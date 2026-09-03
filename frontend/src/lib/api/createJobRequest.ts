import type { ComposerDraft, FramesDraft, H3Specs, MediaAsset } from "../../types";
import { isTurboProfile, samplingProfileId } from "../sampling";

function frameGeometry(draft: FramesDraft, specs: H3Specs) {
  const entries = ([
    draft.firstFrame ? { role: "first_frame" as const, asset: draft.firstFrame } : null,
    draft.lastFrame ? { role: "last_frame" as const, asset: draft.lastFrame } : null,
  ]).filter((entry): entry is { role: "first_frame" | "last_frame"; asset: MediaAsset } => entry !== null);
  const source = entries.sort((left, right) => left.asset.createdAt - right.asset.createdAt)[0];
  if (!source?.asset.width || !source.asset.height) return null;
  const ratio = source.asset.width / source.asset.height;
  const resolution = "480p" as const;
  const { short_edge: shortEdge, max_pixels: maxPixels } = specs.output.geometry.resolutions[resolution];
  const { multiple } = specs.output.geometry;
  let width = ratio >= 1 ? ratio * shortEdge : shortEdge;
  let height = ratio >= 1 ? shortEdge : shortEdge / ratio;
  const pixels = width * height;
  if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels);
    width *= scale;
    height *= scale;
  }
  width = Math.max(multiple, Math.round(width / multiple) * multiple);
  height = Math.max(multiple, Math.round(height / multiple) * multiple);
  while (width * height > maxPixels) {
    if (width >= height) width -= multiple;
    else height -= multiple;
  }
  return { width, height, geometrySource: source.role };
}

export function buildCreateJobRequest(draft: ComposerDraft, specs: H3Specs) {
  const resolution = "480p" as const;
  const preset = specs.output.geometry.resolutions[resolution].native_aspects.find((candidate) => candidate.id === draft.aspect);
  if (!preset) throw new Error(`The H3 API does not support aspect ${draft.aspect}.`);
  const frame = draft.mode === "frames" ? frameGeometry(draft, specs) : null;
  const references = draft.mode === "references" ? draft.references.map((asset, index) => ({
    id: asset.id,
    kind: asset.kind,
    use_audio: false,
    field: `attachment_${index}`,
  })) : [];
  const body = new FormData();
  const profileId = samplingProfileId(draft);
  const sampling = specs.output.sampling.profiles[profileId];
  const loras = Object.fromEntries(specs.output.loras.flatMap((lora) => {
    const configured = draft.loras?.[lora.id];
    const strength = configured ?? (lora.default_enabled ? lora.default_strength : 0);
    return strength > 0 ? [[lora.id, strength]] : [];
  }));
  body.set("prompt", draft.prompt.trim());
  body.set("config", JSON.stringify({
    mode: draft.mode,
    width: frame?.width ?? preset.width,
    height: frame?.height ?? preset.height,
    duration_seconds: draft.duration,
    resolution,
    sampling_profile: profileId,
    turbo: isTurboProfile(profileId),
    sparse_attention: draft.sparseAttention === true,
    sparse_attention_video_budget: draft.sparseAttentionBudget ?? specs.output.attention.sparse.video_budget,
    seed: null,
    steps: sampling.steps.default,
    sampler: sampling.sampler,
    scheduler: sampling.scheduler,
    loras,
    geometry_source: frame?.geometrySource,
    references: draft.mode === "references" ? references : undefined,
  }));
  if (draft.mode === "frames") {
    if (draft.firstFrame) body.set("first_frame", draft.firstFrame.file, draft.firstFrame.name);
    if (draft.lastFrame) body.set("last_frame", draft.lastFrame.file, draft.lastFrame.name);
  } else {
    draft.references.forEach((asset, index) => body.set(`attachment_${index}`, asset.file, asset.name));
  }
  return body;
}
