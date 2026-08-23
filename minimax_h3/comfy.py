"""Small ComfyUI subprocess client used by the Modal H3 worker."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.request
import uuid
from collections.abc import Callable

COMFY_DIR = "/root/comfy/ComfyUI"
INPUT_ROOT = f"{COMFY_DIR}/input"
OUTPUT_ROOT = f"{COMFY_DIR}/output"
DEFAULT_PORT = 8188
WEBSOCKET_TIMEOUT_SECONDS = 15
STALL_TIMEOUT_SECONDS = 5 * 60
WORKFLOW_TIMEOUT_SECONDS = 45 * 60
PROMPT_MISSING_TIMEOUT_SECONDS = 60


class ComfyWorkflowStalled(TimeoutError):
    """Raised when ComfyUI owns a running prompt but stops making progress."""


def symlink_models(source: str = "/models", target: str = f"{COMFY_DIR}/models") -> None:
    """Point ComfyUI's model directory at the mounted Modal Volume."""
    if os.path.exists(target) and not os.path.islink(target):
        shutil.rmtree(target)
    if not os.path.exists(target):
        os.symlink(source, target)
        print(f"Symlinked {source} -> {target}", flush=True)


def start_comfyui(port: int = DEFAULT_PORT) -> subprocess.Popen:
    """Start the pinned ComfyUI server in the background."""
    return subprocess.Popen(
        [
            "python3",
            "main.py",
            "--port",
            str(port),
            "--listen",
            "127.0.0.1",
            "--disable-auto-launch",
            "--disable-metadata",
            "--use-ck-attention",
        ],
        cwd=COMFY_DIR,
    )


def wait_for_server(
    port: int = DEFAULT_PORT,
    attempts: int = 600,
    request_timeout: float = 2,
) -> None:
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/history", timeout=request_timeout
            ) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError(f"ComfyUI did not become ready within {attempts} seconds")


def audit_workflow_nodes(workflow: dict, port: int = DEFAULT_PORT) -> None:
    required = {node["class_type"] for node in workflow.values()}
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/object_info") as response:
        registered = set(json.loads(response.read().decode("utf-8")))
    missing = sorted(required - registered)
    if missing:
        raise RuntimeError(f"ComfyUI is missing workflow nodes: {missing}")


def find_output(outputs: dict, extensions: tuple[str, ...]) -> str | None:
    """Find the first saved ComfyUI output matching one of `extensions`."""
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        for entries in node_output.values():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                filename = entry.get("filename")
                if not filename or not filename.lower().endswith(extensions):
                    continue
                return os.path.join(
                    OUTPUT_ROOT, entry.get("subfolder", ""), filename
                )
    return None


def _request_json(url: str, *, data: dict | None = None, timeout: float = 5) -> dict:
    request_data = None
    headers = {}
    if data is not None:
        request_data = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=request_data, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        value = json.loads(response.read().decode("utf-8"))
    return value if isinstance(value, dict) else {}


def _queue_contains(entries: object, prompt_id: str) -> bool:
    if not isinstance(entries, list):
        return False
    return any(
        isinstance(entry, list) and len(entry) > 1 and entry[1] == prompt_id
        for entry in entries
    )


def prompt_state(prompt_id: str, port: int = DEFAULT_PORT) -> tuple[str, dict | None]:
    """Return ComfyUI's authoritative state for one submitted prompt."""
    queue = _request_json(f"http://127.0.0.1:{port}/queue", timeout=3)
    if _queue_contains(queue.get("queue_running"), prompt_id):
        return "running", None
    if _queue_contains(queue.get("queue_pending"), prompt_id):
        return "pending", None
    history = _request_json(f"http://127.0.0.1:{port}/history/{prompt_id}", timeout=3)
    record = history.get(prompt_id)
    if isinstance(record, dict):
        return "finished", record
    return "missing", None


def cancel_prompt(prompt_id: str, port: int = DEFAULT_PORT) -> bool:
    """Cancel a running or pending ComfyUI prompt without touching other work."""
    response = _request_json(
        f"http://127.0.0.1:{port}/api/jobs/{prompt_id}/cancel",
        data={},
        timeout=5,
    )
    return response.get("cancelled") is True


def _history_outputs(prompt_id: str, record: dict) -> dict:
    status = record.get("status") or {}
    if isinstance(status, dict) and status.get("status_str") == "error":
        messages = status.get("messages") or []
        detail = json.dumps(messages, ensure_ascii=False)[:4000]
        raise RuntimeError(f"ComfyUI execution failed: {detail}")
    outputs = record.get("outputs")
    return outputs if isinstance(outputs, dict) else {}


def submit_and_watch(
    workflow: dict,
    port: int = DEFAULT_PORT,
    on_event: Callable[[str, dict], None] | None = None,
) -> dict:
    """Submit a workflow and wait for its matching WebSocket completion event."""
    from websocket import WebSocketTimeoutException, create_connection

    client_id = uuid.uuid4().hex
    websocket = create_connection(
        f"ws://127.0.0.1:{port}/ws?clientId={client_id}",
        timeout=WEBSOCKET_TIMEOUT_SECONDS,
    )
    prompt_id: str | None = None
    finished = False
    try:
        payload = json.dumps(
            {"prompt": workflow, "client_id": client_id}
        ).encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/prompt",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request) as response:
            submitted = json.loads(response.read().decode("utf-8"))
        prompt_id = submitted["prompt_id"]
        workflow_deadline = time.monotonic() + WORKFLOW_TIMEOUT_SECONDS
        last_progress_at = time.monotonic()
        missing_since: float | None = None
        last_watchdog_state: str | None = None

        while True:
            try:
                raw = websocket.recv()
            except WebSocketTimeoutException as error:
                now = time.monotonic()
                if now >= workflow_deadline:
                    raise TimeoutError(
                        f"ComfyUI did not finish within {WORKFLOW_TIMEOUT_SECONDS} seconds"
                    ) from error
                try:
                    state, record = prompt_state(prompt_id, port)
                except Exception as state_error:
                    state, record = "unreachable", None
                    print(f"ComfyUI watchdog could not read prompt state: {state_error}", flush=True)
                if state != last_watchdog_state:
                    print(f"ComfyUI prompt {prompt_id} watchdog state: {state}", flush=True)
                    last_watchdog_state = state
                if state == "finished" and record is not None:
                    outputs = _history_outputs(prompt_id, record)
                    finished = True
                    return outputs
                if state == "pending":
                    missing_since = None
                    continue
                if state == "running":
                    missing_since = None
                    if now - last_progress_at >= STALL_TIMEOUT_SECONDS:
                        raise ComfyWorkflowStalled(
                            f"ComfyUI prompt {prompt_id} made no progress for "
                            f"{STALL_TIMEOUT_SECONDS} seconds"
                        ) from error
                    continue
                if state == "missing":
                    missing_since = missing_since or now
                    if now - missing_since >= PROMPT_MISSING_TIMEOUT_SECONDS:
                        raise RuntimeError(f"ComfyUI lost prompt {prompt_id}") from error
                    continue
                if now - last_progress_at >= STALL_TIMEOUT_SECONDS:
                    raise ComfyWorkflowStalled(
                        f"ComfyUI became unreachable with no progress for "
                        f"{STALL_TIMEOUT_SECONDS} seconds"
                    ) from error
                continue
            if not isinstance(raw, str):
                continue
            message = json.loads(raw)
            data = message.get("data") or {}
            if data.get("prompt_id") != prompt_id:
                continue
            message_type = str(message.get("type") or "")
            last_progress_at = time.monotonic()
            missing_since = None
            if on_event:
                on_event(message_type, data)
            if message_type == "execution_error":
                detail = json.dumps(data, ensure_ascii=False)[:4000]
                raise RuntimeError(f"ComfyUI execution failed: {detail}")
            if message_type == "execution_success":
                break
            if message_type == "executing" and data.get("node") is None:
                break

        history = _request_json(f"http://127.0.0.1:{port}/history/{prompt_id}")
        record = history.get(prompt_id)
        if not isinstance(record, dict):
            raise RuntimeError(f"ComfyUI completed without history for prompt {prompt_id}")
        outputs = _history_outputs(prompt_id, record)
        finished = True
        return outputs
    finally:
        if prompt_id is not None and not finished:
            try:
                cancel_prompt(prompt_id, port)
            except Exception as cancel_error:
                print(f"Could not cancel ComfyUI prompt {prompt_id}: {cancel_error}", flush=True)
        websocket.close()
