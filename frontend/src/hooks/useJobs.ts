import { useCallback, useEffect, useMemo, useState } from "react";
import { sortJobs } from "../lib/jobs";
import { mergeFavoriteSnapshot } from "../lib/favorites";
import { readJobs, writeJobs } from "../lib/storage/jobRepository";
import type { Job } from "../types";
import { useJobPolling } from "./useJobPolling";

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>(readJobs);
  useEffect(() => writeJobs(jobs), [jobs]);

  const addJob = useCallback((job: Job) => setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]), []);
  const addJobs = useCallback((added: Job[]) => setJobs((current) => [...added, ...current.filter((item) => !added.some((candidate) => candidate.id === item.id))]), []);
  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, ...patch, updatedAt: Date.now() } : job));
  }, []);
  const replaceJob = useCallback((id: string, replacement: Job) => {
    setJobs((current) => current.map((job) => job.id === id ? replacement : job));
  }, []);
  const removeJob = useCallback((id: string) => setJobs((current) => current.filter((job) => job.id !== id)), []);
  const syncFavorites = useCallback((favorites: Job[]) => setJobs((current) => mergeFavoriteSnapshot(current, favorites)), []);

  useJobPolling(jobs, updateJob);
  return { jobs: useMemo(() => sortJobs(jobs), [jobs]), addJob, addJobs, updateJob, replaceJob, removeJob, syncFavorites };
}
