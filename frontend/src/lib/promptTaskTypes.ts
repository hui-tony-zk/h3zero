export const PROMPT_TASK_TYPE_NODE = "promptTaskType";

export const PROMPT_TASK_TYPES = [
  { id: "reference generation", label: "Generation reference", description: "Guide subjects, setting, style, motion, or storyboard." },
  { id: "keyframe completion", label: "Keyframe", description: "Use an image as a concrete first, last, or intermediate frame." },
  { id: "video editing", label: "Edit video", description: "Directly modify an uploaded source video." },
  { id: "video continuation", label: "Continue video", description: "Generate from where an uploaded video ends." },
  { id: "audio reuse", label: "Reuse audio", description: "Copy all or part of the original audio signal." },
  { id: "audio reference", label: "Reference audio", description: "Follow its voice, music, rhythm, or sound without copying it." },
] as const;

export type PromptTaskType = (typeof PROMPT_TASK_TYPES)[number]["id"];
const taskTypeIds = new Set<string>(PROMPT_TASK_TYPES.map(({ id }) => id));
export const PROMPT_TASK_TYPE_PATTERN = `\\[(?:${PROMPT_TASK_TYPES.map(({ id }) => id).join("|")})(?: \\+ (?:${PROMPT_TASK_TYPES.map(({ id }) => id).join("|")}))*\\]`;

export function parsePromptTaskTypes(value: string): PromptTaskType[] | null {
  const match = value.trim().match(/^\[([^\]]+)\]$/);
  if (!match) return null;
  const types = match[1].split(" + ");
  if (!types.length || types.some((type) => !taskTypeIds.has(type))) return null;
  return [...new Set(types)] as PromptTaskType[];
}

export function promptTaskTypeText(value: unknown) {
  const types = Array.isArray(value) ? value.filter((type): type is PromptTaskType => typeof type === "string" && taskTypeIds.has(type)) : [];
  return types.length ? `[${types.join(" + ")}]` : "";
}

export function removeLastPromptTaskType(value: unknown) {
  const types = Array.isArray(value) ? value.filter((type): type is PromptTaskType => typeof type === "string" && taskTypeIds.has(type)) : [];
  return types.slice(0, -1);
}
