"""CPU-only Modal web app and local client entrypoint for H3Zero.

The public gateway is deployed independently from the GPU worker so frontend
changes do not version the worker or invalidate its CPU memory snapshots.
"""

from __future__ import annotations

from pathlib import Path

import modal

from minimax_h3.config import (
    GPU_APP_NAME,
    OUTPUT_VOLUME_NAME,
    PROGRESS_DICT_NAME,
    WEB_APP_NAME,
)
from minimax_h3.specs import resolve_sampling_profile
from minimax_h3.workflow import validate_image_bytes
from modal_services import jobs


output_volume = modal.Volume.from_name(OUTPUT_VOLUME_NAME, create_if_missing=True)
progress_store = modal.Dict.from_name(PROGRESS_DICT_NAME, create_if_missing=True)

frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
web_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("fastapi==0.141.1", "python-multipart==0.0.32")
    .env({"H3_CONTAINER_ROLE": "web"})
)
if (frontend_dist / "index.html").is_file():
    web_image = web_image.add_local_dir(
        frontend_dist,
        remote_path="/frontend/dist",
        copy=True,
    )
web_image = web_image.add_local_python_source("minimax_h3", "modal_services")

app = modal.App(WEB_APP_NAME)


@app.function(
    image=web_image,
    volumes={jobs.OUTPUT_ROOT: output_volume},
    timeout=15 * 60,
    schedule=modal.Period(hours=6),
)
def maintain_outputs():
    """Migrate legacy favorites before pruning temporary job storage."""
    from modal_services import favorites

    output_volume.reload()
    migration = favorites.migrate_legacy_videos()
    # Make favorite-owned copies durable before deleting any legacy job video.
    output_volume.commit()

    cleanup = jobs.cleanup_stale_jobs()
    live_job_ids = set()
    jobs_directory = Path(jobs.OUTPUT_ROOT) / "jobs"
    if jobs_directory.is_dir():
        live_job_ids = {path.stem for path in jobs_directory.glob("*.json")}
    removed_progress = 0
    try:
        for key in list(progress_store.keys()):
            if isinstance(key, str) and key not in live_job_ids:
                progress_store.pop(key)
                removed_progress += 1
    except Exception as exc:
        print(f"Could not finish progress cleanup: {exc}", flush=True)
    output_volume.commit()
    result = {
        "migration": migration,
        "cleanup": cleanup,
        "removed_progress": removed_progress,
    }
    print(f"H3 output maintenance: {result}", flush=True)
    return result


@app.function(
    image=web_image,
    volumes={jobs.OUTPUT_ROOT: output_volume},
    timeout=15 * 60,
    scaledown_window=15,
    max_containers=2,
)
@modal.asgi_app()
def web():
    """CPU-only gateway; API polling and health never invoke the GPU."""
    from modal_services.gateway import create_gateway

    Service = modal.Cls.from_name(GPU_APP_NAME, "H3Service")
    return create_gateway(
        output_volume=output_volume,
        service_factory=Service,
        function_call_from_id=modal.FunctionCall.from_id,
        progress_store=progress_store,
    )


def _read_keyframe(path: str, label: str) -> bytes | None:
    if not path:
        return None
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"{label} frame does not exist: {source}")
    raw = source.read_bytes()
    validate_image_bytes(raw)
    return raw


@app.local_entrypoint()
def main(
    prompt: str,
    out: str = "outputs/minimax-h3.mp4",
    width: int = 864,
    height: int = 480,
    duration_seconds: float = 5,
    seed: int = -1,
    resolution: str = "480p",
    turbo: bool = True,
    sampling_profile: str = "",
    steps: int = 0,
    sampler: str = "",
    scheduler: str = "",
    first_frame: str = "",
    last_frame: str = "",
) -> None:
    """Call the separately deployed worker and save the returned MP4 locally."""
    profile_id, profile = resolve_sampling_profile(
        sampling_profile or None,
        turbo=turbo,
    )
    service = modal.Cls.from_name(GPU_APP_NAME, "H3Service")()
    result = service.generate.remote(
        prompt=prompt,
        width=width,
        height=height,
        duration_seconds=duration_seconds,
        seed=None if seed < 0 else seed,
        resolution=resolution,
        turbo=profile["turbo"],
        sampling_profile=profile_id,
        steps=steps or profile["steps"]["default"],
        sampler=sampler or profile["sampler"],
        scheduler=scheduler or profile["scheduler"],
        first_frame=_read_keyframe(first_frame, "first"),
        last_frame=_read_keyframe(last_frame, "last"),
    )

    destination = Path(out).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(result["video"])
    print(f"Saved {destination} (seed {result['seed']})", flush=True)
