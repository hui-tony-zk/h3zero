import { loadAsset } from "../assets";
import { emptyPromptDocument } from "../promptDocument";
import type { AspectId, DraftCollection, FramesDraft, GenerationCount, GenerationMode, MediaAsset, PromptDocument, ReferencesDraft, ResolutionId, SamplingProfileId, SeedChoice } from "../../types";
import { isTurboProfile } from "../sampling";

const STORAGE_KEY = "h3-studio-drafts-v1";
const GENERATION_DEFAULT_VERSION = 2;
const aspects = new Set<AspectId>(["9:16", "16:9"]);

type StoredDraft = {
  prompt?: string;
  promptDocument?: PromptDocument;
  duration?: number;
  aspect?: AspectId;
  generationCount?: GenerationCount;
  samplingProfile?: SamplingProfileId;
  seed?: SeedChoice;
  resolution?: ResolutionId;
  turbo?: boolean;
  loras?: Record<string, number>;
  firstFrameId?: string | null;
  lastFrameId?: string | null;
  referenceIds?: string[];
};

type StoredDrafts = { activeMode?: GenerationMode; frames?: StoredDraft; references?: StoredDraft; generationDefaultVersion?: number };

export function emptyFramesDraft(): FramesDraft {
  return { mode: "frames", prompt: "", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 2, samplingProfile: "turbo_4", seed: "random", resolution: "480p", turbo: true, firstFrame: null, lastFrame: null };
}

export function emptyReferencesDraft(): ReferencesDraft {
  return { mode: "references", prompt: "", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 2, samplingProfile: "turbo_4", seed: "random", resolution: "480p", turbo: true, references: [] };
}

function samplingProfile(stored?: StoredDraft): SamplingProfileId {
  if (["turbo_4", "turbo_8", "spectrum", "base"].includes(String(stored?.samplingProfile))) {
    return stored?.samplingProfile as SamplingProfileId;
  }
  return stored?.turbo === false ? "spectrum" : "turbo_4";
}

function aspect(value?: AspectId): AspectId {
  return value && aspects.has(value) ? value : "16:9";
}

function generationCount(value?: GenerationCount, useNewDefault = false): GenerationCount {
  if (useNewDefault) return 2;
  return value === 1 || value === 2 || value === 3 ? value : 2;
}

async function restoreFrames(stored?: StoredDraft, useNewDefault = false): Promise<FramesDraft> {
  if (!stored) return emptyFramesDraft();
  const [firstFrame, lastFrame] = await Promise.all([
    stored.firstFrameId ? loadAsset(stored.firstFrameId) : null,
    stored.lastFrameId ? loadAsset(stored.lastFrameId) : null,
  ]);
  const profile = samplingProfile(stored);
  return { mode: "frames", prompt: "", promptDocument: emptyPromptDocument(), duration: stored.duration ?? 5, aspect: aspect(stored.aspect), generationCount: generationCount(stored.generationCount, useNewDefault), samplingProfile: profile, seed: "random", resolution: "480p", turbo: isTurboProfile(profile), loras: stored.loras ?? {}, firstFrame, lastFrame };
}

async function restoreReferences(stored?: StoredDraft, useNewDefault = false): Promise<ReferencesDraft> {
  if (!stored) return emptyReferencesDraft();
  const references = (await Promise.all((stored.referenceIds ?? []).map(loadAsset))).filter((asset): asset is MediaAsset => asset !== null);
  const profile = samplingProfile(stored);
  return { mode: "references", prompt: "", promptDocument: emptyPromptDocument(), duration: stored.duration ?? 5, aspect: aspect(stored.aspect), generationCount: generationCount(stored.generationCount, useNewDefault), samplingProfile: profile, seed: "random", resolution: "480p", turbo: isTurboProfile(profile), loras: stored.loras ?? {}, references };
}

export async function readDrafts(): Promise<{ activeMode: GenerationMode; drafts: DraftCollection }> {
  let stored: StoredDrafts = {};
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredDrafts; } catch { /* use defaults */ }
  const useNewDefault = stored.generationDefaultVersion !== GENERATION_DEFAULT_VERSION;
  const [frames, references] = await Promise.all([restoreFrames(stored.frames, useNewDefault), restoreReferences(stored.references, useNewDefault)]);
  return { activeMode: stored.activeMode === "frames" ? "frames" : "references", drafts: { frames, references } };
}

function base(draft: FramesDraft | ReferencesDraft): StoredDraft {
  return { duration: draft.duration, aspect: draft.aspect, generationCount: draft.generationCount, samplingProfile: draft.samplingProfile, turbo: draft.turbo, loras: draft.loras ?? {} };
}

export function writeDrafts(activeMode: GenerationMode, drafts: DraftCollection) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    generationDefaultVersion: GENERATION_DEFAULT_VERSION,
    activeMode,
    frames: { ...base(drafts.frames), firstFrameId: drafts.frames.firstFrame?.id ?? null, lastFrameId: drafts.frames.lastFrame?.id ?? null },
    references: { ...base(drafts.references), referenceIds: drafts.references.references.map((asset) => asset.id) },
  } satisfies StoredDrafts));
}
