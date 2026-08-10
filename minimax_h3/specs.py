"""Authoritative, CPU-safe browser capabilities for MiniMax H3 Base."""

from __future__ import annotations

import copy
import math

FPS = 24
CANVAS_MULTIPLE = 32
BASE_SHORT_EDGE = 480
MAX_PIXELS = 480 * 864
SPEC_VERSION = "1.2"
BASE_MIN_STEPS = 1
BASE_STEPS = 20
BASE_MAX_STEPS = 50
BASE_SAMPLER = "res_multistep"
BASE_SCHEDULER = "simple"
TURBO_LORA = "minimax_h3_turbo_v4_step600_ema.safetensors"
TURBO_LORA_STRENGTH = 1.0
TURBO_LOW_VRAM = False
TURBO_MIN_STEPS = 4
TURBO_STEPS = 8
TURBO_MAX_STEPS = 8
TURBO_SAMPLER = "minimax_h3_turbo"
TURBO_SCHEDULER = "simple"

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


def aligned_frame_count(duration_seconds: float) -> int:
    """Snap a requested duration upward to H3's 17k+5 frame grid."""
    raw_frames = max(5, math.floor(duration_seconds * FPS + 0.5))
    return raw_frames + (5 - raw_frames % 17) % 17


def native_canvas(width: int, height: int) -> tuple[int, int]:
    """Resolve an aspect to H3's 480-short-edge, area-capped canvas."""
    if width <= 0 or height <= 0:
        raise ValueError("source width and height must be positive")
    ratio = width / height
    if ratio >= 1.0:
        nominal_width, nominal_height = BASE_SHORT_EDGE * ratio, BASE_SHORT_EDGE
    else:
        nominal_width, nominal_height = BASE_SHORT_EDGE, BASE_SHORT_EDGE / ratio
    if nominal_width * nominal_height > MAX_PIXELS:
        scale = math.sqrt(MAX_PIXELS / (nominal_width * nominal_height))
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
    while resolved_width * resolved_height > MAX_PIXELS:
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


def aspect_presets() -> list[dict]:
    return [
        {
            "id": aspect,
            "width": native_canvas(width, height)[0],
            "height": native_canvas(width, height)[1],
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
            "model": "MiniMax-H3 Base Ref2VA",
            "checkpoint": "minimax_h3_ref2va_int8_convrot.safetensors",
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
        "sampling": {
            "default": "turbo",
            "profiles": {
                "turbo": {
                    "method": "MiniMax-H3 Turbo LoRA",
                    "lora": TURBO_LORA,
                    "preview": True,
                    "steps": {
                        "default": TURBO_STEPS,
                        "min": TURBO_MIN_STEPS,
                        "max": TURBO_MAX_STEPS,
                    },
                    "sampler": TURBO_SAMPLER,
                    "scheduler": TURBO_SCHEDULER,
                    "lora_strength": TURBO_LORA_STRENGTH,
                    "low_vram": TURBO_LOW_VRAM,
                },
                "base": {
                    "method": "MiniMax-H3 Base",
                    "lora": None,
                    "preview": False,
                    "steps": {
                        "default": BASE_STEPS,
                        "min": BASE_MIN_STEPS,
                        "max": BASE_MAX_STEPS,
                    },
                    "sampler": BASE_SAMPLER,
                    "scheduler": BASE_SCHEDULER,
                    "lora_strength": None,
                    "low_vram": None,
                },
            },
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
            "max_pixels": MAX_PIXELS,
            "native_aspects": aspect_presets(),
            "two_k_available": False,
        },
    },
}


def get_specs() -> dict:
    """Return a copy so request handlers cannot mutate the canonical contract."""
    return copy.deepcopy(_SPECS)
