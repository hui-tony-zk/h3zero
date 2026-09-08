import { motion } from "framer-motion";
import { SlidersHorizontal, X } from "lucide-react";
import { useEffect } from "react";
import { generationSettingSections } from "../lib/generationSettings";
import type { Job } from "../types";

export function GenerationSettingsDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const sections = generationSettingSections(job);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-80 flex items-end justify-center bg-black/76 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.section
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.99 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-[20px] border border-white/12 bg-[#171717] shadow-[0_28px_90px_rgba(0,0,0,.72)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generation-settings-title"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/8 px-4 py-4 sm:px-5">
          <span className="flex size-9 items-center justify-center rounded-full bg-reelo-accent/12 text-reelo-accent"><SlidersHorizontal size={16} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="generation-settings-title" className="text-sm font-bold text-reelo-text">Generation settings</h2>
            <p className="mt-0.5 text-[10px] text-reelo-dim">Resolved configuration and output details</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-full text-white/55 hover:bg-white/7 hover:text-white" aria-label="Close generation settings"><X size={16} /></button>
        </header>

        <div className="min-h-0 overflow-y-auto px-4 py-2 sm:px-5">
          {sections.map((section) => (
            <section key={section.title} className="border-b border-white/7 py-4 last:border-b-0">
              <h3 className="mb-2.5 text-[9px] font-bold uppercase tracking-[0.17em] text-reelo-accent/80">{section.title}</h3>
              {section.text !== undefined ? (
                <p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-white/78">{section.text}</p>
              ) : <dl className="space-y-2.5">
                {section.items.map(({ label, value }, index) => (
                  <div key={`${label}-${index}`} className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.4fr)] gap-4 text-[11px] leading-4">
                    <dt className="text-white/42">{label}</dt>
                    <dd className="min-w-0 break-words text-right font-medium text-white/78">{value}</dd>
                  </div>
                ))}
              </dl>}
            </section>
          ))}
        </div>
      </motion.section>
    </motion.div>
  );
}
