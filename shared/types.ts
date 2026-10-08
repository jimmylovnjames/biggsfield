export type MediaKind = "image" | "video";
export type JobStatus = "queued" | "running" | "done" | "failed";

export type VideoMode = "text" | "image" | "frames" | "reference" | "edit" | "extend";
export type ImageMode = "generate" | "edit";

export interface Asset {
  id: string;
  kind: MediaKind;
  source: "generated" | "upload";
  file: string;
  mime: string;
  jobId?: string;
  prompt?: string;
  /** Seconds, videos only. */
  duration?: number;
  favorite?: boolean;
  createdAt: number;
}

export interface ImageJobRequest {
  prompt: string;
  model: string;
  n: number;
  aspectRatio: string;
  resolution: string;
  quality?: string;
  styleId?: string;
  /** Source images. Present → /v1/images/edits, absent → /v1/images/generations. */
  inputAssetIds?: string[];
}

export interface KeyframeInput {
  assetId: string;
  t: number;
}

export interface VideoJobRequest {
  mode: VideoMode;
  prompt: string;
  model: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  audio?: boolean;
  cameraId?: string;
  effectId?: string;
  /** First frame (image / frames / reference modes). */
  imageAssetId?: string;
  lastFrameAssetId?: string;
  keyframes?: KeyframeInput[];
  referenceAssetIds?: string[];
  voiceIds?: string[];
  /** Source clip (edit / extend modes). */
  videoAssetId?: string;
}

export interface Job {
  id: string;
  kind: MediaKind;
  mode: ImageMode | VideoMode;
  status: JobStatus;
  /** 0-100 when xAI reports it. */
  progress?: number;
  prompt: string;
  /** Prompt actually sent, with style/camera/effect directions appended. */
  finalPrompt: string;
  model: string;
  request: ImageJobRequest | VideoJobRequest;
  inputAssetIds: string[];
  outputAssetIds: string[];
  xaiRequestId?: string;
  costUsd?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppStatus {
  hasKey: boolean;
  keySource: "env" | "settings" | null;
  mock: boolean;
  spendUsd: number;
  textModel: string;
}

export type ServerEvent =
  | { type: "job"; job: Job }
  | { type: "job-deleted"; id: string }
  | { type: "asset"; asset: Asset }
  | { type: "asset-deleted"; id: string }
  | { type: "status"; status: AppStatus };
