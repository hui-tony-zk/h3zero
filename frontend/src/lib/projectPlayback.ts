import type { ProjectClip } from "../types";

const STORAGE_KEY = "h3-project-playheads-v1";

export interface ProjectPlaybackPosition {
  clipId: string;
  sourceTime: number;
}

function readPositions(): Record<string, ProjectPlaybackPosition> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function readProjectPlaybackPosition(projectId: string) {
  return readPositions()[projectId] ?? null;
}

export function writeProjectPlaybackPosition(projectId: string, position: ProjectPlaybackPosition) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPositions(), [projectId]: position }));
}

export function clearProjectPlaybackPosition(projectId: string) {
  const positions = readPositions();
  if (!positions[projectId]) return;
  delete positions[projectId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

export function resolveProjectPlaybackPosition(
  clips: ProjectClip[],
  stored: ProjectPlaybackPosition | null,
): ProjectPlaybackPosition | null {
  if (!clips.length) return null;
  const clip = clips.find((candidate) => candidate.id === stored?.clipId) ?? clips[0];
  const sourceTime = stored?.clipId === clip.id && Number.isFinite(stored.sourceTime)
    ? stored.sourceTime
    : clip.inPoint;
  return {
    clipId: clip.id,
    sourceTime: Math.max(clip.inPoint, Math.min(clip.outPoint, sourceTime)),
  };
}
