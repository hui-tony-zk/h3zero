"""Media inspection and normalization helpers used before GPU submission."""

from __future__ import annotations

import json
import subprocess
from fractions import Fraction
from pathlib import Path

from minimax_h3.specs import FPS


def image_suffix(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return ".webp"
    raise ValueError("input images must be PNG, JPEG, or WebP")


def _png_dimensions(raw: bytes) -> tuple[int, int]:
    if len(raw) < 24 or raw[12:16] != b"IHDR":
        raise ValueError("invalid PNG image")
    return int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")


def _jpeg_dimensions(raw: bytes) -> tuple[int, int]:
    position = 2
    sof_markers = {
        0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
        0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
    }
    while position + 4 <= len(raw):
        if raw[position] != 0xFF:
            position += 1
            continue
        while position < len(raw) and raw[position] == 0xFF:
            position += 1
        if position >= len(raw):
            break
        marker = raw[position]
        position += 1
        if marker in {0x01, 0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if position + 2 > len(raw):
            break
        length = int.from_bytes(raw[position:position + 2], "big")
        if length < 2 or position + length > len(raw):
            break
        if marker in sof_markers and length >= 7:
            height = int.from_bytes(raw[position + 3:position + 5], "big")
            width = int.from_bytes(raw[position + 5:position + 7], "big")
            return width, height
        position += length
    raise ValueError("invalid JPEG image")


def _webp_dimensions(raw: bytes) -> tuple[int, int]:
    position = 12
    while position + 8 <= len(raw):
        kind = raw[position:position + 4]
        size = int.from_bytes(raw[position + 4:position + 8], "little")
        data = position + 8
        if data + size > len(raw):
            break
        if kind == b"VP8X" and size >= 10:
            width = 1 + int.from_bytes(raw[data + 4:data + 7], "little")
            height = 1 + int.from_bytes(raw[data + 7:data + 10], "little")
            return width, height
        if kind == b"VP8 " and size >= 10 and raw[data + 3:data + 6] == b"\x9d\x01\x2a":
            width = int.from_bytes(raw[data + 6:data + 8], "little") & 0x3FFF
            height = int.from_bytes(raw[data + 8:data + 10], "little") & 0x3FFF
            return width, height
        if kind == b"VP8L" and size >= 5 and raw[data] == 0x2F:
            bits = int.from_bytes(raw[data + 1:data + 5], "little")
            width = (bits & 0x3FFF) + 1
            height = ((bits >> 14) & 0x3FFF) + 1
            return width, height
        position = data + size + (size % 2)
    raise ValueError("invalid WebP image")


def image_dimensions(raw: bytes) -> tuple[int, int]:
    suffix = image_suffix(raw)
    if suffix == ".png":
        width, height = _png_dimensions(raw)
    elif suffix == ".jpg":
        width, height = _jpeg_dimensions(raw)
    else:
        width, height = _webp_dimensions(raw)
    if width <= 0 or height <= 0:
        raise ValueError("image dimensions must be positive")
    return width, height


def _duration(payload: dict) -> float:
    values = [payload.get("format", {}).get("duration")]
    values.extend(stream.get("duration") for stream in payload.get("streams", []))
    for value in values:
        try:
            duration = float(value)
        except (TypeError, ValueError):
            continue
        if duration > 0:
            return duration
    raise ValueError("media duration could not be determined")


def probe_media(path: str | Path) -> dict:
    """Return normalized ffprobe metadata without invoking a shell."""
    command = [
        "ffprobe", "-v", "error", "-of", "json",
        "-show_entries",
        "format=duration:stream=codec_type,width,height,r_frame_rate,duration",
        str(Path(path)),
    ]
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise ValueError("media file could not be decoded by ffprobe") from exc
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError("ffprobe returned invalid media metadata") from exc
    streams = payload.get("streams") or []
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
    result = {
        "duration_seconds": _duration(payload),
        "has_video": video is not None,
        "has_audio": audio is not None,
    }
    if video is not None:
        result["width"] = int(video.get("width") or 0)
        result["height"] = int(video.get("height") or 0)
        try:
            result["fps"] = float(Fraction(video.get("r_frame_rate") or "0/1"))
        except (ValueError, ZeroDivisionError):
            result["fps"] = 0.0
    return result


def normalize_video_24fps(
    source: str | Path,
    destination: str | Path,
    *,
    include_audio: bool,
) -> dict:
    """Create a deterministic H.264/24fps input and return its probed metadata."""
    source = Path(source)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg", "-v", "error", "-y", "-i", str(source),
        "-map", "0:v:0", "-vf", f"fps={FPS}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p",
    ]
    if include_audio:
        command.extend(["-map", "0:a:0", "-c:a", "aac", "-ar", "32000", "-ac", "2"])
    else:
        command.append("-an")
    command.extend(["-movflags", "+faststart", str(destination)])
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=10 * 60)
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        destination.unlink(missing_ok=True)
        raise ValueError("reference video could not be normalized to 24fps") from exc
    metadata = probe_media(destination)
    if not metadata["has_video"] or abs(float(metadata.get("fps", 0)) - FPS) > 0.01:
        destination.unlink(missing_ok=True)
        raise ValueError("normalized reference video is not 24fps")
    return metadata
