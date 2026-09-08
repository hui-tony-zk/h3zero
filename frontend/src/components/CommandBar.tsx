import { ArrowRight, ChevronDown, ChevronUp, ExternalLink, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { ratiosMatch } from "../lib/assets";
import { hasReferencePromptContent } from "../lib/promptDefaults";
import { isTurboProfile, profileLabel, samplingProfileId } from "../lib/sampling";
import type { AspectId, BaseDraft, ComposerDraft, GenerationCount, GenerationMode, H3Specs, MediaAsset, SamplingProfileId } from "../types";
import { CropModal } from "./CropModal";
import { MediaViewer } from "./MediaViewer";
import { LoraMixer } from "./LoraMixer";
import { PromptEditor } from "./PromptEditor";
import { ControlSelect } from "./composer/ControlSelect";
import { FramesInput, ReferencesInput } from "./composer/MediaInputs";
import { prepareFrame, prepareReferenceReplacement, prepareReferences } from "./composer/validation";

type CropRequest = { asset: MediaAsset; role: "firstFrame" | "lastFrame"; targetRatio: number };

const promptGuides: Record<GenerationMode, string> = {
  frames: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md",
  references: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md",
};

function modeLabel(draft: ComposerDraft) {
  if (draft.mode === "references") return "Reference → Video";
  if (draft.firstFrame && draft.lastFrame) return "First → Last";
  if (draft.firstFrame) return "First frame → Video";
  if (draft.lastFrame) return "Video → Last frame";
  return "Text → Video";
}

export function CommandBar({ draft, specs, open, launching, onOpenChange, onModeChange, onUpdate, onSetFrame, onAddReferences, onReplaceReference, onRemoveReference, onLaunch }: {
  draft: ComposerDraft;
  specs: H3Specs | null;
  open: boolean;
  launching: boolean;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: GenerationMode) => void;
  onUpdate: (patch: Partial<BaseDraft>) => void;
  onSetFrame: (role: "firstFrame" | "lastFrame", asset: MediaAsset | null) => Promise<void>;
  onAddReferences: (assets: MediaAsset[]) => Promise<void>;
  onReplaceReference: (id: string, replacement: MediaAsset) => Promise<void>;
  onRemoveReference: (id: string) => void;
  onLaunch: () => Promise<void>;
}) {
  const [viewer, setViewer] = useState<MediaAsset | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [crop, setCrop] = useState<CropRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const references = draft.mode === "references" ? draft.references : [];
  const selectedProfile = samplingProfileId(draft);
  const profileOptions = specs
    ? (Object.keys(specs.output.sampling.profiles) as SamplingProfileId[]).map((profile) => ({ value: profile, label: profileLabel(profile) }))
    : [{ value: selectedProfile, label: profileLabel(selectedProfile) }];
  const hasFrame = draft.mode === "frames" && (!!draft.firstFrame || !!draft.lastFrame);
  const hasVisualReference = references.some((asset) => asset.kind === "image" || asset.kind === "video");
  const referenceReady = !!specs && (draft.mode === "frames" || (specs.modes.references.available && references.length > 0 && (!specs.modes.references.attachments.audio_may_not_be_sole_modality || hasVisualReference)));
  const hasPromptContent = draft.mode === "references" ? hasReferencePromptContent(draft.prompt) : draft.prompt.trim().length > 0;
  const ready = hasPromptContent && referenceReady && !launching;
  const frameAccept = specs?.modes.frames.attachments.mime_types.join(",") ?? "image/png,image/jpeg,image/webp";
  const refPolicy = specs?.modes.references.attachments;
  const referenceAccept = refPolicy ? [...refPolicy.image.mime_types, ...refPolicy.video.mime_types, ...refPolicy.audio.mime_types].join(",") : "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/ogg";

  const fail = (problem: unknown, fallback: string) => setError(problem instanceof Error ? problem.message : fallback);
  const attachFrame = async (role: "firstFrame" | "lastFrame", file?: File) => {
    if (!file || draft.mode !== "frames") return;
    if (!specs) return fail("H3 settings are still loading.", "H3 settings are still loading.");
    try {
      setError(null);
      const asset = await prepareFrame(file, specs.modes.frames);
      const other = role === "firstFrame" ? draft.lastFrame : draft.firstFrame;
      if (other && !ratiosMatch(other, asset) && other.width && other.height) return setCrop({ asset, role, targetRatio: other.width / other.height });
      await onSetFrame(role, asset);
    } catch (problem) { fail(problem, "Could not attach this frame."); }
  };
  const attachReferences = async (files: FileList | null) => {
    if (!files?.length || draft.mode !== "references") return;
    if (!specs) return fail("H3 settings are still loading.", "H3 settings are still loading.");
    try { setError(null); await onAddReferences(await prepareReferences(files, draft.references, specs.modes.references)); }
    catch (problem) { fail(problem, "Could not attach these files."); }
  };
  const replaceReference = async (file: File) => {
    if (!viewer || draft.mode !== "references") return;
    if (!specs) return setViewerError("H3 settings are still loading.");
    setReplacing(true);
    setViewerError(null);
    try {
      const replacement = await prepareReferenceReplacement(file, viewer, draft.references, specs.modes.references);
      await onReplaceReference(viewer.id, replacement);
      setViewer(replacement);
    } catch (problem) {
      setViewerError(problem instanceof Error ? problem.message : "Could not replace this reference.");
    } finally {
      setReplacing(false);
    }
  };
  const launch = async () => {
    try { setError(null); await onLaunch(); }
    catch (problem) { fail(problem, "Could not start this generation."); }
  };

  return <>
    <motion.section initial={false} animate={{ height: open ? "90dvh" : 60 }} transition={{ duration: .22, ease: [0.16, 1, 0.3, 1] }} className="h3-bottom-sheet fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] max-w-[760px] flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-reelo-border bg-[#181818]/98 shadow-[0_-18px_70px_rgba(0,0,0,.62)] backdrop-blur-xl sm:inset-x-6">
      {!open ? <button type="button" onClick={() => onOpenChange(true)} className="flex min-h-15 flex-1 items-center gap-3 px-4 text-left sm:px-5" aria-label="Expand composer"><div className="min-w-0 flex-1"><p className="text-[9px] font-bold uppercase tracking-[0.15em] text-reelo-dim">{modeLabel(draft)} · {draft.duration} sec</p><p className={`mt-1 truncate text-sm ${hasPromptContent ? "text-reelo-text" : "text-white/34"}`}>{hasPromptContent ? draft.prompt.trim() : "Describe your next video…"}</p></div><ChevronUp size={17} className="shrink-0 text-reelo-dim" /></button> :
      <motion.div initial={false} animate={{ opacity: 1 }} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-white/7 px-3 py-2.5 sm:px-4"><div className="flex items-center gap-1 rounded-full bg-black/25 p-0.5">{(["references", "frames"] as GenerationMode[]).map((mode) => <button key={mode} type="button" onClick={() => onModeChange(mode)} className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${draft.mode === mode ? "bg-white/10 text-reelo-text" : "text-reelo-dim hover:text-reelo-text"}`}>{mode === "frames" ? "Text / frame" : "Reference"}</button>)}</div><button type="button" onClick={() => onOpenChange(false)} className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold text-reelo-dim hover:bg-white/6 hover:text-reelo-text" aria-label="Collapse composer"><span>{modeLabel(draft)}</span><ChevronDown size={13} /></button></div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <AnimatePresence mode="wait" initial={false}>{draft.mode === "frames" ? <FramesInput draft={draft} accept={frameAccept} onFiles={(role, file) => void attachFrame(role, file)} onView={(asset) => { setViewerError(null); setViewer(asset); }} onRemove={(role) => void onSetFrame(role, null)} /> : <ReferencesInput draft={draft} accept={referenceAccept} onFiles={(files) => void attachReferences(files)} onView={(asset) => { setViewerError(null); setViewer(asset); }} onRemove={onRemoveReference} />}</AnimatePresence>
          <PromptEditor mode={draft.mode} document={draft.promptDocument} references={references} onChange={(promptDocument, prompt) => onUpdate({ promptDocument, prompt })} />
          {!!specs?.output.loras.length && <LoraMixer loras={specs.output.loras} scales={draft.loras ?? {}} onScalesChange={(loras) => onUpdate({ loras })} />}
          {error && <p className="mx-4 mb-2 text-[10px] text-red-300">{error}</p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/7 px-3 py-3 sm:px-4">
            <ControlSelect value={draft.duration} label={`${draft.duration} sec`} options={specs ? specs.output.duration.options.map(({ requested_seconds }) => ({ value: requested_seconds, label: `${requested_seconds} seconds` })) : [{ value: draft.duration, label: `${draft.duration} seconds` }]} onChange={(duration) => onUpdate({ duration })} />
            {!hasFrame && <ControlSelect value={draft.aspect} label={draft.aspect} options={specs ? specs.output.geometry.native_aspects.map(({ id }) => ({ value: id as AspectId, label: id })) : [{ value: draft.aspect, label: draft.aspect }]} onChange={(aspect) => onUpdate({ aspect })} />}
            <ControlSelect value={draft.generationCount} label={`${draft.generationCount}x`} options={([1, 2, 3] as GenerationCount[]).map((count) => ({ value: count, label: `${count}x` }))} onChange={(generationCount) => onUpdate({ generationCount })} />
            <ControlSelect<SamplingProfileId> value={selectedProfile} label={profileLabel(selectedProfile)} options={profileOptions} onChange={(samplingProfile) => onUpdate({ samplingProfile, turbo: isTurboProfile(samplingProfile), seed: "random", resolution: "480p" })} />
            <div className="ml-auto flex items-center gap-2"><a href={promptGuides[draft.mode]} target="_blank" rel="noreferrer" title={`${draft.mode === "frames" ? "Frames" : "References"} prompt guide`} aria-label={`Open the official ${draft.mode === "frames" ? "frames" : "references"} prompt guide`} className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-[10px] font-semibold text-reelo-dim hover:bg-white/6 hover:text-reelo-text">Prompt guide<ExternalLink size={11} /></a><button type="button" disabled={!ready} onClick={() => void launch()} title={!specs ? "Loading H3 settings" : draft.mode === "references" && !hasVisualReference ? "Add at least one image or video" : `Generate ${draft.generationCount === 1 ? "video" : `${draft.generationCount} videos`}`} className="flex h-9 items-center gap-2 rounded-full bg-reelo-accent px-4 text-xs font-bold text-black hover:bg-[#69c7ff] disabled:cursor-not-allowed disabled:bg-white/7 disabled:text-white/25">{launching ? <LoaderCircle size={14} className="animate-spin" /> : <>Generate{draft.generationCount > 1 ? ` ${draft.generationCount}` : ""} <ArrowRight size={14} /></>}</button></div>
          </div>
        </div>
      </motion.div>}
    </motion.section>
    {viewer && <MediaViewer asset={viewer} onClose={() => { setViewer(null); setViewerError(null); }} onReplace={draft.mode === "references" && draft.references.some((asset) => asset.id === viewer.id) ? (file) => void replaceReference(file) : undefined} replaceAccept={draft.mode === "references" && refPolicy && viewer.kind !== "file" ? refPolicy[viewer.kind].mime_types.join(",") : undefined} replacing={replacing} error={viewerError} />}
    {crop && <CropModal asset={crop.asset} targetRatio={crop.targetRatio} onClose={() => setCrop(null)} onUse={async (asset) => { await onSetFrame(crop.role, asset); setCrop(null); }} />}
  </>;
}
