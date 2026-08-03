import { FilePlus2, ImagePlus, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { FramesDraft, MediaAsset, ReferencesDraft } from "../../types";

function FrameSlot({ label, asset, choose, view, remove }: { label: string; asset: MediaAsset | null; choose: () => void; view: (asset: MediaAsset) => void; remove: () => void }) {
  if (!asset) return <button type="button" onClick={choose} className="flex h-20 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-white/12 bg-white/[0.025] text-[11px] font-semibold text-reelo-dim hover:border-reelo-accent/45 hover:text-reelo-text"><ImagePlus size={15} />{label}</button>;
  return <div className="group relative h-20 min-w-0 flex-1 overflow-hidden rounded-xl border border-white/12 bg-black"><button type="button" onClick={() => view(asset)} className="absolute inset-0 size-full"><img src={asset.previewUrl} alt={label} className="size-full object-cover" /><span className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/15" /><span className="absolute inset-x-0 bottom-0 truncate px-2.5 py-2 text-left text-[10px] font-bold text-white/80">{label}</span></button><button type="button" onClick={remove} className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-black/65 text-white/70 hover:bg-red-500 hover:text-white" aria-label={`Remove ${label}`}><X size={12} /></button></div>;
}

export function FramesInput({ draft, accept, onFiles, onView, onRemove }: { draft: FramesDraft; accept: string; onFiles: (role: "firstFrame" | "lastFrame", file?: File) => void; onView: (asset: MediaAsset) => void; onRemove: (role: "firstFrame" | "lastFrame") => void }) {
  const first = useRef<HTMLInputElement>(null); const last = useRef<HTMLInputElement>(null);
  const hasFrame = !!draft.firstFrame || !!draft.lastFrame;
  const [expanded, setExpanded] = useState(hasFrame);

  useEffect(() => {
    if (hasFrame) setExpanded(true);
  }, [hasFrame]);

  return <motion.div key="frames" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="px-3 pt-3 sm:px-4">
    <AnimatePresence initial={false} mode="wait">
      {!expanded ? <motion.button key="add-frames" type="button" onClick={() => setExpanded(true)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-expanded="false" className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 text-[11px] font-semibold text-reelo-dim transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-reelo-text"><ImagePlus size={14} />Add frames <span className="text-white/35">(optional)</span></motion.button> : <motion.div key="frame-slots" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-2"><FrameSlot label="First frame" asset={draft.firstFrame} choose={() => first.current?.click()} view={onView} remove={() => onRemove("firstFrame")} /><FrameSlot label="Last frame" asset={draft.lastFrame} choose={() => last.current?.click()} view={onView} remove={() => onRemove("lastFrame")} /></motion.div>}
    </AnimatePresence>
    <input ref={first} type="file" accept={accept} className="hidden" onChange={(event) => { onFiles("firstFrame", event.target.files?.[0]); event.target.value = ""; }} />
    <input ref={last} type="file" accept={accept} className="hidden" onChange={(event) => { onFiles("lastFrame", event.target.files?.[0]); event.target.value = ""; }} />
  </motion.div>;
}

function ReferenceThumb({ asset, view, remove }: { asset: MediaAsset; view: () => void; remove: () => void }) {
  return <div className="group relative size-18 shrink-0 overflow-hidden rounded-xl border border-white/12 bg-black"><button type="button" onClick={view} className="absolute inset-0 size-full">{asset.kind === "image" && <img src={asset.previewUrl} alt={asset.name} className="size-full object-cover" />}{asset.kind === "video" && <video src={asset.previewUrl} muted playsInline className="size-full object-cover" />}{asset.kind !== "image" && asset.kind !== "video" && <span className="flex size-full items-center justify-center text-[9px] font-bold uppercase tracking-wider text-white/45">{asset.kind}</span>}<span className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" /></button><button type="button" onClick={remove} className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white/70 hover:bg-red-500 hover:text-white" aria-label={`Remove ${asset.name}`}><X size={11} /></button></div>;
}

export function ReferencesInput({ draft, accept, onFiles, onView, onRemove }: { draft: ReferencesDraft; accept: string; onFiles: (files: FileList | null) => void; onView: (asset: MediaAsset) => void; onRemove: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <motion.div key="references" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2 overflow-x-auto px-3 pt-3 sm:px-4">{draft.references.map((asset) => <ReferenceThumb key={asset.id} asset={asset} view={() => onView(asset)} remove={() => onRemove(asset.id)} />)}<button type="button" onClick={() => input.current?.click()} className="flex size-18 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/12 bg-white/[0.025] text-reelo-dim hover:border-reelo-accent/45 hover:text-reelo-accent" aria-label="Add references"><FilePlus2 size={17} /></button><input ref={input} type="file" multiple accept={accept} className="hidden" onChange={(event) => { onFiles(event.target.files); event.target.value = ""; }} /></motion.div>;
}
