import { restoreJob } from "./storage/jobRepository";
import type { FavoriteAsset, Job, MediaAsset } from "../types";

export function parseFavoriteSnapshot(value: unknown): Job[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.jobs)) return [];
  return source.jobs.flatMap((entry) => {
    const job = restoreJob(entry);
    return job ? [{ ...job, status: "completed" as const, contentUrl: `/api/jobs/${encodeURIComponent(job.id)}/video`, hearted: true }] : [];
  });
}

export function mergeFavoriteSnapshot(local: Job[], remote: Job[]) {
  const remoteById = new Map(remote.map((job) => [job.id, job]));
  const merged = local.map((job) => {
    const favorite = remoteById.get(job.id);
    if (!favorite) return job.hearted ? { ...job, hearted: false, favoriteAssets: [] } : job;
    remoteById.delete(job.id);
    return { ...job, ...favorite, hearted: true };
  });
  return [...merged, ...remoteById.values()];
}

export function describeFavoriteAssets(job: Job, assets: MediaAsset[]): FavoriteAsset[] {
  return assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    kind: asset.kind as FavoriteAsset["kind"],
    size: asset.size,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    createdAt: asset.createdAt,
    role: asset.id === job.firstFrameId ? "firstFrame"
      : asset.id === job.lastFrameId ? "lastFrame"
      : "reference",
  }));
}
