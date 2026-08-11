import { File, LoaderCircle, RefreshCw, X } from "lucide-react";
import { motion } from "framer-motion";
import { useRef } from "react";
import type { MediaAsset } from "../types";

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export function MediaViewer({ asset, onClose, onReplace, replaceAccept, replacing = false, error }: { asset: MediaAsset; onClose: () => void; onReplace?: (file: File) => void; replaceAccept?: string; replacing?: boolean; error?: string | null }) {
  const replacementInput = useRef<HTMLInputElement>(null);
  return (
    <div className="fixed inset-0 z-70 flex flex-col bg-black/92 backdrop-blur-xl" role="dialog" aria-modal="true" aria-label={asset.name}>
      <div className="flex h-15 items-center justify-between border-b border-white/10 px-4 sm:px-6">
        <div className="min-w-0"><p className="truncate text-xs font-bold text-white">{asset.name}</p><p className="mt-0.5 text-[10px] text-white/45">{asset.kind} · {sizeLabel(asset.size)}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</p></div>
        <div className="flex items-center gap-2">
          {onReplace && <><button type="button" disabled={replacing} onClick={() => replacementInput.current?.click()} className="flex h-9 items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 text-[11px] font-semibold text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-50" aria-label={`Replace ${asset.name}`}>{replacing ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}Replace</button><input ref={replacementInput} type="file" accept={replaceAccept} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onReplace(file); event.target.value = ""; }} /></>}
          <button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-full border border-white/12 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close attachment"><X size={17} /></button>
        </div>
      </div>
      {error && <p className="border-b border-red-300/12 bg-red-400/8 px-4 py-2 text-[11px] text-red-200 sm:px-6">{error}</p>}
      <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} className="flex min-h-0 flex-1 items-center justify-center p-5">
        {asset.kind === "image" && <img src={asset.previewUrl} alt={asset.name} className="max-h-full max-w-full object-contain" />}
        {asset.kind === "video" && <video src={asset.previewUrl} controls autoPlay playsInline className="max-h-full max-w-full" />}
        {asset.kind === "audio" && <audio src={asset.previewUrl} controls autoPlay className="w-full max-w-xl" />}
        {asset.kind === "file" && <div className="flex flex-col items-center text-white/45"><File size={38} /><p className="mt-3 text-sm">Preview unavailable</p></div>}
      </motion.div>
    </div>
  );
}
