import { useEffect, useState } from "react";
import { loadGeneratedVideoUrl } from "../lib/generatedVideos";
import type { Job } from "../types";

export function useGeneratedVideoUrl(job: Job, enabled = true) {
  const isLocal = job.contentUrl.startsWith("blob:");
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(enabled && isLocal ? job.contentUrl : null);

  useEffect(() => {
    if (!enabled || job.status !== "completed" || !job.contentUrl) {
      setResolvedUrl(null);
      return;
    }
    if (job.contentUrl.startsWith("blob:")) {
      setResolvedUrl(job.contentUrl);
      return;
    }

    let active = true;
    setResolvedUrl(null);
    void loadGeneratedVideoUrl(job.id)
      .then((url) => {
        if (active) setResolvedUrl(url ?? job.contentUrl);
      })
      .catch(() => {
        if (active) setResolvedUrl(job.contentUrl);
      });
    return () => { active = false; };
  }, [enabled, job.contentUrl, job.id, job.status]);

  return enabled && isLocal ? job.contentUrl : resolvedUrl;
}
