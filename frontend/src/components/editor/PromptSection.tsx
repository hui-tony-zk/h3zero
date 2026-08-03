import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { mergeAttributes, Node, type NodeViewProps } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PROMPT_SECTIONS, PROMPT_SECTION_NODE, promptSectionId, promptSectionLabel } from "../../lib/promptSections";

function PromptSectionView({ node }: NodeViewProps) {
  const id = promptSectionId(String(node.attrs.id ?? ""));
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const open = hovered || pinned;

  useEffect(() => {
    if (!open || !trigger.current || !popover.current) return;
    return autoUpdate(trigger.current, popover.current, () => {
      if (!trigger.current || !popover.current) return;
      void computePosition(trigger.current, popover.current, {
        strategy: "fixed",
        placement: "right-start",
        middleware: [offset(8), flip(), shift({ padding: 12 })],
      }).then(({ x, y }) => setPosition({ x, y }));
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node;
      if (!trigger.current?.contains(target) && !popover.current?.contains(target)) { setPinned(false); setHovered(false); }
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setPinned(false); setHovered(false); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!id) return null;
  const section = PROMPT_SECTIONS[id];
  return <NodeViewWrapper as="span" className="relative inline" contentEditable={false}>
    <button
      ref={trigger}
      type="button"
      className="rounded px-1 py-0.5 font-mono font-semibold text-reelo-accent/85 underline decoration-reelo-accent/35 decoration-dotted underline-offset-4 transition-colors hover:bg-white/[0.06] hover:text-reelo-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-reelo-accent/70"
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => setPinned((current) => !current)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >{promptSectionLabel(id)}</button>
    {open && createPortal(<div
      ref={popover}
      role="dialog"
      aria-label={`${id} prompt guidance`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="z-[120] w-[min(310px,calc(100vw-24px))] rounded-xl border border-white/10 bg-[#171719] p-3 text-left shadow-2xl shadow-black/60"
      style={{ position: "fixed", left: position.x, top: position.y }}
    >
      <p className="text-xs leading-5 text-white/78">{section.purpose}</p>
      <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-white/35">Example</p>
      <p className="mt-1 font-mono text-[10px] leading-4 text-white/60">{section.example}</p>
    </div>, document.body)}
  </NodeViewWrapper>;
}

export const PromptSection = Node.create({
  name: PROMPT_SECTION_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() { return { id: { default: null } }; },
  parseHTML() { return [{ tag: "span[data-prompt-section]", getAttrs: (element) => ({ id: (element as HTMLElement).dataset.promptSection }) }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-prompt-section": node.attrs.id }), promptSectionLabel(String(node.attrs.id ?? ""))];
  },
  addNodeView() { return ReactNodeViewRenderer(PromptSectionView, { as: "span" }); },
});
