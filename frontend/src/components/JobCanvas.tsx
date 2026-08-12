import { AlertCircle, ArrowDownToLine, Film, FolderPlus, Heart, LoaderCircle, SlidersHorizontal, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { groupJobs } from "../lib/jobs";
import { profileLabel } from "../lib/sampling";
import { useGeneratedVideoUrl } from "../hooks/useGeneratedVideoUrl";
import type { ProjectMembership } from "../lib/projects";
import type { Job } from "../types";
import { RemixIcon } from "./icons";
import { GenerationSettingsDialog } from "./GenerationSettingsDialog";

function isActive(job: Job) {
  return job.status === "uploading" || job.status === "queued" || job.status === "running";
}

function aspectNumber(job: Job) {
  if (job.metadata?.width && job.metadata.height) return job.metadata.width / job.metadata.height;
  if (job.displayAspect) return job.displayAspect;
  const [width, height] = job.aspect.split(":").map(Number);
  return width && height ? width / height : 16 / 9;
}

function activeCopy(job: Job) {
  if (job.progress?.message) return job.progress.message;
  if (job.status === "uploading") return "Uploading inputs";
  return job.status === "queued" ? "Waiting for a worker" : "H3 is generating video and sound";
}

function batchStartPadding(job: Job) {
  const halfWidthLimitedHeight = 41 / aspectNumber(job);
  return `max(1rem, calc(50% - max(130px, min(26dvh, 280px, ${halfWidthLimitedHeight}vw))))`;
}

type PlaybackReady = (video: HTMLVideoElement) => void;

function showVideoThumbnail(video: HTMLVideoElement) {
  video.pause();
  if (video.readyState >= 1) video.currentTime = 0;
}

function JobVideo({ job, autoplayEnabled, onPlaybackReady }: { job: Job; autoplayEnabled: boolean; onPlaybackReady: PlaybackReady }) {
  const videoUrl = useGeneratedVideoUrl(job);
  const isLocal = videoUrl?.startsWith("blob:") === true;
  return videoUrl ? <video data-h3-autoplay-video src={videoUrl} autoPlay={autoplayEnabled} loop muted playsInline preload={autoplayEnabled || isLocal ? "auto" : "metadata"} onLoadedMetadata={(event) => onPlaybackReady(event.currentTarget)} className="absolute inset-0 size-full bg-black object-contain" /> : null;
}

function ProjectChips({ memberships, onOpenProject, className = "" }: { memberships: ProjectMembership[]; onOpenProject: (projectId: string) => void; className?: string }) {
  if (!memberships.length) return null;
  return <div className={`flex max-w-[calc(100%-6rem)] flex-wrap gap-1 ${className}`} aria-label="Project memberships">
    {memberships.map((project) => <button key={project.id} type="button" onClick={(event) => { event.stopPropagation(); onOpenProject(project.id); }} className="max-w-[16ch] truncate rounded-full border border-reelo-accent/28 bg-black/66 px-2 py-1 text-[9px] font-semibold text-reelo-accent backdrop-blur-md hover:border-reelo-accent/55 hover:bg-black" title={`Open ${project.name}`}>{project.name}</button>)}
  </div>;
}

function FullscreenVideo({ job, memberships, autoplayEnabled, onPlaybackReady, onAddToProject, onOpenProject, onClose }: { job: Job; memberships: ProjectMembership[]; autoplayEnabled: boolean; onPlaybackReady: PlaybackReady; onAddToProject: () => void; onOpenProject: (projectId: string) => void; onClose: () => void }) {
  const videoUrl = useGeneratedVideoUrl(job);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-70 flex items-center justify-center bg-black/94 p-4 backdrop-blur-xl sm:p-8" role="dialog" aria-modal="true" aria-label="Video viewer">
      {videoUrl && <video data-h3-autoplay-video src={videoUrl} autoPlay={autoplayEnabled} loop controls playsInline onLoadedMetadata={(event) => onPlaybackReady(event.currentTarget)} className="max-h-full max-w-full object-contain" />}
      <ProjectChips memberships={memberships} onOpenProject={onOpenProject} className="fixed left-4 top-4 sm:left-6 sm:top-6" />
      <div className="fixed right-4 top-4 flex gap-2 sm:right-6 sm:top-6">
        <button type="button" onClick={onAddToProject} className="flex size-10 items-center justify-center rounded-full border border-white/12 bg-black/60 text-white/80 backdrop-blur-md hover:bg-white/10 hover:text-reelo-accent" aria-label="Add video to project" title="Add to project"><FolderPlus size={16} /></button>
        {videoUrl && <a href={videoUrl} download={`h3-${job.id}.mp4`} className="flex size-10 items-center justify-center rounded-full border border-white/12 bg-black/60 text-white/80 backdrop-blur-md hover:bg-white/10 hover:text-white" aria-label="Download video" title="Download"><ArrowDownToLine size={16} /></a>}
        <button type="button" onClick={onClose} className="flex size-10 items-center justify-center rounded-full border border-white/12 bg-black/60 text-white/80 backdrop-blur-md hover:bg-white/10 hover:text-white" aria-label="Close video viewer"><X size={17} /></button>
      </div>
    </motion.div>
  );
}

function JobCard({ job, memberships, autoplayEnabled, onPlaybackReady, favoritePending, onFavorite, onAddToProject, onOpenProject, onRemix, onDelete, onCancel, onView, onSettings }: {
  job: Job;
  memberships: ProjectMembership[];
  autoplayEnabled: boolean;
  onPlaybackReady: PlaybackReady;
  favoritePending: boolean;
  onFavorite: () => void;
  onAddToProject: () => void;
  onOpenProject: (projectId: string) => void;
  onRemix: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onView: () => void;
  onSettings: () => void;
}) {
  const active = isActive(job);
  const failed = job.status === "failed" || job.status === "expired" || job.status === "cancelled";
  const progress = job.progress?.percent;
  const samplingProfile = job.metadata?.sampling_profile ?? job.samplingProfile ?? (job.turbo ? "turbo_4" : "spectrum");
  const accelerated = samplingProfile !== "base";
  const samplingLabel = profileLabel(samplingProfile);
  const ratio = aspectNumber(job);
  const style = {
    "--job-aspect": ratio,
    aspectRatio: ratio,
    width: "min(82vw, calc(min(52dvh, 560px) * var(--job-aspect)))",
  } as CSSProperties;

  return (
    <motion.article
      layout
      data-job-id={job.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      onClick={job.status === "completed" && job.contentUrl ? onView : undefined}
      className={`group relative max-h-[52dvh] min-h-[260px] shrink-0 overflow-hidden rounded-[14px] border border-white/12 bg-reelo-card shadow-[0_20px_55px_rgba(0,0,0,.28)] ${job.status === "completed" && job.contentUrl ? "cursor-zoom-in" : ""}`}
      style={style}
    >
      {job.status === "completed" && job.contentUrl ? (
        <button type="button" onClick={(event) => { event.stopPropagation(); onView(); }} className="absolute inset-0 size-full cursor-zoom-in" aria-label="Open video fullscreen"><JobVideo job={job} autoplayEnabled={autoplayEnabled} onPlaybackReady={onPlaybackReady} /></button>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#151515]">
          <div className="absolute inset-0 opacity-70 [background:radial-gradient(circle_at_20%_10%,rgba(68,170,255,.17),transparent_42%),linear-gradient(145deg,rgba(255,255,255,.025),transparent)]" />
          {active ? <LoaderCircle size={24} className="relative animate-spin text-reelo-accent" /> : <AlertCircle size={22} className="relative text-white/24" />}
        </div>
      )}

      <span
        className={`pointer-events-none absolute left-3 top-3 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] backdrop-blur-md ${accelerated ? "border-reelo-accent/35 bg-black/62 text-reelo-accent" : "border-white/12 bg-black/62 text-white/65"}`}
        title={`Sampling profile: ${samplingLabel}`}
      >
        {samplingLabel}
      </span>
      <ProjectChips memberships={memberships} onOpenProject={onOpenProject} className="absolute left-3 top-11 z-10" />

      {job.status === "completed" && <button
        type="button"
        disabled={favoritePending}
        onClick={(event) => { event.stopPropagation(); onFavorite(); }}
        className={`absolute right-3 top-3 flex size-8 items-center justify-center rounded-full border backdrop-blur-md transition-colors disabled:opacity-55 ${job.hearted ? "border-pink-300/35 bg-pink-500/18 text-pink-300" : "border-white/12 bg-black/62 text-white/72 hover:bg-black hover:text-white"}`}
        aria-label={job.hearted ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={job.hearted === true}
        title={job.hearted ? "Unfavorite" : "Favorite"}
      >
        {favoritePending ? <LoaderCircle size={13} className="animate-spin" /> : <Heart size={14} className={job.hearted ? "fill-current" : ""} />}
      </button>}

      {(active || failed) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/88 to-transparent px-4 pb-14 pt-16">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${active ? "text-reelo-accent" : "text-red-300"}`}>{active ? job.progress?.phase ?? job.status : job.status}</p>
              <p className="mt-1 truncate text-xs text-white/76">{active ? activeCopy(job) : job.error || "This generation did not complete"}</p>
            </div>
            {progress !== undefined && <span className="text-[10px] font-bold tabular-nums text-white/65">{Math.round(progress * 100)}%</span>}
          </div>
          {progress !== undefined && <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full bg-reelo-accent" initial={false} animate={{ width: `${progress * 100}%` }} transition={{ ease: "easeOut", duration: 0.25 }} />
          </div>}
        </div>
      )}

      {job.status !== "uploading" && <div className="absolute bottom-3 right-3 flex gap-1.5 sm:pointer-events-none sm:translate-y-1 sm:opacity-0 sm:transition-[opacity,transform] sm:duration-150 sm:group-hover:pointer-events-auto sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100">
        <button type="button" onClick={(event) => { event.stopPropagation(); onSettings(); }} className="flex size-8 items-center justify-center rounded-full border border-white/12 bg-black/62 text-white/75 backdrop-blur-md hover:bg-black hover:text-white" aria-label="Show generation settings" title="Generation settings"><SlidersHorizontal size={13} /></button>
        {job.status === "completed" && <button type="button" onClick={(event) => { event.stopPropagation(); onAddToProject(); }} className="flex size-8 items-center justify-center rounded-full border border-white/12 bg-black/62 text-white/75 backdrop-blur-md hover:bg-black hover:text-reelo-accent" aria-label="Add video to project" title="Add to project"><FolderPlus size={13} /></button>}
        <button type="button" onClick={(event) => { event.stopPropagation(); onRemix(); }} className="flex size-8 items-center justify-center rounded-full border border-white/12 bg-black/62 text-white/75 backdrop-blur-md hover:bg-black hover:text-white" aria-label="Remix this job" title="Remix"><RemixIcon size={13} /></button>
        <button type="button" onClick={(event) => { event.stopPropagation(); if (active) onCancel(); else onDelete(); }} className="flex size-8 items-center justify-center rounded-full border border-white/12 bg-black/62 text-white/75 backdrop-blur-md hover:bg-red-500 hover:text-white" aria-label={active ? "Cancel job" : "Delete job"} title={active ? "Cancel job" : "Delete"}><Trash2 size={13} /></button>
      </div>}
    </motion.article>
  );
}

export function JobCanvas({ jobs, projectMemberships, autoplayEnabled, favoritePendingIds, onFavorite, onAddToProject, onOpenProject, onRemix, onDelete, onCancel }: { jobs: Job[]; projectMemberships: Map<string, ProjectMembership[]>; autoplayEnabled: boolean; favoritePendingIds: Set<string>; onFavorite: (job: Job) => void; onAddToProject: (job: Job) => void; onOpenProject: (projectId: string) => void; onRemix: (job: Job) => void; onDelete: (job: Job) => void; onCancel: (job: Job) => void }) {
  const [viewer, setViewer] = useState<Job | null>(null);
  const [settingsJob, setSettingsJob] = useState<Job | null>(null);

  const applyAutoplay = useCallback((video: HTMLVideoElement) => {
    if (!autoplayEnabled) {
      showVideoThumbnail(video);
      return;
    }
    void video.play().catch(() => undefined);
  }, [autoplayEnabled]);

  useEffect(() => {
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("[data-h3-autoplay-video]"));
    if (!autoplayEnabled) {
      videos.forEach(showVideoThumbnail);
      return;
    }

    videos.forEach((video) => { void video.play().catch(() => undefined); });
  }, [autoplayEnabled]);

  if (!jobs.length) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[1180px] items-center justify-center px-6 pb-24 text-center">
        <div className="max-w-sm">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full border border-white/8 bg-white/[0.025] text-white/24"><Film size={19} /></span>
          <h1 className="mt-5 text-lg font-semibold tracking-tight text-reelo-text">Make a video with H3Zero</h1>
          <p className="mx-auto mt-2 max-w-[34ch] text-xs leading-5 text-reelo-dim">Open the composer below, add references or frames, and describe what should happen.</p>
        </div>
      </main>
    );
  }

  const batches = groupJobs(jobs);

  return (
    <>
      <main className="h-dvh overflow-hidden pb-[60px] pt-12">
        <div className="flex h-full w-full gap-3 overflow-x-auto px-[9vw] [scrollbar-color:rgba(255,255,255,0.22)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb:hover]:bg-white/40 [&::-webkit-scrollbar-track]:mx-[12vw] [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-white/[0.045] sm:gap-5 sm:px-[12vw]" aria-label="Video batches">
          {batches.map((batch) => <section key={batch.id} aria-label="Generation batch" className="h-full shrink-0 overflow-y-auto overscroll-y-contain [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin]">
            <div style={batch.jobs.length > 1 ? { paddingTop: batchStartPadding(batch.jobs[0]) } : undefined} className={`flex min-h-full flex-col items-center gap-3 pb-4 sm:gap-5 ${batch.jobs.length === 1 ? "justify-center pt-4" : "justify-start"}`}>
              {batch.jobs.map((job) => <JobCard key={job.id} job={job} memberships={projectMemberships.get(job.id) ?? []} autoplayEnabled={autoplayEnabled} onPlaybackReady={applyAutoplay} favoritePending={favoritePendingIds.has(job.id)} onFavorite={() => onFavorite(job)} onAddToProject={() => onAddToProject(job)} onOpenProject={onOpenProject} onRemix={() => onRemix(job)} onDelete={() => onDelete(job)} onCancel={() => onCancel(job)} onView={() => setViewer(job)} onSettings={() => setSettingsJob(job)} />)}
            </div>
          </section>)}
        </div>
      </main>
      <AnimatePresence>{viewer && <FullscreenVideo job={viewer} memberships={projectMemberships.get(viewer.id) ?? []} autoplayEnabled={autoplayEnabled} onPlaybackReady={applyAutoplay} onAddToProject={() => onAddToProject(viewer)} onOpenProject={onOpenProject} onClose={() => setViewer(null)} />}</AnimatePresence>
      <AnimatePresence>{settingsJob && <GenerationSettingsDialog job={settingsJob} onClose={() => setSettingsJob(null)} />}</AnimatePresence>
    </>
  );
}
