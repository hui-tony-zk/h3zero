import type { H3Specs, MediaAsset } from "../src/types";

export const specs: H3Specs = {
  version: "1.0",
  modes: {
    frames: { available: true, attachments: { mime_types: ["image/png"], max_bytes_each: 20 * 1024 * 1024 } },
    references: { available: true, order: "newest_to_oldest", attachments: {
      max_sources: 12, max_images: 9, max_videos: 3, max_audios: 3, audio_may_not_be_sole_modality: true,
      image: { mime_types: ["image/png"], max_bytes_each: 20 * 1024 * 1024 },
      video: { mime_types: ["video/mp4"], max_bytes_each: 512 * 1024 * 1024, min_seconds_each: 2, max_seconds_each: 15, max_seconds_total: 15 },
      audio: { mime_types: ["audio/mpeg"], max_bytes_each: 100 * 1024 * 1024, min_seconds_each: 2, max_seconds_each: 15, max_seconds_total: 15 },
    } },
  },
  output: {
    duration: { default_seconds: 5, options: [{ requested_seconds: 5, frames: 124, actual_seconds: 124 / 24 }] },
    geometry: { multiple: 32, base_short_edge: 480, max_pixels: 480 * 864, native_aspects: [{ id: "9:16", width: 480, height: 864 }, { id: "16:9", width: 864, height: 480 }] },
  },
};

export function asset(id: string, kind: MediaAsset["kind"] = "image", createdAt = 1): MediaAsset {
  const type = kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg";
  const file = new File([id], `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"}`, { type });
  return { id, name: file.name, type, kind, size: file.size, file, previewUrl: `blob:${id}`, width: kind === "image" ? 1920 : undefined, height: kind === "image" ? 1080 : undefined, duration: kind === "image" ? undefined : 3, createdAt };
}
