import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { mergeAttributes, Node, nodeInputRule, nodePasteRule, type NodeViewProps } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Check, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parsePromptTaskTypes, PROMPT_TASK_TYPES, PROMPT_TASK_TYPE_NODE, PROMPT_TASK_TYPE_PATTERN, promptTaskTypeText, removeLastPromptTaskType, type PromptTaskType } from "../../lib/promptTaskTypes";

function PromptTaskTypeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const selected = (Array.isArray(node.attrs.types) ? node.attrs.types : []) as PromptTaskType[];
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    return autoUpdate(trigger.current, menu.current, () => {
      if (!trigger.current || !menu.current) return;
      void computePosition(trigger.current, menu.current, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(7), flip(), shift({ padding: 12 })],
      }).then(({ x, y }) => setPosition({ x, y }));
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const toggle = (type: PromptTaskType) => {
    const types = selected.includes(type) ? selected.filter((item) => item !== type) : [...selected, type];
    updateAttributes({ types });
  };

  const removeLast = () => {
    const types = removeLastPromptTaskType(selected);
    if (types.length) updateAttributes({ types });
    else deleteNode();
  };

  const backspace = (event: React.KeyboardEvent) => {
    if (event.key !== "Backspace") return;
    event.preventDefault();
    event.stopPropagation();
    removeLast();
  };

  return <NodeViewWrapper as="span" className="group/task inline-flex items-center align-baseline" contentEditable={false}>
    <span tabIndex={0} aria-label={`${promptTaskTypeText(selected)}. Backspace removes the last relationship.`} onKeyDown={backspace} className="inline-flex items-center rounded-md border border-reelo-accent/20 bg-reelo-accent/[0.07] px-1.5 py-0.5 font-mono font-semibold text-reelo-accent/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-reelo-accent/60">
      {promptTaskTypeText(selected) || "[choose task]"}
    </span>
    <button
      ref={trigger}
      type="button"
      aria-label="Add reference relationship"
      aria-expanded={open}
      aria-haspopup="menu"
      onKeyDown={backspace}
      onClick={() => setOpen((current) => !current)}
      className={`ml-1 inline-flex h-5 items-center overflow-hidden rounded px-1 text-[9px] font-semibold text-white/45 transition-all hover:bg-white/[0.06] hover:text-white/75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-reelo-accent/60 ${open ? "max-w-14 opacity-100" : "max-w-0 px-0 opacity-0 group-hover/task:max-w-14 group-hover/task:px-1 group-hover/task:opacity-100 group-focus-within/task:max-w-14 group-focus-within/task:px-1 group-focus-within/task:opacity-100"}`}
    ><Plus size={10} className="mr-0.5 shrink-0" />Add</button>
    {open && createPortal(<div
      ref={menu}
      role="menu"
      aria-label="Reference relationships"
      className="z-[125] w-[min(330px,calc(100vw-24px))] rounded-xl border border-white/10 bg-[#171719] p-1.5 shadow-2xl shadow-black/60"
      style={{ position: "fixed", left: position.x, top: position.y }}
    >{PROMPT_TASK_TYPES.map((option) => {
      const checked = selected.includes(option.id);
      return <button
        key={option.id}
        type="button"
        role="menuitemcheckbox"
        aria-checked={checked}
        onClick={() => toggle(option.id)}
        className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.055]"
      >
        <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${checked ? "border-reelo-accent/55 bg-reelo-accent text-black" : "border-white/15 text-transparent"}`}><Check size={10} /></span>
        <span><span className="block text-[11px] font-semibold text-white/80">{option.label}</span><span className="mt-0.5 block text-[10px] leading-4 text-white/42">{option.description}</span></span>
      </button>;
    })}</div>, document.body)}
  </NodeViewWrapper>;
}

export const PromptTaskTypeNode = Node.create({
  name: PROMPT_TASK_TYPE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() { return { types: { default: ["reference generation"] } }; },
  parseHTML() { return [{ tag: "span[data-prompt-task-types]", getAttrs: (element) => ({ types: JSON.parse((element as HTMLElement).dataset.promptTaskTypes ?? "[]") }) }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-prompt-task-types": JSON.stringify(node.attrs.types) }), promptTaskTypeText(node.attrs.types)];
  },
  addInputRules() {
    return [nodeInputRule({
      find: new RegExp(`${PROMPT_TASK_TYPE_PATTERN}$`),
      type: this.type,
      getAttributes: (match) => ({ types: parsePromptTaskTypes(match[0]) ?? [] }),
    })];
  },
  addPasteRules() {
    return [nodePasteRule({
      find: new RegExp(PROMPT_TASK_TYPE_PATTERN, "g"),
      type: this.type,
      getAttributes: (match) => ({ types: parsePromptTaskTypes(match[0]) ?? [] }),
    })];
  },
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state, view } = this.editor;
        const { empty, $from } = state.selection;
        const node = $from.nodeBefore;
        if (!empty || node?.type.name !== PROMPT_TASK_TYPE_NODE) return false;

        const from = $from.pos - node.nodeSize;
        const types = removeLastPromptTaskType(node.attrs.types);
        const transaction = state.tr;
        if (types.length) {
          transaction.setNodeMarkup(from, undefined, { ...node.attrs, types });
        } else {
          const before = state.doc.resolve(from).nodeBefore;
          const deleteFrom = before?.isText && before.text?.endsWith(" ") ? from - 1 : from;
          transaction.delete(deleteFrom, $from.pos);
        }
        view.dispatch(transaction.scrollIntoView());
        return true;
      },
    };
  },
  addNodeView() { return ReactNodeViewRenderer(PromptTaskTypeView, { as: "span" }); },
});
