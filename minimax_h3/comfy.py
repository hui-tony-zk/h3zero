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
            "--use-sage-attention",
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


def submit_and_watch(
    workflow: dict,
    port: int = DEFAULT_PORT,
    on_event: Callable[[str, dict], None] | None = None,
) -> dict:
    """Submit a workflow and wait for its matching WebSocket completion event."""
    from websocket import create_connection

    client_id = uuid.uuid4().hex
    websocket = create_connection(
        f"ws://127.0.0.1:{port}/ws?clientId={client_id}", timeout=60
    )
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

        while True:
            raw = websocket.recv()
            if not isinstance(raw, str):
                continue
            message = json.loads(raw)
            data = message.get("data") or {}
            if data.get("prompt_id") != prompt_id:
                continue
            message_type = str(message.get("type") or "")
            if on_event:
                on_event(message_type, data)
            if message_type == "execution_error":
                detail = json.dumps(data, ensure_ascii=False)[:4000]
                raise RuntimeError(f"ComfyUI execution failed: {detail}")
            if message_type == "execution_success":
                break
            if message_type == "executing" and data.get("node") is None:
                break

        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/history/{prompt_id}"
        ) as response:
            history = json.loads(response.read().decode("utf-8"))
        return history[prompt_id].get("outputs", {})
    finally:
        websocket.close()
