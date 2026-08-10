import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Cloud } from "lucide-react";
import { CloudSyncDialog } from "./components/CloudSyncDialog";
import { CommandBar } from "./components/CommandBar";
import { GithubStarPrompt } from "./components/GithubStarPrompt";
import { JobCanvas } from "./components/JobCanvas";
import { Toast, type ToastNotice } from "./components/Toast";
import { useDrafts } from "./hooks/useDrafts";
import { useGithubStarReminder } from "./hooks/useGithubStarReminder";
import { useJobs } from "./hooks/useJobs";
import { createJob, deleteFavorite, deleteJob, getFavorites, getSpecs, putFavorite } from "./lib/api/client";
import { loadAsset } from "./lib/assets";
import { describeFavoriteAssets } from "./lib/favorites";
import { readCloudSyncUsername, writeCloudSyncUsername } from "./lib/cloudSync";
import { pendingJob, uploadingJob } from "./lib/jobs";
import type { H3Specs, Job } from "./types";

export default function App() {
  const { jobs, addJobs, updateJob, replaceJob, removeJob, syncFavorites } = useJobs();
  const githubStarReminder = useGithubStarReminder(jobs);
  const drafts = useDrafts();
  const [specs, setSpecs] = useState<H3Specs | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [composerOpen, setComposerOpen] = useState(() => jobs.length === 0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const [favoritePendingIds, setFavoritePendingIds] = useState<Set<string>>(() => new Set());
  const [cloudSyncUsername, setCloudSyncUsername] = useState<string | null>(readCloudSyncUsername);
  const [cloudSyncOpen, setCloudSyncOpen] = useState(false);
  const pendingDeleteRef = useRef<{ job: Job; timer: number } | null>(null);
  const pendingFavoriteRef = useRef<Job | null>(null);

  useEffect(() => {
    let active = true;
    void getSpecs().then((value) => { if (active) setSpecs(value); }).catch((error) => { if (active) setSpecError(error instanceof Error ? error.message : "Could not load H3 settings."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!cloudSyncUsername) return;
    let active = true;
    const sync = () => {
      void getFavorites(cloudSyncUsername).then((favorites) => { if (active) syncFavorites(favorites); }).catch(() => undefined);
    };
    sync();
    window.addEventListener("focus", sync);
    return () => { active = false; window.removeEventListener("focus", sync); };
  }, [cloudSyncUsername, syncFavorites]);

  const launch = useCallback(async () => {
    if (!specs) throw new Error(specError ?? "H3 settings are still loading.");
    setLaunching(true);
    try {
      const submittedDraft = drafts.activeDraft;
      const batch = { id: crypto.randomUUID(), size: submittedDraft.generationCount, createdAt: Date.now() };
      const optimisticJobs = Array.from({ length: batch.size }, (_, index) => (
        uploadingJob(`upload:${batch.id}:${index}`, submittedDraft, { ...batch, index })
      ));
      addJobs(optimisticJobs);
      drafts.resetActiveDraft();
      setComposerOpen(false);

      const results = await Promise.allSettled(optimisticJobs.map(async (optimistic, index) => {
        try {
          const response = await createJob(submittedDraft, specs);
          replaceJob(optimistic.id, pendingJob(response, submittedDraft, { ...batch, index }));
          return response;
        } catch (error) {
          updateJob(optimistic.id, {
            status: "failed",
            error: error instanceof Error ? error.message : "Could not upload this generation.",
            progress: undefined,
          });
          throw error;
        }
      }));
      const rejected = results.filter((result) => result.status === "rejected");
      if (rejected.length) {
        const reason = rejected[0].reason;
        const detail = reason instanceof Error ? reason.message : "Could not submit every generation.";
        throw new Error(`${batch.size - rejected.length} of ${batch.size} generations started. ${detail}`);
      }
    } finally { setLaunching(false); }
  }, [addJobs, drafts, replaceJob, specError, specs, updateJob]);

  const finalizeDelete = useCallback((job: Job) => {
    removeJob(job.id);
    if (job.id.startsWith("upload:")) return;
    void deleteJob(job.id).catch((error) => {
      addJobs([job]);
      setToast((current) => current?.id.startsWith("delete:") ? current : {
        id: `delete-error:${job.id}:${Date.now()}`,
        message: error instanceof Error ? "Could not delete result" : "Delete failed",
      });
    });
  }, [addJobs, removeJob]);

  const undoDelete = useCallback(() => {
    if (!pendingDeleteRef.current) return;
    window.clearTimeout(pendingDeleteRef.current.timer);
    pendingDeleteRef.current = null;
    setPendingDeleteId(null);
  }, []);

  const remove = useCallback((job: Job) => {
    if (pendingDeleteRef.current) {
      window.clearTimeout(pendingDeleteRef.current.timer);
      finalizeDelete(pendingDeleteRef.current.job);
    }

    const toastId = `delete:${job.id}`;
    const timer = window.setTimeout(() => {
      finalizeDelete(job);
      pendingDeleteRef.current = null;
      setPendingDeleteId(null);
      setToast((current) => current?.id === toastId ? null : current);
    }, 5000);

    pendingDeleteRef.current = { job, timer };
    setPendingDeleteId(job.id);
    setToast({ id: toastId, message: "Deleted", actionLabel: "Undo", onAction: undoDelete });
  }, [finalizeDelete, undoDelete]);

  const cancel = useCallback((job: Job) => {
    // Active work bypasses the delete undo window so Modal can cancel it
    // before a queued GPU worker starts.
    removeJob(job.id);
    void deleteJob(job.id).catch(() => {
      addJobs([job]);
      setToast((current) => current?.id.startsWith("delete:") ? current : {
        id: `cancel-error:${job.id}:${Date.now()}`,
        message: "Could not cancel job",
      });
    });
  }, [addJobs, removeJob]);

  const dismissToast = useCallback((id: string) => {
    setToast((current) => current?.id === id ? null : current);
  }, []);
  const toggleFavorite = useCallback(async (job: Job, username: string) => {
    if (favoritePendingIds.has(job.id)) return;
    const nextHearted = !job.hearted;
    const previousAssets = job.favoriteAssets;
    setFavoritePendingIds((current) => new Set(current).add(job.id));
    updateJob(job.id, { hearted: nextHearted, favoriteAssets: nextHearted ? previousAssets : [] });
    try {
      if (nextHearted) {
        const uniqueIds = [...new Set(job.inputAssetIds)];
        const sources = (await Promise.all(uniqueIds.map(loadAsset))).filter((asset) => asset !== null);
        const manifest = describeFavoriteAssets(job, sources);
        updateJob(job.id, { favoriteAssets: manifest });
        const saved = await putFavorite(username, { ...job, hearted: true, favoriteAssets: manifest }, sources, manifest);
        updateJob(job.id, { hearted: true, favoriteAssets: saved.favoriteAssets });
      } else {
        await deleteFavorite(username, job.id);
      }
    } catch (error) {
      updateJob(job.id, { hearted: job.hearted, favoriteAssets: previousAssets });
      setToast({
        id: `favorite-error:${job.id}:${Date.now()}`,
        message: error instanceof Error ? error.message : "Could not update favorite",
      });
    } finally {
      setFavoritePendingIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }, [favoritePendingIds, updateJob]);
  const requestFavorite = useCallback((job: Job) => {
    if (!cloudSyncUsername) {
      pendingFavoriteRef.current = job;
      setCloudSyncOpen(true);
      return;
    }
    void toggleFavorite(job, cloudSyncUsername);
  }, [cloudSyncUsername, toggleFavorite]);
  const connectCloudSync = useCallback(async (username: string) => {
    const favorites = await getFavorites(username);
    syncFavorites(favorites);
    const normalized = writeCloudSyncUsername(username);
    setCloudSyncUsername(normalized);
    setCloudSyncOpen(false);
    const pending = pendingFavoriteRef.current;
    pendingFavoriteRef.current = null;
    if (pending) await toggleFavorite(pending, normalized);
  }, [syncFavorites, toggleFavorite]);
  const closeCloudSync = useCallback(() => {
    pendingFavoriteRef.current = null;
    setCloudSyncOpen(false);
  }, []);
  const remix = useCallback(async (job: Job) => {
    try {
      await drafts.restoreInputs(job);
      setComposerOpen(true);
    } catch (error) {
      setToast({
        id: `remix-error:${job.id}:${Date.now()}`,
        message: error instanceof Error ? error.message : "Could not restore favorite inputs",
      });
    }
  }, [drafts]);

  const visibleJobs = pendingDeleteId ? jobs.filter((job) => job.id !== pendingDeleteId) : jobs;

  return <div className="min-h-screen bg-reelo-bg text-reelo-text">
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-4 px-5 py-4 sm:px-7 sm:py-5"
    >
      <div className="text-[11px] font-bold tracking-[0.16em] text-white/82" aria-label="H3Zero">
        H3<span className="text-reelo-accent">Zero</span>
      </div>
      <button type="button" onClick={() => { pendingFavoriteRef.current = null; setCloudSyncOpen(true); }} className="pointer-events-auto flex min-h-8 max-w-[65vw] items-center gap-1.5 rounded-full px-2.5 text-[10px] font-medium text-white/56 transition hover:bg-white/6 hover:text-white" title={cloudSyncUsername ? "Change Modal cloud sync name" : "Set up Modal cloud sync"}>
        <Cloud size={12} className={cloudSyncUsername ? "text-reelo-accent" : ""} />
        <span className="truncate">{cloudSyncUsername ? `Synced as: ${cloudSyncUsername}` : "Modal cloud sync"}</span>
      </button>
    </motion.header>
    <JobCanvas jobs={visibleJobs} favoritePendingIds={favoritePendingIds} onFavorite={requestFavorite} onRemix={(job) => void remix(job)} onDelete={remove} onCancel={cancel} />
    <GithubStarPrompt visible={githubStarReminder.visible} onDismiss={githubStarReminder.dismiss} onStar={githubStarReminder.hideForever} />
    {specError && !specs && <p className="fixed inset-x-4 bottom-20 z-50 text-center text-xs text-red-300">{specError}</p>}
    <CommandBar draft={drafts.activeDraft} specs={specs} open={composerOpen} launching={launching} onOpenChange={setComposerOpen} onModeChange={drafts.setActiveMode} onUpdate={drafts.updateActiveDraft} onSetFrame={drafts.setFrame} onAddReferences={drafts.addReferences} onRemoveReference={drafts.removeReference} onLaunch={launch} />
    <CloudSyncDialog open={cloudSyncOpen} currentUsername={cloudSyncUsername} onClose={closeCloudSync} onSubmit={connectCloudSync} />
    <Toast toast={toast} onDismiss={dismissToast} />
  </div>;
}
