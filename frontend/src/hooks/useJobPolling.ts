import { useEffect, useRef } from "react";
import { ApiError, contentUrl, getJobStatus } from "../lib/api/client";
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
          updateJob(job.id, {
            status: result.status,
            error: result.error,
            metadata: result.metadata ?? job.metadata,
            progress: result.status === "completed" ? undefined : result.progress ?? job.progress,
            contentUrl: result.status === "completed" ? result.videoUrl ?? contentUrl(job.id) : job.contentUrl,
          });
        } catch (error) {
          if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
            updateJob(job.id, { status: "expired", error: "This job is no longer available on Modal.", progress: undefined });
          }
        }
      }));
      if (!stopped) timer = window.setTimeout(poll, document.hidden ? 10_000 : 2_000);
    };
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [updateJob]);
}
