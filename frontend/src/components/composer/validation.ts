import { createMediaAsset } from "../../lib/assets";
import type { FramesModeSpec, MediaAsset, ReferencesModeSpec } from "../../types";

function mib(bytes: number) { return Math.round(bytes / 1024 / 1024); }

export async function prepareFrame(file: File, spec: FramesModeSpec) {
  if (!spec.attachments.mime_types.includes(file.type)) throw new Error("Frames must be PNG, JPEG, or WebP images.");
  if (file.size > spec.attachments.max_bytes_each) throw new Error(`Frames must be ${mib(spec.attachments.max_bytes_each)} MiB or smaller.`);
  return createMediaAsset(file);
}

export async function prepareReferences(files: FileList, current: MediaAsset[], spec: ReferencesModeSpec) {
  const policy = spec.attachments;
  if (current.length + files.length > policy.max_sources) throw new Error(`This model accepts up to ${policy.max_sources} attachments.`);
  const assets = await Promise.all(Array.from(files).map((file) => createMediaAsset(file)));
  const next = assets.concat(current);
  for (const asset of assets) {
    if (asset.kind === "file") throw new Error(`${asset.name} is not a supported image, video, or audio file.`);
    const kindPolicy = policy[asset.kind];
    if (!kindPolicy.mime_types.includes(asset.type)) throw new Error(`${asset.name} is not a supported ${asset.kind} file.`);
    if (asset.size > kindPolicy.max_bytes_each) throw new Error(`${asset.name} must be ${mib(kindPolicy.max_bytes_each)} MiB or smaller.`);
    if ((asset.kind === "video" || asset.kind === "audio") && asset.duration !== undefined && (asset.duration < (kindPolicy.min_seconds_each ?? 0) || asset.duration > (kindPolicy.max_seconds_each ?? Infinity))) throw new Error(`${asset.name} must be ${kindPolicy.min_seconds_each}–${kindPolicy.max_seconds_each} seconds.`);
  }
  const count = (kind: MediaAsset["kind"]) => next.filter((asset) => asset.kind === kind).length;
  if (count("image") > policy.max_images) throw new Error(`This model accepts up to ${policy.max_images} images.`);
  if (count("video") > policy.max_videos) throw new Error(`This model accepts up to ${policy.max_videos} videos.`);
  if (count("audio") > policy.max_audios) throw new Error(`This model accepts up to ${policy.max_audios} audio clips.`);
  for (const kind of ["video", "audio"] as const) {
    const total = next.filter((asset) => asset.kind === kind).reduce((sum, asset) => sum + (asset.duration ?? 0), 0);
    const limit = policy[kind].max_seconds_total;
    if (limit !== undefined && total > limit) throw new Error(`${kind === "video" ? "Reference videos" : "Audio clips"} can total up to ${limit} seconds.`);
  }
  return assets;
}

export async function prepareReferenceReplacement(file: File, replaced: MediaAsset, current: MediaAsset[], spec: ReferencesModeSpec) {
  const asset = await createMediaAsset(file);
  if (asset.kind === "file") throw new Error(`${asset.name} is not a supported image, video, or audio file.`);
  if (asset.kind !== replaced.kind) throw new Error(`Choose another ${replaced.kind} file for this reference.`);
  const remaining = current.filter((candidate) => candidate.id !== replaced.id);
  const policy = spec.attachments[asset.kind];
  if (!policy.mime_types.includes(asset.type)) throw new Error(`${asset.name} is not a supported ${asset.kind} file.`);
  if (asset.size > policy.max_bytes_each) throw new Error(`${asset.name} must be ${mib(policy.max_bytes_each)} MiB or smaller.`);
  if ((asset.kind === "video" || asset.kind === "audio") && asset.duration !== undefined && (asset.duration < (policy.min_seconds_each ?? 0) || asset.duration > (policy.max_seconds_each ?? Infinity))) throw new Error(`${asset.name} must be ${policy.min_seconds_each}–${policy.max_seconds_each} seconds.`);
  if (asset.kind === "video" || asset.kind === "audio") {
    const total = remaining.filter((candidate) => candidate.kind === asset.kind).reduce((sum, candidate) => sum + (candidate.duration ?? 0), asset.duration ?? 0);
    if (policy.max_seconds_total !== undefined && total > policy.max_seconds_total) throw new Error(`${asset.kind === "video" ? "Reference videos" : "Audio clips"} can total up to ${policy.max_seconds_total} seconds.`);
  }
  return asset;
}
