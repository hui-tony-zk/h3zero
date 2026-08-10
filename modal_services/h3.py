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
from minimax_h3.workflow import (
    BASE_SAMPLER,
    BASE_SCHEDULER,
    BASE_STEPS,
    TURBO_SAMPLER,
    TURBO_SCHEDULER,
    TURBO_STEPS,
    validate_image_bytes,
)
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
    cpu=2,
    memory=4096,
    volumes={jobs.OUTPUT_ROOT: output_volume},
    timeout=15 * 60,
    scaledown_window=30,
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
    turbo: bool = True,
    steps: int = 0,
    sampler: str = "",
    scheduler: str = "",
    first_frame: str = "",
    last_frame: str = "",
) -> None:
    """Call the separately deployed worker and save the returned MP4 locally."""
    service = modal.Cls.from_name(GPU_APP_NAME, "H3Service")()
    result = service.generate.remote(
        prompt=prompt,
        width=width,
        height=height,
        duration_seconds=duration_seconds,
        seed=None if seed < 0 else seed,
        turbo=turbo,
        steps=steps or (TURBO_STEPS if turbo else BASE_STEPS),
        sampler=sampler or (TURBO_SAMPLER if turbo else BASE_SAMPLER),
        scheduler=scheduler or (TURBO_SCHEDULER if turbo else BASE_SCHEDULER),
        first_frame=_read_keyframe(first_frame, "first"),
        last_frame=_read_keyframe(last_frame, "last"),
    )

    destination = Path(out).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(result["video"])
    print(f"Saved {destination} (seed {result['seed']})", flush=True)
