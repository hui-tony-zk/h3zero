import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CommandBar } from "./components/CommandBar";
import { GithubStarPrompt } from "./components/GithubStarPrompt";
import { JobCanvas } from "./components/JobCanvas";
import { useDrafts } from "./hooks/useDrafts";
import { useGithubStarReminder } from "./hooks/useGithubStarReminder";
import { useJobs } from "./hooks/useJobs";
import { createJob, deleteJob, getSpecs } from "./lib/api/client";
import { pendingJob } from "./lib/jobs";
import type { H3Specs, Job } from "./types";

export default function App() {
  const { jobs, addJob, removeJob } = useJobs();
  const githubStarReminder = useGithubStarReminder(jobs);
  const drafts = useDrafts();
  const [specs, setSpecs] = useState<H3Specs | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [composerOpen, setComposerOpen] = useState(() => jobs.length === 0);

  useEffect(() => {
    let active = true;
    void getSpecs().then((value) => { if (active) setSpecs(value); }).catch((error) => { if (active) setSpecError(error instanceof Error ? error.message : "Could not load H3 settings."); });
    return () => { active = false; };
  }, []);

  const launch = useCallback(async () => {
    if (!specs) throw new Error(specError ?? "H3 settings are still loading.");
    setLaunching(true);
    try {
      const submittedDraft = drafts.activeDraft;
      const response = await createJob(submittedDraft, specs);
      addJob(pendingJob(response, submittedDraft));
      drafts.resetActiveDraft();
      setComposerOpen(false);
    } finally { setLaunching(false); }
  }, [addJob, drafts, specError, specs]);

  const remove = useCallback(async (job: Job) => { await deleteJob(job.id); removeJob(job.id); }, [removeJob]);
  const remix = useCallback(async (job: Job) => { await drafts.restoreInputs(job); setComposerOpen(true); }, [drafts]);

  return <div className="min-h-screen bg-reelo-bg text-reelo-text">
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-none fixed inset-x-0 top-0 z-30 px-5 py-4 sm:px-7 sm:py-5"
    >
      <div className="text-[11px] font-bold tracking-[0.16em] text-white/82" aria-label="H3Zero">
        H3<span className="text-reelo-accent">Zero</span>
      </div>
    </motion.header>
    <JobCanvas jobs={jobs} onRemix={(job) => void remix(job)} onDelete={remove} />
    <GithubStarPrompt visible={githubStarReminder.visible} onDismiss={githubStarReminder.dismiss} onStar={githubStarReminder.hideForever} />
    {specError && !specs && <p className="fixed inset-x-4 bottom-20 z-50 text-center text-xs text-red-300">{specError}</p>}
    <CommandBar draft={drafts.activeDraft} specs={specs} open={composerOpen} launching={launching} onOpenChange={setComposerOpen} onModeChange={drafts.setActiveMode} onUpdate={drafts.updateActiveDraft} onSetFrame={drafts.setFrame} onAddReferences={drafts.addReferences} onRemoveReference={drafts.removeReference} onLaunch={launch} />
  </div>;
}
