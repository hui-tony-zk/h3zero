"""FastAPI application factory for the CPU-only Modal web function."""

from __future__ import annotations

import json
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from minimax_h3 import media
from minimax_h3.specs import (
    AUDIO_MIME_TYPES,
    IMAGE_MIME_TYPES,
    MAX_AUDIO_BYTES,
    MAX_IMAGE_BYTES,
    MAX_REFERENCE_AUDIOS,
    MAX_REFERENCE_DURATION,
    MAX_REFERENCE_IMAGES,
    MAX_REFERENCE_SOURCES,
    MAX_REFERENCE_VIDEOS,
    MAX_VIDEO_BYTES,
    MIN_REFERENCE_DURATION,
    VIDEO_MIME_TYPES,
    aspect_presets,
    get_specs,
    native_canvas,
)
from minimax_h3.workflow import (
    TURBO_SAMPLER,
    TURBO_SCHEDULER,
    TURBO_STEPS,
    validate_generation,
    validate_image_bytes,
)
from modal_services import favorites, jobs

DEFAULT_CONFIG = {
    "mode": "frames",
    "width": 864,
    "height": 480,
    "duration_seconds": 5,
    "seed": None,
    "steps": TURBO_STEPS,
    "sampler": TURBO_SAMPLER,
    "scheduler": TURBO_SCHEDULER,
    "geometry_source": None,
    "ref_image_size": "match",
    "references": [],
}
CONFIG_FIELDS = set(DEFAULT_CONFIG)
REFERENCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
NATIVE_CANVASES = {
    (preset["width"], preset["height"])
    for preset in aspect_presets()
}

MIME_SUFFIXES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}


def parse_config(prompt: str, raw: str | None) -> dict:
    if not prompt.strip():
        raise ValueError("prompt must not be blank")
    try:
        supplied = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("config must be valid JSON") from exc
    if not isinstance(supplied, dict):
        raise ValueError("config must be a JSON object")
    unknown = sorted(set(supplied) - CONFIG_FIELDS)
    if unknown:
        raise ValueError(f"unknown config fields: {unknown}")

    config = {**DEFAULT_CONFIG, **supplied}
    if config["mode"] not in {"frames", "references"}:
        raise ValueError("mode must be 'frames' or 'references'")
    for field in ("width", "height", "steps"):
        if isinstance(config[field], bool) or not isinstance(config[field], int):
            raise ValueError(f"{field} must be an integer")
    duration = config["duration_seconds"]
    if isinstance(duration, bool) or not isinstance(duration, (int, float)):
        raise ValueError("duration_seconds must be a number")
    config["duration_seconds"] = float(duration)
    seed = config["seed"]
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int)):
        raise ValueError("seed must be an integer or null")
    if seed is not None and not 0 <= seed <= 0xFFFFFFFFFFFFFFFF:
        raise ValueError("seed must be an unsigned 64-bit integer")
    if not isinstance(config["sampler"], str) or not isinstance(config["scheduler"], str):
        raise ValueError("sampler and scheduler must be strings")
    if config["geometry_source"] not in {None, "first_frame", "last_frame"}:
        raise ValueError("geometry_source must be first_frame, last_frame, or null")
    if config["ref_image_size"] not in {"match", "max"}:
        raise ValueError("ref_image_size must be 'match' or 'max'")
    if not isinstance(config["references"], list):
        raise ValueError("references must be a JSON array")

    validate_generation(
        prompt=prompt,
        **{
            key: config[key]
            for key in (
                "width",
                "height",
                "duration_seconds",
                "steps",
                "sampler",
                "scheduler",
            )
        },
    )
    return config


async def _read_image(upload, label: str) -> tuple[bytes, tuple[int, int]] | None:
    if upload is None or not getattr(upload, "filename", ""):
        return None
    content_type = _content_type(upload)
    if content_type not in IMAGE_MIME_TYPES:
        await upload.close()
        raise ValueError(f"invalid {label} frame: unsupported image MIME type")
    try:
        raw = await upload.read(MAX_IMAGE_BYTES + 1)
    finally:
        await upload.close()
    try:
        validate_image_bytes(raw)
        dimensions = media.image_dimensions(raw)
    except ValueError as exc:
        raise ValueError(f"invalid {label} frame: {exc}") from exc
    return raw, dimensions


def _content_type(upload) -> str:
    return str(getattr(upload, "content_type", "") or "").split(";", 1)[0].lower()


async def _stage_upload(upload, destination: Path, max_bytes: int) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError(f"attachment exceeds the {max_bytes}-byte app limit")
                output.write(chunk)
    finally:
        await upload.close()
    if total == 0:
        destination.unlink(missing_ok=True)
        raise ValueError("attachments must not be empty")
    return total


async def _close_form_uploads(form) -> None:
    seen = set()
    for _, value in form.multi_items():
        if not hasattr(value, "close") or id(value) in seen:
            continue
        seen.add(id(value))
        try:
            await value.close()
        except Exception:
            pass


def _kind_for_mime(content_type: str) -> str | None:
    if content_type in IMAGE_MIME_TYPES:
        return "image"
    if content_type in VIDEO_MIME_TYPES:
        return "video"
    if content_type in AUDIO_MIME_TYPES:
        return "audio"
    return None


def _validate_reference_declarations(declarations: list[dict]) -> None:
    if not declarations:
        raise ValueError("references mode requires at least one attachment")
    if len(declarations) > MAX_REFERENCE_SOURCES:
        raise ValueError(f"references mode accepts at most {MAX_REFERENCE_SOURCES} sources")
    counts = {"image": 0, "video": 0, "audio": 0}
    ids = set()
    fields = set()
    for index, entry in enumerate(declarations):
        if not isinstance(entry, dict):
            raise ValueError(f"reference {index} must be an object")
        unknown = set(entry) - {"id", "kind", "field", "use_audio"}
        if unknown:
            raise ValueError(f"reference {index} has unknown fields: {sorted(unknown)}")
        reference_id = entry.get("id") or f"reference-{index + 1}"
        if not isinstance(reference_id, str) or not REFERENCE_ID.fullmatch(reference_id):
            raise ValueError(f"reference {index} has an invalid id")
        if reference_id in ids:
            raise ValueError("reference ids must be unique")
        ids.add(reference_id)
        entry["id"] = reference_id
        kind = entry.get("kind")
        if kind not in counts:
            raise ValueError(f"reference {index} kind must be image, video, or audio")
        counts[kind] += 1
        field = entry.get("field") or f"reference_{index}"
        if not isinstance(field, str) or not field or field in fields:
            raise ValueError("reference multipart fields must be non-empty and unique")
        fields.add(field)
        entry["field"] = field
        use_audio = entry.get("use_audio", False)
        if not isinstance(use_audio, bool):
            raise ValueError(f"reference {index} use_audio must be a boolean")
        if kind != "video" and use_audio:
            raise ValueError("use_audio is valid only for video references")
        entry["use_audio"] = use_audio
    if counts["image"] > MAX_REFERENCE_IMAGES:
        raise ValueError(f"references mode accepts at most {MAX_REFERENCE_IMAGES} images")
    if counts["video"] > MAX_REFERENCE_VIDEOS:
        raise ValueError(f"references mode accepts at most {MAX_REFERENCE_VIDEOS} videos")
    if counts["audio"] > MAX_REFERENCE_AUDIOS:
        raise ValueError(f"references mode accepts at most {MAX_REFERENCE_AUDIOS} audios")
    if counts["image"] + counts["video"] == 0:
        raise ValueError("audio cannot be the sole reference modality")


def _assign_reference_tags(references: list[dict]) -> None:
    slots = {"image": 0, "video": 0, "audio": 0}
    tags = {"image": 0, "video": 0, "audio": 0}
    for reference in references:
        kind = reference["kind"]
        reference["slot"] = slots[kind]
        slots[kind] += 1
        assigned = []
        if kind == "image":
            tags["image"] += 1
            assigned.append(f"<Picture {tags['image']}>")
        elif kind == "audio":
            tags["audio"] += 1
            assigned.append(f"<Audio {tags['audio']}>")
        else:
            if reference["use_audio"]:
                tags["audio"] += 1
                assigned.append(f"<Audio {tags['audio']}>")
            tags["video"] += 1
            assigned.append(f"<Video {tags['video']}>")
        reference["tags"] = assigned


def _duration_in_range(duration: float, label: str) -> None:
    if duration < MIN_REFERENCE_DURATION or duration > MAX_REFERENCE_DURATION:
        raise ValueError(
            f"{label} duration must be between {MIN_REFERENCE_DURATION:g} and "
            f"{MAX_REFERENCE_DURATION:g} seconds"
        )


async def _stage_references(
    *,
    form,
    config: dict,
    job_id: str,
    root: Path,
    probe_media: Callable,
    normalize_video: Callable,
) -> tuple[list[dict], list[dict]]:
    declarations = [dict(item) if isinstance(item, dict) else item for item in config["references"]]
    _validate_reference_declarations(declarations)

    staged: list[dict] = []
    video_total = 0.0
    audio_total = 0.0
    for index, declaration in enumerate(declarations):
        upload = form.get(declaration["field"])
        if upload is None or not getattr(upload, "filename", ""):
            raise ValueError(f"missing multipart file for reference {declaration['id']}")
        content_type = _content_type(upload)
        kind = declaration["kind"]
        expected_kind = _kind_for_mime(content_type)
        if expected_kind != kind:
            await upload.close()
            raise ValueError(
                f"reference {declaration['id']} MIME type does not match kind {kind}"
            )
        suffix = MIME_SUFFIXES[content_type]
        source_name = f"{index:02d}-{declaration['id']}{suffix}"
        source_path = jobs.input_path(job_id, source_name, root)
        max_bytes = {
            "image": MAX_IMAGE_BYTES,
            "video": MAX_VIDEO_BYTES,
            "audio": MAX_AUDIO_BYTES,
        }[kind]
        byte_count = await _stage_upload(upload, source_path, max_bytes)
        reference = {
            "id": declaration["id"],
            "index": index,
            "kind": kind,
            "name": Path(str(getattr(upload, "filename", "") or source_name)).name,
            "mime_type": content_type,
            "bytes": byte_count,
            "use_audio": declaration["use_audio"],
            "staged_filename": source_name,
        }
        if kind == "image":
            raw = source_path.read_bytes()
            validate_image_bytes(raw)
            reference["width"], reference["height"] = media.image_dimensions(raw)
        elif kind == "audio":
            metadata = probe_media(source_path)
            if not metadata.get("has_audio"):
                raise ValueError(f"reference {reference['id']} has no decodable audio stream")
            duration = float(metadata["duration_seconds"])
            _duration_in_range(duration, f"reference audio {reference['id']}")
            audio_total += duration
            reference["duration_seconds"] = round(duration, 3)
        else:
            source_metadata = probe_media(source_path)
            if not source_metadata.get("has_video"):
                raise ValueError(f"reference {reference['id']} has no decodable video stream")
            duration = float(source_metadata["duration_seconds"])
            _duration_in_range(duration, f"reference video {reference['id']}")
            if declaration["use_audio"] and not source_metadata.get("has_audio"):
                raise ValueError(
                    f"reference video {reference['id']} requested use_audio but has no audio stream"
                )
            normalized_name = f"{index:02d}-{declaration['id']}-24fps.mp4"
            normalized_path = jobs.input_path(job_id, normalized_name, root)
            normalized = normalize_video(
                source_path,
                normalized_path,
                include_audio=declaration["use_audio"],
            )
            source_path.unlink(missing_ok=True)
            reference.update({
                "staged_filename": normalized_name,
                "mime_type": "video/mp4",
                "bytes": normalized_path.stat().st_size,
                "width": int(normalized.get("width") or source_metadata.get("width") or 0),
                "height": int(normalized.get("height") or source_metadata.get("height") or 0),
                "fps": 24,
                "duration_seconds": round(float(normalized["duration_seconds"]), 3),
            })
            video_total += duration
        staged.append(reference)

    if video_total > MAX_REFERENCE_DURATION:
        raise ValueError("total reference video duration must not exceed 15 seconds")
    if audio_total > MAX_REFERENCE_DURATION:
        raise ValueError("total standalone reference audio duration must not exceed 15 seconds")
    _assign_reference_tags(staged)
    public = [
        {key: value for key, value in reference.items() if key != "staged_filename"}
        for reference in staged
    ]
    return staged, public


def _resolve_frame_geometry(
    config: dict,
    first: tuple[bytes, tuple[int, int]] | None,
    last: tuple[bytes, tuple[int, int]] | None,
) -> dict:
    available = {
        "first_frame": first,
        "last_frame": last,
    }
    populated = [name for name, value in available.items() if value is not None]
    source = config["geometry_source"]
    if not populated:
        if source is not None:
            raise ValueError("geometry_source requires a matching uploaded frame")
        if (config["width"], config["height"]) not in NATIVE_CANVASES:
            raise ValueError("canvas must be 864x480 (16:9) or 480x864 (9:16)")
        return config
    if source is None:
        source = populated[0]
    if source not in populated:
        raise ValueError(f"geometry_source {source} was not uploaded")
    source_dimensions = available[source][1]
    for name in populated:
        if name == source:
            continue
        width, height = available[name][1]
        source_width, source_height = source_dimensions
        if width * source_height != height * source_width:
            raise ValueError(
                f"{name} aspect ratio does not match {source}; crop it before submission"
            )
    width, height = native_canvas(*source_dimensions)
    resolved = {**config, "width": width, "height": height, "geometry_source": source}
    validate_generation(
        prompt="geometry validation",
        **{
            key: resolved[key]
            for key in (
                "width", "height", "duration_seconds", "steps", "sampler", "scheduler"
            )
        },
    )
    return resolved


def create_gateway(
    *,
    output_volume,
    service_factory: Callable,
    function_call_from_id: Callable,
    progress_store=None,
    output_root: str | Path = jobs.OUTPUT_ROOT,
    frontend_dist: str | Path = "/frontend/dist",
    probe_media: Callable = media.probe_media,
    normalize_video: Callable = media.normalize_video_24fps,
):
    root = Path(output_root)
    dist = Path(frontend_dist)
    api = FastAPI(title="H3Zero", version="2.0.0")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    async def call_modal_async(method, *args, **kwargs):
        """Use Modal's async interface without complicating local test doubles."""
        aio = getattr(method, "aio", None)
        if aio is not None:
            return await aio(*args, **kwargs)
        return await run_in_threadpool(method, *args, **kwargs)

    def commit() -> None:
        output_volume.commit()

    def reload() -> None:
        output_volume.reload()

    def get_progress(job_id: str) -> dict | None:
        if progress_store is None:
            return None
        try:
            return progress_store.get(job_id, None)
        except Exception:
            return None

    async def get_progress_async(job_id: str) -> dict | None:
        if progress_store is None:
            return None
        try:
            return await call_modal_async(progress_store.get, job_id, None)
        except Exception:
            return None

    def progress_payload(phase: str, message: str, percent=None) -> dict:
        progress = {
            "phase": phase,
            "message": message,
            "updated_at": jobs.utc_now(),
        }
        if percent is not None:
            progress["percent"] = max(0.0, min(1.0, float(percent)))
        return progress

    def put_progress(job_id: str, phase: str, message: str, *, percent=None) -> dict:
        progress = progress_payload(phase, message, percent)
        if progress_store is not None:
            try:
                progress_store.put(job_id, progress)
            except Exception:
                pass
        return progress

    async def put_progress_async(
        job_id: str,
        phase: str,
        message: str,
        *,
        percent=None,
    ) -> dict:
        progress = progress_payload(phase, message, percent)
        if progress_store is not None:
            try:
                await call_modal_async(progress_store.put, job_id, progress)
            except Exception:
                pass
        return progress

    def delete_progress(job_id: str) -> None:
        if progress_store is None:
            return
        try:
            progress_store.pop(job_id)
        except Exception:
            pass

    def persist_status(job_id: str, status: str, **changes) -> dict:
        record = jobs.update_job(job_id, root=root, status=status, **changes)
        commit()
        return record

    def terminal(job_id: str, status: str, error: str) -> dict:
        progress = put_progress(job_id, status, error)
        return persist_status(job_id, status, result=None, error=error, progress=progress)

    def refresh_job(job_id: str) -> dict | None:
        reload()
        record = jobs.read_job(job_id, root=root)
        if record is None:
            return None
        if record["status"] == "completed":
            if not jobs.video_path(job_id, root).is_file():
                return terminal(job_id, "expired", "persisted video is no longer available")
            return record
        if record["status"] not in {"queued", "running"}:
            return record

        call_id = record.get("call_id") or jobs.read_call_id(job_id, root)
        if not call_id:
            return record
        try:
            result = function_call_from_id(call_id).get(timeout=0)
        except Exception as exc:
            name = type(exc).__name__
            if isinstance(exc, TimeoutError) or name == "TimeoutError":
                return record
            if name in {"OutputExpiredError", "NotFoundError"}:
                if time.time() - float(record.get("created_at_unix", 0)) < 60:
                    return record
                return terminal(
                    job_id,
                    "expired",
                    "Modal call metadata expired before a video was persisted",
                )
            return terminal(job_id, "failed", f"generation failed: {str(exc)[:2000]}")

        reload()
        latest = jobs.read_job(job_id, root=root)
        if latest and latest["status"] not in {"queued", "running"}:
            return latest
        if isinstance(result, dict) and result.get("status") == "completed":
            progress = put_progress(job_id, "done", "Video ready")
            return persist_status(
                job_id,
                "completed",
                result=result.get("result"),
                error=None,
                call_id=call_id,
                progress=progress,
            )
        return terminal(job_id, "failed", "generation returned without a persisted result")

    @api.get("/api/health")
    def health():
        return {
            "status": "ok",
            "service": "minimax-h3",
            "gpu": "RTX-PRO-6000",
            "gpu_invoked": False,
        }

    @api.get("/api/specs")
    def specs():
        return get_specs()

    @api.get("/api/cloud-sync/{username}/favorites")
    def get_favorites(username: str):
        try:
            username = favorites.normalize_username(username)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        reload()
        return {"username": username, "jobs": favorites.list_favorites(username, root)}

    @api.put("/api/cloud-sync/{username}/favorites/{job_id}")
    async def put_favorite(username: str, job_id: str, request: Request):
        try:
            username = favorites.normalize_username(username)
            jobs.validate_job_id(job_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        reload()
        durable = jobs.read_job(job_id, root=root)
        if (
            durable is None
            or durable.get("status") != "completed"
            or not jobs.video_path(job_id, root).is_file()
        ):
            raise HTTPException(status_code=409, detail="only completed jobs can be favorited")

        form = await request.form(max_files=12, max_fields=16, max_part_size=1024 * 1024)
        job_value = form.get("job")
        assets_value = form.get("assets")
        if not isinstance(job_value, str) or not isinstance(assets_value, str):
            await _close_form_uploads(form)
            raise HTTPException(status_code=422, detail="job and assets JSON are required")

        temporary_paths: list[Path] = []
        try:
            client_job = json.loads(job_value)
            asset_declarations = json.loads(assets_value)
            if not isinstance(client_job, dict) or not isinstance(asset_declarations, list):
                raise ValueError("job must be an object and assets must be an array")
            if len(asset_declarations) > MAX_REFERENCE_SOURCES:
                raise ValueError(f"favorites accept at most {MAX_REFERENCE_SOURCES} source assets")

            client_ids = client_job.get("inputAssetIds") or []
            if not isinstance(client_ids, list) or any(not isinstance(value, str) for value in client_ids):
                raise ValueError("inputAssetIds must be an array of strings")
            allowed_asset_ids = set(client_ids)
            for field_name in ("firstFrameId", "lastFrameId"):
                value = client_job.get(field_name)
                if isinstance(value, str):
                    allowed_asset_ids.add(value)

            sanitized_assets = []
            seen_asset_ids = set()
            for index, source in enumerate(asset_declarations):
                if not isinstance(source, dict):
                    raise ValueError(f"favorite asset {index} must be an object")
                asset_id = favorites.validate_asset_id(str(source.get("id", "")))
                if asset_id not in allowed_asset_ids or asset_id in seen_asset_ids:
                    raise ValueError(f"favorite asset {index} is not a unique job input")
                seen_asset_ids.add(asset_id)
                kind = source.get("kind")
                mime_type = str(source.get("type", "")).lower()
                if kind not in {"image", "video", "audio"} or _kind_for_mime(mime_type) != kind:
                    raise ValueError(f"favorite asset {index} has an invalid media type")
                upload = form.get(f"asset_{index}")
                if upload is None or not getattr(upload, "filename", ""):
                    raise ValueError(f"favorite asset {index} file is missing")
                if _content_type(upload) != mime_type:
                    raise ValueError(f"favorite asset {index} MIME type does not match")
                destination = favorites.asset_path(username, asset_id, root)
                temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
                temporary_paths.append(temporary)
                max_bytes = {
                    "image": MAX_IMAGE_BYTES,
                    "video": MAX_VIDEO_BYTES,
                    "audio": MAX_AUDIO_BYTES,
                }[kind]
                size = await _stage_upload(upload, temporary, max_bytes)
                sanitized_assets.append({
                    "id": asset_id,
                    "name": Path(str(source.get("name") or getattr(upload, "filename", "asset"))).name,
                    "type": mime_type,
                    "kind": kind,
                    "size": size,
                    "width": source.get("width") if isinstance(source.get("width"), (int, float)) else None,
                    "height": source.get("height") if isinstance(source.get("height"), (int, float)) else None,
                    "duration": source.get("duration") if isinstance(source.get("duration"), (int, float)) else None,
                    "createdAt": source.get("createdAt") if isinstance(source.get("createdAt"), (int, float)) else 0,
                    "role": source.get("role") if source.get("role") in {"firstFrame", "lastFrame", "reference"} else None,
                })

            allowed_client_fields = {
                "createdAt", "updatedAt", "aspect", "displayAspect", "inputAssetIds",
                "firstFrameId", "lastFrameId", "referenceIds", "batchId", "batchIndex", "batchSize",
            }
            request_data = durable.get("request") or {}
            result_data = durable.get("result") if isinstance(durable.get("result"), dict) else {}
            favorite_record = {
                key: value for key, value in client_job.items() if key in allowed_client_fields
            }
            favorite_record.update({
                "id": job_id,
                "mode": request_data.get("mode", "frames"),
                "prompt": request_data.get("prompt", ""),
                "status": "completed",
                "duration": request_data.get("duration_seconds", 5),
                "contentUrl": f"/api/jobs/{job_id}/video",
                "metadata": result_data,
                "hearted": True,
                "favoriteAssets": sanitized_assets,
            })

            previous = favorites.read_favorite(username, job_id, root)
            previous_ids = {
                asset["id"] for asset in (previous or {}).get("favoriteAssets", [])
                if isinstance(asset, dict) and isinstance(asset.get("id"), str)
            }
            for temporary, asset in zip(temporary_paths, sanitized_assets):
                destination = favorites.asset_path(username, asset["id"], root)
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary.replace(destination)
            favorites.write_favorite(username, favorite_record, root)
            favorites.remove_unreferenced(username, previous_ids, root)
            commit()
            return favorite_record
        except (json.JSONDecodeError, ValueError) as exc:
            for temporary in temporary_paths:
                temporary.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        finally:
            await _close_form_uploads(form)

    @api.delete("/api/cloud-sync/{username}/favorites/{job_id}", status_code=204)
    def delete_favorite(username: str, job_id: str):
        try:
            username = favorites.normalize_username(username)
            jobs.validate_job_id(job_id)
            reload()
            favorites.delete_favorite(username, job_id, root)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="favorite not found") from exc
        commit()
        return Response(status_code=204)

    @api.get("/api/cloud-sync/{username}/assets/{asset_id}")
    def get_favorite_asset(username: str, asset_id: str):
        try:
            username = favorites.normalize_username(username)
            reload()
            path = favorites.asset_path(username, asset_id, root)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="favorite asset not found") from exc
        if not path.is_file():
            raise HTTPException(status_code=404, detail="favorite asset not found")
        return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})

    @api.post("/api/jobs", status_code=202)
    async def create_job(request: Request):
        form = await request.form(
            max_files=20,
            max_fields=50,
            max_part_size=1024 * 1024,
        )
        prompt_value = form.get("prompt")
        config_value = form.get("config")
        if not isinstance(prompt_value, str):
            await _close_form_uploads(form)
            raise HTTPException(status_code=422, detail="prompt is required")
        if config_value is not None and not isinstance(config_value, str):
            await _close_form_uploads(form)
            raise HTTPException(status_code=422, detail="config must be a JSON string")

        job_id = uuid.uuid4().hex
        staged_references: list[dict] = []
        public_references: list[dict] = []
        try:
            config = parse_config(prompt_value, config_value)
            attachment_fields = {
                entry.get("field")
                for entry in config["references"]
                if isinstance(entry, dict) and isinstance(entry.get("field"), str)
            }
            allowed_fields = {
                "prompt", "config", "first_frame", "last_frame", *attachment_fields,
            }
            unknown_fields = sorted(
                {name for name, _ in form.multi_items()} - allowed_fields
            )
            if unknown_fields:
                raise ValueError(f"unknown multipart fields: {unknown_fields}")
            first = await _read_image(form.get("first_frame"), "first")
            last = await _read_image(form.get("last_frame"), "last")
            if config["mode"] == "frames":
                if config["references"]:
                    raise ValueError("frames mode does not accept reference attachments")
                config = _resolve_frame_geometry(config, first, last)
            else:
                if first is not None or last is not None:
                    raise ValueError("references mode does not accept first_frame or last_frame")
                if config["geometry_source"] is not None:
                    raise ValueError("geometry_source is valid only in frames mode")
                if (config["width"], config["height"]) not in NATIVE_CANVASES:
                    raise ValueError("canvas must be 864x480 (16:9) or 480x864 (9:16)")
                staged_references, public_references = await _stage_references(
                    form=form,
                    config=config,
                    job_id=job_id,
                    root=root,
                    probe_media=probe_media,
                    normalize_video=normalize_video,
                )
                config = {**config, "references": public_references}
        except ValueError as exc:
            await _close_form_uploads(form)
            shutil.rmtree(jobs.input_dir(job_id, root), ignore_errors=True)
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        # Starlette keeps multipart file handles open for the lifetime of the
        # form object. Every accepted upload has already been copied/read, so
        # release all handles before persisting metadata or spawning work.
        await _close_form_uploads(form)

        first_frame = first[0] if first else None
        last_frame = last[0] if last else None
        jobs.create_job(
            job_id,
            prompt=prompt_value.strip(),
            config=config,
            has_first_frame=first_frame is not None,
            has_last_frame=last_frame is not None,
            root=root,
        )
        queued_progress = await put_progress_async(
            job_id,
            "queued",
            "Waiting for the GPU worker",
        )
        jobs.update_job(job_id, root=root, progress=queued_progress)
        await call_modal_async(output_volume.commit)
        try:
            call_config = {
                key: value
                for key, value in config.items()
                if key not in {"references"}
            }
            call = await call_modal_async(
                service_factory().generate.spawn,
                prompt=prompt_value.strip(),
                **call_config,
                references=staged_references,
                first_frame=first_frame,
                last_frame=last_frame,
                job_id=job_id,
                persist_output=True,
            )
            jobs.write_call_id(job_id, call.object_id, root=root)
            await call_modal_async(output_volume.commit)
        except Exception as exc:
            shutil.rmtree(jobs.input_dir(job_id, root), ignore_errors=True)
            progress = await put_progress_async(
                job_id,
                "failed",
                "Generation submission failed",
            )
            jobs.update_job(
                job_id,
                root=root,
                status="failed",
                error=f"could not submit generation: {str(exc)[:2000]}",
                progress=progress,
            )
            await call_modal_async(output_volume.commit)
            raise HTTPException(status_code=503, detail="generation submission failed") from exc

        record = jobs.read_job(job_id, root=root)
        return JSONResponse(
            jobs.public_job(record, await get_progress_async(job_id)),
            status_code=202,
        )

    @api.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        try:
            jobs.validate_job_id(job_id)
            record = refresh_job(job_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
        if record is None:
            raise HTTPException(status_code=404, detail="job not found")
        return jobs.public_job(record, get_progress(job_id))

    @api.get("/api/jobs/{job_id}/video")
    def get_video(job_id: str):
        try:
            jobs.validate_job_id(job_id)
            record = refresh_job(job_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
        if record is None:
            raise HTTPException(status_code=404, detail="job not found")
        if record["status"] == "expired":
            raise HTTPException(status_code=410, detail="video expired")
        if record["status"] != "completed":
            raise HTTPException(
                status_code=409,
                detail={"status": record["status"], "error": record.get("error")},
            )
        return FileResponse(
            jobs.video_path(job_id, root),
            media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"},
        )

    @api.delete("/api/jobs/{job_id}", status_code=204)
    def delete_job(job_id: str):
        try:
            jobs.validate_job_id(job_id)
            reload()
            record = jobs.read_job(job_id, root=root)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
        if record is None:
            raise HTTPException(status_code=404, detail="job not found")
        jobs.mark_deleted(job_id, root=root)
        call_id = record.get("call_id") or jobs.read_call_id(job_id, root)
        # Cancellation is latency-sensitive: do it before either durable
        # Volume commit so queued GPU work has the best chance of never starting.
        if call_id and record["status"] in {"queued", "running"}:
            try:
                function_call_from_id(call_id).cancel()
            except Exception:
                pass
        commit()
        favorites.delete_job_favorites(job_id, root)
        jobs.delete_job_artifacts(job_id, root=root)
        delete_progress(job_id)
        commit()
        return Response(status_code=204)

    assets = dist / "assets"
    if assets.is_dir():
        api.mount("/assets", StaticFiles(directory=assets), name="assets")

    @api.get("/{spa_path:path}", include_in_schema=False)
    def spa(spa_path: str):
        if spa_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="route not found")
        if dist.is_dir() and spa_path:
            candidate = (dist / spa_path).resolve()
            try:
                candidate.relative_to(dist.resolve())
            except ValueError:
                candidate = dist / "__invalid__"
            if candidate.is_file():
                return FileResponse(candidate)
        index = dist / "index.html"
        if index.is_file():
            return FileResponse(
                index,
                media_type="text/html",
                headers={"Cache-Control": "no-store"},
            )
        return JSONResponse(
            {"detail": "frontend build not included; run the frontend build before deploy"},
            status_code=503,
        )

    return api
