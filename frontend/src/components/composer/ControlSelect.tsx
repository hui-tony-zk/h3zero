import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export function ControlSelect<T extends string | number>({ value, label, options, onChange }: {
  value: T; label: string; options: Array<{ value: T; label: string }>; onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const focus = (index: number) => optionRefs.current[(index + options.length) % options.length]?.focus();
  const triggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault(); setOpen(true); requestAnimationFrame(() => focus(selectedIndex + (event.key === "ArrowUp" ? -1 : 0)));
  };
  const menuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = optionRefs.current.findIndex((option) => option === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); focus(current + (event.key === "ArrowDown" ? 1 : -1)); }
    if (event.key === "Home" || event.key === "End") { event.preventDefault(); focus(event.key === "Home" ? 0 : options.length - 1); }
  };

  return <div ref={root} className="relative">
    <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={triggerKey} className={`inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-semibold text-reelo-text transition-colors ${open ? "border-reelo-accent/35 bg-white/[0.085]" : "border-white/9 bg-white/[0.045] hover:bg-white/[0.075]"}`}>{label}<ChevronDown size={12} className={`ml-2 text-reelo-dim transition-transform ${open ? "rotate-180 text-reelo-accent" : ""}`} /></button>
    <AnimatePresence>{open && <motion.div role="listbox" aria-label={label} initial={{ opacity: 0, y: 5, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: .98 }} transition={{ duration: .14 }} onKeyDown={menuKey} className="absolute bottom-[calc(100%+8px)] left-0 z-60 max-h-60 min-w-36 overflow-y-auto rounded-[10px] border border-white/10 bg-[#161616]/98 p-1 shadow-[0_12px_34px_rgba(0,0,0,.68)] backdrop-blur-xl">
      {options.map((option, index) => <button ref={(node) => { optionRefs.current[index] = node; }} key={String(option.value)} type="button" role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }} className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-[11px] font-semibold ${option.value === value ? "bg-reelo-accent/[0.09] text-reelo-accent" : "text-reelo-text hover:bg-white/[0.06]"}`}>{option.label}<Check size={12} className={option.value === value ? "opacity-100" : "opacity-0"} /></button>)}
    </motion.div>}</AnimatePresence>
  </div>;
}
