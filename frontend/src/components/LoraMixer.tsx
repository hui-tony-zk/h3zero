import { useEffect, useRef, useState } from "react";
import type { LoraConfig } from "../types";

type MixerMode = "compact" | "add" | "tweak" | "hints";

function clampLoraScale(lora: LoraConfig, value: number) {
  const rounded = Math.round(value / lora.step) * lora.step;
  return Math.min(lora.max_strength, Math.max(lora.min_strength, rounded));
}

function initialScale(lora: LoraConfig, scales: Record<string, number>) {
  return scales[lora.id] ?? (lora.default_enabled ? lora.default_strength : 0);
}

export function LoraMixer({ loras, scales, onScalesChange }: {
  loras: LoraConfig[];
  scales: Record<string, number>;
  onScalesChange: (scales: Record<string, number>) => void;
}) {
  const [mode, setMode] = useState<MixerMode>("compact");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [addKeys, setAddKeys] = useState<string[]>([]);
  const autoCloseTimerRef = useRef<number | null>(null);
  const getScale = (lora: LoraConfig) => clampLoraScale(lora, initialScale(lora, scales));
  const activeLoras = loras.filter((lora) => getScale(lora) > 0);
  const activePromptLoras = activeLoras.filter((lora) => lora.prompt?.trim());
  const inactiveCount = loras.length - activeLoras.length;
  const selectedLora = loras.find((lora) => lora.id === selectedKey) ?? null;
  const addLoras = addKeys.map((key) => loras.find((lora) => lora.id === key)).filter((lora): lora is LoraConfig => Boolean(lora));

  useEffect(() => () => {
    if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
  }, []);

  const closeToCompact = () => {
    if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = null;
    setSelectedKey(null);
    setMode("compact");
  };
  const scheduleAutoClose = () => {
    if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = window.setTimeout(closeToCompact, 420);
  };
  const setScale = (lora: LoraConfig, value: number) => {
    onScalesChange({ ...scales, [lora.id]: clampLoraScale(lora, value) });
  };
  const commitScale = (lora: LoraConfig, value: number, closeWhenZero = false) => {
    const nextScale = clampLoraScale(lora, value);
    if (nextScale > 0 || closeWhenZero) scheduleAutoClose();
  };
  const openAdd = () => {
    setAddKeys(loras.filter((lora) => getScale(lora) <= 0).map((lora) => lora.id));
    setSelectedKey(null);
    setMode("add");
  };

  if (mode === "add") return <div className="advanced-drawer lora-mixer">
    <MixerHeader label="Add LoRA" onClose={closeToCompact} />
    {addLoras.length ? addLoras.map((lora) => <LoraSliderRow key={lora.id} lora={lora} value={getScale(lora)} onChange={(value) => setScale(lora, value)} onCommit={(value) => commitScale(lora, value)} />) : <div className="lora-empty-state">All LoRAs are active.</div>}
  </div>;

  if (mode === "tweak" && selectedLora) return <div className="advanced-drawer lora-mixer">
    <MixerHeader label={selectedLora.name} onClose={closeToCompact} onRemove={() => { setScale(selectedLora, 0); closeToCompact(); }} />
    <LoraSliderRow lora={selectedLora} value={getScale(selectedLora)} onChange={(value) => setScale(selectedLora, value)} onCommit={(value) => commitScale(selectedLora, value, true)} compact />
  </div>;

  if (mode === "hints") return <div className="advanced-drawer lora-mixer">
    <MixerHeader label="LoRA hints" onClose={closeToCompact} />
    <div className="lora-hints-list">{activePromptLoras.map((lora) => <section className="lora-hint-item" key={lora.id}><h3>{lora.name}</h3><p>{lora.prompt}</p></section>)}</div>
  </div>;

  return <div className="advanced-drawer lora-mixer lora-mixer-compact">
    <div className="lora-compact-row">
      <span className="lora-compact-label">LoRAs</span>
      <div className="lora-chip-row">{activeLoras.length ? activeLoras.map((lora) => <span className="lora-chip" key={lora.id}>
        <button type="button" className="lora-chip-main" onClick={() => { setSelectedKey(lora.id); setMode("tweak"); }} title={`Adjust ${lora.name}`}><span>{lora.name}</span><b>{getScale(lora).toFixed(1)}</b></button>
        <button type="button" className="lora-chip-remove" onClick={() => setScale(lora, 0)} title={`Remove ${lora.name}`} aria-label={`Remove ${lora.name}`}><TrashIcon /></button>
      </span>) : <span className="lora-empty-chip">none active</span>}</div>
      <button type="button" className="lora-text-action" onClick={openAdd} disabled={inactiveCount === 0}>+ Add</button>
      {activePromptLoras.length > 0 && <button type="button" className="lora-text-action" onClick={() => setMode("hints")}>hints</button>}
    </div>
  </div>;
}

function MixerHeader({ label, onClose, onRemove }: { label: string; onClose: () => void; onRemove?: () => void }) {
  return <div className="advanced-drawer-header lora-mixer-header"><span>{label}</span><div className="lora-header-actions">
    {onRemove && <button type="button" className="lora-icon-action danger" onClick={onRemove} title="Remove" aria-label="Remove"><TrashIcon /></button>}
    <button type="button" className="lora-icon-action" onClick={onClose} title="Close" aria-label="Close"><CloseIcon /></button>
  </div></div>;
}

function LoraSliderRow({ lora, value, onChange, onCommit, compact = false }: { lora: LoraConfig; value: number; onChange: (value: number) => void; onCommit: (value: number) => void; compact?: boolean }) {
  const commit = (input: HTMLInputElement) => onCommit(parseFloat(input.value));
  return <div className={`row slider-row lora-slider-row ${compact ? "compact" : ""}`}>
    {!compact && <div className="lora-slider-label">{lora.reference_url ? <a href={lora.reference_url} target="_blank" rel="noopener noreferrer" title={`View ${lora.name} reference`}><span>{lora.name}</span><ExternalLinkIcon /></a> : <span>{lora.name}</span>}</div>}
    <div className="slider-container"><span className="lora-range-edge">{lora.min_strength}</span><input type="range" min={lora.min_strength} max={lora.max_strength} step={lora.step} value={value} aria-label={`${lora.name} strength`} onChange={(event) => onChange(parseFloat(event.target.value))} onPointerUp={(event) => commit(event.currentTarget)} onKeyUp={(event) => commit(event.currentTarget)} onBlur={(event) => commit(event.currentTarget)} /><span className="lora-range-edge">{lora.max_strength}</span><span className="slider-val">{value.toFixed(1)}</span></div>
  </div>;
}

function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
}

function TrashIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></svg>;
}

function ExternalLinkIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>;
}
