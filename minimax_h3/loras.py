"""Optional, local-only style LoRA configuration and validation."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from pathlib import PurePosixPath
from urllib.parse import unquote, urlparse

LORA_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
DEFAULT_ENABLED = False
DEFAULT_STRENGTH = 1.0
DEFAULT_MIN_STRENGTH = 0.0
DEFAULT_MAX_STRENGTH = 1.5
DEFAULT_STEP = 0.1


def _load_local_loras() -> Iterable[Mapping]:
    try:
        from minimax_h3.local_loras import LORAS
    except ModuleNotFoundError as exc:
        if exc.name != "minimax_h3.local_loras":
            raise
        return ()
    return LORAS


def _finite_number(value, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"LoRA {field} must be a number")
    number = float(value)
    if number != number or number in {float("inf"), float("-inf")}:
        raise ValueError(f"LoRA {field} must be finite")
    return number


def _entry_from_url(name: str, url: str) -> dict:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("LoRA URL entries require a display name")
    if not isinstance(url, str):
        raise ValueError(f"LoRA {name} URL must be a string")
    parsed = urlparse(url)
    parts = [unquote(part) for part in parsed.path.split("/") if part]
    if parsed.scheme != "https" or parsed.netloc != "huggingface.co":
        raise ValueError(f"LoRA {name} must use an https://huggingface.co URL")
    if len(parts) < 5 or parts[2] != "resolve":
        raise ValueError(f"LoRA {name} URL must contain /resolve/<revision>/<file>")
    source = "/".join(parts[4:])
    lora_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64]
    return {
        "id": lora_id,
        "name": name.strip(),
        "repo": "/".join(parts[:2]),
        "source": source,
        "filename": PurePosixPath(source).name,
        "revision": parts[3],
        "default_enabled": DEFAULT_ENABLED,
        "default_strength": DEFAULT_STRENGTH,
    }


def normalize_loras(entries: Iterable[Mapping] | Mapping[str, str]) -> tuple[dict, ...]:
    if isinstance(entries, Mapping):
        entries = [_entry_from_url(name, url) for name, url in entries.items()]
    if isinstance(entries, (str, bytes)) or not isinstance(entries, Iterable):
        raise ValueError("LORAS must be an iterable of mappings")
    normalized = []
    seen = set()
    for index, raw in enumerate(entries):
        if not isinstance(raw, Mapping):
            raise ValueError(f"LoRA entry {index} must be a mapping")
        lora_id = raw.get("id")
        if not isinstance(lora_id, str) or not LORA_ID.fullmatch(lora_id):
            raise ValueError(f"LoRA entry {index} has an invalid id")
        if lora_id in seen:
            raise ValueError(f"duplicate LoRA id: {lora_id}")
        seen.add(lora_id)

        strings = {}
        for field in ("name", "repo", "source", "filename", "revision"):
            value = raw.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"LoRA {lora_id} requires {field}")
            strings[field] = value.strip()
        if (
            PurePosixPath(strings["filename"]).name != strings["filename"]
            or "\\" in strings["filename"]
        ):
            raise ValueError(f"LoRA {lora_id} filename must not contain a path")
        if not strings["filename"].lower().endswith(".safetensors"):
            raise ValueError(f"LoRA {lora_id} filename must be a safetensors file")

        minimum = _finite_number(raw.get("min_strength", DEFAULT_MIN_STRENGTH), "min_strength")
        maximum = _finite_number(raw.get("max_strength", DEFAULT_MAX_STRENGTH), "max_strength")
        step = _finite_number(raw.get("step", DEFAULT_STEP), "step")
        default = _finite_number(raw.get("default_strength", 1.0), "default_strength")
        if minimum < 0 or maximum <= minimum or step <= 0:
            raise ValueError(f"LoRA {lora_id} has an invalid strength range")
        if not minimum <= default <= maximum:
            raise ValueError(f"LoRA {lora_id} default_strength is outside its range")
        default_enabled = raw.get("default_enabled", False)
        if not isinstance(default_enabled, bool):
            raise ValueError(f"LoRA {lora_id} default_enabled must be a boolean")
        prompt = raw.get("prompt")
        if prompt is not None and not isinstance(prompt, str):
            raise ValueError(f"LoRA {lora_id} prompt must be a string")

        normalized.append({
            "id": lora_id,
            **strings,
            "default_enabled": default_enabled,
            "default_strength": default,
            "min_strength": minimum,
            "max_strength": maximum,
            "step": step,
            "prompt": prompt.strip() if isinstance(prompt, str) else None,
        })
    return tuple(normalized)


CONFIGURED_LORAS = normalize_loras(_load_local_loras())


def public_loras() -> list[dict]:
    private_fields = {"repo", "source", "revision"}
    return [
        {key: value for key, value in lora.items() if key not in private_fields}
        for lora in CONFIGURED_LORAS
    ]


def download_specs() -> list[tuple[str, str, str, str, str]]:
    return [
        (
            lora["repo"],
            lora["source"],
            "loras",
            lora["filename"],
            lora["revision"],
        )
        for lora in CONFIGURED_LORAS
    ]


def resolve_lora_strengths(value: Mapping | None) -> dict[str, float]:
    if value is None:
        value = {
            lora["id"]: lora["default_strength"]
            for lora in CONFIGURED_LORAS
            if lora["default_enabled"]
        }
    if not isinstance(value, Mapping):
        raise ValueError("loras must be a JSON object")
    configured = {lora["id"]: lora for lora in CONFIGURED_LORAS}
    if any(not isinstance(key, str) for key in value):
        raise ValueError("LoRA ids must be strings")
    unknown = sorted(set(value) - set(configured))
    if unknown:
        raise ValueError(f"unknown or unavailable LoRAs: {unknown}")
    resolved = {}
    for lora_id, raw_strength in value.items():
        lora = configured[lora_id]
        strength = _finite_number(raw_strength, f"{lora_id} strength")
        if not lora["min_strength"] <= strength <= lora["max_strength"]:
            raise ValueError(
                f"LoRA {lora_id} strength must be between "
                f"{lora['min_strength']} and {lora['max_strength']}"
            )
        if strength > 0:
            resolved[lora_id] = strength
    return resolved


def active_loras(strengths: Mapping[str, float]) -> list[dict]:
    configured = {lora["id"]: lora for lora in CONFIGURED_LORAS}
    return [
        {
            "id": lora_id,
            "name": configured[lora_id]["name"],
            "filename": configured[lora_id]["filename"],
            "strength": strength,
        }
        for lora_id, strength in strengths.items()
    ]
