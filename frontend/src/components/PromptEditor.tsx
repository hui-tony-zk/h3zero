import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { hydratePromptDocument, promptDocumentToText, sanitizePromptDocument } from "../lib/promptDocument";
import { referencePromptDocument } from "../lib/promptDefaults";
import type { GenerationMode, MediaAsset, PromptDocument } from "../types";
import { createReferenceMention } from "./editor/ReferenceMention";
import { PromptSection } from "./editor/PromptSection";
import { PromptTaskTypeNode } from "./editor/PromptTaskType";

export function PromptEditor({ mode, document, references, onChange }: {
  mode: GenerationMode; document: PromptDocument; references: MediaAsset[]; onChange: (document: PromptDocument, text: string) => void;
}) {
  const [empty, setEmpty] = useState(() => !promptDocumentToText(document, references).trim());
  const assetsRef = useRef(references); const modeRef = useRef(mode); const onChangeRef = useRef(onChange);
  assetsRef.current = references; modeRef.current = mode; onChangeRef.current = onChange;
  const extensions = useMemo(() => [Document, Paragraph, Text, UndoRedo, PromptSection, PromptTaskTypeNode, createReferenceMention(assetsRef, modeRef)], []);
  const editor = useEditor({
    extensions, content: hydratePromptDocument(document, references),
    editorProps: { attributes: { class: "h3-prompt-surface", role: "textbox", "aria-label": "Describe the video, motion, camera, and sound" } },
    onUpdate: ({ editor: current }) => { const next = sanitizePromptDocument(current.getJSON()); const text = promptDocumentToText(next, assetsRef.current); queueMicrotask(() => setEmpty(!text.trim())); onChangeRef.current(next, text); },
  });
  useEffect(() => {
    if (!editor) return;
    const hydrated = hydratePromptDocument(document, references);
    const hydratedNode = editor.schema.nodeFromJSON(hydrated);
    if (!editor.state.doc.eq(hydratedNode)) editor.commands.setContent(hydrated, { emitUpdate: false });
    setEmpty(!promptDocumentToText(document, references).trim());
  }, [document, editor, references]);
  return <div className="h3-prompt-editor">
    <EditorContent editor={editor} className="contents" />
    {mode === "references" && empty && <button type="button" onClick={() => editor?.chain().setContent(referencePromptDocument()).focus("end").run()} className="absolute bottom-3 left-4 z-10 inline-flex h-7 items-center gap-1.5 rounded-full border border-white/9 bg-white/[0.045] px-2.5 font-semibold text-reelo-dim hover:border-white/15 hover:bg-white/[0.075] hover:text-reelo-text"><Plus size={11} />Insert template</button>}
  </div>;
}
