"""Authoritative, CPU-safe browser capabilities for MiniMax H3 Base."""

from __future__ import annotations

import copy
import math

from minimax_h3.loras import public_loras
from minimax_h3.runtime import (
    ATTENTION_BACKEND,
    COMFY_KITCHEN_VERSION,
    SPARSE_ATTENTION_DENSER_EARLY,
    SPARSE_ATTENTION_IMPLEMENTATION,
    SPARSE_ATTENTION_VERSION,
    SPARSE_ATTENTION_VIDEO_BUDGET,
)

FPS = 24
CANVAS_MULTIPLE = 32
BASE_SHORT_EDGE = 480
MAX_PIXELS = 768 * 1344
SPEC_VERSION = "1.8"
BASE_MIN_STEPS = 30
BASE_STEPS = 30
BASE_MAX_STEPS = 30
BASE_SAMPLER = "res_multistep"
BASE_SCHEDULER = "simple"
TURBO_4_LORA = "minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors"
TURBO_8_LORA = "minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors"
SPECTRUM_VERSION = "0.2.16"
TURBO_LORA = TURBO_4_LORA
TURBO_LORA_STRENGTH = 1.0
TURBO_MIN_STEPS = 4
TURBO_STEPS = 4
TURBO_MAX_STEPS = 4
TURBO_SAMPLER = "res_multistep"
TURBO_SCHEDULER = "simple"
DEFAULT_SAMPLING_PROFILE = "turbo_4"
SAMPLING_PROFILE_IDS = ("turbo_4", "turbo_8", "spectrum", "base")
PUBLIC_SAMPLING_PROFILE_IDS = SAMPLING_PROFILE_IDS
SEED_OPTIONS = (None, 42, 106, 99)
DEFAULT_RESOLUTION = "480p"
RESOLUTION_IDS = ("480p", "768p")

SAMPLING_PROFILES = {
    "turbo_4": {
        "label": "Turbo · 4 steps",
        "method": "LightX2V MiniMax-H3 Turbo 4-step LoRA",
        "lora": TURBO_4_LORA,
        "preview": True,
        "steps": {"default": 4, "min": 4, "max": 4},
        "sampler": "res_multistep",
        "scheduler": "simple",
        "lora_strength": TURBO_LORA_STRENGTH,
        "spectrum": False,
        "turbo": True,
        "low_vram": None,
    },
    "turbo_8": {
        "label": "8 step LoRA",
        "method": "LightX2V MiniMax-H3 Turbo 8-step LoRA",
        "lora": TURBO_8_LORA,
        "preview": True,
        "steps": {"default": 8, "min": 8, "max": 8},
        "sampler": "res_multistep",
        "scheduler": "simple",
        "lora_strength": TURBO_LORA_STRENGTH,
        "spectrum": False,
        "turbo": True,
        "low_vram": None,
    },
    "spectrum": {
        "label": "Spectrum · 30 steps",
        "method": f"MiniMax-H3 Base with Spectrum v{SPECTRUM_VERSION}",
        "lora": None,
        "preview": True,
        "steps": {"default": BASE_STEPS, "min": BASE_MIN_STEPS, "max": BASE_MAX_STEPS},
        "sampler": "res_multistep",
        "scheduler": "simple",
        "lora_strength": None,
        "spectrum": True,
        "turbo": False,
        "low_vram": None,
    },
    "base": {
        "label": "Base · 30 steps",
        "method": "MiniMax-H3 Base",
        "lora": None,
        "preview": False,
        "steps": {"default": BASE_STEPS, "min": BASE_MIN_STEPS, "max": BASE_MAX_STEPS},
        "sampler": "res_multistep",
        "scheduler": "simple",
        "lora_strength": None,
        "spectrum": False,
        "turbo": False,
        "low_vram": None,
    },
}


def resolve_sampling_profile(
    profile_id: str | None = None,
    *,
    turbo: bool | None = None,
) -> tuple[str, dict]:
    """Resolve a profile while retaining the legacy Turbo boolean fallback."""
    if profile_id is None:
        profile_id = "spectrum" if turbo is False else DEFAULT_SAMPLING_PROFILE
    if not isinstance(profile_id, str) or profile_id not in SAMPLING_PROFILES:
        raise ValueError(
            f"sampling_profile must be one of {', '.join(SAMPLING_PROFILE_IDS)}"
        )
    return profile_id, SAMPLING_PROFILES[profile_id]

IMAGE_MIME_TYPES = ("image/png", "image/jpeg", "image/webp")
VIDEO_MIME_TYPES = ("video/mp4", "video/quicktime", "video/webm")
AUDIO_MIME_TYPES = (
    "audio/aac",
    "audio/flac",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
)

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_VIDEO_BYTES = 512 * 1024 * 1024
MAX_AUDIO_BYTES = 100 * 1024 * 1024
MAX_REFERENCE_SOURCES = 12
MAX_REFERENCE_IMAGES = 9
MAX_REFERENCE_VIDEOS = 3
MAX_REFERENCE_AUDIOS = 3
MIN_REFERENCE_DURATION = 2.0
MAX_REFERENCE_DURATION = 15.0

ASPECT_RATIOS = (
    ("9:16", 9, 16),
    ("16:9", 16, 9),
)

RESOLUTION_PROFILES = {
    "480p": {
        "label": "480p",
        "short_edge": 480,
        "max_pixels": 480 * 864,
        "recommended": False,
    },
    "768p": {
        "label": "768p (recommended)",
        "short_edge": 768,
        "max_pixels": 768 * 1344,
        "recommended": True,
    },
}


def aligned_frame_count(duration_seconds: float) -> int:
    """Snap a requested duration upward to H3's 17k+5 frame grid."""
    raw_frames = max(5, math.floor(duration_seconds * FPS + 0.5))
    return raw_frames + (5 - raw_frames % 17) % 17


def resolve_resolution(resolution: str | None = None) -> tuple[str, dict]:
    resolution_id = resolution or DEFAULT_RESOLUTION
    if not isinstance(resolution_id, str) or resolution_id not in RESOLUTION_PROFILES:
        raise ValueError(f"resolution must be one of {', '.join(RESOLUTION_IDS)}")
    return resolution_id, RESOLUTION_PROFILES[resolution_id]


def native_canvas(
    width: int,
    height: int,
    resolution: str = DEFAULT_RESOLUTION,
) -> tuple[int, int]:
    """Resolve an aspect to the selected H3 area-capped canvas."""
    if width <= 0 or height <= 0:
        raise ValueError("source width and height must be positive")
    _, profile = resolve_resolution(resolution)
    short_edge = profile["short_edge"]
    max_pixels = profile["max_pixels"]
    ratio = width / height
    if ratio >= 1.0:
        nominal_width, nominal_height = short_edge * ratio, short_edge
    else:
        nominal_width, nominal_height = short_edge, short_edge / ratio
    if nominal_width * nominal_height > max_pixels:
        scale = math.sqrt(max_pixels / (nominal_width * nominal_height))
        nominal_width *= scale
        nominal_height *= scale
    resolved_width = max(
        CANVAS_MULTIPLE,
        round(nominal_width / CANVAS_MULTIPLE) * CANVAS_MULTIPLE,
    )
    resolved_height = max(
        CANVAS_MULTIPLE,
        round(nominal_height / CANVAS_MULTIPLE) * CANVAS_MULTIPLE,
    )
    while resolved_width * resolved_height > max_pixels:
        if resolved_width >= resolved_height:
            resolved_width -= CANVAS_MULTIPLE
        else:
            resolved_height -= CANVAS_MULTIPLE
    return resolved_width, resolved_height


def duration_options() -> list[dict]:
    return [
        {
            "requested_seconds": seconds,
            "frames": aligned_frame_count(seconds),
            "actual_seconds": aligned_frame_count(seconds) / FPS,
        }
        for seconds in range(5, 16)
    ]


def aspect_presets(resolution: str = DEFAULT_RESOLUTION) -> list[dict]:
    return [
        {
            "id": aspect,
            "width": native_canvas(width, height, resolution)[0],
            "height": native_canvas(width, height, resolution)[1],
        }
        for aspect, width, height in ASPECT_RATIOS
    ]


_SPECS = {
    "version": SPEC_VERSION,
    "modes": {
        "frames": {
            "available": True,
            "model": "MiniMax-H3 Base FL2VA",
            "checkpoint": "minimax_h3_fl2va_int8_convrot.safetensors",
            "attachments": {
                "kinds": ["image"],
                "max_images": 2,
                "slots": ["first_frame", "last_frame"],
                "mime_types": list(IMAGE_MIME_TYPES),
                "max_bytes_each": MAX_IMAGE_BYTES,
            },
            "geometry": {
                "with_frames": "first_uploaded_frame",
                "geometry_source_values": ["first_frame", "last_frame"],
                "mismatched_second_frame": "reject",
            },
        },
        "references": {
            "available": True,
            "model": "MiniMax-H3 Base FL2VA with reference conditioning",
            "checkpoint": "minimax_h3_fl2va_int8_convrot.safetensors",
            "order": "upload_order",
            "tags": {
                "image": "<Picture N>",
                "video": "<Video N>",
                "audio": "<Audio N>",
                "numbering": "independent_per_type",
            },
            "attachments": {
                "max_sources": MAX_REFERENCE_SOURCES,
                "max_images": MAX_REFERENCE_IMAGES,
                "max_videos": MAX_REFERENCE_VIDEOS,
                "max_audios": MAX_REFERENCE_AUDIOS,
                "audio_may_not_be_sole_modality": True,
                "image": {
                    "mime_types": list(IMAGE_MIME_TYPES),
                    "max_bytes_each": MAX_IMAGE_BYTES,
                },
                "video": {
                    "mime_types": list(VIDEO_MIME_TYPES),
                    "max_bytes_each": MAX_VIDEO_BYTES,
                    "min_seconds_each": MIN_REFERENCE_DURATION,
                    "max_seconds_each": MAX_REFERENCE_DURATION,
                    "max_seconds_total": MAX_REFERENCE_DURATION,
                    "normalized_fps": FPS,
                    "embedded_audio": "optional_per_video",
                },
                "audio": {
                    "mime_types": list(AUDIO_MIME_TYPES),
                    "max_bytes_each": MAX_AUDIO_BYTES,
                    "min_seconds_each": MIN_REFERENCE_DURATION,
                    "max_seconds_each": MAX_REFERENCE_DURATION,
                    "max_seconds_total": MAX_REFERENCE_DURATION,
                },
            },
            "ref_image_size": {
                "default": "match",
                "values": ["match", "max"],
                "max_short_edge": 2048,
            },
        },
    },
    "output": {
        "fps": FPS,
        "attention": {
            "backend": ATTENTION_BACKEND,
            "version": COMFY_KITCHEN_VERSION,
            "scope": "global",
            "sparse": {
                "available": True,
                "default": False,
                "implementation": SPARSE_ATTENTION_IMPLEMENTATION,
                "version": SPARSE_ATTENTION_VERSION,
                "video_budget": SPARSE_ATTENTION_VIDEO_BUDGET,
                "video_budgets": [
                    {"value": 0.30, "label": "30% — Balanced"},
                    {"value": 0.15, "label": "15% — Fast"},
                    {"value": 0.10, "label": "10% — Fastest"},
                ],
                "denser_early": SPARSE_ATTENTION_DENSER_EARLY,
            },
        },
        "loras": public_loras(),
        "sampling": {
            "default": DEFAULT_SAMPLING_PROFILE,
            "profiles": {
                profile_id: SAMPLING_PROFILES[profile_id]
                for profile_id in PUBLIC_SAMPLING_PROFILE_IDS
            },
        },
        "seed": {
            "default": "random",
            "options": [
                {
                    "id": "random" if value is None else str(value),
                    "label": "Random" if value is None else str(value),
                    "value": value,
                }
                for value in SEED_OPTIONS
            ],
        },
        "audio": {
            "native": True,
            "always_generated": True,
            "sample_rate_hz": 32000,
            "channels": 2,
        },
        "duration": {
            "default_seconds": 5,
            "options": duration_options(),
        },
        "geometry": {
            "multiple": CANVAS_MULTIPLE,
            "base_short_edge": BASE_SHORT_EDGE,
            "max_pixels": RESOLUTION_PROFILES[DEFAULT_RESOLUTION]["max_pixels"],
            "native_aspects": aspect_presets(),
            "default_resolution": DEFAULT_RESOLUTION,
            "resolutions": {
                resolution_id: {
                    **profile,
                    "native_aspects": aspect_presets(resolution_id),
                }
                for resolution_id, profile in RESOLUTION_PROFILES.items()
            },
            "two_k_available": False,
        },
    },
}


def get_specs() -> dict:
    """Return a copy so request handlers cannot mutate the canonical contract."""
    return copy.deepcopy(_SPECS)
