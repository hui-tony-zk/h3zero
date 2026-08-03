"""Comfy custom node preserving MiniMax H3 references in global request order.

This file is copied into ComfyUI/custom_nodes by the Modal image definition. It
targets the repository-pinned ComfyUI H3 implementation and deliberately reuses
its latent, resize, and audio helpers.
"""

from __future__ import annotations

import json
import math

import node_helpers
from comfy_extras.nodes_minimax_h3 import (
    CANVAS_MULTIPLE,
    FPS,
    REF_IMAGE_SHORT_EDGE,
    MiniMaxH3ReferenceToVideo,
    _empty_av_latent,
    _resize,
    adapt_canvas,
)


class MiniMaxH3OrderedReferenceToVideo:
    """Ref2VA conditioning with a single cross-media ordering manifest."""

    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        optional.update({f"ref_image_{index}": ("IMAGE",) for index in range(9)})
        optional.update({f"ref_video_{index}": ("IMAGE",) for index in range(3)})
        optional.update({f"ref_video_audio_{index}": ("AUDIO",) for index in range(3)})
        optional.update({f"ref_audio_{index}": ("AUDIO",) for index in range(3)})
        return {
            "required": {
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "audio_vae": ("VAE",),
                "prompt": ("STRING", {"multiline": True, "dynamicPrompts": True}),
                "width": ("INT", {"default": 864, "min": 32, "step": 32}),
                "height": ("INT", {"default": 480, "min": 32, "step": 32}),
                "length": ("INT", {"default": 124, "min": 5, "step": 17}),
                "ref_image_size": (["match", "max"], {"default": "match"}),
                "reference_order": ("STRING", {"default": "[]"}),
            },
            "optional": optional,
        }

    RETURN_TYPES = ("CONDITIONING", "LATENT")
    RETURN_NAMES = ("positive", "latent")
    FUNCTION = "execute"
    CATEGORY = "model/conditioning/minimax"
    DESCRIPTION = "MiniMax H3 Ref2VA with globally ordered mixed references."

    @staticmethod
    def _order(raw: str) -> list[dict]:
        try:
            order = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("reference_order must be valid JSON") from exc
        if not isinstance(order, list):
            raise ValueError("reference_order must be a list")
        seen = set()
        for entry in order:
            if not isinstance(entry, dict):
                raise ValueError("each ordered reference must be an object")
            kind = entry.get("kind")
            slot = entry.get("slot")
            if kind not in {"image", "video", "audio"}:
                raise ValueError("ordered reference has an invalid kind")
            if not isinstance(slot, int) or slot < 0:
                raise ValueError("ordered reference has an invalid slot")
            key = (kind, slot)
            if key in seen:
                raise ValueError("ordered reference slots must be unique")
            seen.add(key)
        return order

    def execute(
        self,
        clip,
        vae,
        audio_vae,
        prompt,
        width,
        height,
        length,
        ref_image_size,
        reference_order,
        **kwargs,
    ):
        latent, frame_count = _empty_av_latent(width, height, length)
        ref_items = []
        ref_blocks = []

        for entry in self._order(reference_order):
            kind = entry["kind"]
            slot = entry["slot"]
            if kind == "image":
                image = kwargs.get(f"ref_image_{slot}")
                if image is None:
                    raise ValueError(f"ordered image slot {slot} is not connected")
                source_height, source_width = image.shape[1], image.shape[2]
                if ref_image_size == "match":
                    scale = min(
                        1.0,
                        math.sqrt((width * height) / (source_width * source_height)),
                    )
                else:
                    scale = min(
                        1.0,
                        REF_IMAGE_SHORT_EDGE / min(source_width, source_height),
                    )
                target_width = max(
                    CANVAS_MULTIPLE,
                    round(source_width * scale / CANVAS_MULTIPLE) * CANVAS_MULTIPLE,
                )
                target_height = max(
                    CANVAS_MULTIPLE,
                    round(source_height * scale / CANVAS_MULTIPLE) * CANVAS_MULTIPLE,
                )
                resized = _resize(image[:1], target_width, target_height, "disabled")
                encoded = vae.encode(resized)
                ref_items.append({"type": "image", "data": resized})
                ref_blocks.append({
                    "kind": "image",
                    "latent_h": target_height // 16,
                    "latent_w": target_width // 16,
                    "latent": encoded,
                })
                continue

            if kind == "audio":
                audio = kwargs.get(f"ref_audio_{slot}")
                if audio is None:
                    raise ValueError(f"ordered audio slot {slot} is not connected")
                audio_latent, audio_length = MiniMaxH3ReferenceToVideo._encode_ref_audio(
                    audio_vae,
                    audio,
                )
                ref_items.append({"type": "audio"})
                ref_blocks.append({
                    "kind": "audio",
                    "ref_audio_t": audio_length,
                    "audio_latent": audio_latent,
                })
                continue

            video_frames = kwargs.get(f"ref_video_{slot}")
            if video_frames is None:
                raise ValueError(f"ordered video slot {slot} is not connected")
            soundtrack = None
            if entry.get("use_audio"):
                soundtrack = kwargs.get(f"ref_video_audio_{slot}")
                if soundtrack is None:
                    raise ValueError(f"ordered video audio slot {slot} is not connected")
            source_height, source_width = video_frames.shape[1], video_frames.shape[2]
            canvas_width, canvas_height = adapt_canvas(source_width, source_height)
            if source_width * source_height < canvas_width * canvas_height:
                canvas_width = max(
                    CANVAS_MULTIPLE,
                    round(source_width / CANVAS_MULTIPLE) * CANVAS_MULTIPLE,
                )
                canvas_height = max(
                    CANVAS_MULTIPLE,
                    round(source_height / CANVAS_MULTIPLE) * CANVAS_MULTIPLE,
                )
            frames = _resize(video_frames, canvas_width, canvas_height, "disabled")
            if frames.shape[0] > frame_count:
                frames = frames[:frame_count]
            count = frames.shape[0]
            if count < 5:
                raise ValueError("MiniMax H3 reference videos need at least 5 frames")
            while count % 17 != 5:
                count -= 1
            frames = frames[:count]
            encoded = vae.encode(frames)
            audio_latent, audio_length = (None, 0)
            if soundtrack is not None:
                audio_latent, audio_length = MiniMaxH3ReferenceToVideo._encode_ref_audio(
                    audio_vae,
                    soundtrack,
                )
                # MiniMax presents a selected synchronized audio label immediately
                # before the visual label for that same globally ordered source.
                ref_items.append({"type": "audio"})
            sample_indices = list(range(0, frames.shape[0], FPS // 2))
            qwen_frames = frames[sample_indices]
            ref_items.append({
                "type": "video",
                "data": qwen_frames,
                "timestamps": [index / 2.0 for index in range(len(sample_indices))],
            })
            ref_blocks.append({
                "kind": "video_audio" if audio_length else "video",
                "latent_t": encoded.shape[2],
                "latent_h": canvas_height // 16,
                "latent_w": canvas_width // 16,
                "ref_audio_t": audio_length,
                "latent": encoded,
                "audio_latent": audio_latent,
            })

        tokens = clip.tokenize(prompt, minimax_ref_items=ref_items)
        conditioning = clip.encode_from_tokens_scheduled(tokens)
        if ref_blocks:
            conditioning = node_helpers.conditioning_set_values(
                conditioning,
                {"minimax_refs": ref_blocks},
            )
        return conditioning, latent


NODE_CLASS_MAPPINGS = {
    "MiniMaxH3OrderedReferenceToVideo": MiniMaxH3OrderedReferenceToVideo,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MiniMaxH3OrderedReferenceToVideo": "MiniMax H3 Ordered Reference to Video",
}
