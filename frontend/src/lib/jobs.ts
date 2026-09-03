import type { ComposerDraft, Job, JobCreateResponse } from "../types";
import { isTurboProfile, samplingProfileId } from "./sampling";

export type JobBatch = { id: string; jobs: Job[]; active: boolean; createdAt: number };
type PendingBatch = { id: string; index: number; size: number; createdAt: number };

export function isActiveJob(job: Job) { return job.status === "uploading" || job.status === "queued" || job.status === "running"; }

export function groupJobs(jobs: Job[]): JobBatch[] {
  const grouped = new Map<string, Job[]>();
  for (const job of jobs) {
    const id = job.batchId ?? `job:${job.id}`;
    grouped.set(id, [...(grouped.get(id) ?? []), job]);
  }
  return [...grouped.entries()].map(([id, members]) => ({
    id,
    jobs: members.sort((left, right) => (left.batchIndex ?? 0) - (right.batchIndex ?? 0) || left.createdAt - right.createdAt),
    active: members.some(isActiveJob),
    createdAt: Math.max(...members.map((job) => job.createdAt)),
  })).sort((left, right) => Number(right.active) - Number(left.active) || right.createdAt - left.createdAt);
}

export function sortJobs(jobs: Job[]) {
  return groupJobs(jobs).flatMap((batch) => batch.jobs);
}

export function pendingJob(response: JobCreateResponse, draft: ComposerDraft, batch?: PendingBatch): Job {
  const now = batch?.createdAt ?? Date.now();
  const frames = draft.mode === "frames" ? [draft.firstFrame, draft.lastFrame].filter((asset) => asset !== null) : [];
  const source = [...frames].sort((left, right) => left.createdAt - right.createdAt)[0];
  const inputAssetIds = draft.mode === "references" ? draft.references.map((asset) => asset.id) : frames.map((asset) => asset.id);
  const samplingProfile = samplingProfileId(draft);
  return {
    id: response.id, mode: draft.mode, prompt: draft.prompt.trim(), createdAt: now, updatedAt: now,
    status: response.status, duration: draft.duration, aspect: draft.aspect,
    turbo: isTurboProfile(samplingProfile), samplingProfile, seed: "random", resolution: "480p",
    sparseAttention: draft.sparseAttention === true, sparseAttentionBudget: draft.sparseAttentionBudget ?? 0.3, loras: draft.loras ?? {},
    displayAspect: source?.width && source.height ? source.width / source.height : undefined,
    inputAssetIds,
    firstFrameId: draft.mode === "frames" ? draft.firstFrame?.id : undefined,
    lastFrameId: draft.mode === "frames" ? draft.lastFrame?.id : undefined,
    referenceIds: draft.mode === "references" ? inputAssetIds : undefined,
    contentUrl: "",
    progress: response.status === "uploading"
      ? { phase: "uploading", message: "Uploading inputs", updatedAt: now }
      : { phase: "queued", message: "Waiting for a worker", updatedAt: now },
    batchId: batch?.id,
    batchIndex: batch?.index,
    batchSize: batch?.size,
  };
}

export function uploadingJob(id: string, draft: ComposerDraft, batch: PendingBatch): Job {
  return pendingJob({ id, status: "uploading" }, draft, batch);
}
