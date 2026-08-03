import { Crop, LoaderCircle, X } from "lucide-react";
import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { cropImageAsset } from "../lib/assets";
import type { MediaAsset } from "../types";

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }

export function CropModal({ asset, targetRatio, onClose, onUse }: {
  asset: MediaAsset;
  targetRatio: number;
  onClose: () => void;
  onUse: (asset: MediaAsset) => Promise<void>;
}) {
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const [working, setWorking] = useState(false);
  const drag = useRef<{ x: number; y: number; focusX: number; focusY: number } | null>(null);

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/76 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Crop frame">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl rounded-2xl border border-reelo-border bg-[#171717] shadow-[0_28px_90px_rgba(0,0,0,.75)]">
        <div className="flex items-center justify-between border-b border-white/7 px-4 py-3.5 sm:px-5"><div><h2 className="text-sm font-bold text-reelo-text">Crop to match</h2><p className="mt-0.5 text-[10px] text-reelo-dim">Drag the image to choose the visible area</p></div><button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-full text-reelo-dim hover:bg-white/7 hover:text-reelo-text" aria-label="Close crop"><X size={16} /></button></div>
        <div className="p-4 sm:p-6">
          <div
            className="relative mx-auto max-h-[58vh] max-w-full cursor-grab touch-none overflow-hidden rounded-xl bg-black active:cursor-grabbing"
            style={{ aspectRatio: String(targetRatio), width: targetRatio >= 1 ? "100%" : `min(100%, ${Math.round(58 * targetRatio)}vh)` }}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, focusX: focus.x, focusY: focus.y }; }}
            onPointerMove={(event) => { if (!drag.current) return; const rect = event.currentTarget.getBoundingClientRect(); setFocus({ x: clamp(drag.current.focusX - (event.clientX - drag.current.x) / rect.width), y: clamp(drag.current.focusY - (event.clientY - drag.current.y) / rect.height) }); }}
            onPointerUp={() => { drag.current = null; }}
          >
            <img src={asset.previewUrl} alt="Crop preview" draggable={false} className="pointer-events-none absolute inset-0 size-full select-none object-cover" style={{ objectPosition: `${focus.x * 100}% ${focus.y * 100}%` }} />
            <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/25" />
            <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/18" /><div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/18" /><div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/18" /><div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/18" />
          </div>
        </div>
        <div className="flex justify-end border-t border-white/7 p-3.5"><button type="button" disabled={working} onClick={async () => { setWorking(true); try { await onUse(await cropImageAsset(asset, targetRatio, focus.x, focus.y)); } finally { setWorking(false); } }} className="inline-flex h-10 items-center gap-2 rounded-full bg-reelo-accent px-5 text-xs font-bold text-black disabled:opacity-50">{working ? <LoaderCircle size={14} className="animate-spin" /> : <Crop size={14} />}Use crop</button></div>
      </motion.div>
    </div>
  );
}
