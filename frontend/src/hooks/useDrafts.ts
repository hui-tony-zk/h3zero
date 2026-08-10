import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAsset, saveAsset, saveFavoriteAsset } from "../lib/assets";
import { getFavoriteAsset } from "../lib/api/client";
import { readCloudSyncUsername } from "../lib/cloudSync";
import { emptyFramesDraft, emptyReferencesDraft, readDrafts, writeDrafts } from "../lib/storage/draftRepository";
import { promptDocumentToText, promptTextToDocument, prunePromptDocument, restoreReferenceTokens } from "../lib/promptDocument";
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
      const references = current.references.references.concat(assets);
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
    const restoreAsset = async (id: string) => {
      const local = await loadAsset(id);
      if (local) return local;
      const favorite = job.favoriteAssets?.find((asset) => asset.id === id);
      if (!favorite) return null;
      const username = readCloudSyncUsername();
      if (!username) throw new Error("Set up Modal cloud sync to restore these inputs.");
      return saveFavoriteAsset(favorite, await getFavoriteAsset(username, id));
    };
    setActiveMode(job.mode);
    if (job.mode === "references") {
      const references = (await Promise.all((job.referenceIds ?? job.inputAssetIds).map(restoreAsset))).filter((asset): asset is MediaAsset => asset !== null);
      const prompt = restoreReferenceTokens(job.prompt, references);
      setDrafts((current) => ({ ...current, references: { ...current.references, prompt, promptDocument: promptTextToDocument(prompt, references), duration: job.duration, aspect: job.aspect, references } }));
      return;
    }
    const [firstFrame, lastFrame] = await Promise.all([job.firstFrameId ? restoreAsset(job.firstFrameId) : null, job.lastFrameId ? restoreAsset(job.lastFrameId) : null]);
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
