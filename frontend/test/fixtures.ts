import type { H3Specs, MediaAsset } from "../src/types";

export const specs: H3Specs = {
  version: "1.7",
  modes: {
    frames: { available: true, attachments: { mime_types: ["image/png"], max_bytes_each: 20 * 1024 * 1024 } },
    references: { available: true, order: "upload_order", attachments: {
      max_sources: 12, max_images: 9, max_videos: 3, max_audios: 3, audio_may_not_be_sole_modality: true,
      image: { mime_types: ["image/png"], max_bytes_each: 20 * 1024 * 1024 },
      video: { mime_types: ["video/mp4"], max_bytes_each: 512 * 1024 * 1024, min_seconds_each: 2, max_seconds_each: 15, max_seconds_total: 15 },
      audio: { mime_types: ["audio/mpeg"], max_bytes_each: 100 * 1024 * 1024, min_seconds_each: 2, max_seconds_each: 15, max_seconds_total: 15 },
    } },
  },
  output: {
    attention: { backend: "comfy_kitchen", version: "0.2.31", scope: "global" },
    loras: [],
    sampling: { default: "turbo_4", profiles: {
      turbo_4: { label: "Turbo · 4 steps", method: "LightX2V MiniMax-H3 Turbo 4-step LoRA", lora: "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors", preview: true, steps: { default: 4, min: 4, max: 4 }, sampler: "res_multistep", scheduler: "simple", lora_strength: 1, spectrum: false, turbo: true, low_vram: null },
      turbo_8: { label: "8 step LoRA", method: "LightX2V MiniMax-H3 Turbo 8-step LoRA", lora: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors", preview: true, steps: { default: 8, min: 8, max: 8 }, sampler: "res_multistep", scheduler: "simple", lora_strength: 1, spectrum: false, turbo: true, low_vram: null },
      spectrum: { label: "Spectrum · 30 steps", method: "MiniMax-H3 Base with Spectrum v0.2.16", lora: null, preview: true, steps: { default: 30, min: 30, max: 30 }, sampler: "res_multistep", scheduler: "simple", lora_strength: null, spectrum: true, turbo: false, low_vram: null },
      base: { label: "Base · 30 steps", method: "MiniMax-H3 Base", lora: null, preview: false, steps: { default: 30, min: 30, max: 30 }, sampler: "res_multistep", scheduler: "simple", lora_strength: null, spectrum: false, turbo: false, low_vram: null },
    } },
    seed: { default: "random", options: [{ id: "random", label: "Random", value: null }, { id: "42", label: "42", value: 42 }, { id: "106", label: "106", value: 106 }, { id: "99", label: "99", value: 99 }] },
    duration: { default_seconds: 5, options: [{ requested_seconds: 5, frames: 124, actual_seconds: 124 / 24 }] },
    geometry: {
      multiple: 32, base_short_edge: 480, max_pixels: 480 * 864,
      native_aspects: [{ id: "9:16", width: 480, height: 864 }, { id: "16:9", width: 864, height: 480 }],
      default_resolution: "480p",
      resolutions: {
        "480p": { label: "480p", short_edge: 480, max_pixels: 480 * 864, recommended: false, native_aspects: [{ id: "9:16", width: 480, height: 864 }, { id: "16:9", width: 864, height: 480 }] },
        "768p": { label: "768p (recommended)", short_edge: 768, max_pixels: 768 * 1344, recommended: true, native_aspects: [{ id: "9:16", width: 768, height: 1344 }, { id: "16:9", width: 1344, height: 768 }] },
      },
    },
  },
};

export function asset(id: string, kind: MediaAsset["kind"] = "image", createdAt = 1): MediaAsset {
  const type = kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg";
  const file = new File([id], `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"}`, { type });
  return { id, name: file.name, type, kind, size: file.size, file, previewUrl: `blob:${id}`, width: kind === "image" ? 1920 : undefined, height: kind === "image" ? 1080 : undefined, duration: kind === "image" ? undefined : 3, createdAt };
}
