export const PROMPT_SECTION_NODE = "promptSection";

export const PROMPT_SECTIONS = {
  subject_definitions: {
    purpose: "Defines referenced content and its reference labels.",
    example: "<Subject 1> is the woman shown in <Picture 1>. Preserve her face, hair, and clothing.",
  },
  summary: {
    purpose: "Summarizes the task type, target video, and main reference relationships.",
    example: "[reference generation] A short scene follows <Subject 1> through a quiet cafe.",
  },
  retention_analysis: {
    purpose: "Describes how referenced content is preserved, transferred, or reused.",
    example: "<Subject 1>: fully_preserved — retain identity, costume, and hairstyle.",
  },
  detailed_description: {
    purpose: "Describes visuals, actions, shots, sound, and dialogue in playback order.",
    example: "[Shot 1] A medium shot follows <Subject 1> toward the window.",
  },
  overall_soundscape: {
    purpose: "Summarizes ambience and physical sounds.",
    example: "Quiet room tone, soft footsteps, and distant street noise.",
  },
  non_diegetic_music: {
    purpose: "Describes background music audible only to the audience.",
    example: "A restrained solo-piano score at a slow tempo.",
  },
} as const;

export type PromptSectionId = keyof typeof PROMPT_SECTIONS;

export function promptSectionId(value: string): PromptSectionId | null {
  const id = value.trim().replace(/:$/, "") as PromptSectionId;
  return Object.hasOwn(PROMPT_SECTIONS, id) ? id : null;
}

export function promptSectionLabel(id: string) {
  return promptSectionId(id) ? `${id}:` : "";
}
