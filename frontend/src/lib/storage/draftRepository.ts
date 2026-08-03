import { loadAsset } from "../assets";
import { emptyPromptDocument, promptDocumentToText, promptTextToDocument, prunePromptDocument, sanitizePromptDocument } from "../promptDocument";
import { hasReferencePromptContent, REFERENCE_PROMPT_STRUCTURE, referencePromptDocument } from "../promptDefaults";
import type { AspectId, DraftCollection, FramesDraft, GenerationMode, MediaAsset, PromptDocument, ReferencesDraft } from "../../types";

const STORAGE_KEY = "h3-studio-drafts-v1";
const aspects = new Set<AspectId>(["9:16", "16:9"]);

type StoredDraft = {
  prompt?: string;
  promptDocument?: PromptDocument;
  duration?: number;
  aspect?: AspectId;
  firstFrameId?: string | null;
  lastFrameId?: string | null;
  referenceIds?: string[];
};

type StoredDrafts = { activeMode?: GenerationMode; frames?: StoredDraft; references?: StoredDraft };

export function emptyFramesDraft(): FramesDraft {
  return { mode: "frames", prompt: "", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", firstFrame: null, lastFrame: null };
}

export function emptyReferencesDraft(): ReferencesDraft {
  return { mode: "references", prompt: REFERENCE_PROMPT_STRUCTURE, promptDocument: referencePromptDocument(), duration: 5, aspect: "16:9", references: [] };
}

function aspect(value?: AspectId): AspectId {
  return value && aspects.has(value) ? value : "16:9";
}

async function restoreFrames(stored?: StoredDraft): Promise<FramesDraft> {
  if (!stored) return emptyFramesDraft();
  const [firstFrame, lastFrame] = await Promise.all([
    stored.firstFrameId ? loadAsset(stored.firstFrameId) : null,
    stored.lastFrameId ? loadAsset(stored.lastFrameId) : null,
  ]);
  const promptDocument = prunePromptDocument(stored.promptDocument ?? promptTextToDocument(stored.prompt ?? ""), []);
  return { mode: "frames", prompt: promptDocumentToText(promptDocument), promptDocument, duration: stored.duration ?? 5, aspect: aspect(stored.aspect), firstFrame, lastFrame };
}

async function restoreReferences(stored?: StoredDraft): Promise<ReferencesDraft> {
  if (!stored) return emptyReferencesDraft();
  const references = (await Promise.all((stored.referenceIds ?? []).map(loadAsset))).filter((asset): asset is MediaAsset => asset !== null);
  const restoredDocument = prunePromptDocument(stored.promptDocument ?? promptTextToDocument(stored.prompt ?? "", references), references);
  const promptDocument = hasReferencePromptContent(promptDocumentToText(restoredDocument, references)) ? restoredDocument : referencePromptDocument();
  return { mode: "references", prompt: promptDocumentToText(promptDocument, references), promptDocument, duration: stored.duration ?? 5, aspect: aspect(stored.aspect), references };
}

export async function readDrafts(): Promise<{ activeMode: GenerationMode; drafts: DraftCollection }> {
  let stored: StoredDrafts = {};
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredDrafts; } catch { /* use defaults */ }
  const [frames, references] = await Promise.all([restoreFrames(stored.frames), restoreReferences(stored.references)]);
  return { activeMode: stored.activeMode === "frames" ? "frames" : "references", drafts: { frames, references } };
}

function base(draft: FramesDraft | ReferencesDraft): StoredDraft {
  return { prompt: draft.prompt, promptDocument: sanitizePromptDocument(draft.promptDocument), duration: draft.duration, aspect: draft.aspect };
}

export function writeDrafts(activeMode: GenerationMode, drafts: DraftCollection) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    activeMode,
    frames: { ...base(drafts.frames), firstFrameId: drafts.frames.firstFrame?.id ?? null, lastFrameId: drafts.frames.lastFrame?.id ?? null },
    references: { ...base(drafts.references), referenceIds: drafts.references.references.map((asset) => asset.id) },
  } satisfies StoredDrafts));
}
