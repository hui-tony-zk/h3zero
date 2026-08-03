import { Github, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const REPOSITORY_URL = "https://github.com/hui-tony-zk/h3zero";

export function GithubStarPrompt({ visible, onDismiss, onStar }: {
  visible: boolean;
  onDismiss: () => void;
  onStar: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          initial={{ opacity: 0, x: 14, y: -4 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 10 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed right-4 top-4 z-40 w-[min(340px,calc(100vw-2rem))] rounded-[14px] border border-white/12 bg-[#1b1b1b]/96 p-3.5 shadow-[0_18px_55px_rgba(0,0,0,.42)] backdrop-blur-xl sm:right-6 sm:top-5"
          aria-label="Star H3Zero on GitHub"
        >
          <button type="button" onClick={onDismiss} className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full text-white/40 hover:bg-white/7 hover:text-white/80" aria-label="Dismiss GitHub star reminder">
            <X size={14} />
          </button>
          <div className="flex items-start gap-3 pr-7">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.055] text-white/78"><Github size={17} /></span>
            <div>
              <p className="text-xs font-semibold text-reelo-text">Finding H3Zero useful?</p>
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer" onClick={onStar} className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-bold text-reelo-accent hover:text-[#7acbff]">
                Star on GitHub <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
