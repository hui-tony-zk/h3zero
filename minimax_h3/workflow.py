"""Pure validation and ComfyUI workflow construction for MiniMax H3 Base."""

from __future__ import annotations

import json

from minimax_h3.media import image_dimensions, image_suffix
from minimax_h3.specs import (
    FPS,
    MAX_IMAGE_BYTES,
    MAX_PIXELS,
    aligned_frame_count,
)

FRAME_DIFFUSION_MODEL = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
REFERENCE_DIFFUSION_MODEL = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
TEXT_ENCODER = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"

VALID_SAMPLERS = {"res_multistep"}
VALID_SCHEDULERS = {"simple", "normal", "beta"}
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
) -> None:
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
    if width * height > MAX_PIXELS:
        raise ValueError(
            f"width * height must not exceed {MAX_PIXELS} pixels (480 * 864)"
        )
    if not 1 <= steps <= 50:
        raise ValueError("steps must be between 1 and 50")
    if sampler not in VALID_SAMPLERS:
        raise ValueError(f"sampler must be one of {sorted(VALID_SAMPLERS)}")
    if scheduler not in VALID_SCHEDULERS:
        raise ValueError(f"scheduler must be one of {sorted(VALID_SCHEDULERS)}")


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
) -> dict:
    return {
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
                "model": ["model", 0],
                "scheduler": scheduler,
                "steps": steps,
                "denoise": 1.0,
            },
        },
        "guider": {
            "class_type": "BasicGuider",
            "inputs": {
                "model": ["model", 0],
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


def build_frames_workflow(
    *,
    prompt: str,
    width: int,
    height: int,
    duration_seconds: float,
    seed: int,
    steps: int = 20,
    sampler: str = "res_multistep",
    scheduler: str = "simple",
    output_stem: str = "h3",
    first_frame_filename: str | None = None,
    last_frame_filename: str | None = None,
) -> dict:
    validate_generation(
        prompt=prompt,
        width=width,
        height=height,
        duration_seconds=duration_seconds,
        steps=steps,
        sampler=sampler,
        scheduler=scheduler,
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
    ref_image_size: str = "match",
    steps: int = 20,
    sampler: str = "res_multistep",
    scheduler: str = "simple",
    output_stem: str = "h3",
) -> dict:
    validate_generation(
        prompt=prompt,
        width=width,
        height=height,
        duration_seconds=duration_seconds,
        steps=steps,
        sampler=sampler,
        scheduler=scheduler,
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
        diffusion_model=REFERENCE_DIFFUSION_MODEL,
        conditioning_class="MiniMaxH3OrderedReferenceToVideo",
        conditioning_inputs=conditioning_inputs,
        seed=seed,
        steps=steps,
        sampler=sampler,
        scheduler=scheduler,
        output_stem=output_stem,
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
