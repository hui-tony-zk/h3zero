"""Idempotent, revision-pinned Hugging Face model downloads for H3."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

MODELS_ROOT = "/models"
SCRATCH_ROOT = "/root/hf-downloads"


def _normalize_spec(spec) -> tuple[str, str, str, str, str]:
    if len(spec) != 5:
        raise ValueError(f"Expected a five-field model spec, received {spec!r}")
    return spec


def required_paths(specs, models_root: str = MODELS_ROOT) -> list[Path]:
    return [
        Path(models_root) / folder / destination
        for _repo, _source, folder, destination, _revision in map(
            _normalize_spec, specs
        )
    ]


def require_files_present(specs, label: str = "MiniMax H3") -> None:
    missing = [
        str(path)
        for path in required_paths(specs)
        if not path.is_file() or path.stat().st_size <= 0
    ]
    if missing:
        listing = "\n".join(f"  - {path}" for path in missing)
        raise RuntimeError(
            f"Missing {label} model files:\n{listing}\n"
            "Run `npm run models` before sending generation requests."
        )


def safetensors_header_ok(path: str | Path) -> bool:
    path = str(path)
    if not path.endswith(".safetensors"):
        return True
    try:
        with open(path, "rb") as handle:
            header_length_bytes = handle.read(8)
            if len(header_length_bytes) != 8:
                return False
            header_length = int.from_bytes(header_length_bytes, "little")
            header = handle.read(header_length)
            if len(header) != header_length:
                return False
            json.loads(header.decode("utf-8"))
        return True
    except Exception as exc:
        print(f"Safetensors validation failed for {path}: {exc}", flush=True)
        return False


def download_files(specs) -> None:
    from huggingface_hub import hf_hub_download

    for spec in specs:
        repo, source, folder, destination, revision = _normalize_spec(spec)
        destination_dir = Path(MODELS_ROOT) / folder
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination_path = destination_dir / destination

        if destination_path.exists() and safetensors_header_ok(destination_path):
            print(f"Already present: {destination_path}", flush=True)
            continue
        if destination_path.exists():
            destination_path.unlink()

        print(f"Downloading {repo}@{revision}/{source}", flush=True)
        os.makedirs(SCRATCH_ROOT, exist_ok=True)
        downloaded = hf_hub_download(
            repo_id=repo,
            filename=source,
            revision=revision,
            local_dir=SCRATCH_ROOT,
        )
        shutil.move(downloaded, destination_path)
        if not safetensors_header_ok(destination_path):
            destination_path.unlink(missing_ok=True)
            raise RuntimeError(f"Downloaded file is invalid: {destination_path}")
        gib = destination_path.stat().st_size / 1024**3
        print(f"Saved {destination_path} ({gib:.2f} GiB)", flush=True)
