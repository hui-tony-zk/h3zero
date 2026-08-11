import { profileLabel } from "./sampling";
import type { Job, SamplingProfileId } from "../types";

export type GenerationSetting = { label: string; value: string };
export type GenerationSettingSection = { title: string; items: GenerationSetting[]; text?: string };

const profileSteps: Record<SamplingProfileId, number> = {
  turbo_4: 4,
  turbo_8: 8,
  spectrum: 20,
  base: 20,
};

function present(value: unknown): value is string | number {
  return (typeof value === "string" && value.length > 0) || (typeof value === "number" && Number.isFinite(value));
}

function item(label: string, value: unknown): GenerationSetting[] {
  return present(value) ? [{ label, value: String(value) }] : [];
}

function bytesLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${bytes.toLocaleString()} bytes`;
}

function elapsedLabel(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours ? `${hours}h` : "", minutes || hours ? `${minutes}m` : "", `${seconds}s`].filter(Boolean).join(" ");
}

function inputLabel(job: Job) {
  if (job.mode === "references") {
    const count = job.referenceIds?.length ?? job.inputAssetIds.length;
    return `${count} reference${count === 1 ? "" : "s"}`;
  }
  if (job.firstFrameId && job.lastFrameId) return "First and last frames";
  if (job.firstFrameId) return "First frame";
  if (job.lastFrameId) return "Last frame";
  return "Text only";
}

export function generationSettingSections(job: Job): GenerationSettingSection[] {
  const metadata = job.metadata;
  const profile = metadata?.sampling_profile ?? job.samplingProfile ?? (job.turbo ? "turbo_4" : "spectrum");
  const seed = metadata?.seed ?? job.seed ?? "random";
  const resolution = metadata?.resolution ?? job.resolution ?? "480p";
  const width = metadata?.width;
  const height = metadata?.height;
  const actualDuration = metadata?.duration_seconds;
  const audio = metadata?.audio;
  const batch = job.batchSize && job.batchSize > 1
    ? `${(job.batchIndex ?? 0) + 1} of ${job.batchSize}`
    : undefined;
  const generationTime = job.samplingStartedAt !== undefined
    && job.finishedAt !== undefined
    && job.finishedAt >= job.samplingStartedAt
    ? `${elapsedLabel(job.finishedAt - job.samplingStartedAt)} · sampling → ${job.status === "completed" ? "video ready" : "stopped"}`
    : undefined;

  const overview: GenerationSetting[] = [
    ...item("Generation ID", job.id),
    ...item("Status", job.status),
    ...item("Created", new Date(job.createdAt).toLocaleString()),
    ...item("Generation time", generationTime),
    ...item("Mode", job.mode === "references" ? "Reference → video" : "Text / frame → video"),
    ...item("Inputs", inputLabel(job)),
    ...item("Batch", batch),
  ];

  const output: GenerationSetting[] = [
    ...item("Requested duration", `${job.duration} seconds`),
    ...item("Actual duration", actualDuration === undefined ? undefined : `${actualDuration.toFixed(2)} seconds`),
    ...item("Aspect", job.aspect),
    ...item("Resolution", resolution),
    ...item("Output size", width && height ? `${width} × ${height}` : undefined),
    ...item("Frames", metadata?.frames),
    ...item("Frame rate", metadata?.fps === undefined ? undefined : `${metadata.fps} fps`),
    ...item("File size", metadata?.bytes === undefined ? undefined : bytesLabel(metadata.bytes)),
    ...item("Audio", audio ? `${audio.native ? "Native" : "External"} · ${(audio.sample_rate_hz / 1000).toFixed(audio.sample_rate_hz % 1000 ? 1 : 0)} kHz · ${audio.channels === 2 ? "Stereo" : `${audio.channels} channel${audio.channels === 1 ? "" : "s"}`}` : undefined),
  ];

  const sampling: GenerationSetting[] = [
    ...item("Profile", profileLabel(profile)),
    ...item("Seed", seed),
    ...item("Steps", metadata?.steps ?? profileSteps[profile]),
    ...item("Sampler", metadata?.sampler ?? "res_multistep"),
    ...item("Scheduler", metadata?.scheduler ?? "simple"),
    ...item("Turbo", (metadata?.turbo ?? job.turbo) ? "Enabled" : "Disabled"),
    ...item("Model", metadata?.model),
    ...item("Checkpoint", metadata?.checkpoint),
  ];

  const acceleration: GenerationSetting[] = [
    ...item("Turbo LoRA", metadata?.lora),
    ...item("Turbo LoRA strength", metadata?.lora_strength),
    ...item("Spectrum", metadata?.spectrum ? `v${metadata.spectrum.version}` : undefined),
    ...item("Spectrum offline replay", metadata?.spectrum ? (metadata.spectrum.offline_smoothing_replay ? "Enabled" : "Disabled") : undefined),
    ...item("Spectrum audio blend", metadata?.spectrum?.audio_blend_weight),
    ...(metadata?.loras ?? []).flatMap((lora) => item(lora.name, `${lora.strength} · ${lora.filename}`)),
    ...(!metadata?.loras && job.loras ? Object.entries(job.loras).flatMap(([id, strength]) => item(id, strength)) : []),
  ];

  return [
    { title: "Generation", items: overview },
    { title: "Output", items: output },
    { title: "Sampling", items: sampling },
    ...(acceleration.length ? [{ title: "Acceleration & LoRAs", items: acceleration }] : []),
    { title: "Prompt", items: [], text: job.prompt.trim() || "No prompt saved." },
  ];
}
