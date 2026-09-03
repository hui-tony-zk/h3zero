import type { GenerationMetadata, H3Specs, JobCreateResponse, JobProgress, JobStatus, JobStatusResponse } from "../../types";

const jobStatuses = new Set<JobStatus>(["queued", "running", "completed", "failed", "expired", "cancelled"]);
const loraIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

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

function timestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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
  if (source.version !== "1.8") throw new Error(`Unsupported H3 spec version: ${String(source.version)}`);
  const modes = record(source.modes);
  record(modes.frames);
  record(modes.references);
  const output = record(source.output);
  const attention = record(output.attention);
  record(attention.sparse);
  if (output.loras === undefined) output.loras = [];
  if (!Array.isArray(output.loras)) throw new Error("The H3 API returned an invalid LoRA catalog.");
  const loraIds = new Set<string>();
  for (const value of output.loras) {
    const lora = record(value);
    if (typeof lora.id !== "string" || !loraIdPattern.test(lora.id) || loraIds.has(lora.id)) {
      throw new Error("The H3 API returned an invalid LoRA ID.");
    }
    loraIds.add(lora.id);
    const aliases = lora.aliases ?? [];
    if (!Array.isArray(aliases)) throw new Error("The H3 API returned invalid LoRA aliases.");
    for (const alias of aliases) {
      if (typeof alias !== "string" || !loraIdPattern.test(alias) || loraIds.has(alias)) {
        throw new Error("The H3 API returned invalid LoRA aliases.");
      }
      loraIds.add(alias);
    }
    lora.aliases = aliases;
  }
  const sampling = record(output.sampling);
  const profiles = record(sampling.profiles);
  record(profiles.turbo_4);
  record(profiles.turbo_8);
  record(profiles.spectrum);
  record(profiles.base);
  record(output.seed);
  record(output.duration);
  const geometry = record(output.geometry);
  const resolutions = record(geometry.resolutions);
  record(resolutions["480p"]);
  record(resolutions["768p"]);
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
    createdAt: timestamp(source.created_at),
    updatedAt: timestamp(source.updated_at),
    samplingStartedAt: timestamp(source.sampling_started_at),
    error: typeof source.error === "string" ? source.error : undefined,
    metadata: metadata(source.result),
    videoUrl: typeof source.video_url === "string" ? source.video_url : undefined,
    progress: progress(source.progress),
  };
}
