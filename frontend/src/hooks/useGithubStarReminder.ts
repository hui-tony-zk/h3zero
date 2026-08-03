import { useCallback, useEffect, useRef, useState } from "react";
import { isGithubStarReminderMilestone } from "../lib/githubStarReminder";
import type { Job, JobStatus } from "../types";

const STORAGE_KEY = "h3zero-github-star-reminder-v1";

type ReminderState = {
  completedCount: number;
  pendingMilestone?: number;
  hiddenForever: boolean;
};

const initialState: ReminderState = {
  completedCount: 0,
  hiddenForever: false,
};

function readState(): ReminderState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const value = JSON.parse(raw) as Partial<ReminderState>;
    return {
      completedCount: Number.isInteger(value.completedCount) && Number(value.completedCount) >= 0 ? Number(value.completedCount) : 0,
      pendingMilestone: Number.isInteger(value.pendingMilestone) && Number(value.pendingMilestone) > 0 ? Number(value.pendingMilestone) : undefined,
      hiddenForever: value.hiddenForever === true,
    };
  } catch {
    return initialState;
  }
}

export function useGithubStarReminder(jobs: Job[]) {
  const [state, setState] = useState<ReminderState>(readState);
  const previousStatuses = useRef(new Map<string, JobStatus>(jobs.map((job) => [job.id, job.status])));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    const previous = previousStatuses.current;
    const newlyCompleted = jobs.filter((job) => (
      job.status === "completed"
      && previous.has(job.id)
      && previous.get(job.id) !== "completed"
    )).length;

    previousStatuses.current = new Map<string, JobStatus>(jobs.map((job) => [job.id, job.status]));
    if (!newlyCompleted) return;

    setState((current) => {
      let completedCount = current.completedCount;
      let pendingMilestone = current.pendingMilestone;
      for (let index = 0; index < newlyCompleted; index += 1) {
        completedCount += 1;
        if (!current.hiddenForever && isGithubStarReminderMilestone(completedCount)) pendingMilestone = completedCount;
      }
      return { ...current, completedCount, pendingMilestone };
    });
  }, [jobs]);

  const dismiss = useCallback(() => {
    setState((current) => ({ ...current, pendingMilestone: undefined }));
  }, []);

  const hideForever = useCallback(() => {
    setState((current) => ({ ...current, pendingMilestone: undefined, hiddenForever: true }));
  }, []);

  return {
    visible: !state.hiddenForever && state.pendingMilestone !== undefined,
    dismiss,
    hideForever,
  };
}
