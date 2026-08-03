import { shift } from "@floating-ui/dom";
import type { NodeViewProps } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import { NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { ChevronLeft, FileAudio2, Image as ImageIcon, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState, type MutableRefObject } from "react";
import { referenceTokenMap, REFERENCE_MENTION_NODE } from "../../lib/promptDocument";
import { buildReferenceInsertion, type AnchorKind, type ReferenceRecipe } from "../../lib/promptRecipes";
import type { GenerationMode, MediaAsset } from "../../types";

type MenuItem = { asset: MediaAsset; token: string };
type InsertChoice = MenuItem & { recipe: ReferenceRecipe; anchor?: AnchorKind };
type MenuProps = SuggestionProps<MenuItem, InsertChoice>;
type MenuHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

type RecipeOption = { id: ReferenceRecipe; label: string; description: string; preview: string };

const imageRecipes: RecipeOption[] = [
  { id: "subject", label: "Subject source", description: "Define a reusable character, object, setting, costume, or style.", preview: "<Subject N> is … shown in <Picture N>." },
  { id: "storyboard", label: "Storyboard reference", description: "Map the picture to a shot and state what it plans.", preview: "<Picture N> is a storyboard reference for [Shot N] …" },
  { id: "anchor", label: "Shot anchor", description: "Use the picture as an exact frame or composition anchor.", preview: "<Picture N> is the … of [Shot N] …" },
];

const videoRecipes: RecipeOption[] = [
  { id: "video-source", label: "Source edit", description: "Edit or transform the uploaded video as a whole.", preview: "<Video N> is the source video for the target video edit." },
  { id: "video-continuation", label: "Continuation", description: "Continue naturally from the uploaded video's ending.", preview: "The target video continues from the end of <Video N>." },
  { id: "video-structure", label: "Motion and structure", description: "Reference its camera movement, cuts, rhythm, or timing.", preview: "<Video N> provides the camera movement, cuts, rhythm …" },
  { id: "subject", label: "Subject source", description: "Reuse a visible character, object, setting, action, or style.", preview: "<Subject N> is … shown in <Video N>." },
];

const anchors: Array<{ id: AnchorKind; label: string }> = [
  { id: "first frame", label: "First frame" },
  { id: "keyframe", label: "Keyframe" },
  { id: "last frame", label: "Last frame" },
  { id: "composition anchor", label: "Composition anchor" },
];

function Visual({ asset, className = "size-7" }: { asset: Pick<MediaAsset, "kind" | "previewUrl">; className?: string }) {
  if (asset.kind === "image") return <img src={asset.previewUrl} alt="" className={`${className} shrink-0 rounded-md object-cover`} />;
  if (asset.kind === "video") return <video src={asset.previewUrl} muted playsInline preload="metadata" className={`${className} shrink-0 rounded-md object-cover`} />;
  return <span className={`${className} flex shrink-0 items-center justify-center rounded-md bg-white/7 text-white/55`}><FileAudio2 size={13} /></span>;
}

const Menu = forwardRef<MenuHandle, MenuProps>(function Menu(props, ref) {
  const [selected, setSelected] = useState(0);
  const [pending, setPending] = useState<MenuItem | null>(null);
  const [choosingAnchor, setChoosingAnchor] = useState(false);
  useEffect(() => { setSelected(0); setPending(null); setChoosingAnchor(false); }, [props.items, props.query]);

  const activeRecipes = pending?.asset.kind === "video" ? videoRecipes : imageRecipes;
  const optionCount = choosingAnchor ? anchors.length : pending ? activeRecipes.length : props.items.length;
  const back = () => {
    if (choosingAnchor) setChoosingAnchor(false);
    else setPending(null);
    setSelected(0);
  };
  const choose = (index: number) => {
    if (!pending) {
      const item = props.items[index];
      if (!item) return;
      if (item.asset.kind === "audio") props.command({ ...item, recipe: "reference" });
      else { setPending(item); setSelected(0); }
      return;
    }
    if (choosingAnchor) {
      const anchor = anchors[index];
      if (anchor) props.command({ ...pending, recipe: "anchor", anchor: anchor.id });
      return;
    }
    const recipe = activeRecipes[index];
    if (!recipe) return;
    if (recipe.id === "anchor") { setChoosingAnchor(true); setSelected(0); }
    else props.command({ ...pending, recipe: recipe.id });
  };
  useImperativeHandle(ref, () => ({ onKeyDown: ({ event }) => {
    if (event.key === "Escape" && pending) { event.preventDefault(); back(); return true; }
    if (!optionCount) return false;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => (value + optionCount + (event.key === "ArrowUp" ? -1 : 1)) % optionCount); return true; }
    if (event.key === "Enter") { event.preventDefault(); choose(selected); return true; }
    return false;
  } }), [optionCount, pending, choosingAnchor, props.items, selected]);
  if (!props.items.length) return <div className="rounded-xl border border-white/10 bg-[#202020] px-3 py-2.5 text-[11px] text-reelo-dim shadow-2xl">No matching attachments</div>;
  if (!pending) return <div role="listbox" aria-label="Reference attachments" className="w-[300px] overflow-hidden rounded-xl border border-white/10 bg-[#202020] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.65)]">{props.items.map((item, index) => <button key={item.asset.id} type="button" role="option" aria-label={`${item.token} reference`} aria-selected={index === selected} onMouseDown={(event) => { event.preventDefault(); choose(index); }} onMouseEnter={() => setSelected(index)} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left ${index === selected ? "bg-reelo-accent/12" : "hover:bg-white/5"}`}><Visual asset={item.asset} /><span className="font-mono text-[10px] font-semibold text-reelo-accent">{item.token}</span></button>)}</div>;

  return <div role="listbox" aria-label={choosingAnchor ? "Choose shot anchor" : `Insert ${pending.token} as`} className="w-[350px] overflow-hidden rounded-xl border border-white/10 bg-[#202020] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.65)]">
    <div className="flex items-center gap-2 px-1.5 py-1.5"><button type="button" onMouseDown={(event) => { event.preventDefault(); back(); }} className="flex size-7 items-center justify-center rounded-lg text-reelo-dim hover:bg-white/6 hover:text-reelo-text" aria-label="Back"><ChevronLeft size={14} /></button><Visual asset={pending.asset} /><span className="font-mono text-[10px] font-semibold text-reelo-accent">{pending.token}</span></div>
    <div className="my-1 h-px bg-white/7" />
    {choosingAnchor ? anchors.map((anchor, index) => <button key={anchor.id} type="button" role="option" aria-selected={index === selected} onMouseDown={(event) => { event.preventDefault(); choose(index); }} onMouseEnter={() => setSelected(index)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold ${index === selected ? "bg-reelo-accent/12 text-reelo-text" : "text-reelo-dim hover:bg-white/5 hover:text-reelo-text"}`}><span>{anchor.label}</span><span className="font-mono text-[9px] font-normal text-white/30">{pending.token} is the {anchor.id}…</span></button>) : activeRecipes.map((recipe, index) => <button key={recipe.id} type="button" role="option" aria-selected={index === selected} onMouseDown={(event) => { event.preventDefault(); choose(index); }} onMouseEnter={() => setSelected(index)} className={`block w-full rounded-lg px-2.5 py-2 text-left ${index === selected ? "bg-reelo-accent/12" : "hover:bg-white/5"}`}><span className="block text-[11px] font-semibold text-reelo-text">{recipe.label}</span><span className="mt-0.5 block text-[9px] leading-4 text-reelo-dim">{recipe.description}</span><span className="mt-1 block truncate font-mono text-[9px] text-white/32">{recipe.preview.replaceAll("<Picture N>", pending.token).replaceAll("<Video N>", pending.token)}</span></button>)}
  </div>;
});

function Chip({ node, deleteNode }: NodeViewProps) {
  const asset = { id: String(node.attrs.id ?? ""), name: String(node.attrs.label ?? "Reference"), kind: node.attrs.kind === "video" || node.attrs.kind === "audio" ? node.attrs.kind : "image", previewUrl: String(node.attrs.previewUrl ?? "") } as const;
  const token = String(node.attrs.token ?? "");
  return <NodeViewWrapper as="span" className="h3-reference-mention" data-reference-id={asset.id} data-reference-token={token}>{(asset.kind === "image" || asset.kind === "video") && asset.previewUrl ? <Visual asset={asset} className="size-5" /> : asset.kind === "audio" ? <FileAudio2 size={12} /> : <ImageIcon size={12} />}{token && <span className="font-mono text-reelo-accent/75">{token}</span>}<button type="button" contentEditable={false} onMouseDown={(event) => event.preventDefault()} onClick={deleteNode} className="ml-0.5 flex size-4 items-center justify-center rounded-full text-white/38 hover:bg-white/10 hover:text-white" aria-label={`Remove mention ${asset.name}`}><X size={10} /></button></NodeViewWrapper>;
}

export function createReferenceMention(assets: MutableRefObject<MediaAsset[]>, mode: MutableRefObject<GenerationMode>) {
  return Mention.extend({
    name: REFERENCE_MENTION_NODE,
    addAttributes: () => ({ id: { default: null }, label: { default: null }, kind: { default: "image" }, previewUrl: { default: null }, token: { default: null } }),
    addNodeView: () => ReactNodeViewRenderer(Chip, { as: "span" }),
  }).configure({
    deleteTriggerWithBackspace: true,
    renderText: ({ node }) => String(node.attrs.label ?? "Reference"),
    suggestion: {
      char: "@", placement: "top-start", offset: { mainAxis: 8 }, floatingUi: { middleware: [shift({ padding: 12 })] },
      allow: () => mode.current === "references" && assets.current.length > 0,
      items: ({ query }) => {
        const normalized = query.trim().toLowerCase(); const { byId } = referenceTokenMap(assets.current);
        return assets.current.map((asset) => ({ asset, token: byId.get(asset.id) ?? "" })).filter((item) => !normalized || item.asset.name.toLowerCase().includes(normalized) || item.token.toLowerCase().includes(normalized));
      },
      command: ({ editor, range, props }) => {
        const item = props as unknown as InsertChoice;
        editor.chain().focus().insertContentAt(range, buildReferenceInsertion({ ...item, promptText: editor.getText() })).run();
      },
      render: () => {
        let component: ReactRenderer<MenuHandle, MenuProps> | null = null; let unmount: (() => void) | null = null;
        return {
          onStart: (props) => { component = new ReactRenderer(Menu, { props, editor: props.editor, className: "z-[90]" }); unmount = props.mount(component.element); },
          onUpdate: (props) => component?.updateProps(props),
          onKeyDown: (props) => component?.ref?.onKeyDown(props) ?? false,
          onExit: () => { unmount?.(); component?.destroy(); component = null; unmount = null; },
        };
      },
    },
  });
}
