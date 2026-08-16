import type { AspectId, Job, LocalProject, ProjectClip } from "../types";

export interface ProjectMembership {
  id: string;
  name: string;
}

export const MIN_CLIP_SECONDS = 0.25;
export const PROJECT_SCHEMA_VERSION = 1 as const;
export const PROJECT_PLAYBACK_END_EPSILON = 0.03;
export const PROJECT_TRANSITION_SECONDS = 0.3;
export const PROJECT_PREVIEW_FPS = 30;

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function projectAspect(value: unknown): AspectId {
  return value === "9:16" ? "9:16" : "16:9";
}

export function clipDuration(clip: ProjectClip) {
  return Math.max(MIN_CLIP_SECONDS, clip.outPoint - clip.inPoint) / clip.playbackRate;
}

export function clipFractionAtSourceTime(clip: ProjectClip, sourceTime: number) {
  const sourceSpan = Math.max(MIN_CLIP_SECONDS, clip.outPoint - clip.inPoint);
  return Math.max(0, Math.min(1, (sourceTime - clip.inPoint) / sourceSpan));
}

export function sourceTimeAtClipFraction(clip: ProjectClip, fraction: number) {
  const boundedFraction = Math.max(0, Math.min(1, fraction));
  return clip.inPoint + (clip.outPoint - clip.inPoint) * boundedFraction;
}

export function isProjectPlaybackBoundary(clip: ProjectClip, sourceTime: number, ended = false) {
  return ended || sourceTime >= clip.outPoint - PROJECT_PLAYBACK_END_EPSILON;
}

export function projectClipFadeDuration(
  clips: ProjectClip[],
  index: number,
  fps = PROJECT_PREVIEW_FPS,
) {
  const clip = clips[index];
  if (!clip) return 0;
  const fadesIn = index > 0 && clip.transitionIn !== "cut";
  const fadesOut = index < clips.length - 1 && clips[index + 1].transitionIn !== "cut";
  const fadeCount = Number(fadesIn) + Number(fadesOut);
  if (!fadeCount) return 0;
  const fadeBudget = Math.max(0, clipDuration(clip) - 1 / Math.max(1, fps));
  return Math.min(PROJECT_TRANSITION_SECONDS, fadeBudget / fadeCount);
}

export function projectClipOpacity(
  clips: ProjectClip[],
  index: number,
  sourceTime: number,
  fps = PROJECT_PREVIEW_FPS,
) {
  const clip = clips[index];
  if (!clip) return 1;
  const fadesIn = index > 0 && clip.transitionIn !== "cut";
  const fadesOut = index < clips.length - 1 && clips[index + 1].transitionIn !== "cut";
  const fadeDuration = projectClipFadeDuration(clips, index, fps);
  if (!fadeDuration) return 1;
  const duration = clipDuration(clip);
  const elapsed = Math.max(0, Math.min(duration, (sourceTime - clip.inPoint) / clip.playbackRate));
  const fadeIn = fadesIn ? elapsed / fadeDuration : 1;
  const fadeOut = fadesOut ? (duration - elapsed) / fadeDuration : 1;
  return Math.max(0, Math.min(1, fadeIn, fadeOut));
}

export function normalizeClip(clip: ProjectClip): ProjectClip {
  const sourceDuration = Math.max(MIN_CLIP_SECONDS, finiteNumber(clip.sourceDuration, 5));
  const inPoint = Math.max(0, Math.min(sourceDuration - MIN_CLIP_SECONDS, finiteNumber(clip.inPoint, 0)));
  const outPoint = Math.max(
    inPoint + MIN_CLIP_SECONDS,
    Math.min(sourceDuration, finiteNumber(clip.outPoint, sourceDuration)),
  );
  const playbackRate = [0.5, 0.75, 1, 1.25, 1.5, 2].includes(clip.playbackRate)
    ? clip.playbackRate
    : 1;
  const transitionIn = clip.transitionIn === "cut" ? "cut" : "fade-black";
  return { ...clip, inPoint, outPoint, sourceDuration, playbackRate, transitionIn };
}

export function makeProject(name = "Untitled project", now = Date.now()): LocalProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID?.() ?? `project-${Math.random().toString(36).slice(2)}`,
    name,
    createdAt: now,
    updatedAt: now,
    aspect: "16:9",
    clips: [],
  };
}

export function makeProjectClip(job: Job, order: number, now = Date.now()): ProjectClip {
  const duration = Math.max(
    MIN_CLIP_SECONDS,
    finiteNumber(job.metadata?.duration_seconds, finiteNumber(job.duration, 5)),
  );
  return {
    id: crypto.randomUUID?.() ?? `clip-${Math.random().toString(36).slice(2)}`,
    jobId: job.id,
    inPoint: 0,
    outPoint: duration,
    sourceDuration: duration,
    playbackRate: 1,
    transitionIn: "fade-black",
    order,
    createdAt: now,
  };
}

export function reorderProjectClips(clips: ProjectClip[], fromId: string, toId: string) {
  const ordered = [...clips].sort((a, b) => a.order - b.order);
  const fromIndex = ordered.findIndex((clip) => clip.id === fromId);
  const toIndex = ordered.findIndex((clip) => clip.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return ordered;
  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);
  return ordered.map((clip, order) => ({ ...clip, order }));
}

export function moveProjectClip(clips: ProjectClip[], clipId: string, delta: number) {
  const ordered = [...clips].sort((a, b) => a.order - b.order);
  const fromIndex = ordered.findIndex((clip) => clip.id === clipId);
  const toIndex = Math.max(0, Math.min(ordered.length - 1, fromIndex + delta));
  if (fromIndex < 0 || fromIndex === toIndex) return ordered;
  return reorderProjectClips(ordered, clipId, ordered[toIndex].id);
}

export function projectMembershipsByJob(projects: LocalProject[]) {
  const memberships = new Map<string, ProjectMembership[]>();
  projects.forEach((project) => {
    project.clips.forEach((clip) => {
      const current = memberships.get(clip.jobId) ?? [];
      if (!current.some(({ id }) => id === project.id)) {
        memberships.set(clip.jobId, [...current, { id: project.id, name: project.name }]);
      }
    });
  });
  return memberships;
}

export function restoreProjects(value: unknown): LocalProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    if (source.schemaVersion !== PROJECT_SCHEMA_VERSION || typeof source.id !== "string") return [];
    const createdAt = finiteNumber(source.createdAt, Date.now());
    const rawClips = Array.isArray(source.clips) ? source.clips : [];
    const clips = rawClips.flatMap((item, order) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const clip = item as Record<string, unknown>;
      if (typeof clip.id !== "string" || typeof clip.jobId !== "string") return [];
      return [normalizeClip({
        id: clip.id,
        jobId: clip.jobId,
        inPoint: finiteNumber(clip.inPoint, 0),
        outPoint: finiteNumber(clip.outPoint, 5),
        sourceDuration: finiteNumber(clip.sourceDuration, 5),
        playbackRate: finiteNumber(clip.playbackRate, 1),
        transitionIn: clip.transitionIn === "cut" ? "cut" : "fade-black",
        order,
        createdAt: finiteNumber(clip.createdAt, createdAt),
      })];
    });
    return [{
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: source.id,
      name: typeof source.name === "string" && source.name.trim() ? source.name : "Untitled project",
      createdAt,
      updatedAt: finiteNumber(source.updatedAt, createdAt),
      aspect: projectAspect(source.aspect),
      clips,
    } satisfies LocalProject];
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}
