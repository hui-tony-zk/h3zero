import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cloud, Film, Layers3 } from "lucide-react";
import { CloudSyncDialog } from "./components/CloudSyncDialog";
import { CommandBar } from "./components/CommandBar";
import { GithubStarPrompt } from "./components/GithubStarPrompt";
import { JobCanvas } from "./components/JobCanvas";
import { ProjectPicker } from "./components/ProjectPicker";
import { Projects } from "./components/Projects";
import { Toast, type ToastNotice } from "./components/Toast";
import { useDrafts } from "./hooks/useDrafts";
import { useGithubStarReminder } from "./hooks/useGithubStarReminder";
import { useJobs } from "./hooks/useJobs";
import { useProjects } from "./hooks/useProjects";
import { createJob, deleteFavorite, deleteJob, getFavorites, getSpecs, putFavorite } from "./lib/api/client";
import { loadAsset } from "./lib/assets";
import { describeFavoriteAssets } from "./lib/favorites";
import { loadGeneratedVideoBlob, removeGeneratedVideo } from "./lib/generatedVideos";
import { readCloudSyncUsername, writeCloudSyncUsername } from "./lib/cloudSync";
import { pendingJob, uploadingJob } from "./lib/jobs";
import { projectMembershipsByJob } from "./lib/projects";
import type { H3Specs, Job } from "./types";

const AUTOPLAY_STORAGE_KEY = "h3zero:autoplay";

function readAutoplayPreference() {
  try {
    return window.localStorage.getItem(AUTOPLAY_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export default function App() {
  const { jobs, addJobs, updateJob, replaceJob, removeJob, syncFavorites } = useJobs();
  const projects = useProjects();
  const githubStarReminder = useGithubStarReminder(jobs);
  const drafts = useDrafts();
  const [workspace, setWorkspace] = useState<"videos" | "projects">("videos");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => projects.projects[0]?.id ?? null);
  const [projectPickerJob, setProjectPickerJob] = useState<Job | null>(null);
  const [specs, setSpecs] = useState<H3Specs | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [composerOpen, setComposerOpen] = useState(() => jobs.length === 0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const [favoritePendingIds, setFavoritePendingIds] = useState<Set<string>>(() => new Set());
  const [cloudSyncUsername, setCloudSyncUsername] = useState<string | null>(readCloudSyncUsername);
  const [cloudSyncOpen, setCloudSyncOpen] = useState(false);
  const [autoplayEnabled, setAutoplayEnabled] = useState(readAutoplayPreference);
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
    if (projects.referencedJobIds.has(job.id)) {
      setToast({ id: `project-delete-blocked:${job.id}:${Date.now()}`, message: "Remove this video from its projects before deleting it." });
      return;
    }
    removeJob(job.id);
    if (job.id.startsWith("upload:")) return;
    void deleteJob(job.id)
      .then(() => { void removeGeneratedVideo(job.id).catch(() => undefined); })
      .catch((error) => {
        addJobs([job]);
        setToast((current) => current?.id.startsWith("delete:") ? current : {
          id: `delete-error:${job.id}:${Date.now()}`,
          message: error instanceof Error ? "Could not delete result" : "Delete failed",
        });
      });
  }, [addJobs, projects.referencedJobIds, removeJob]);

  const undoDelete = useCallback(() => {
    if (!pendingDeleteRef.current) return;
    window.clearTimeout(pendingDeleteRef.current.timer);
    pendingDeleteRef.current = null;
    setPendingDeleteId(null);
  }, []);

  const remove = useCallback((job: Job) => {
    if (projects.referencedJobIds.has(job.id)) {
      setToast({ id: `project-delete-blocked:${job.id}:${Date.now()}`, message: "Remove this video from its projects before deleting it." });
      return;
    }
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
  }, [finalizeDelete, projects.referencedJobIds, undoDelete]);

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
  const openProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setWorkspace("projects");
  }, []);
  const showProjectAddedToast = useCallback((projectId: string, jobId: string) => {
    const projectName = projects.projects.find((project) => project.id === projectId)?.name ?? "Untitled project";
    setToast({
      id: `project-added:${jobId}:${Date.now()}`,
      message: `Added to ${projectName}`,
      actionLabel: "Open project",
      onAction: () => openProject(projectId),
    });
  }, [openProject, projects.projects]);
  const favoriteJob = useCallback(async (job: Job, username: string) => {
    if (job.hearted) return true;
    if (favoritePendingIds.has(job.id)) return;
    const previousAssets = job.favoriteAssets;
    setFavoritePendingIds((current) => new Set(current).add(job.id));
    updateJob(job.id, { hearted: true, favoriteAssets: previousAssets });
    try {
      const uniqueIds = [...new Set(job.inputAssetIds)];
      const sources = (await Promise.all(uniqueIds.map(loadAsset))).filter((asset) => asset !== null);
      const manifest = describeFavoriteAssets(job, sources);
      const video = await loadGeneratedVideoBlob(job.id);
      updateJob(job.id, { favoriteAssets: manifest });
      const saved = await putFavorite(username, { ...job, hearted: true, favoriteAssets: manifest }, sources, manifest, video);
      updateJob(job.id, { hearted: true, favoriteAssets: saved.favoriteAssets });
      return true;
    } catch (error) {
      updateJob(job.id, { hearted: job.hearted, favoriteAssets: previousAssets });
      setToast({
        id: `favorite-error:${job.id}:${Date.now()}`,
        message: error instanceof Error ? error.message : "Could not update favorite",
      });
      return false;
    } finally {
      setFavoritePendingIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }, [favoritePendingIds, updateJob]);
  const toggleFavorite = useCallback(async (job: Job, username: string) => {
    if (!job.hearted) {
      await favoriteJob(job, username);
      return;
    }
    if (favoritePendingIds.has(job.id)) return;
    const previousAssets = job.favoriteAssets;
    setFavoritePendingIds((current) => new Set(current).add(job.id));
    updateJob(job.id, { hearted: false, favoriteAssets: [] });
    try {
      await deleteFavorite(username, job.id);
    } catch (error) {
      updateJob(job.id, { hearted: true, favoriteAssets: previousAssets });
      setToast({ id: `favorite-error:${job.id}:${Date.now()}`, message: error instanceof Error ? error.message : "Could not update favorite" });
    } finally {
      setFavoritePendingIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }, [favoriteJob, favoritePendingIds, updateJob]);
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
  const toggleAutoplay = useCallback(() => {
    setAutoplayEnabled((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(AUTOPLAY_STORAGE_KEY, next ? "on" : "off");
      } catch {
        // Playback still works when storage is unavailable.
      }
      return next;
    });
  }, []);
  const remix = useCallback(async (job: Job) => {
    try {
      await drafts.restoreInputs(job);
      setWorkspace("videos");
      setComposerOpen(true);
    } catch (error) {
      setToast({
        id: `remix-error:${job.id}:${Date.now()}`,
        message: error instanceof Error ? error.message : "Could not restore favorite inputs",
      });
    }
  }, [drafts]);

  const addToProject = useCallback((job: Job, projectId: string) => {
    projects.addJob(projectId, job);
    setProjectPickerJob(null);
    showProjectAddedToast(projectId, job.id);
  }, [projects, showProjectAddedToast]);

  const visibleJobs = pendingDeleteId ? jobs.filter((job) => job.id !== pendingDeleteId) : jobs;
  const projectMemberships = useMemo(() => projectMembershipsByJob(projects.projects), [projects.projects]);

  return <div className="min-h-screen bg-reelo-bg text-reelo-text">
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-none fixed inset-x-0 top-0 z-30 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3 sm:px-7 sm:py-5"
    >
      <div className="text-[11px] font-bold tracking-[0.16em] text-white/82" aria-label="H3Zero">
        H3<span className="text-reelo-accent">Zero</span>
      </div>
      <nav className="pointer-events-auto flex rounded-full border border-white/7 bg-black/35 p-0.5 backdrop-blur-md" aria-label="Workspace"><button type="button" onClick={() => setWorkspace("videos")} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[9px] font-bold transition sm:px-3 ${workspace === "videos" ? "bg-white/10 text-white" : "text-white/38 hover:text-white/70"}`}><Film size={11} /> Videos</button><button type="button" onClick={() => setWorkspace("projects")} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[9px] font-bold transition sm:px-3 ${workspace === "projects" ? "bg-white/10 text-white" : "text-white/38 hover:text-white/70"}`}><Layers3 size={11} /> Projects</button></nav>
      <div className="pointer-events-auto ml-auto flex items-center gap-1">
        <button type="button" onClick={() => { pendingFavoriteRef.current = null; setCloudSyncOpen(true); }} className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-full px-2 text-[10px] font-medium text-white/56 transition hover:bg-white/6 hover:text-white sm:px-2.5" title={cloudSyncUsername ? "Change Modal cloud sync name" : "Set up Modal cloud sync"}>
          <Cloud size={12} className={cloudSyncUsername ? "text-reelo-accent" : ""} />
          <span className="hidden max-w-[20vw] truncate sm:inline">{cloudSyncUsername ? `Synced as: ${cloudSyncUsername}` : "Modal cloud sync"}</span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={autoplayEnabled}
          aria-label={`Autoplay ${autoplayEnabled ? "on" : "off"}`}
          onClick={toggleAutoplay}
          className="group flex min-h-8 items-center gap-2 rounded-full px-2.5 text-[10px] font-semibold text-white/72 transition hover:bg-white/6 hover:text-white"
          title={autoplayEnabled ? "Show video thumbnails" : "Play all loaded videos"}
        >
          <span className="hidden sm:inline">Autoplay</span>
          <span className={`relative h-4 w-7 rounded-full border transition-colors ${autoplayEnabled ? "border-reelo-accent/55 bg-reelo-accent/22" : "border-white/16 bg-white/6"}`} aria-hidden="true">
            <motion.span
              className={`absolute left-0 top-[3px] size-2 rounded-full ${autoplayEnabled ? "bg-reelo-accent" : "bg-white/42"}`}
              animate={{ x: autoplayEnabled ? 15 : 3 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            />
          </span>
        </button>
      </div>
    </motion.header>
    <AnimatePresence mode="wait">
      {workspace === "videos" ? <motion.div key="videos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><JobCanvas jobs={visibleJobs} projectMemberships={projectMemberships} autoplayEnabled={autoplayEnabled} favoritePendingIds={favoritePendingIds} onFavorite={requestFavorite} onAddToProject={setProjectPickerJob} onOpenProject={openProject} onRemix={(job) => void remix(job)} onDelete={remove} onCancel={cancel} /></motion.div> : <Projects key="projects" projects={projects.projects} jobs={jobs} selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} onCreateProject={projects.createProject} onRenameProject={projects.renameProject} onSetAspect={projects.setProjectAspect} onDeleteProject={projects.deleteProject} onUpdateClip={projects.updateClip} onRemoveClip={projects.removeClip} onReorderClips={projects.reorderClips} onMoveClip={projects.moveClip} onOpenLibrary={() => setWorkspace("videos")} onRemix={(job) => void remix(job)} />}
    </AnimatePresence>
    {workspace === "videos" && <GithubStarPrompt visible={githubStarReminder.visible} onDismiss={githubStarReminder.dismiss} onStar={githubStarReminder.hideForever} />}
    {workspace === "videos" && specError && !specs && <p className="fixed inset-x-4 bottom-20 z-50 text-center text-xs text-red-300">{specError}</p>}
    {workspace === "videos" && <CommandBar draft={drafts.activeDraft} specs={specs} open={composerOpen} launching={launching} onOpenChange={setComposerOpen} onModeChange={drafts.setActiveMode} onUpdate={drafts.updateActiveDraft} onSetFrame={drafts.setFrame} onAddReferences={drafts.addReferences} onReplaceReference={drafts.replaceReference} onRemoveReference={drafts.removeReference} onLaunch={launch} />}
    <AnimatePresence>{projectPickerJob && <ProjectPicker job={projectPickerJob} projects={projects.projects} onCreate={projects.createProject} onAdd={(projectId) => addToProject(projectPickerJob, projectId)} onClose={() => setProjectPickerJob(null)} />}</AnimatePresence>
    <CloudSyncDialog open={cloudSyncOpen} currentUsername={cloudSyncUsername} onClose={closeCloudSync} onSubmit={connectCloudSync} />
    <Toast toast={toast} onDismiss={dismissToast} />
  </div>;
}
