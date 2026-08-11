"""Durable filesystem contract for asynchronous H3 jobs."""

from __future__ import annotations

import json
import re
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

OUTPUT_ROOT = "/outputs"
JOB_STATUSES = {"queued", "running", "completed", "failed", "expired"}
JOB_RETENTION_SECONDS = 24 * 60 * 60
TOMBSTONE_RETENTION_SECONDS = 7 * 24 * 60 * 60
_JOB_ID = re.compile(r"^[a-f0-9]{32}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_job_id(job_id: str) -> str:
    if not _JOB_ID.fullmatch(job_id):
        raise ValueError("invalid job id")
    return job_id


def _root(root: str | Path = OUTPUT_ROOT) -> Path:
    return Path(root)


def metadata_path(job_id: str, root: str | Path = OUTPUT_ROOT) -> Path:
    return _root(root) / "jobs" / f"{validate_job_id(job_id)}.json"


def call_id_path(job_id: str, root: str | Path = OUTPUT_ROOT) -> Path:
    return _root(root) / "calls" / f"{validate_job_id(job_id)}.txt"


def video_path(job_id: str, root: str | Path = OUTPUT_ROOT) -> Path:
    return _root(root) / "videos" / f"{validate_job_id(job_id)}.mp4"


def tombstone_path(job_id: str, root: str | Path = OUTPUT_ROOT) -> Path:
    return _root(root) / "deleted" / f"{validate_job_id(job_id)}.json"


def input_dir(job_id: str, root: str | Path = OUTPUT_ROOT) -> Path:
    return _root(root) / "inputs" / validate_job_id(job_id)


def input_path(job_id: str, filename: str, root: str | Path = OUTPUT_ROOT) -> Path:
    if not filename or Path(filename).name != filename:
        raise ValueError("invalid input filename")
    return input_dir(job_id, root) / filename


def _atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def create_job(
    job_id: str,
    *,
    prompt: str,
    config: dict,
    has_first_frame: bool,
    has_last_frame: bool,
    root: str | Path = OUTPUT_ROOT,
) -> dict:
    now = utc_now()
    record = {
        "id": validate_job_id(job_id),
        "status": "queued",
        "created_at": now,
        "created_at_unix": time.time(),
        "updated_at": now,
        "request": {
            "prompt": prompt,
            **config,
            "has_first_frame": has_first_frame,
            "has_last_frame": has_last_frame,
        },
        "result": None,
        "error": None,
        "call_id": None,
        "progress": {
            "phase": "queued",
            "message": "Waiting for the GPU worker",
            "updated_at": now,
        },
    }
    write_job(record, root=root)
    return record


def read_job(job_id: str, root: str | Path = OUTPUT_ROOT) -> dict | None:
    path = metadata_path(job_id, root)
    if not path.is_file():
        return None
    record = json.loads(path.read_text(encoding="utf-8"))
    if record.get("id") != job_id or record.get("status") not in JOB_STATUSES:
        raise ValueError(f"invalid job metadata: {path}")
    return record


def write_job(record: dict, root: str | Path = OUTPUT_ROOT) -> dict:
    job_id = validate_job_id(str(record.get("id", "")))
    status = str(record.get("status", ""))
    if status not in JOB_STATUSES:
        raise ValueError(f"invalid job status: {status}")
    next_record = {**record, "id": job_id, "status": status}
    _atomic_text(
        metadata_path(job_id, root),
        json.dumps(next_record, ensure_ascii=False, sort_keys=True),
    )
    return next_record


def update_job(
    job_id: str,
    *,
    root: str | Path = OUTPUT_ROOT,
    **changes,
) -> dict:
    record = read_job(job_id, root)
    if record is None:
        raise FileNotFoundError(f"unknown job: {job_id}")
    record.update(changes)
    record["updated_at"] = utc_now()
    return write_job(record, root=root)


def write_call_id(
    job_id: str,
    call_id: str,
    root: str | Path = OUTPUT_ROOT,
) -> None:
    if not call_id.strip():
        raise ValueError("call id must not be blank")
    _atomic_text(call_id_path(job_id, root), call_id.strip())


def read_call_id(job_id: str, root: str | Path = OUTPUT_ROOT) -> str | None:
    path = call_id_path(job_id, root)
    if not path.is_file():
        return None
    return path.read_text(encoding="utf-8").strip() or None


def mark_deleted(job_id: str, root: str | Path = OUTPUT_ROOT) -> None:
    _atomic_text(
        tombstone_path(job_id, root),
        json.dumps({"id": validate_job_id(job_id), "deleted_at": utc_now()}),
    )


def is_deleted(job_id: str, root: str | Path = OUTPUT_ROOT) -> bool:
    return tombstone_path(job_id, root).is_file()


def delete_job_artifacts(job_id: str, root: str | Path = OUTPUT_ROOT) -> None:
    for path in (
        metadata_path(job_id, root),
        call_id_path(job_id, root),
        video_path(job_id, root),
    ):
        path.unlink(missing_ok=True)
    shutil.rmtree(input_dir(job_id, root), ignore_errors=True)


def cleanup_stale_jobs(
    root: str | Path = OUTPUT_ROOT,
    *,
    now: float | None = None,
    retention_seconds: float = JOB_RETENTION_SECONDS,
    tombstone_retention_seconds: float = TOMBSTONE_RETENTION_SECONDS,
) -> dict:
    """Remove delivered/abandoned job artifacts while leaving favorites alone."""
    root_path = _root(root)
    current_time = time.time() if now is None else float(now)
    removed: list[str] = []
    jobs_dir = root_path / "jobs"
    if jobs_dir.is_dir():
        for path in jobs_dir.glob("*.json"):
            try:
                job_id = validate_job_id(path.stem)
                record = read_job(job_id, root_path)
                age = current_time - path.stat().st_mtime
            except (json.JSONDecodeError, OSError, ValueError):
                continue
            if record is None or age < retention_seconds:
                continue
            if record["status"] in {"queued", "running"}:
                mark_deleted(job_id, root_path)
            delete_job_artifacts(job_id, root_path)
            removed.append(job_id)

    # Old versions could leave files behind without metadata. Once they have
    # aged past the same delivery window, they are safe to prune.
    for directory_name, pattern in (("videos", "*.mp4"), ("calls", "*.txt")):
        directory = root_path / directory_name
        if not directory.is_dir():
            continue
        for path in directory.glob(pattern):
            try:
                job_id = validate_job_id(path.stem)
                orphaned = not metadata_path(job_id, root_path).is_file()
                old = current_time - path.stat().st_mtime >= retention_seconds
            except (OSError, ValueError):
                continue
            if orphaned and old:
                path.unlink(missing_ok=True)

    inputs_root = root_path / "inputs"
    if inputs_root.is_dir():
        for directory in inputs_root.iterdir():
            try:
                orphaned = not metadata_path(validate_job_id(directory.name), root_path).is_file()
                old = current_time - directory.stat().st_mtime >= retention_seconds
            except (OSError, ValueError):
                continue
            if directory.is_dir() and orphaned and old:
                shutil.rmtree(directory, ignore_errors=True)

    pruned_tombstones = 0
    deleted_dir = root_path / "deleted"
    if deleted_dir.is_dir():
        for path in deleted_dir.glob("*.json"):
            try:
                old = current_time - path.stat().st_mtime >= tombstone_retention_seconds
            except OSError:
                continue
            if old:
                path.unlink(missing_ok=True)
                pruned_tombstones += 1
    return {"removed_job_ids": removed, "pruned_tombstones": pruned_tombstones}


def public_job(record: dict, progress: dict | None = None) -> dict:
    """Return the stable browser-facing job representation."""
    job_id = validate_job_id(str(record["id"]))
    result = record.get("result")
    if isinstance(result, dict):
        result = {**result, "video_url": f"/api/jobs/{job_id}/video"}
    video_url = f"/api/jobs/{job_id}/video" if record["status"] == "completed" else None
    request = record.get("request") or {}
    return {
        "id": job_id,
        "mode": request.get("mode", "frames"),
        "status": record["status"],
        "created_at": record["created_at"],
        "updated_at": record["updated_at"],
        "sampling_started_at": record.get("sampling_started_at"),
        "request": request,
        "result": result,
        "error": record.get("error"),
        "progress": progress or record.get("progress"),
        "status_url": f"/api/jobs/{job_id}",
        "video_url": video_url,
    }
