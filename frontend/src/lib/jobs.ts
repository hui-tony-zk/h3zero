import type { ComposerDraft, Job, JobCreateResponse } from "../types";

export function isActiveJob(job: Job) { return job.status === "queued" || job.status === "running"; }

export function sortJobs(jobs: Job[]) {
  return [...jobs].sort((left, right) => Number(isActiveJob(right)) - Number(isActiveJob(left)) || right.createdAt - left.createdAt);
}

export function pendingJob(response: JobCreateResponse, draft: ComposerDraft): Job {
  const now = Date.now();
  const frames = draft.mode === "frames" ? [draft.firstFrame, draft.lastFrame].filter((asset) => asset !== null) : [];
  const source = [...frames].sort((left, right) => left.createdAt - right.createdAt)[0];
  const inputAssetIds = draft.mode === "references" ? draft.references.map((asset) => asset.id) : frames.map((asset) => asset.id);
  return {
    id: response.id, mode: draft.mode, prompt: draft.prompt.trim(), createdAt: now, updatedAt: now,
    status: response.status, duration: draft.duration, aspect: draft.aspect,
    displayAspect: source?.width && source.height ? source.width / source.height : undefined,
    inputAssetIds,
    firstFrameId: draft.mode === "frames" ? draft.firstFrame?.id : undefined,
    lastFrameId: draft.mode === "frames" ? draft.lastFrame?.id : undefined,
    referenceIds: draft.mode === "references" ? inputAssetIds : undefined,
    contentUrl: "",
    progress: { phase: "queued", message: "Waiting for a worker", updatedAt: now },
  };
}
