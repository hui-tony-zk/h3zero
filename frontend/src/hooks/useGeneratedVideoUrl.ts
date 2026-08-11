import { useEffect, useState } from "react";
import { loadGeneratedVideoUrl } from "../lib/generatedVideos";
import type { Job } from "../types";

export function useGeneratedVideoUrl(job: Job) {
  const isLocal = job.contentUrl.startsWith("blob:");
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(isLocal ? job.contentUrl : null);

  useEffect(() => {
    if (job.status !== "completed" || !job.contentUrl) {
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
  }, [job.contentUrl, job.id, job.status]);

  return isLocal ? job.contentUrl : resolvedUrl;
}
