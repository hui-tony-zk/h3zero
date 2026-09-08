"""Pure validation and ComfyUI workflow construction for MiniMax H3."""

from __future__ import annotations

import json

from minimax_h3.loras import CONFIGURED_LORAS, resolve_lora_strengths
from minimax_h3.media import image_dimensions, image_suffix
from minimax_h3.specs import (
    FPS,
    MAX_IMAGE_BYTES,
    MAX_PIXELS,
    aligned_frame_count,
    resolve_resolution,
    resolve_sampling_profile,
)

FRAME_DIFFUSION_MODEL = "minimax_h3_fl2va_int8_convrot.safetensors"
REFERENCE_DIFFUSION_MODEL = "minimax_h3_ref2va_int8_convrot.safetensors"
# Keep the Ref2VA checkpoint available for fallback/A-B testing, while routing
# the production reference-conditioning graph through the higher-quality FL2VA
# checkpoint.
REFERENCE_CONDITIONING_DIFFUSION_MODEL = FRAME_DIFFUSION_MODEL
TEXT_ENCODER = "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
VALID_REF_IMAGE_SIZES = {"match", "max"}


def validate_generation(
    *,
    prompt: str,
    width: int,
    height: int,
    duration_seconds: float,
    steps: int,
    sampler: str,
    scheduler: str,
    sampling_profile: str | None = None,
    turbo: bool | None = None,
    resolution: str = "480p",
) -> None:
    if turbo is not None and not isinstance(turbo, bool):
        raise ValueError("turbo must be a boolean")
    profile_id, profile = resolve_sampling_profile(sampling_profile, turbo=turbo)
    resolution_id, resolution_profile = resolve_resolution(resolution)
    if not prompt.strip():
        raise ValueError("prompt must not be blank")
    if len(prompt) > 12_000:
        raise ValueError("prompt must be at most 12,000 characters")
    if not 5 <= duration_seconds <= 15:
        raise ValueError("duration_seconds must be between 5 and 15")
    if width < 256 or height < 256:
        raise ValueError("width and height must each be at least 256")
    if width % 32 or height % 32:
        raise ValueError("width and height must be multiples of 32")
    max_pixels = resolution_profile["max_pixels"]
    if width * height > max_pixels:
        raise ValueError(
            f"width * height must not exceed {max_pixels} pixels for {resolution_id}"
        )
    valid_sampler = profile["sampler"]
    valid_scheduler = profile["scheduler"]
    if isinstance(steps, bool) or not isinstance(steps, int) or steps < 1:
        raise ValueError("steps must be a positive integer")
    if sampler != valid_sampler:
        raise ValueError(f"sampler must be {valid_sampler!r} for {profile_id}")
    if scheduler != valid_scheduler:
        raise ValueError(f"scheduler must be {valid_scheduler!r} for {profile_id}")


def validate_image_bytes(raw: bytes) -> str:
    """Validate a local keyframe and return its safe filename suffix."""
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("each input image must be between 1 byte and 20 MiB")
    suffix = image_suffix(raw)
    image_dimensions(raw)
    return suffix


def _common_workflow(
    *,
    diffusion_model: str,
    conditioning_class: str,
    conditioning_inputs: dict,
    seed: int,
    steps: int,
    sampler: str,
    scheduler: str,
    output_stem: str,
    sampling_profile: str,
    loras: dict[str, float],
) -> dict:
    _, profile = resolve_sampling_profile(sampling_profile)
    model_reference = ["model", 0]
    accelerator_nodes = {}
    if profile["lora"]:
        accelerator_nodes["turbo_lora"] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": model_reference,
                "lora_name": profile["lora"],
                "strength_model": profile["lora_strength"],
            },
        }
        model_reference = ["turbo_lora", 0]
    lora_nodes = {}
    for index, lora in enumerate(CONFIGURED_LORAS):
        strength = loras.get(lora["id"])
        if strength is None:
            continue
        node_id = f"style_lora_{index}"
        lora_nodes[node_id] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": model_reference,
                "lora_name": lora["filename"],
                "strength_model": strength,
            },
        }
        model_reference = [node_id, 0]
    if profile["spectrum"]:
        accelerator_nodes["spectrum"] = {
            "class_type": "SpectrumApplyMiniMaxH3",
            "inputs": {
                "model": model_reference,
                "enabled": True,
                "blend_weight": 0.5,
                "degree": 1,
                "ridge_lambda": 0.1,
                "window_size": 2.0,
                "flex_window": 0.75,
                "warmup_steps": 1,
                "tail_actual_steps": 1,
                "max_history": 8,
                "debug": False,
                "history_storage": "system_ram",
                "bootstrap_first_forecast": True,
                "anchor_residual_feedback": False,
                "selective_rollback_correction": False,
                "offline_smoothing_replay": True,
                "audio_blend_weight": 0.0,
                "offline_archive_storage": "system_ram",
                "model_aware_mode": "off",
            },
        }
        model_reference = ["spectrum", 0]
    workflow = {
        "model": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": diffusion_model, "weight_dtype": "default"},
        },
        "clip": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": TEXT_ENCODER,
                "type": "minimax",
                "device": "default",
            },
        },
        "video_vae": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": VIDEO_VAE},
        },
        "audio_vae": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": AUDIO_VAE},
        },
        "conditioning": {
            "class_type": conditioning_class,
            "inputs": conditioning_inputs,
        },
        "noise": {
            "class_type": "RandomNoise",
            "inputs": {"noise_seed": seed},
        },
        "sampler": {
            "class_type": "KSamplerSelect",
            "inputs": {"sampler_name": sampler},
        },
        "scheduler": {
            "class_type": "BasicScheduler",
            "inputs": {
                "model": model_reference,
                "scheduler": scheduler,
                "steps": steps,
                "denoise": 1.0,
            },
        },
        "guider": {
            "class_type": "BasicGuider",
            "inputs": {
                "model": model_reference,
                "conditioning": ["conditioning", 0],
            },
        },
        "sample": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["noise", 0],
                "guider": ["guider", 0],
                "sampler": ["sampler", 0],
                "sigmas": ["scheduler", 0],
                "latent_image": ["conditioning", 1],
            },
        },
        "decode_video": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["sample", 0], "vae": ["video_vae", 0]},
        },
        "decode_audio": {
            "class_type": "VAEDecodeAudio",
            "inputs": {"samples": ["sample", 0], "vae": ["audio_vae", 0]},
        },
        "create_video": {
            "class_type": "CreateVideo",
            "inputs": {
                "images": ["decode_video", 0],
                "audio": ["decode_audio", 0],
                "fps": FPS,
                "bit_depth": 8,
            },
        },
        "save_video": {
            "class_type": "SaveVideo",
            "inputs": {
                "video": ["create_video", 0],
                "filename_prefix": f"video/h3/{output_stem}",
                "format": "mp4",
                "codec": "h264",
            },
        },
    }
    workflow.update(accelerator_nodes)
    workflow.update(lora_nodes)
    return workflow


def build_frames_workflow(
    *,
    prompt: str,
    width: int,
    height: int,
    duration_seconds: float,
    seed: int,
    turbo: bool | None = None,
    sampling_profile: str | None = None,
    steps: int | None = None,
    sampler: str | None = None,
    scheduler: str | None = None,
    loras: dict[str, float] | None = None,
    output_stem: str = "h3",
    first_frame_filename: str | None = None,
    last_frame_filename: str | None = None,
    resolution: str = "480p",
) -> dict:
    profile_id, profile = resolve_sampling_profile(sampling_profile, turbo=turbo)
    steps = steps if steps is not None else profile["steps"]["default"]
    sampler = sampler or profile["sampler"]
    scheduler = scheduler or profile["scheduler"]
    loras = resolve_lora_strengths(loras)
    validate_generation(
        prompt=prompt,
        width=width,
        height=height,
        duration_seconds=duration_seconds,
        steps=steps,
        sampler=sampler,
        scheduler=scheduler,
        sampling_profile=profile_id,
        resolution=resolution,
    )
    if not 0 <= seed <= 0xFFFFFFFFFFFFFFFF:
        raise ValueError("seed must be an unsigned 64-bit integer")
    conditioning_inputs = {
        "clip": ["clip", 0],
        "vae": ["video_vae", 0],
        "prompt": prompt.strip(),
        "width": width,
        "height": height,
        "length": aligned_frame_count(duration_seconds),
    }
    workflow = _common_workflow(
        diffusion_model=FRAME_DIFFUSION_MODEL,
        conditioning_class="MiniMaxH3ImageToVideo",
        conditioning_inputs=conditioning_inputs,
        seed=seed,
        steps=steps,
        sampler=sampler,
        scheduler=scheduler,
        output_stem=output_stem,
        sampling_profile=profile_id,
        loras=loras,
    )
    for label, filename in (
        ("first_frame", first_frame_filename),
        ("last_frame", last_frame_filename),
    ):
        if not filename:
            continue
        node_id = f"load_{label}"
        workflow[node_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": filename},
        }
        workflow["conditioning"]["inputs"][label] = [node_id, 0]
    return workflow


def build_reference_workflow(
    *,
    prompt: str,
    width: int,
    height: int,
    duration_seconds: float,
    seed: int,
    references: list[dict],
    turbo: bool | None = None,
    sampling_profile: str | None = None,
    ref_image_size: str = "match",
    steps: int | None = None,
    sampler: str | None = None,
    scheduler: str | None = None,
    loras: dict[str, float] | None = None,
    output_stem: str = "h3",
    resolution: str = "480p",
) -> dict:
    profile_id, profile = resolve_sampling_profile(sampling_profile, turbo=turbo)
    steps = steps if steps is not None else profile["steps"]["default"]
    sampler = sampler or profile["sampler"]
    scheduler = scheduler or profile["scheduler"]
    loras = resolve_lora_strengths(loras)
    validate_generation(
        prompt=prompt,
        width=width,
        height=height,
        duration_seconds=duration_seconds,
        steps=steps,
        sampler=sampler,
        scheduler=scheduler,
        sampling_profile=profile_id,
        resolution=resolution,
    )
    if not 0 <= seed <= 0xFFFFFFFFFFFFFFFF:
        raise ValueError("seed must be an unsigned 64-bit integer")
    if ref_image_size not in VALID_REF_IMAGE_SIZES:
        raise ValueError("ref_image_size must be 'match' or 'max'")

    order: list[dict] = []
    conditioning_inputs = {
        "clip": ["clip", 0],
        "vae": ["video_vae", 0],
        "audio_vae": ["audio_vae", 0],
        "prompt": prompt.strip(),
        "width": width,
        "height": height,
        "length": aligned_frame_count(duration_seconds),
        "ref_image_size": ref_image_size,
    }
    workflow = _common_workflow(
        diffusion_model=REFERENCE_CONDITIONING_DIFFUSION_MODEL,
        conditioning_class="MiniMaxH3OrderedReferenceToVideo",
        conditioning_inputs=conditioning_inputs,
        seed=seed,
        steps=steps,
        sampler=sampler,
        scheduler=scheduler,
        output_stem=output_stem,
        sampling_profile=profile_id,
        loras=loras,
    )

    for index, reference in enumerate(references):
        kind = reference.get("kind")
        slot = reference.get("slot")
        filename = reference.get("local_filename")
        reference_id = reference.get("id")
        if kind not in {"image", "video", "audio"}:
            raise ValueError(f"reference {index} has an invalid kind")
        if not isinstance(slot, int) or slot < 0:
            raise ValueError(f"reference {index} has an invalid slot")
        if not isinstance(filename, str) or not filename:
            raise ValueError(f"reference {index} is missing local_filename")
        if not isinstance(reference_id, str) or not reference_id:
            raise ValueError(f"reference {index} is missing id")

        entry = {
            "id": reference_id,
            "kind": kind,
            "slot": slot,
            "use_audio": bool(reference.get("use_audio", False)),
        }
        order.append(entry)
        load_id = f"load_reference_{index}"
        if kind == "image":
            workflow[load_id] = {
                "class_type": "LoadImage",
                "inputs": {"image": filename},
            }
            conditioning_inputs[f"ref_image_{slot}"] = [load_id, 0]
        elif kind == "audio":
            workflow[load_id] = {
                "class_type": "LoadAudio",
                "inputs": {"audio": filename},
            }
            conditioning_inputs[f"ref_audio_{slot}"] = [load_id, 0]
        else:
            workflow[load_id] = {
                "class_type": "LoadVideo",
                "inputs": {"file": filename},
            }
            components_id = f"reference_components_{index}"
            workflow[components_id] = {
                "class_type": "GetVideoComponents",
                "inputs": {"video": [load_id, 0]},
            }
            conditioning_inputs[f"ref_video_{slot}"] = [components_id, 0]
            if entry["use_audio"]:
                conditioning_inputs[f"ref_video_audio_{slot}"] = [components_id, 1]

    conditioning_inputs["reference_order"] = json.dumps(
        order,
        ensure_ascii=True,
        separators=(",", ":"),
    )
    return workflow
