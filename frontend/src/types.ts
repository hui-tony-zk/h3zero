import type { JSONContent } from "@tiptap/core";

export type GenerationMode = "frames" | "references";
export type AspectId = "9:16" | "16:9";
export type GenerationCount = 1 | 2 | 3;
export type SamplingProfileId = "turbo_4" | "turbo_8" | "spectrum" | "base";
export type SeedChoice = "random" | 42 | 106 | 99;
export type ResolutionId = "480p" | "768p";
export type MediaKind = "image" | "video" | "audio" | "file";
export type PromptDocument = JSONContent;

export interface MediaAsset {
  id: string;
  name: string;
  type: string;
  kind: MediaKind;
  size: number;
  file: File;
  previewUrl: string;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: number;
}

export interface BaseDraft {
  prompt: string;
  promptDocument: PromptDocument;
  duration: number;
  aspect: AspectId;
  generationCount: GenerationCount;
  samplingProfile?: SamplingProfileId;
  seed?: SeedChoice;
  resolution?: ResolutionId;
  turbo?: boolean;
  loras?: Record<string, number>;
}

export interface LoraConfig {
  id: string;
  name: string;
  filename: string;
  default_enabled: boolean;
  default_strength: number;
  min_strength: number;
  max_strength: number;
  step: number;
  prompt?: string | null;
  reference_url?: string | null;
}

export interface FramesDraft extends BaseDraft {
  mode: "frames";
  firstFrame: MediaAsset | null;
  lastFrame: MediaAsset | null;
}

export interface ReferencesDraft extends BaseDraft {
  mode: "references";
  references: MediaAsset[];
}

export type ComposerDraft = FramesDraft | ReferencesDraft;

export interface DraftCollection {
  frames: FramesDraft;
  references: ReferencesDraft;
}

export interface AttachmentTypeSpec {
  mime_types: string[];
  max_bytes_each: number;
  min_seconds_each?: number;
  max_seconds_each?: number;
  max_seconds_total?: number;
}

export interface FramesModeSpec {
  available: boolean;
  attachments: {
    mime_types: string[];
    max_bytes_each: number;
  };
}

export interface ReferencesModeSpec {
  available: boolean;
  order: "newest_to_oldest" | "upload_order";
  attachments: {
    max_sources: number;
    max_images: number;
    max_videos: number;
    max_audios: number;
    audio_may_not_be_sole_modality: boolean;
    image: AttachmentTypeSpec;
    video: AttachmentTypeSpec;
    audio: AttachmentTypeSpec;
  };
}

export interface SamplingProfile {
  label: string;
  method: string;
  lora: string | null;
  preview: boolean;
  steps: { default: number; min: number; max: number };
  sampler: string;
  scheduler: string;
  lora_strength: number | null;
  spectrum: boolean;
  turbo: boolean;
  low_vram: boolean | null;
}

export interface H3Specs {
  version: "1.7";
  modes: {
    frames: FramesModeSpec;
    references: ReferencesModeSpec;
  };
  output: {
    attention: { backend: "comfy_kitchen"; version: string; scope: "global" };
    loras: LoraConfig[];
    sampling: {
      default: SamplingProfileId;
      profiles: Record<SamplingProfileId, SamplingProfile>;
    };
    seed: {
      default: "random";
      options: Array<{ id: string; label: string; value: number | null }>;
    };
    duration: {
      default_seconds: number;
      options: Array<{ requested_seconds: number; frames: number; actual_seconds: number }>;
    };
    geometry: {
      multiple: number;
      base_short_edge: number;
      max_pixels: number;
      native_aspects: Array<{ id: AspectId; width: number; height: number }>;
      default_resolution: ResolutionId;
      resolutions: Record<ResolutionId, {
        label: string;
        short_edge: number;
        max_pixels: number;
        recommended: boolean;
        native_aspects: Array<{ id: AspectId; width: number; height: number }>;
      }>;
    };
  };
}

export type JobStatus = "uploading" | "queued" | "running" | "completed" | "failed" | "expired" | "cancelled";

export interface GenerationMetadata {
  mode?: GenerationMode;
  model?: string;
  checkpoint?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  frames?: number;
  fps?: number;
  seed?: number;
  steps?: number;
  sampler?: string;
  scheduler?: string;
  turbo?: boolean;
  sampling_profile?: SamplingProfileId;
  resolution?: ResolutionId;
  lora?: string;
  lora_strength?: number;
  lora_low_vram?: boolean;
  attention?: { backend: string; version: string };
  spectrum?: { version: string; offline_smoothing_replay: boolean; audio_blend_weight: number };
  loras?: Array<{ id: string; name: string; filename: string; strength: number }>;
  audio?: { native: boolean; sample_rate_hz: number; channels: number };
  references?: Array<{ id?: string; kind?: MediaKind; tags?: string[] }>;
  bytes?: number;
}

export interface JobProgress {
  phase: string;
  message: string;
  updatedAt: number;
  percent?: number;
}

export interface FavoriteAsset {
  id: string;
  name: string;
  type: string;
  kind: Exclude<MediaKind, "file">;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: number;
  role?: "firstFrame" | "lastFrame" | "reference";
}

export interface Job {
  id: string;
  mode: GenerationMode;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  samplingStartedAt?: number;
  status: JobStatus;
  duration: number;
  aspect: AspectId;
  turbo: boolean;
  samplingProfile?: SamplingProfileId;
  seed?: SeedChoice;
  resolution?: ResolutionId;
  loras?: Record<string, number>;
  displayAspect?: number;
  inputAssetIds: string[];
  firstFrameId?: string;
  lastFrameId?: string;
  referenceIds?: string[];
  contentUrl: string;
  error?: string;
  metadata?: GenerationMetadata;
  progress?: JobProgress;
  batchId?: string;
  batchIndex?: number;
  batchSize?: number;
  hearted?: boolean;
  favoriteAssets?: FavoriteAsset[];
}

export interface JobCreateResponse {
  id: string;
  status: JobStatus;
}

export interface JobStatusResponse extends JobCreateResponse {
  createdAt?: number;
  updatedAt?: number;
  samplingStartedAt?: number;
  error?: string;
  metadata?: GenerationMetadata;
  videoUrl?: string;
  progress?: JobProgress;
}

export type ProjectTransition = "fade-black" | "cut";

export interface ProjectClip {
  id: string;
  jobId: string;
  inPoint: number;
  outPoint: number;
  sourceDuration: number;
  playbackRate: number;
  transitionIn: ProjectTransition;
  order: number;
  createdAt: number;
}

export interface LocalProject {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspect: AspectId;
  clips: ProjectClip[];
}
