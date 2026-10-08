// Pure request-body builders for the xAI Imagine REST API.
// Field names follow https://docs.x.ai/developers/rest-api-reference/inference/{images,videos}.
import {
  composeImagePrompt,
  composeVideoPrompt,
  imageModel,
  IMAGE_ASPECTS,
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  MAX_IMAGE_INPUTS,
  VIDEO_ASPECTS,
  VIDEO_LIMITS,
  videoModel,
} from "../shared/catalog";
import type { ImageJobRequest, VideoJobRequest } from "../shared/types";

export class ValidationError extends Error {}

const fail = (msg: string): never => {
  throw new ValidationError(msg);
};

/** Turns an asset id into something xAI accepts (a data URL). Injected so builders stay pure. */
export type ResolveMedia = (assetId: string, expect: "image" | "video") => string;

export interface BuiltRequest {
  path: string;
  body: Record<string, unknown>;
  finalPrompt: string;
  inputAssetIds: string[];
}

export function buildImageRequest(req: ImageJobRequest, resolve: ResolveMedia): BuiltRequest {
  const model = imageModel(req.model) ?? fail(`Unknown image model: ${req.model}`);
  const inputs = req.inputAssetIds ?? [];
  if (inputs.length > MAX_IMAGE_INPUTS) fail(`At most ${MAX_IMAGE_INPUTS} source images`);
  const n = Math.round(Number(req.n) || 1);
  if (n < 1 || n > 10) fail("Image count must be 1-10");
  if (!IMAGE_ASPECTS.includes(req.aspectRatio)) fail(`Unsupported aspect ratio ${req.aspectRatio}`);
  if (!IMAGE_RESOLUTIONS.includes(req.resolution)) fail(`Unsupported resolution ${req.resolution}`);

  const finalPrompt = composeImagePrompt(req.prompt ?? "", req.styleId);
  if (!finalPrompt) fail("Prompt is required");

  const body: Record<string, unknown> = {
    model: model.id,
    prompt: finalPrompt,
    n,
    aspect_ratio: req.aspectRatio,
    resolution: req.resolution,
    response_format: "b64_json",
  };
  if (model.supportsQuality && req.quality && req.quality !== "auto") {
    if (!IMAGE_QUALITIES.includes(req.quality)) fail(`Unsupported quality ${req.quality}`);
    body.quality = req.quality;
  }

  if (inputs.length === 0) {
    return { path: "/v1/images/generations", body, finalPrompt, inputAssetIds: [] };
  }
  const images = inputs.map((id) => ({ url: resolve(id, "image"), type: "image_url" }));
  if (images.length === 1) body.image = images[0];
  else body.images = images;
  return { path: "/v1/images/edits", body, finalPrompt, inputAssetIds: inputs };
}

export function buildVideoRequest(req: VideoJobRequest, resolve: ResolveMedia): BuiltRequest {
  const model = videoModel(req.model) ?? fail(`Unknown video model: ${req.model}`);
  if (!model.modes.includes(req.mode)) fail(`${model.label} does not support ${req.mode} mode`);

  const finalPrompt = composeVideoPrompt(req.prompt ?? "", req.cameraId, req.effectId);
  const body: Record<string, unknown> = { model: model.id };
  if (finalPrompt) body.prompt = finalPrompt;
  const inputAssetIds: string[] = [];
  const media = (id: string | undefined, kind: "image" | "video", label: string) => {
    if (!id) fail(`${label} is required`);
    inputAssetIds.push(id!);
    return { url: resolve(id!, kind) };
  };

  const duration = req.duration === undefined ? undefined : Math.round(Number(req.duration));
  const checkDuration = (min: number, max: number) => {
    if (duration === undefined) return;
    if (!Number.isFinite(duration) || duration < min || duration > max) fail(`Duration must be ${min}-${max}s`);
    body.duration = duration;
  };
  const checkAspect = () => {
    if (!req.aspectRatio) return;
    if (!VIDEO_ASPECTS.includes(req.aspectRatio)) fail(`Unsupported aspect ratio ${req.aspectRatio}`);
    body.aspect_ratio = req.aspectRatio;
  };
  const checkResolution = (allowed: string[]) => {
    if (!req.resolution) return;
    if (!allowed.includes(req.resolution)) fail(`${model.label} supports ${allowed.join(", ")} here, not ${req.resolution}`);
    body.resolution = req.resolution;
  };
  const audio = () => {
    if (req.audio === false) body.generate_audio = false;
  };

  switch (req.mode) {
    case "text": {
      if (!finalPrompt) fail("Prompt is required for text-to-video");
      checkDuration(VIDEO_LIMITS.minDuration, VIDEO_LIMITS.maxDuration);
      checkAspect();
      checkResolution(model.resolutions);
      audio();
      return { path: "/v1/videos/generations", body, finalPrompt, inputAssetIds };
    }
    case "image": {
      body.image = media(req.imageAssetId, "image", "Start image");
      // Output always matches the input image's aspect ratio; aspect_ratio is ignored, so omit it.
      checkDuration(VIDEO_LIMITS.minDuration, VIDEO_LIMITS.maxDuration);
      checkResolution(model.resolutions);
      audio();
      return { path: "/v1/videos/generations", body, finalPrompt, inputAssetIds };
    }
    case "frames": {
      if (req.imageAssetId) body.image = media(req.imageAssetId, "image", "Start frame");
      if (req.lastFrameAssetId) body.last_frame = media(req.lastFrameAssetId, "image", "End frame");
      const keyframes = req.keyframes ?? [];
      if (keyframes.length > VIDEO_LIMITS.maxKeyframes) fail(`At most ${VIDEO_LIMITS.maxKeyframes} keyframes`);
      if (!body.last_frame && keyframes.length === 0) fail("Add an end frame or at least one keyframe");
      checkDuration(VIDEO_LIMITS.minDuration, VIDEO_LIMITS.maxDuration);
      const clip = duration ?? VIDEO_LIMITS.defaultDuration;
      const slots = new Set<number>();
      if (keyframes.length) {
        body.keyframes = keyframes.map((k) => {
          const t = Number(k.t);
          if (!(t > 0 && t < clip)) fail(`Keyframe times must be strictly between 0 and ${clip}s`);
          const slot = Math.round(t * 3);
          if (slots.has(slot)) fail("Keyframes must be at least 1/3s apart");
          slots.add(slot);
          return { image: media(k.assetId, "image", "Keyframe image"), timestamp_s: t };
        });
      }
      checkAspect();
      // Pinned frames run as reference-to-video, which tops out below text/image-to-video.
      checkResolution(model.referenceResolutions);
      audio();
      return { path: "/v1/videos/generations", body, finalPrompt, inputAssetIds };
    }
    case "reference": {
      const refs = req.referenceAssetIds ?? [];
      const voices = (req.voiceIds ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean);
      if (refs.length > model.maxReferenceImages) fail(`${model.label} takes at most ${model.maxReferenceImages} reference images`);
      if (voices.length && !model.voices) fail(`${model.label} does not support voice references`);
      if (voices.length > VIDEO_LIMITS.maxVoices) fail(`At most ${VIDEO_LIMITS.maxVoices} voices`);
      if (voices.some((v) => !/^[a-z0-9_-]+$/.test(v))) fail("Invalid voice id");
      if (!refs.length && !voices.length) fail("Add at least one reference image or voice");
      if (!finalPrompt) fail("Prompt is required for reference-to-video");
      if (refs.length) body.reference_images = refs.map((id) => media(id, "image", "Reference image"));
      if (voices.length) body.reference_audios = voices.map((voice_id) => ({ voice_id }));
      if (req.imageAssetId) {
        if (model.id === "grok-imagine-video") fail("Imagine Video (classic) can't combine a start frame with references");
        body.image = media(req.imageAssetId, "image", "Start frame");
      }
      checkDuration(VIDEO_LIMITS.minDuration, model.referenceMaxDuration);
      checkAspect();
      checkResolution(model.referenceResolutions);
      audio();
      return { path: "/v1/videos/generations", body, finalPrompt, inputAssetIds };
    }
    case "edit": {
      if (!finalPrompt) fail("Describe the edit");
      body.video = media(req.videoAssetId, "video", "Source video");
      // duration / aspect_ratio / resolution are not supported for edits.
      return { path: "/v1/videos/edits", body, finalPrompt, inputAssetIds };
    }
    case "extend": {
      if (!finalPrompt) fail("Describe what happens next");
      body.video = media(req.videoAssetId, "video", "Source video");
      checkDuration(VIDEO_LIMITS.extendMin, VIDEO_LIMITS.extendMax);
      return { path: "/v1/videos/extensions", body, finalPrompt, inputAssetIds };
    }
    default:
      return fail(`Unknown mode ${(req as VideoJobRequest).mode}`);
  }
}
