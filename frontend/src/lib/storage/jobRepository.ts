import type { AspectId, FavoriteAsset, GenerationMode, Job, JobStatus } from "../../types";

const STORAGE_KEY = "h3-studio-jobs-v2";
const aspects = new Set<AspectId>(["9:16", "16:9"]);
const statuses = new Set<JobStatus>(["queued", "running", "completed", "failed", "expired", "cancelled"]);

function stringList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function mode(value: unknown): GenerationMode { return value === "references" ? "references" : "frames"; }
function aspect(value: unknown): AspectId {
  if (aspects.has(value as AspectId)) return value as AspectId;
  return "16:9";
}
function status(value: unknown): JobStatus {
  return statuses.has(value as JobStatus) ? value as JobStatus : "failed";
}

function restoreFavoriteAssets(value: unknown): FavoriteAsset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    if (
      typeof source.id !== "string" || typeof source.name !== "string"
      || typeof source.type !== "string" || !["image", "video", "audio"].includes(String(source.kind))
    ) return [];
    return [{
      id: source.id,
      name: source.name,
      type: source.type,
      kind: source.kind as FavoriteAsset["kind"],
      size: typeof source.size === "number" ? source.size : 0,
      width: typeof source.width === "number" ? source.width : undefined,
      height: typeof source.height === "number" ? source.height : undefined,
      duration: typeof source.duration === "number" ? source.duration : undefined,
      createdAt: typeof source.createdAt === "number" ? source.createdAt : 0,
      role: ["firstFrame", "lastFrame", "reference"].includes(String(source.role)) ? source.role as FavoriteAsset["role"] : undefined,
    }];
  });
}

export function restoreJob(value: unknown): Job | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id) return null;
  const createdAt = typeof source.createdAt === "number" ? source.createdAt : Date.now();
  const jobMode = mode(source.mode);
  const jobStatus = status(source.status);
  const inputAssetIds = stringList(source.inputAssetIds);
  const referenceIds = stringList(source.referenceIds);
  return {
    id: source.id, mode: jobMode, status: jobStatus,
    prompt: typeof source.prompt === "string" ? source.prompt : "",
    createdAt, updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : createdAt,
    duration: typeof source.duration === "number" ? source.duration : 5,
    aspect: aspect(source.aspect),
    displayAspect: typeof source.displayAspect === "number" ? source.displayAspect : undefined,
    inputAssetIds,
    firstFrameId: typeof source.firstFrameId === "string" ? source.firstFrameId : undefined,
    lastFrameId: typeof source.lastFrameId === "string" ? source.lastFrameId : undefined,
    referenceIds: referenceIds.length ? referenceIds : jobMode === "references" ? inputAssetIds : undefined,
    contentUrl: jobStatus === "completed" ? `/api/jobs/${encodeURIComponent(source.id)}/video` : "",
    error: typeof source.error === "string" ? source.error : undefined,
    metadata: source.metadata && typeof source.metadata === "object" ? source.metadata as Job["metadata"] : undefined,
    progress: source.progress && typeof source.progress === "object" ? source.progress as Job["progress"] : undefined,
    batchId: typeof source.batchId === "string" ? source.batchId : undefined,
    batchIndex: typeof source.batchIndex === "number" ? source.batchIndex : undefined,
    batchSize: typeof source.batchSize === "number" ? source.batchSize : undefined,
    hearted: source.hearted === true,
    favoriteAssets: restoreFavoriteAssets(source.favoriteAssets),
  };
}

export function readJobs(): Job[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const values = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(values) ? values.map(restoreJob).filter((job): job is Job => job !== null) : [];
  } catch { return []; }
}

export function writeJobs(jobs: Job[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.filter((job) => job.status !== "uploading")));
}
