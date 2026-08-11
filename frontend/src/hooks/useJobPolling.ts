import { useEffect, useRef } from "react";
import { acknowledgeJob, ApiError, contentUrl, getJobStatus } from "../lib/api/client";
import { cacheGeneratedVideo } from "../lib/generatedVideos";
import type { Job } from "../types";

export function useJobPolling(jobs: Job[], updateJob: (id: string, patch: Partial<Job>) => void) {
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      const active = jobsRef.current.filter((job) => job.status === "queued" || job.status === "running");
      if (active.length) await Promise.all(active.map(async (job) => {
        try {
          const result = await getJobStatus(job.id);
          const remoteVideoUrl = result.status === "completed" ? result.videoUrl ?? contentUrl(job.id) : "";
          let completedVideoUrl = remoteVideoUrl;
          if (remoteVideoUrl) {
            try {
              completedVideoUrl = await cacheGeneratedVideo(job.id, remoteVideoUrl);
              await acknowledgeJob(job.id).catch(() => undefined);
            } catch {
              // A completed Modal result remains usable when browser storage is
              // unavailable or full; later loads fall back to the server URL.
            }
          }
          updateJob(job.id, {
            status: result.status,
            createdAt: result.createdAt ?? job.createdAt,
            samplingStartedAt: result.samplingStartedAt ?? job.samplingStartedAt,
            finishedAt: ["completed", "failed", "expired", "cancelled"].includes(result.status)
              ? result.updatedAt ?? job.finishedAt ?? Date.now()
              : job.finishedAt,
            error: result.error,
            metadata: result.metadata ?? job.metadata,
            progress: result.status === "completed" ? undefined : result.progress ?? job.progress,
            contentUrl: result.status === "completed" ? completedVideoUrl : job.contentUrl,
          });
        } catch (error) {
          if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
            updateJob(job.id, { status: "expired", finishedAt: Date.now(), error: "This job is no longer available on Modal.", progress: undefined });
          }
        }
      }));
      if (!stopped) timer = window.setTimeout(poll, document.hidden ? 10_000 : 2_000);
    };
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [updateJob]);
}
