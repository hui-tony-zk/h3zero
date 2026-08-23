"""Dedicated Modal GPU app for MiniMax H3 FL2VA and Ref2VA generation.

Run ``npm run setup`` once, then generate with:

    npm run generate -- --prompt "A cinematic lighthouse in a storm."
"""

from __future__ import annotations

import os
import secrets
import shutil
import uuid
from pathlib import Path

import modal

from minimax_h3 import comfy as comfy_client
from minimax_h3 import hf
from minimax_h3.loras import active_loras, download_specs, resolve_lora_strengths
from minimax_h3.progress import progress_from_comfy_event
from minimax_h3.specs import (
    SPECTRUM_VERSION,
    TURBO_4_LORA,
    TURBO_8_LORA,
    TURBO_LORA_STRENGTH,
    resolve_sampling_profile,
)
from minimax_h3.runtime import (
    ATTENTION_BACKEND,
    COMFY_KITCHEN_VERSION,
    PYTORCH_CUDA_INDEX,
    PYTORCH_VERSION,
    TORCHAUDIO_VERSION,
    TORCHVISION_VERSION,
    verify_gpu_runtime,
)
from minimax_h3.config import (
    GPU_APP_NAME,
    GPU_SCALEDOWN_WINDOW_SECONDS,
    MODEL_VOLUME_NAME,
    OUTPUT_VOLUME_NAME,
    PROGRESS_DICT_NAME,
)
from minimax_h3.workflow import (
    AUDIO_VAE,
    FRAME_DIFFUSION_MODEL,
    REFERENCE_CONDITIONING_DIFFUSION_MODEL,
    REFERENCE_DIFFUSION_MODEL,
    TEXT_ENCODER,
    VIDEO_VAE,
    aligned_frame_count,
    build_frames_workflow,
    build_reference_workflow,
    validate_image_bytes,
)
from modal_services import jobs

COMFY_COMMIT = "2f35f4a08176d993cded35dac3332be4f7287f41"
MODEL_REVISION = "cfc0a7e86b7bfd99199db90a536ab187af61a8b9"
MODEL_REPO = "Comfy-Org/MiniMax-H3"
TURBO_REVISION = "e6346777701aa2b64d42ed058cdd71ae00e7cd52"
TURBO_REPO = "lightx2v/Minimax-h3-Turbo"
SPECTRUM_COMMIT = "567768f0de500ffbaf404dd9527c7a537819f7cd"
SPECTRUM_REPO = "https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3.git"

MODEL_DOWNLOADS = [
    (
        MODEL_REPO,
        f"diffusion_models/{FRAME_DIFFUSION_MODEL}",
        "diffusion_models",
        FRAME_DIFFUSION_MODEL,
        MODEL_REVISION,
    ),
    # Retain Ref2VA in the Volume for fallback and controlled comparisons even
    # though the production reference workflow currently runs on FL2VA.
    (
        MODEL_REPO,
        f"diffusion_models/{REFERENCE_DIFFUSION_MODEL}",
        "diffusion_models",
        REFERENCE_DIFFUSION_MODEL,
        MODEL_REVISION,
    ),
    (
        MODEL_REPO,
        f"text_encoders/{TEXT_ENCODER}",
        "text_encoders",
        TEXT_ENCODER,
        MODEL_REVISION,
    ),
    (
        MODEL_REPO,
        f"vae/{VIDEO_VAE}",
        "vae",
        VIDEO_VAE,
        MODEL_REVISION,
    ),
    (
        MODEL_REPO,
        f"vae/{AUDIO_VAE}",
        "vae",
        AUDIO_VAE,
        MODEL_REVISION,
    ),
    (
        TURBO_REPO,
        TURBO_4_LORA,
        "loras",
        TURBO_4_LORA,
        TURBO_REVISION,
    ),
    (
        TURBO_REPO,
        TURBO_8_LORA,
        "loras",
        TURBO_8_LORA,
        TURBO_REVISION,
    ),
] + download_specs()

model_volume = modal.Volume.from_name(MODEL_VOLUME_NAME, create_if_missing=True)
output_volume = modal.Volume.from_name(OUTPUT_VOLUME_NAME, create_if_missing=True)
progress_store = modal.Dict.from_name(PROGRESS_DICT_NAME, create_if_missing=True)

download_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("huggingface-hub==1.26.0", "hf-xet")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
    .add_local_python_source("minimax_h3", "modal_services")
)

comfy_image = (
    modal.Image.from_registry(
        "nvidia/cuda:13.0.2-devel-ubuntu24.04",
        add_python="3.11",
    )
    .entrypoint([])
    .apt_install(
        "git",
        "ffmpeg",
        "libgl1",
        "libglib2.0-0",
    )
    .pip_install("comfy-cli==1.13.0")
    .run_commands("comfy --skip-prompt install --fast-deps --nvidia")
    .run_commands(
        f"git -C /root/comfy/ComfyUI fetch --depth 1 origin {COMFY_COMMIT}",
        f"git -C /root/comfy/ComfyUI checkout --detach {COMFY_COMMIT}",
        "python -m pip install -r /root/comfy/ComfyUI/requirements.txt",
    )
    .run_commands(
        "git init /root/comfy/ComfyUI/custom_nodes/ComfyUI-Spectrum-MiniMax-H3",
        "git -C /root/comfy/ComfyUI/custom_nodes/ComfyUI-Spectrum-MiniMax-H3 "
        f"remote add origin {SPECTRUM_REPO}",
        "git -C /root/comfy/ComfyUI/custom_nodes/ComfyUI-Spectrum-MiniMax-H3 "
        f"fetch --depth 1 origin {SPECTRUM_COMMIT}",
        "git -C /root/comfy/ComfyUI/custom_nodes/ComfyUI-Spectrum-MiniMax-H3 "
        f"checkout --detach {SPECTRUM_COMMIT}",
    )
    .pip_install(
        f"torch=={PYTORCH_VERSION}",
        f"torchvision=={TORCHVISION_VERSION}",
        f"torchaudio=={TORCHAUDIO_VERSION}",
        index_url=PYTORCH_CUDA_INDEX,
    )
    .pip_install("websocket-client==1.9.0")
    .env({
        # Keep Blackwell runtime JIT compilation single-threaded to avoid
        # unstable parallel compiler workers.
        "TORCHINDUCTOR_COMPILE_THREADS": "1",
    })
    .add_local_file(
        "minimax_h3/ordered_refs_node.py",
        remote_path="/root/comfy/ComfyUI/custom_nodes/minimax_h3_ordered_refs.py",
        copy=True,
    )
    .add_local_python_source("minimax_h3", "modal_services")
)

app = modal.App(GPU_APP_NAME)


@app.function(
    image=download_image,
    volumes={"/models": model_volume, jobs.OUTPUT_ROOT: output_volume},
    timeout=6 * 60 * 60,
)
def download_models() -> None:
    """Populate the model Volume without paying for GPU download time."""
    hf.download_files(MODEL_DOWNLOADS)
    model_volume.commit()
    print("MiniMax H3 model volume is ready.", flush=True)


@app.cls(
    image=comfy_image,
    gpu="RTX-PRO-6000",
    volumes={"/models": model_volume, jobs.OUTPUT_ROOT: output_volume},
    timeout=60 * 60,
    startup_timeout=20 * 60,
    scaledown_window=GPU_SCALEDOWN_WINDOW_SECONDS,
    max_containers=1,
    enable_memory_snapshot=True,
)
@modal.concurrent(max_inputs=1)
class H3Service:
    """A single-concurrency H3 worker backed by pinned ComfyUI."""

    port: int = 8188

    @modal.enter(snap=True)
    def prepare_snapshot(self) -> None:
        """Capture CPU-only imports and filesystem setup before GPU startup."""
        comfy_client.symlink_models()
        Path(comfy_client.INPUT_ROOT).mkdir(parents=True, exist_ok=True)
        print("CPU memory snapshot setup ready", flush=True)

    @modal.enter(snap=False)
    def boot(self) -> None:
        """Initialize CUDA and ComfyUI after restoring the CPU snapshot."""
        runtime = verify_gpu_runtime()
        print(f"GPU runtime ready: {runtime}", flush=True)
        hf.require_files_present(MODEL_DOWNLOADS)
        # Keep this idempotent for both initial snapshot creation and restores.
        comfy_client.symlink_models()
        Path(comfy_client.INPUT_ROOT).mkdir(parents=True, exist_ok=True)
        self.comfy_process = comfy_client.start_comfyui(self.port)
        comfy_client.wait_for_server(self.port)
        audit = build_frames_workflow(
            prompt="workflow audit",
            width=864,
            height=480,
            duration_seconds=5,
            seed=0,
            output_stem="audit",
        )
        comfy_client.audit_workflow_nodes(audit, self.port)
        reference_audit = build_reference_workflow(
            prompt="reference workflow audit",
            width=864,
            height=480,
            duration_seconds=5,
            seed=0,
            output_stem="reference-audit",
            references=[
                {
                    "id": "audit-reference",
                    "kind": "image",
                    "slot": 0,
                    "local_filename": "audit-reference.png",
                }
            ],
        )
        comfy_client.audit_workflow_nodes(reference_audit, self.port)
        print(
            f"ComfyUI {COMFY_COMMIT[:12]} ready in {os.environ.get('MODAL_REGION')}",
            flush=True,
        )

    @modal.exit()
    def stop(self) -> None:
        process = getattr(self, "comfy_process", None)
        if process and process.poll() is None:
            process.terminate()

    def _restart_comfyui(self) -> None:
        """Replace a stalled ComfyUI process before this container accepts more work."""
        process = getattr(self, "comfy_process", None)
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except Exception:
                process.kill()
                process.wait(timeout=10)
        self.comfy_process = comfy_client.start_comfyui(self.port)
        comfy_client.wait_for_server(self.port)
        print("ComfyUI restarted after stalled workflow", flush=True)

    def _stage_input(self, raw: bytes | None, label: str) -> str | None:
        if raw is None:
            return None
        suffix = validate_image_bytes(raw)
        filename = f"{uuid.uuid4().hex}-{label}{suffix}"
        (Path(comfy_client.INPUT_ROOT) / filename).write_bytes(raw)
        return filename

    def _stage_references(self, job_id: str, references: list[dict]) -> tuple[list[dict], list[str]]:
        output_volume.reload()
        staged = []
        local_inputs = []
        for index, reference in enumerate(references):
            source_name = reference.get("staged_filename")
            if not isinstance(source_name, str):
                raise ValueError(f"reference {index} is missing staged_filename")
            source = jobs.input_path(job_id, source_name)
            if not source.is_file():
                raise FileNotFoundError(f"staged reference is missing: {source_name}")
            suffix = source.suffix.lower()
            filename = f"{uuid.uuid4().hex}-reference-{index}{suffix}"
            destination = Path(comfy_client.INPUT_ROOT) / filename
            shutil.copyfile(source, destination)
            staged.append({**reference, "local_filename": filename})
            local_inputs.append(filename)
        return staged, local_inputs

    def _put_progress(
        self,
        job_id: str | None,
        phase: str,
        message: str,
        *,
        percent: float | None = None,
    ) -> dict | None:
        if job_id is None:
            return None
        progress = {
            "phase": phase,
            "message": message,
            "updated_at": jobs.utc_now(),
        }
        if percent is not None:
            progress["percent"] = max(0.0, min(1.0, float(percent)))
        progress_store.put(job_id, progress)
        return progress

    def _progress_handler(self, job_id: str | None):
        last = {"signature": None, "sampling_started": False}

        def publish(phase: str, message: str, percent: float | None = None) -> None:
            signature = (phase, message, None if percent is None else round(percent, 6))
            if signature == last["signature"]:
                return
            last["signature"] = signature
            progress = self._put_progress(job_id, phase, message, percent=percent)
            if phase == "sampling" and not last["sampling_started"]:
                last["sampling_started"] = True
                if job_id is not None and progress is not None:
                    try:
                        self._update_persisted_job(
                            job_id,
                            "running",
                            sampling_started_at=progress["updated_at"],
                        )
                    except Exception:
                        # Timing is optional metadata and must never interrupt
                        # an otherwise healthy generation.
                        pass

        def on_event(event: str, data: dict) -> None:
            update = progress_from_comfy_event(event, data)
            if update:
                publish(
                    update["phase"],
                    update["message"],
                    update.get("percent"),
                )

        return on_event

    def _update_persisted_job(self, job_id: str, status: str, **changes) -> bool:
        output_volume.reload()
        if jobs.is_deleted(job_id):
            return False
        record = jobs.read_job(job_id)
        if record is None:
            raise FileNotFoundError(f"persisted job metadata is missing: {job_id}")
        actual_seed = changes.pop("_actual_seed", None)
        if actual_seed is not None:
            changes["request"] = {**record.get("request", {}), "seed": actual_seed}
        jobs.update_job(job_id, status=status, **changes)
        output_volume.commit()
        return True

    @modal.method()
    def generate(
        self,
        prompt: str,
        width: int = 864,
        height: int = 480,
        duration_seconds: float = 5,
        seed: int | None = None,
        resolution: str = "480p",
        turbo: bool = True,
        sampling_profile: str | None = None,
        steps: int | None = None,
        sampler: str | None = None,
        scheduler: str | None = None,
        loras: dict[str, float] | None = None,
        first_frame: bytes | None = None,
        last_frame: bytes | None = None,
        job_id: str | None = None,
        persist_output: bool = False,
        mode: str = "frames",
        geometry_source: str | None = None,
        ref_image_size: str = "match",
        references: list[dict] | None = None,
    ) -> dict:
        """Generate an MP4, optionally persisting it for the async web API.

        Direct callers retain the original ``{"video": bytes, ...metadata}``
        result. The gateway passes ``persist_output=True`` and a job id; that
        mode writes the MP4/job record to the output Volume and returns only
        small metadata.
        """
        if persist_output and job_id is None:
            raise ValueError("job_id is required when persist_output is true")
        if job_id is not None:
            jobs.validate_job_id(job_id)
        if mode not in {"frames", "references"}:
            raise ValueError("mode must be 'frames' or 'references'")
        if not isinstance(turbo, bool):
            raise ValueError("turbo must be a boolean")
        profile_id, profile = resolve_sampling_profile(
            sampling_profile,
            turbo=turbo,
        )
        loras = resolve_lora_strengths(loras)
        if geometry_source not in {None, "first_frame", "last_frame"}:
            raise ValueError("invalid geometry_source")
        if mode == "references" and (first_frame is not None or last_frame is not None):
            raise ValueError("references mode does not accept keyframes")
        if mode == "references" and not references:
            raise ValueError("references mode requires staged references")
        actual_seed = seed if seed is not None else secrets.randbelow(2**63)
        output_stem = uuid.uuid4().hex
        local_inputs: list[str] = []
        generated: str | None = None
        staged_references: list[dict] = []

        try:
            if persist_output:
                starting = self._put_progress(job_id, "starting", "GPU worker started")
                if not self._update_persisted_job(
                    job_id,
                    "running",
                    call_id=modal.current_function_call_id(),
                    _actual_seed=actual_seed,
                    error=None,
                    progress=starting,
                ):
                    return {"id": job_id, "status": "expired", "result": None}
            first = self._stage_input(first_frame, "first")
            last = self._stage_input(last_frame, "last")
            local_inputs = [name for name in (first, last) if name]
            if mode == "references":
                staged_references, reference_inputs = self._stage_references(job_id, references or [])
                local_inputs.extend(reference_inputs)
                workflow = build_reference_workflow(
                    prompt=prompt,
                    width=width,
                    height=height,
                    duration_seconds=duration_seconds,
                    seed=actual_seed,
                    sampling_profile=profile_id,
                    steps=steps,
                    sampler=sampler,
                    scheduler=scheduler,
                    loras=loras,
                    output_stem=output_stem,
                    references=staged_references,
                    ref_image_size=ref_image_size,
                    resolution=resolution,
                )
            else:
                workflow = build_frames_workflow(
                    prompt=prompt,
                    width=width,
                    height=height,
                    duration_seconds=duration_seconds,
                    seed=actual_seed,
                    sampling_profile=profile_id,
                    steps=steps,
                    sampler=sampler,
                    scheduler=scheduler,
                    loras=loras,
                    output_stem=output_stem,
                    first_frame_filename=first,
                    last_frame_filename=last,
                    resolution=resolution,
                )
            outputs = comfy_client.submit_and_watch(
                workflow,
                port=self.port,
                on_event=self._progress_handler(job_id),
            )
            generated = comfy_client.find_output(outputs, (".mp4",))
            if not generated or not os.path.isfile(generated):
                raise FileNotFoundError(
                    "ComfyUI completed without returning an MP4 output"
                )

            frames = aligned_frame_count(duration_seconds)
            sampling_steps = int(workflow["scheduler"]["inputs"]["steps"])
            sampling_sampler = str(workflow["sampler"]["inputs"]["sampler_name"])
            metadata = {
                "mode": mode,
                "model": (
                    "MiniMax-H3-FL2VA (reference conditioning)"
                    if mode == "references"
                    else "MiniMax-H3-FL2VA"
                ),
                "checkpoint": (
                    REFERENCE_CONDITIONING_DIFFUSION_MODEL
                    if mode == "references"
                    else FRAME_DIFFUSION_MODEL
                ),
                "width": width,
                "height": height,
                "resolution": resolution,
                "duration_seconds": frames / 24,
                "frames": frames,
                "fps": 24,
                "seed": actual_seed,
                "turbo": profile["turbo"],
                "sampling_profile": profile_id,
                "steps": sampling_steps,
                "sampler": sampling_sampler,
                "scheduler": workflow["scheduler"]["inputs"]["scheduler"],
                "attention": {
                    "backend": ATTENTION_BACKEND,
                    "version": COMFY_KITCHEN_VERSION,
                },
                "audio": {"native": True, "sample_rate_hz": 32000, "channels": 2},
            }
            if profile["lora"]:
                metadata.update({
                    "lora": profile["lora"],
                    "lora_strength": profile["lora_strength"],
                })
            if profile["spectrum"]:
                metadata["spectrum"] = {
                    "version": SPECTRUM_VERSION,
                    "offline_smoothing_replay": True,
                    "audio_blend_weight": 0.0,
                }
            if loras:
                metadata["loras"] = active_loras(loras)
            if mode == "references":
                metadata["references"] = [
                    {
                        "id": reference.get("id"),
                        "kind": reference.get("kind"),
                        "tags": reference.get("tags", []),
                    }
                    for reference in staged_references
                ]
            if persist_output:
                output_volume.reload()
                if jobs.is_deleted(job_id):
                    return {"id": job_id, "status": "expired", "result": None}
                destination = jobs.video_path(job_id)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(generated, destination)
                metadata["bytes"] = destination.stat().st_size
                completed_progress = self._put_progress(job_id, "done", "Video ready")
                jobs.update_job(
                    job_id,
                    status="completed",
                    result=metadata,
                    error=None,
                    call_id=modal.current_function_call_id(),
                    progress=completed_progress,
                )
                output_volume.commit()
                return {"id": job_id, "status": "completed", "result": metadata}
            return {"video": Path(generated).read_bytes(), **metadata}
        except Exception as exc:
            stalled = isinstance(exc, comfy_client.ComfyWorkflowStalled)
            if persist_output and job_id is not None:
                try:
                    failed_progress = self._put_progress(job_id, "error", "Generation failed")
                    self._update_persisted_job(
                        job_id,
                        "failed",
                        result=None,
                        error=f"generation failed: {str(exc)[:2000]}",
                        call_id=modal.current_function_call_id(),
                        progress=failed_progress,
                    )
                except Exception as persist_exc:
                    print(f"Could not persist failed job state: {persist_exc}", flush=True)
            if stalled:
                self._restart_comfyui()
            raise
        finally:
            for filename in local_inputs:
                (Path(comfy_client.INPUT_ROOT) / filename).unlink(missing_ok=True)
            if generated:
                Path(generated).unlink(missing_ok=True)
            if persist_output and job_id is not None:
                shutil.rmtree(jobs.input_dir(job_id), ignore_errors=True)
                try:
                    output_volume.commit()
                except Exception:
                    pass
