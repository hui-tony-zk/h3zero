import type { JSONContent } from "@tiptap/core";
import type { MediaAsset, PromptDocument } from "../types";
import { PROMPT_SECTION_NODE, promptSectionId, promptSectionLabel } from "./promptSections";
import { parsePromptTaskTypes, PROMPT_TASK_TYPE_NODE, promptTaskTypeText } from "./promptTaskTypes";

export const REFERENCE_MENTION_NODE = "referenceMention";

export function emptyPromptDocument(): PromptDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function referenceTokenMap(references: MediaAsset[]) {
  const counts = { image: 0, video: 0, audio: 0 };
  const byId = new Map<string, string>();
  const byToken = new Map<string, MediaAsset>();
  for (const asset of references) {
    if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio") continue;
    counts[asset.kind] += 1;
    const prefix = asset.kind === "image" ? "Picture" : asset.kind === "video" ? "Video" : "Audio";
    const token = `<${prefix} ${counts[asset.kind]}>`;
    byId.set(asset.id, token);
    byToken.set(token, asset);
  }
  return { byId, byToken };
}

function textNodes(value: string, references: MediaAsset[]): JSONContent[] {
  const { byToken } = referenceTokenMap(references);
  const pattern = /<(?:Picture|Video|Audio) \d+>|\[(?:reference generation|keyframe completion|video editing|video continuation|audio reuse|audio reference)(?: \+ (?:reference generation|keyframe completion|video editing|video continuation|audio reuse|audio reference))*\]/g;
  const nodes: JSONContent[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push({ type: "text", text: value.slice(cursor, index) });
    const asset = byToken.get(match[0]);
    const taskTypes = parsePromptTaskTypes(match[0]);
    if (taskTypes) {
      nodes.push({ type: PROMPT_TASK_TYPE_NODE, attrs: { types: taskTypes } });
    } else if (asset) {
      nodes.push({
        type: REFERENCE_MENTION_NODE,
        attrs: { id: asset.id, label: asset.name, kind: asset.kind },
      });
    } else {
      nodes.push({ type: "text", text: match[0] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < value.length) nodes.push({ type: "text", text: value.slice(cursor) });
  return nodes;
}

export function promptTextToDocument(value: string, references: MediaAsset[] = []): PromptDocument {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) => {
      const sectionLine = line.match(/^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music):(?:\s+(.*))?$/);
      const section = sectionLine ? promptSectionId(sectionLine[1]) : null;
      if (!section) return { type: "paragraph", content: textNodes(line, references) };
      const trailing = sectionLine?.[2] ?? "";
      return { type: "paragraph", content: [{ type: PROMPT_SECTION_NODE, attrs: { id: section } }, ...(trailing ? [{ type: "text", text: " " }, ...textNodes(trailing, references)] : [])] };
    }),
  };
}

function nodeText(node: JSONContent, tokens: Map<string, string>): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === REFERENCE_MENTION_NODE) return tokens.get(String(node.attrs?.id ?? "")) ?? "";
  if (node.type === PROMPT_SECTION_NODE) return promptSectionLabel(String(node.attrs?.id ?? ""));
  if (node.type === PROMPT_TASK_TYPE_NODE) return promptTaskTypeText(node.attrs?.types);
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map((child) => nodeText(child, tokens)).join("");
}

export function promptDocumentToText(document: PromptDocument, references: MediaAsset[] = []): string {
  const { byId } = referenceTokenMap(references);
  if (document.type !== "doc") return nodeText(document, byId);
  return (document.content ?? []).map((node) => nodeText(node, byId)).join("\n");
}

function mapDocument(node: JSONContent, transform: (node: JSONContent) => JSONContent | null): JSONContent | null {
  const transformed = transform(node);
  if (!transformed) return null;
  const content = transformed.content
    ?.map((child) => mapDocument(child, transform))
    .filter((child): child is JSONContent => child !== null);
  return content ? { ...transformed, content } : { ...transformed };
}

function normalizePromptSection(node: JSONContent): JSONContent {
  if (node.type !== "paragraph" || !node.content?.length || node.content[0].type !== "text") return node;
  const text = node.content[0].text ?? "";
  const match = text.match(/^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music):(\s*)/);
  const id = match ? promptSectionId(match[1]) : null;
  if (!id || !match) return node;
  const remainder = text.slice(match[0].length);
  return {
    ...node,
    content: [
      { type: PROMPT_SECTION_NODE, attrs: { id } },
      ...(match[2] || remainder ? [{ type: "text", text: `${match[2]}${remainder}` }] : []),
      ...node.content.slice(1),
    ],
  };
}

export function sanitizePromptDocument(document: PromptDocument): PromptDocument {
  return mapDocument(document, (node) => {
    node = normalizePromptSection(node);
    if (node.type !== REFERENCE_MENTION_NODE) return node;
    const { previewUrl: _previewUrl, ...attrs } = node.attrs ?? {};
    return { ...node, attrs };
  }) ?? emptyPromptDocument();
}

export function hydratePromptDocument(document: PromptDocument, references: MediaAsset[]): PromptDocument {
  const assets = new Map(references.map((asset) => [asset.id, asset]));
  const { byId } = referenceTokenMap(references);
  return mapDocument(document, (node) => {
    node = normalizePromptSection(node);
    if (node.type !== REFERENCE_MENTION_NODE) return node;
    const asset = assets.get(String(node.attrs?.id ?? ""));
    if (!asset) return null;
    return {
      ...node,
      attrs: { ...node.attrs, label: asset.name, kind: asset.kind, previewUrl: asset.previewUrl, token: byId.get(asset.id) ?? "" },
    };
  }) ?? emptyPromptDocument();
}

export function prunePromptDocument(document: PromptDocument, references: MediaAsset[]): PromptDocument {
  const ids = new Set(references.map((asset) => asset.id));
  return mapDocument(document, (node) => {
    if (node.type === REFERENCE_MENTION_NODE && !ids.has(String(node.attrs?.id ?? ""))) return null;
    return node;
  }) ?? emptyPromptDocument();
}
