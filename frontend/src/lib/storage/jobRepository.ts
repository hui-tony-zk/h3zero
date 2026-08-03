import { contentUrl } from "../api/client";
import type { AspectId, GenerationMode, Job, JobStatus } from "../../types";

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

function restore(value: unknown): Job | null {
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
    contentUrl: jobStatus === "completed" ? contentUrl(source.id) : "",
    error: typeof source.error === "string" ? source.error : undefined,
    metadata: source.metadata && typeof source.metadata === "object" ? source.metadata as Job["metadata"] : undefined,
    progress: source.progress && typeof source.progress === "object" ? source.progress as Job["progress"] : undefined,
  };
}

export function readJobs(): Job[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const values = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(values) ? values.map(restore).filter((job): job is Job => job !== null) : [];
  } catch { return []; }
}

export function writeJobs(jobs: Job[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs)); }
