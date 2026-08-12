import { useEffect, useState } from "react";
import { loadOrCacheGeneratedVideoUrl } from "../lib/generatedVideos";

type LocalVideoState = {
  jobId: string | null;
  loading: boolean;
  url: string | null;
};

export function useLocalGeneratedVideoUrl(jobId: string | null, sourceUrl?: string | null) {
  const [state, setState] = useState<LocalVideoState>({ jobId: null, loading: false, url: null });

  useEffect(() => {
    if (!jobId) {
      setState({ jobId: null, loading: false, url: null });
      return;
    }
    let active = true;
    setState({ jobId, loading: true, url: null });
    void loadOrCacheGeneratedVideoUrl(jobId, sourceUrl)
      .then((url) => {
        if (active) setState({ jobId, loading: false, url });
      })
      .catch(() => {
        if (active) setState({ jobId, loading: false, url: null });
      });
    return () => { active = false; };
  }, [jobId, sourceUrl]);

  return state.jobId === jobId
    ? { loading: state.loading, url: state.url }
    : { loading: !!jobId, url: null };
}
