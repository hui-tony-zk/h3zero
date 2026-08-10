import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useCallback, useEffect } from "react";

const TOAST_DURATION_MS = 5000;

export interface ToastNotice {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function Toast({ toast, onDismiss }: { toast: ToastNotice | null; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast]);

  const handleAction = useCallback(() => {
    if (!toast) return;
    toast.onAction?.();
    onDismiss(toast.id);
  }, [onDismiss, toast]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, x: "-50%", y: -8 }}
          animate={{ opacity: 1, x: "-50%", y: 0 }}
          exit={{ opacity: 0, x: "-50%", y: -6 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="fixed left-1/2 z-90 flex items-center gap-4 rounded-[10px] border border-reelo-border bg-reelo-card py-2.5 pl-4 pr-2.5 text-[13px] text-reelo-text shadow-[0_8px_24px_rgba(0,0,0,.5)] [top:calc(env(safe-area-inset-top,0px)+16px)]"
          role="status"
          aria-live="polite"
        >
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button type="button" onClick={handleAction} className="rounded-md px-2 py-1 text-xs font-bold uppercase tracking-[0.04em] text-reelo-accent hover:bg-reelo-accent/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-reelo-accent">
              {toast.actionLabel}
            </button>
          )}
          <button type="button" onClick={() => onDismiss(toast.id)} className="flex size-6 items-center justify-center rounded-md text-reelo-dim hover:bg-white/8 hover:text-reelo-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-reelo-accent" aria-label="Dismiss notification" title="Dismiss">
            <X size={12} strokeWidth={2.5} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
