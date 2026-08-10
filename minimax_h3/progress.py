"""Pure mapping from pinned ComfyUI events to browser-safe progress."""

from __future__ import annotations


def progress_from_comfy_event(event: str, data: dict) -> dict | None:
    if event == "progress_state":
        sample = (data.get("nodes") or {}).get("sample")
        if not isinstance(sample, dict) or sample.get("state") != "running":
            return None
        maximum = float(sample.get("max") or 0)
        value = float(sample.get("value") or 0)
        if maximum <= 0:
            return None
        return {
            "phase": "sampling",
            "message": "Generating video and audio",
            "percent": max(0.0, min(1.0, value / maximum)),
        }
    if event != "executing":
        return None
    node = data.get("node")
    if node is None:
        return None
    node = str(node)
    if node in {"model", "turbo_lora", "clip", "video_vae", "audio_vae"} or node.startswith(
        "load_reference"
    ):
        return {"phase": "loading", "message": "Loading models and reference media"}
    if node.startswith("reference_components") or node == "conditioning":
        return {"phase": "conditioning", "message": "Preparing prompt and conditioning"}
    if node == "sample":
        return {"phase": "sampling", "message": "Generating video and audio"}
    if node in {"decode_video", "decode_audio"}:
        return {"phase": "decoding", "message": "Decoding generated media"}
    if node in {"create_video", "save_video"}:
        return {"phase": "saving", "message": "Muxing and saving the MP4"}
    return None
