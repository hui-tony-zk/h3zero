import type { BaseDraft, SamplingProfileId, SeedChoice } from "../types";

export function samplingProfileId(
  draft: Pick<BaseDraft, "samplingProfile" | "turbo">,
): SamplingProfileId {
  if (draft.samplingProfile && ["turbo_4", "turbo_8", "spectrum", "base"].includes(draft.samplingProfile)) {
    return draft.samplingProfile;
  }
  return draft.turbo === false ? "spectrum" : "turbo_4";
}

export function seedChoice(draft: Pick<BaseDraft, "seed">): SeedChoice {
  return draft.seed ?? "random";
}

export function isTurboProfile(profile: SamplingProfileId): boolean {
  return profile === "turbo_4" || profile === "turbo_8";
}

export function profileLabel(profile: SamplingProfileId): string {
  if (profile === "turbo_4") return "4-step";
  if (profile === "turbo_8") return "8-step";
  if (profile === "spectrum") return "Spectrum";
  return "Base";
}
