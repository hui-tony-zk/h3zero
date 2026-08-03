import type { JSONContent } from "@tiptap/core";

export type GenerationMode = "frames" | "references";
export type AspectId = "9:16" | "16:9";
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
  order: "newest_to_oldest";
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

export interface H3Specs {
  version: "1.0";
  modes: {
    frames: FramesModeSpec;
    references: ReferencesModeSpec;
  };
  output: {
    duration: {
      default_seconds: number;
      options: Array<{ requested_seconds: number; frames: number; actual_seconds: number }>;
    };
    geometry: {
      multiple: number;
      base_short_edge: number;
      max_pixels: number;
      native_aspects: Array<{ id: AspectId; width: number; height: number }>;
    };
  };
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "expired" | "cancelled";

export interface GenerationMetadata {
  model?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  frames?: number;
  fps?: number;
  seed?: number;
  steps?: number;
  sampler?: string;
  scheduler?: string;
}

export interface JobProgress {
  phase: string;
  message: string;
  updatedAt: number;
  percent?: number;
}

export interface Job {
  id: string;
  mode: GenerationMode;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  duration: number;
  aspect: AspectId;
  displayAspect?: number;
  inputAssetIds: string[];
  firstFrameId?: string;
  lastFrameId?: string;
  referenceIds?: string[];
  contentUrl: string;
  error?: string;
  metadata?: GenerationMetadata;
  progress?: JobProgress;
}

export interface JobCreateResponse {
  id: string;
  status: JobStatus;
}

export interface JobStatusResponse extends JobCreateResponse {
  error?: string;
  metadata?: GenerationMetadata;
  videoUrl?: string;
  progress?: JobProgress;
}
