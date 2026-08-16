import type { Job, LocalProject } from "../types";
import { cacheGeneratedVideo, loadGeneratedVideoBlob } from "./generatedVideos";

const STORAGE_KEY = "h3-project-exports-v1";

export type StoredProjectExport = {
  exportId: string;
  filename: string;
  updatedAt: number;
};

function readStoredExports(): Record<string, StoredProjectExport> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function readStoredProjectExport(projectId: string) {
  return readStoredExports()[projectId] ?? null;
}

export function writeStoredProjectExport(projectId: string, value: StoredProjectExport) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStoredExports(), [projectId]: value }));
}

export function clearStoredProjectExport(projectId: string) {
  const exports = readStoredExports();
  if (!exports[projectId]) return;
  delete exports[projectId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(exports));
}

export async function prepareProjectExportVideos(
  project: LocalProject,
  jobsById: Map<string, Job>,
  onProgress?: (completed: number, total: number) => void,
) {
  const jobIds = [...new Set(project.clips.map((clip) => clip.jobId))];
  const videos = new Map<string, Blob>();
  for (const [index, jobId] of jobIds.entries()) {
    let video = await loadGeneratedVideoBlob(jobId);
    const sourceUrl = jobsById.get(jobId)?.contentUrl;
    if (!video && sourceUrl) {
      await cacheGeneratedVideo(jobId, sourceUrl);
      video = await loadGeneratedVideoBlob(jobId);
    }
    if (!video) throw new Error(`Clip ${index + 1} is unavailable on this device.`);
    videos.set(jobId, video.type === "video/mp4" ? video : new Blob([video], { type: "video/mp4" }));
    onProgress?.(index + 1, jobIds.length);
  }
  return videos;
}

export function downloadProjectExport(downloadUrl: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
