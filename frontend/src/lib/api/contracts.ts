import type { GenerationMetadata, H3Specs, JobCreateResponse, JobProgress, JobStatus, JobStatusResponse } from "../../types";

const jobStatuses = new Set<JobStatus>(["queued", "running", "completed", "failed", "expired", "cancelled"]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The H3 API returned an invalid object.");
  return value as Record<string, unknown>;
}

function jobStatus(value: unknown): JobStatus {
  if (typeof value !== "string" || !jobStatuses.has(value as JobStatus)) throw new Error(`The H3 API returned an invalid job status: ${String(value)}`);
  return value as JobStatus;
}

function jobId(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("The H3 API did not return a job ID.");
  return value;
}

function progress(value: unknown): JobProgress | undefined {
  if (value == null) return undefined;
  const source = record(value);
  const updatedAt = typeof source.updated_at === "number" ? source.updated_at : Date.now() / 1000;
  return {
    phase: typeof source.phase === "string" ? source.phase : "working",
    message: typeof source.message === "string" ? source.message : "H3 is working",
    updatedAt: updatedAt * (updatedAt < 10_000_000_000 ? 1000 : 1),
    percent: typeof source.percent === "number" ? Math.max(0, Math.min(1, source.percent)) : undefined,
  };
}

function metadata(value: unknown): GenerationMetadata | undefined {
  if (value == null) return undefined;
  const { video_url: _videoUrl, ...result } = record(value);
  return result as GenerationMetadata;
}

export function parseSpecs(value: unknown): H3Specs {
  const source = record(value);
  if (source.version !== "1.2") throw new Error(`Unsupported H3 spec version: ${String(source.version)}`);
  const modes = record(source.modes);
  record(modes.frames);
  record(modes.references);
  const output = record(source.output);
  const sampling = record(output.sampling);
  const profiles = record(sampling.profiles);
  record(profiles.turbo);
  record(profiles.base);
  record(output.duration);
  record(output.geometry);
  return source as unknown as H3Specs;
}

export function parseJobCreate(value: unknown): JobCreateResponse {
  const source = record(value);
  return { id: jobId(source.id), status: jobStatus(source.status) };
}

export function parseJobStatus(value: unknown, fallbackId: string): JobStatusResponse {
  const source = record(value);
  return {
    id: jobId(source.id ?? fallbackId),
    status: jobStatus(source.status),
    error: typeof source.error === "string" ? source.error : undefined,
    metadata: metadata(source.result),
    videoUrl: typeof source.video_url === "string" ? source.video_url : undefined,
    progress: progress(source.progress),
  };
}
