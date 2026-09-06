export type SparseAttentionPreset = { value: number; label: string };

export function sparseAttentionLabel(
  enabled: boolean,
  videoBudget: number,
  presets: SparseAttentionPreset[] = [],
) {
  if (!enabled) return "Off — full attention";
  return presets.find(({ value }) => value === videoBudget)?.label
    ?? `${Math.round(videoBudget * 100)}% video retained`;
}
