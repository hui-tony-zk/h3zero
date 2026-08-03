import { AlertCircle, ArrowDownToLine, Expand, Film, LoaderCircle, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type CSSProperties } from "react";
import type { Job } from "../types";
import { RemixIcon } from "./icons";

function isActive(job: Job) {
  return job.status === "queued" || job.status === "running";
}

function aspectNumber(job: Job) {
  if (job.metadata?.width && job.metadata.height) return job.metadata.width / job.metadata.height;
  if (job.displayAspect) return job.displayAspect;
  const [width, height] = job.aspect.split(":").map(Number);
  return width && height ? width / height : 16 / 9;
}

function activeCopy(job: Job) {
  if (job.progress?.message) return job.progress.message;
  return job.status === "queued" ? "Waiting for a worker" : "H3 is generating video and sound";
}

function JobVideo({ job }: { job: Job }) {
  return <video src={job.contentUrl} autoPlay loop muted playsInline preload="auto" className="absolute inset-0 size-full bg-black object-contain" />;
}

function FullscreenVideo({ job, onClose }: { job: Job; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-70 flex items-center justify-center bg-black/94 p-4 backdrop-blur-xl sm:p-8" role="dialog" aria-modal="true" aria-label="Video viewer">
      <video src={job.contentUrl} autoPlay loop controls playsInline className="max-h-full max-w-full object-contain" />
      <div className="fixed right-4 top-4 flex gap-2 sm:right-6 sm:top-6">
        <a href={job.contentUrl} download={`h3-${job.id}.mp4`} className="flex size-10 items-center justify-center rounded-full border border-white/12 bg-black/60 text-white/80 backdrop-blur-md hover:bg-white/10 hover:text-white" aria-label="Download video" title="Download"><ArrowDownToLine size={16} /></a>
        <button type="button" onClick={onClose} className="flex size-10 items-center justify-center rounded-full border border-white/12 bg-black/60 text-white/80 backdrop-blur-md hover:bg-white/10 hover:text-white" aria-label="Close video viewer"><X size={17} /></button>
      </div>
    </motion.div>
  );
}

function JobCard({ job, onRemix, onDelete, onView }: {
  job: Job;
  onRemix: () => void;
  onDelete: () => Promise<void>;
  onView: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const active = isActive(job);
  const failed = job.status === "failed" || job.status === "expired" || job.status === "cancelled";
  const progress = job.progress?.percent;
  const ratio = aspectNumber(job);
  const style = {
    "--job-aspect": ratio,
    aspectRatio: ratio,
    width: "min(82vw, calc(min(52dvh, 560px) * var(--job-aspect)))",
  } as CSSProperties;

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

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
        <button type="button" onClick={(event) => { event.stopPropagation(); onView(); }} className="absolute inset-0 size-full cursor-zoom-in" aria-label="Open video fullscreen"><JobVideo job={job} /></button>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#151515]">
          <div className="absolute inset-0 opacity-70 [background:radial-gradient(circle_at_20%_10%,rgba(68,170,255,.17),transparent_42%),linear-gradient(145deg,rgba(255,255,255,.025),transparent)]" />
          {active ? <LoaderCircle size={24} className="relative animate-spin text-reelo-accent" /> : <AlertCircle size={22} className="relative text-white/24" />}
        </div>
      )}

      {(active || failed) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/88 to-transparent px-4 pb-14 pt-16">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${active ? "text-reelo-accent" : "text-red-300"}`}>{active ? job.progress?.phase ?? job.status : job.status}</p>
              <p className="mt-1 truncate text-xs text-white/76">{active ? activeCopy(job) : job.error || "This generation did not complete"}</p>
            </div>
            {progress !== undefined && <span className="text-[10px] font-bold tabular-nums text-white/65">{Math.round(progress * 100)}%</span>}
          </div>
          <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-white/10">
            {progress !== undefined ? <motion.div className="h-full bg-reelo-accent" animate={{ width: `${progress * 100}%` }} transition={{ ease: "easeOut", duration: 0.25 }} /> : active ? <motion.div className="h-full w-1/3 bg-reelo-accent" animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} /> : null}
          </div>
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex gap-1.5">
        <button type="button" onClick={(event) => { event.stopPropagation(); onRemix(); }} className="flex size-8 items-center justify-center rounded-full border border-white/12 bg-black/62 text-white/75 backdrop-blur-md hover:bg-black hover:text-white" aria-label="Remix this job" title="Remix"><RemixIcon size={13} /></button>
        {job.status === "completed" && <button type="button" onClick={(event) => { event.stopPropagation(); onView(); }} className="flex size-8 items-center justify-center rounded-full border border-white/12 bg-black/62 text-white/75 backdrop-blur-md hover:bg-black hover:text-white" aria-label="Open video fullscreen" title="Fullscreen"><Expand size={13} /></button>}
        <button type="button" disabled={deleting} onClick={(event) => { event.stopPropagation(); void remove(); }} className="flex size-8 items-center justify-center rounded-full border border-white/12 bg-black/62 text-white/75 backdrop-blur-md hover:bg-red-500 hover:text-white disabled:opacity-40" aria-label={active ? "Cancel and delete job" : "Delete job"} title={active ? "Cancel job" : "Delete"}>{deleting ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
      </div>
    </motion.article>
  );
}

export function JobCanvas({ jobs, onRemix, onDelete }: { jobs: Job[]; onRemix: (job: Job) => void; onDelete: (job: Job) => Promise<void> }) {
  const [viewer, setViewer] = useState<Job | null>(null);

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

  return (
    <>
      <main className="flex min-h-dvh flex-col justify-center pb-24">
        <div className={`flex w-full items-center gap-3 overflow-x-auto px-[9vw] pb-5 pt-3 [scrollbar-color:rgba(255,255,255,0.22)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb:hover]:bg-white/40 [&::-webkit-scrollbar-track]:mx-[12vw] [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-white/[0.045] sm:gap-5 sm:px-[12vw] ${jobs.length === 1 ? "justify-center" : ""}`} aria-label="Video jobs">
          {jobs.map((job) => <JobCard key={job.id} job={job} onRemix={() => onRemix(job)} onDelete={() => onDelete(job)} onView={() => setViewer(job)} />)}
        </div>
      </main>
      <AnimatePresence>{viewer && <FullscreenVideo job={viewer} onClose={() => setViewer(null)} />}</AnimatePresence>
    </>
  );
}
