"""Durable favorite metadata and source assets stored beside H3 outputs."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from modal_services import jobs

_ASSET_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")


def normalize_username(username: str) -> str:
    normalized = username.strip().lower()
    if not _USERNAME.fullmatch(normalized):
        raise ValueError(
            "username must be 2–32 characters using letters, numbers, dots, hyphens, or underscores"
        )
    return normalized


def validate_asset_id(asset_id: str) -> str:
    if not _ASSET_ID.fullmatch(asset_id):
        raise ValueError("invalid favorite asset id")
    return asset_id


def _root(root: str | Path = jobs.OUTPUT_ROOT) -> Path:
    return Path(root) / "favorites" / "users"


def _user_root(username: str, root: str | Path = jobs.OUTPUT_ROOT) -> Path:
    return _root(root) / normalize_username(username)


def metadata_path(username: str, job_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> Path:
    return _user_root(username, root) / "jobs" / f"{jobs.validate_job_id(job_id)}.json"


def asset_path(username: str, asset_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> Path:
    return _user_root(username, root) / "assets" / f"{validate_asset_id(asset_id)}.blob"


def read_favorite(username: str, job_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> dict | None:
    path = metadata_path(username, job_id, root)
    if not path.is_file():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("id") != job_id:
        raise ValueError(f"invalid favorite metadata: {path}")
    return value


def list_favorites(username: str, root: str | Path = jobs.OUTPUT_ROOT) -> list[dict]:
    directory = _user_root(username, root) / "jobs"
    if not directory.is_dir():
        return []
    values = []
    for path in directory.glob("*.json"):
        try:
            value = read_favorite(username, path.stem, root)
        except (json.JSONDecodeError, ValueError):
            continue
        if value is not None:
            values.append(value)
    return sorted(
        values,
        key=lambda item: float(item.get("createdAt", 0) or 0),
        reverse=True,
    )


def write_favorite(username: str, record: dict, root: str | Path = jobs.OUTPUT_ROOT) -> dict:
    job_id = jobs.validate_job_id(str(record.get("id", "")))
    next_record = {**record, "id": job_id, "hearted": True}
    path = metadata_path(username, job_id, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(
        json.dumps(next_record, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    temporary.replace(path)
    return next_record


def referenced_asset_ids(username: str, root: str | Path = jobs.OUTPUT_ROOT) -> set[str]:
    referenced = set()
    for favorite in list_favorites(username, root):
        for asset in favorite.get("favoriteAssets") or []:
            if isinstance(asset, dict) and isinstance(asset.get("id"), str):
                referenced.add(asset["id"])
    return referenced


def delete_favorite(username: str, job_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> None:
    previous = read_favorite(username, job_id, root)
    metadata_path(username, job_id, root).unlink(missing_ok=True)
    if previous is None:
        return
    still_referenced = referenced_asset_ids(username, root)
    for asset in previous.get("favoriteAssets") or []:
        if not isinstance(asset, dict) or not isinstance(asset.get("id"), str):
            continue
        asset_id = asset["id"]
        if asset_id not in still_referenced:
            asset_path(username, asset_id, root).unlink(missing_ok=True)


def remove_unreferenced(username: str, asset_ids: set[str], root: str | Path = jobs.OUTPUT_ROOT) -> None:
    still_referenced = referenced_asset_ids(username, root)
    for asset_id in asset_ids - still_referenced:
        asset_path(username, asset_id, root).unlink(missing_ok=True)


def delete_job_favorites(job_id: str, root: str | Path = jobs.OUTPUT_ROOT) -> None:
    users_root = _root(root)
    if not users_root.is_dir():
        return
    for directory in users_root.iterdir():
        if not directory.is_dir():
            continue
        try:
            username = normalize_username(directory.name)
            delete_favorite(username, job_id, root)
        except (json.JSONDecodeError, ValueError):
            continue
