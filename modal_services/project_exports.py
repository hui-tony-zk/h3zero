"""Durable, CPU-only project export storage and FFmpeg rendering."""

from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Callable

from modal_services import jobs

EXPORT_STATUSES = {"queued", "running", "completed", "failed"}
EXPORT_RETENTION_SECONDS = 24 * 60 * 60
MAX_PROJECT_CLIPS = 24
MAX_PROJECT_EXPORT_BYTES = 2 * 1024 * 1024 * 1024
PLAYBACK_RATES = {0.5, 0.75, 1.0, 1.25, 1.5, 2.0}
PROJECT_TRANSITION_SECONDS = 0.5
PROJECT_EXPORT_FPS = 24
_EXPORT_ID = re.compile(r"^[a-f0-9]{32}$")
_CLIP_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def validate_export_id(export_id: str) -> str:
    if not _EXPORT_ID.fullmatch(export_id):
        raise ValueError("invalid export id")
    return export_id


def export_dir(export_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> Path:
    return Path(root) / "project-exports" / validate_export_id(export_id)


def metadata_path(export_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> Path:
    return export_dir(export_id, root) / "metadata.json"


def input_path(export_id: str, job_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> Path:
    return export_dir(export_id, root) / "inputs" / f"{jobs.validate_job_id(job_id)}.mp4"


def video_path(export_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> Path:
    return export_dir(export_id, root) / "output.mp4"


def _finite(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite")
    return number


def normalize_project(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("project must be an object")
    name = str(value.get("name") or "Untitled project").strip()[:120] or "Untitled project"
    aspect = value.get("aspect")
    if aspect not in {"16:9", "9:16"}:
        raise ValueError("project aspect must be 16:9 or 9:16")
    raw_clips = value.get("clips")
    if not isinstance(raw_clips, list) or not raw_clips:
        raise ValueError("project must contain at least one clip")
    if len(raw_clips) > MAX_PROJECT_CLIPS:
        raise ValueError(f"projects may export at most {MAX_PROJECT_CLIPS} clips")

    clips = []
    seen_ids = set()
    for index, raw in enumerate(raw_clips):
        if not isinstance(raw, dict):
            raise ValueError(f"clip {index + 1} must be an object")
        clip_id = str(raw.get("id") or "")
        if not _CLIP_ID.fullmatch(clip_id) or clip_id in seen_ids:
            raise ValueError(f"clip {index + 1} has an invalid or duplicate id")
        seen_ids.add(clip_id)
        job_id = jobs.validate_job_id(str(raw.get("jobId") or ""))
        in_point = max(0.0, _finite(raw.get("inPoint"), f"clip {index + 1} inPoint"))
        out_point = _finite(raw.get("outPoint"), f"clip {index + 1} outPoint")
        source_duration = _finite(
            raw.get("sourceDuration"),
            f"clip {index + 1} sourceDuration",
        )
        playback_rate = _finite(
            raw.get("playbackRate"),
            f"clip {index + 1} playbackRate",
        )
        if out_point - in_point < 0.25:
            raise ValueError(f"clip {index + 1} must be at least 0.25 seconds")
        if source_duration < out_point - 0.05:
            raise ValueError(f"clip {index + 1} exceeds its source duration")
        if playback_rate not in PLAYBACK_RATES:
            raise ValueError(f"clip {index + 1} has an unsupported playback rate")
        clips.append({
            "id": clip_id,
            "jobId": job_id,
            "inPoint": in_point,
            "outPoint": out_point,
            "sourceDuration": source_duration,
            "playbackRate": playback_rate,
            "order": index,
        })
    return {"name": name, "aspect": aspect, "clips": clips}


def _atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def create_export(export_id: str, project: dict, root: str | Path = jobs.OUTPUT_ROOT) -> dict:
    now = jobs.utc_now()
    record = {
        "id": validate_export_id(export_id),
        "status": "queued",
        "created_at": now,
        "created_at_unix": time.time(),
        "updated_at": now,
        "project": normalize_project(project),
        "call_id": None,
        "progress": {"phase": "queued", "message": "Starting export", "percent": 0.0},
        "error": None,
    }
    _atomic_json(metadata_path(export_id, root), record)
    return record


def read_export(export_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> dict | None:
    path = metadata_path(export_id, root)
    if not path.is_file():
        return None
    record = json.loads(path.read_text(encoding="utf-8"))
    if record.get("id") != export_id or record.get("status") not in EXPORT_STATUSES:
        raise ValueError("invalid project export metadata")
    return record


def update_export(export_id: str, root: str | Path = jobs.OUTPUT_ROOT, **changes) -> dict:
    record = read_export(export_id, root)
    if record is None:
        raise FileNotFoundError(f"unknown project export: {export_id}")
    status = changes.get("status", record["status"])
    if status not in EXPORT_STATUSES:
        raise ValueError("invalid project export status")
    record.update(changes)
    record["status"] = status
    record["updated_at"] = jobs.utc_now()
    _atomic_json(metadata_path(export_id, root), record)
    return record


def public_export(record: dict, progress: dict | None = None) -> dict:
    completed = record["status"] == "completed"
    return {
        "id": record["id"],
        "status": record["status"],
        "progress": progress or record.get("progress"),
        "error": record.get("error"),
        "download_url": f"/api/project-exports/{record['id']}/video" if completed else None,
        "filename": f"{safe_download_name(record['project']['name'])}.mp4" if completed else None,
    }


def safe_download_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "", value).strip(" .")
    return cleaned or "h3zero-project"


def delete_export(export_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> None:
    shutil.rmtree(export_dir(export_id, root), ignore_errors=True)


def cleanup_stale_exports(
    root: str | Path = jobs.OUTPUT_ROOT,
    *,
    now: float | None = None,
    retention_seconds: float = EXPORT_RETENTION_SECONDS,
) -> list[str]:
    exports_root = Path(root) / "project-exports"
    if not exports_root.is_dir():
        return []
    current = time.time() if now is None else float(now)
    removed = []
    for directory in exports_root.iterdir():
        if not directory.is_dir():
            continue
        try:
            export_id = validate_export_id(directory.name)
            old = current - directory.stat().st_mtime >= retention_seconds
        except (OSError, ValueError):
            continue
        if old:
            shutil.rmtree(directory, ignore_errors=True)
            removed.append(export_id)
    return removed


def _has_audio(path: Path) -> bool:
    completed = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return completed.returncode == 0 and "audio" in completed.stdout


def composition_size(aspect: str) -> tuple[int, int]:
    return (720, 1280) if aspect == "9:16" else (1280, 720)


def build_ffmpeg_command(
    record: dict,
    output: Path,
    *,
    root: str | Path = jobs.OUTPUT_ROOT,
    include_audio: bool,
) -> tuple[list[str], float]:
    clips = record["project"]["clips"]
    width, height = composition_size(record["project"]["aspect"])
    input_args = []
    filters = []
    video_labels = []
    audio_labels = []
    total_duration = 0.0
    for index, clip in enumerate(clips):
        source = input_path(record["id"], clip["jobId"], root)
        source_span = clip["outPoint"] - clip["inPoint"]
        rate = clip["playbackRate"]
        total_duration += source_span / rate
        input_args.extend(["-ss", str(clip["inPoint"]), "-t", str(source_span), "-i", str(source)])
        fade_count = int(index > 0) + int(index < len(clips) - 1)
        fade_budget = max(0.0, source_span / rate - (1 / PROJECT_EXPORT_FPS))
        fade_duration = min(
            PROJECT_TRANSITION_SECONDS,
            fade_budget / fade_count,
        ) if fade_count else 0.0
        video_filters = [
            f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black",
            "setsar=1",
            f"fps={PROJECT_EXPORT_FPS}",
            "format=yuv420p",
            "settb=AVTB",
            f"setpts=(PTS-STARTPTS)/{rate}",
        ]
        if index > 0 and fade_duration > 0:
            video_filters.append(f"fade=t=in:st=0:d={fade_duration}:color=black")
        if index < len(clips) - 1 and fade_duration > 0:
            fade_start = max(0.0, source_span / rate - fade_duration)
            video_filters.append(
                f"fade=t=out:st={fade_start}:d={fade_duration}:color=black"
            )
        filters.append(f"[{index}:v]" + ",".join(video_filters) + f"[v{index}]")
        video_labels.append(f"[v{index}]")
        if include_audio:
            filters.append(
                f"[{index}:a]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS,"
                f"atempo={rate}[a{index}]"
            )
            audio_labels.append(f"[a{index}]")

    if len(clips) == 1:
        video_output = "v0"
        audio_output = "a0"
    else:
        video_output = "outv"
        audio_output = "outa"
        concat_inputs = "".join(
            video_labels[index] + (audio_labels[index] if include_audio else "")
            for index in range(len(clips))
        )
        if include_audio:
            filters.append(f"{concat_inputs}concat=n={len(clips)}:v=1:a=1[{video_output}][{audio_output}]")
        else:
            filters.append(f"{concat_inputs}concat=n={len(clips)}:v=1:a=0[{video_output}]")

    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", *input_args,
        "-filter_complex", ";".join(filters), "-map", f"[{video_output}]",
    ]
    if include_audio:
        command.extend(["-map", f"[{audio_output}]", "-c:a", "aac", "-b:a", "192k"])
    else:
        command.append("-an")
    command.extend([
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats", str(output),
    ])
    return command, total_duration


def render_export(
    export_id: str,
    *,
    root: str | Path = jobs.OUTPUT_ROOT,
    on_progress: Callable[[str, str, float], None] | None = None,
) -> dict:
    record = read_export(export_id, root)
    if record is None:
        raise FileNotFoundError("project export not found")
    sources = [input_path(export_id, clip["jobId"], root) for clip in record["project"]["clips"]]
    missing = [path.name for path in sources if not path.is_file()]
    if missing:
        raise RuntimeError("Missing project video: " + ", ".join(missing[:3]))
    include_audio = all(_has_audio(path) for path in sources)

    with tempfile.TemporaryDirectory(prefix=f"h3zero-export-{export_id}-") as temporary:
        local_output = Path(temporary) / "output.mp4"
        command, total_duration = build_ffmpeg_command(
            record,
            local_output,
            root=root,
            include_audio=include_audio,
        )
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        output_tail = []
        last_percent = -1.0
        assert process.stdout is not None
        for raw_line in process.stdout:
            line = raw_line.strip()
            if not line:
                continue
            output_tail = (output_tail + [line])[-50:]
            if line.startswith(("out_time_us=", "out_time_ms=")):
                try:
                    elapsed = float(line.split("=", 1)[1]) / 1_000_000
                except ValueError:
                    continue
                percent = min(0.98, max(0.0, elapsed / max(0.01, total_duration)))
                if on_progress and percent - last_percent >= 0.02:
                    last_percent = percent
                    on_progress("rendering", f"Rendering MP4 {round(percent * 100)}%", percent)
        return_code = process.wait()
        if return_code:
            detail = "\n".join(output_tail)[-1200:] or f"ffmpeg exited with {return_code}"
            raise RuntimeError(f"FFmpeg export failed: {detail}")
        destination = video_path(export_id, root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_output, destination)
    return {"filename": f"{safe_download_name(record['project']['name'])}.mp4"}
