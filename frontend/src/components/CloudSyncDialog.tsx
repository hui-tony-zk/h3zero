import { AnimatePresence, motion } from "framer-motion";
import { Cloud, LoaderCircle, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { normalizeCloudSyncUsername } from "../lib/cloudSync";

export function CloudSyncDialog({ open, currentUsername, onClose, onSubmit }: {
  open: boolean;
  currentUsername: string | null;
  onClose: () => void;
  onSubmit: (username: string) => Promise<void>;
}) {
  const [value, setValue] = useState(currentUsername ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(currentUsername ?? "");
    setError(null);
  }, [currentUsername, open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const username = normalizeCloudSyncUsername(value);
    if (!username) {
      setError("Use 2–32 letters, numbers, dots, hyphens, or underscores.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(username);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start cloud sync.");
    } finally {
      setBusy(false);
    }
  };

  return <AnimatePresence>{open && <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-80 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
  >
    <motion.form
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.99 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      onSubmit={(event) => void submit(event)}
      className="relative w-full max-w-sm rounded-[18px] border border-white/12 bg-[#171717] px-5 pb-5 pt-6 shadow-[0_28px_80px_rgba(0,0,0,.55)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-sync-title"
    >
      <button type="button" disabled={busy} onClick={onClose} className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full text-white/55 hover:bg-white/7 hover:text-white disabled:opacity-40" aria-label="Close Modal cloud sync"><X size={16} /></button>
      <Cloud size={18} className="text-reelo-accent" />
      <h2 id="cloud-sync-title" className="mt-4 text-base font-semibold tracking-tight text-white">Modal cloud sync</h2>
      <p className="mt-1.5 max-w-[34ch] text-xs leading-5 text-white/52">Use the same name on another device to sync favorites and remix sources.</p>

      <label className="mt-5 block text-[10px] font-bold uppercase tracking-[0.15em] text-white/48" htmlFor="cloud-sync-username">Sync name</label>
      <input
        id="cloud-sync-username"
        value={value}
        disabled={busy}
        autoFocus
        autoCapitalize="none"
        autoComplete="username"
        spellCheck={false}
        onChange={(event) => { setValue(event.target.value); setError(null); }}
        placeholder="tony"
        className="mt-2 h-11 w-full rounded-xl border border-white/12 bg-black/35 px-3.5 text-sm text-white outline-none transition focus:border-reelo-accent/65 focus:ring-2 focus:ring-reelo-accent/15 disabled:opacity-55"
      />
      <div className="mt-2 min-h-4 text-[10px] leading-4 text-white/38">{error ? <span className="text-red-300">{error}</span> : "Anyone who knows this name can open the same favorites."}</div>

      <button type="submit" disabled={busy} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-reelo-accent px-4 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-55">
        {busy && <LoaderCircle size={14} className="animate-spin" />}
        {currentUsername ? "Use this sync name" : "Start syncing"}
      </button>
    </motion.form>
  </motion.div>}</AnimatePresence>;
}
