import { promptTextToDocument } from "./promptDocument";

export const REFERENCE_PROMPT_STRUCTURE = [
  "subject_definitions:",
  "",
  "summary: [reference generation]",
  "",
  "retention_analysis:",
  "",
  "detailed_description: [Shot 1]",
  "",
  "overall_soundscape:",
  "",
  "non_diegetic_music:",
].join("\n");

const REFERENCE_SECTION_LINE = /^(?:subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music):\s*/gm;
const REFERENCE_TASK_TYPE = /\[(?:reference generation|keyframe completion|video editing|video continuation|audio reuse|audio reference)(?: \+ (?:reference generation|keyframe completion|video editing|video continuation|audio reuse|audio reference))*\]/g;
const REFERENCE_DEFAULT_SHOT = /\[Shot 1\]/g;

export function referencePromptDocument() {
  return promptTextToDocument(REFERENCE_PROMPT_STRUCTURE);
}

export function hasReferencePromptContent(prompt: string) {
  return prompt.replace(REFERENCE_SECTION_LINE, "").replace(REFERENCE_TASK_TYPE, "").replace(REFERENCE_DEFAULT_SHOT, "").trim().length > 0;
}
