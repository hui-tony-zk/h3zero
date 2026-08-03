import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAsset, saveAsset } from "../lib/assets";
import { emptyFramesDraft, emptyReferencesDraft, readDrafts, writeDrafts } from "../lib/storage/draftRepository";
import { promptDocumentToText, promptTextToDocument, prunePromptDocument } from "../lib/promptDocument";
import type { BaseDraft, DraftCollection, GenerationMode, Job, MediaAsset } from "../types";

const defaults: DraftCollection = { frames: emptyFramesDraft(), references: emptyReferencesDraft() };

export function useDrafts() {
  const [activeMode, setActiveMode] = useState<GenerationMode>("references");
  const [drafts, setDrafts] = useState<DraftCollection>(defaults);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    void readDrafts().then((restored) => {
      if (!active) return;
      setDrafts(restored.drafts);
      setActiveMode(restored.activeMode);
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { if (hydrated) writeDrafts(activeMode, drafts); }, [activeMode, drafts, hydrated]);

  const updateActiveDraft = useCallback((patch: Partial<BaseDraft>) => {
    setDrafts((current) => ({ ...current, [activeMode]: { ...current[activeMode], ...patch } }));
  }, [activeMode]);

  const setFrame = useCallback(async (role: "firstFrame" | "lastFrame", asset: MediaAsset | null) => {
    if (asset) await saveAsset(asset);
    setDrafts((current) => ({ ...current, frames: { ...current.frames, [role]: asset } }));
  }, []);

  const addReferences = useCallback(async (assets: MediaAsset[]) => {
    await Promise.all(assets.map(saveAsset));
    setDrafts((current) => {
      const references = [...assets].reverse().concat(current.references.references);
      return { ...current, references: { ...current.references, references, prompt: promptDocumentToText(current.references.promptDocument, references) } };
    });
  }, []);

  const removeReference = useCallback((id: string) => {
    setDrafts((current) => {
      const references = current.references.references.filter((asset) => asset.id !== id);
      const promptDocument = prunePromptDocument(current.references.promptDocument, references);
      return { ...current, references: { ...current.references, references, promptDocument, prompt: promptDocumentToText(promptDocument, references) } };
    });
  }, []);

  const restoreInputs = useCallback(async (job: Job) => {
    setActiveMode(job.mode);
    if (job.mode === "references") {
      const references = (await Promise.all((job.referenceIds ?? job.inputAssetIds).map(loadAsset))).filter((asset): asset is MediaAsset => asset !== null);
      setDrafts((current) => ({ ...current, references: { ...current.references, prompt: job.prompt, promptDocument: promptTextToDocument(job.prompt, references), duration: job.duration, aspect: job.aspect, references } }));
      return;
    }
    const [firstFrame, lastFrame] = await Promise.all([job.firstFrameId ? loadAsset(job.firstFrameId) : null, job.lastFrameId ? loadAsset(job.lastFrameId) : null]);
    setDrafts((current) => ({ ...current, frames: { ...current.frames, prompt: job.prompt, promptDocument: promptTextToDocument(job.prompt), duration: job.duration, aspect: job.aspect, firstFrame, lastFrame } }));
  }, []);

  const resetActiveDraft = useCallback(() => {
    setDrafts((current) => ({ ...current, [activeMode]: activeMode === "references" ? emptyReferencesDraft() : emptyFramesDraft() }));
  }, [activeMode]);

  return useMemo(() => ({
    activeMode, setActiveMode, activeDraft: drafts[activeMode], hydrated,
    updateActiveDraft, setFrame, addReferences, removeReference, restoreInputs, resetActiveDraft,
  }), [activeMode, addReferences, drafts, hydrated, removeReference, resetActiveDraft, restoreInputs, setFrame, updateActiveDraft]);
}
