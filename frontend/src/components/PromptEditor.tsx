import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { hydratePromptDocument, promptDocumentToText, sanitizePromptDocument } from "../lib/promptDocument";
import type { GenerationMode, MediaAsset, PromptDocument } from "../types";
import { createReferenceMention } from "./editor/ReferenceMention";
import { PromptSection } from "./editor/PromptSection";
import { PromptTaskTypeNode } from "./editor/PromptTaskType";

export function PromptEditor({ mode, document, references, onChange }: {
  mode: GenerationMode; document: PromptDocument; references: MediaAsset[]; onChange: (document: PromptDocument, text: string) => void;
}) {
  const assetsRef = useRef(references); const modeRef = useRef(mode); const onChangeRef = useRef(onChange);
  assetsRef.current = references; modeRef.current = mode; onChangeRef.current = onChange;
  const extensions = useMemo(() => [Document, Paragraph, Text, UndoRedo, PromptSection, PromptTaskTypeNode, createReferenceMention(assetsRef, modeRef)], []);
  const editor = useEditor({
    extensions, content: hydratePromptDocument(document, references),
    editorProps: { attributes: { class: "h3-prompt-surface", role: "textbox", "aria-label": "Describe the video, motion, camera, and sound" } },
    onUpdate: ({ editor: current }) => { const next = sanitizePromptDocument(current.getJSON()); onChangeRef.current(next, promptDocumentToText(next, assetsRef.current)); },
  });
  useEffect(() => {
    if (!editor) return;
    const hydrated = hydratePromptDocument(document, references);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(hydrated)) editor.commands.setContent(hydrated, { emitUpdate: false });
  }, [document, editor, references]);
  return <EditorContent editor={editor} className="h3-prompt-editor" />;
}
