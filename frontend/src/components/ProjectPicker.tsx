import { FolderPlus, LoaderCircle, Plus, X } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import type { Job, LocalProject } from "../types";

export function ProjectPicker({ job, projects, busy, onCreate, onAdd, onClose }: {
  job: Job;
  projects: LocalProject[];
  busy: boolean;
  onCreate: () => LocalProject;
  onAdd: (projectId: string) => void;
  onClose: () => void;
}) {
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const available = projects.filter((project) => !project.clips.some((clip) => clip.jobId === job.id));

  const createAndAdd = () => {
    const project = onCreate();
    setCreatedProjectId(project.id);
    onAdd(project.id);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-70 flex items-end justify-center bg-black/72 p-3 backdrop-blur-md sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Add video to project"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.99 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md overflow-hidden rounded-[18px] border border-white/12 bg-[#111]/96 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-5 border-b border-white/8 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-white">Add to project</p>
            <p className="mt-1 text-[11px] leading-4 text-white/45">This also favorites the result so its video and available remix inputs stay backed by Modal.</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/45 hover:bg-white/7 hover:text-white" aria-label="Close"><X size={15} /></button>
        </header>

        <div className="max-h-[52dvh] overflow-y-auto p-2">
          <button type="button" disabled={busy} onClick={createAndAdd} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-white/82 hover:bg-white/6 disabled:opacity-45">
            <span className="flex size-9 items-center justify-center rounded-full border border-reelo-accent/25 bg-reelo-accent/10 text-reelo-accent"><Plus size={15} /></span>
            <span><b className="block text-xs">New project</b><span className="mt-0.5 block text-[10px] text-white/40">Create an untitled sequence</span></span>
          </button>
          {projects.map((project) => {
            const alreadyAdded = !available.some((candidate) => candidate.id === project.id);
            const isPending = busy && createdProjectId === project.id;
            return (
              <button key={project.id} type="button" disabled={busy || alreadyAdded} onClick={() => onAdd(project.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-white/82 hover:bg-white/6 disabled:opacity-40">
                <span className="flex size-9 items-center justify-center rounded-full border border-white/8 bg-white/[.035] text-white/55">{isPending ? <LoaderCircle size={14} className="animate-spin" /> : <FolderPlus size={14} />}</span>
                <span className="min-w-0 flex-1"><b className="block truncate text-xs">{project.name}</b><span className="mt-0.5 block text-[10px] text-white/40">{alreadyAdded ? "Already added" : `${project.clips.length} ${project.clips.length === 1 ? "clip" : "clips"}`}</span></span>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
