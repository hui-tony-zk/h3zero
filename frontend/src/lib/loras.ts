import type { LoraConfig } from "../types";

export function remixLoraStrengths(
  stored: Record<string, number> | undefined,
  catalog: LoraConfig[],
): Record<string, number> {
  if (!stored) return {};
  const resolved: Record<string, number> = {};
  for (const lora of catalog) {
    const currentStrength = stored[lora.id];
    if (typeof currentStrength === "number" && Number.isFinite(currentStrength)) {
      resolved[lora.id] = currentStrength;
      continue;
    }
    for (const alias of lora.aliases) {
      const legacyStrength = stored[alias];
      if (typeof legacyStrength === "number" && Number.isFinite(legacyStrength)) {
        resolved[lora.id] = legacyStrength;
        break;
      }
    }
  }
  return resolved;
}
