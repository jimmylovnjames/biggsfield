import { EventEmitter } from "node:events";
import type { AppStatus, Asset, ImageJobRequest, Job, ServerEvent, VideoJobRequest } from "../shared/types";
import { buildImageRequest, buildVideoRequest, ValidationError, type BuiltRequest, type ResolveMedia } from "./payloads";
import * as store from "./store";
import { apiKey, MOCK, TEXT_MODEL, ticksToUsd, xai, XaiError } from "./xai";

export const events = new EventEmitter();
events.setMaxListeners(100);
export const emit = (e: ServerEvent) => events.emit("event", e);

const POLL_MS = Number(process.env.XAI_POLL_MS ?? 4000);
const VIDEO_TIMEOUT_MS = 30 * 60_000;

const resolveMedia: ResolveMedia = (assetId, expect) => {
  const asset = store.getAsset(assetId);
  if (!asset) throw new ValidationError(`Input ${assetId} no longer exists`);
  if (asset.kind !== expect) throw new ValidationError(`Expected an ${expect} input, got ${asset.kind}`);
  return store.assetDataUrl(asset);
};

function change(id: string, patch: Partial<Job>) {
  const job = store.updateJob(id, patch);
  if (job) emit({ type: "job", job });
  return job;
}

function addOutput(job: Job, data: Buffer, extra: Partial<Asset> = {}) {
  const asset = store.saveAsset(data, { source: "generated", jobId: job.id, prompt: job.prompt, ...extra });
  emit({ type: "asset", asset });
  return asset;
}

function createJob(kind: Job["kind"], req: ImageJobRequest | VideoJobRequest, built: BuiltRequest): Job {
  const now = Date.now();
  const job = store.insertJob({
    id: store.newId(),
    kind,
    mode: kind === "image" ? (built.inputAssetIds.length ? "edit" : "generate") : (req as VideoJobRequest).mode,
    status: "queued",
    prompt: req.prompt ?? "",
    finalPrompt: built.finalPrompt,
    model: String(built.body.model),
    request: req,
    inputAssetIds: built.inputAssetIds,
    outputAssetIds: [],
    createdAt: now,
    updatedAt: now,
  });
  emit({ type: "job", job });
  return job;
}

function failJob(id: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[job ${id}] failed:`, message);
  change(id, { status: "failed", error: message, progress: undefined });
}

export function appStatus(): AppStatus {
  const { source } = apiKey();
  return { hasKey: MOCK || !!source, keySource: source, mock: MOCK, spendUsd: store.totalSpend(), textModel: TEXT_MODEL };
}

const emitStatus = () => emit({ type: "status", status: appStatus() });

async function downloadWithRetry(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await xai.download(url);
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// ---------------------------------------------------------------- images

export function submitImageJob(req: ImageJobRequest): Job {
  const built = buildImageRequest(req, resolveMedia);
  const job = createJob("image", req, built);
  void runImageJob(job.id, built);
  return job;
}

async function runImageJob(id: string, built: BuiltRequest) {
  change(id, { status: "running" });
  try {
    const res = await xai.post(built.path, built.body);
    const job = store.getJob(id);
    if (!job) return; // deleted while running
    const outputs: string[] = [];
    for (const item of res.data ?? []) {
      let bytes: Buffer | undefined;
      if (item.b64_json) bytes = Buffer.from(item.b64_json, "base64");
      else if (item.url) bytes = await downloadWithRetry(item.url);
      if (bytes) outputs.push(addOutput(job, bytes, { mime: item.mime_type ?? undefined }).id);
    }
    if (!outputs.length) throw new XaiError("No images returned (possibly filtered by moderation)");
    change(id, { status: "done", progress: 100, outputAssetIds: outputs, costUsd: ticksToUsd(res.usage?.cost_in_usd_ticks) });
    emitStatus();
  } catch (err) {
    failJob(id, err);
  }
}

// ---------------------------------------------------------------- videos

export function submitVideoJob(req: VideoJobRequest): Job {
  const built = buildVideoRequest(req, resolveMedia, (assetId) => store.getAsset(assetId)?.duration);
  const job = createJob("video", req, built);
  void startVideoJob(job.id, built);
  return job;
}

async function startVideoJob(id: string, built: BuiltRequest) {
  change(id, { status: "running", progress: 0 });
  try {
    const res = await xai.post(built.path, built.body);
    if (!res.request_id) throw new XaiError("xAI did not return a request_id");
    change(id, { xaiRequestId: res.request_id });
    await pollVideo(id);
  } catch (err) {
    failJob(id, err);
  }
}

async function pollVideo(id: string) {
  // Measured from when this poller started (not job creation) so a job resumed after downtime
  // always gets at least one status check and a finished render is still downloaded.
  const started = Date.now();
  let transientErrors = 0;
  for (;;) {
    const job = store.getJob(id);
    if (!job || job.status !== "running" || !job.xaiRequestId) return;

    let data: any;
    try {
      ({ json: data } = await xai.get(`/v1/videos/${encodeURIComponent(job.xaiRequestId)}`));
      transientErrors = 0;
    } catch (err) {
      const status = (err as XaiError).status;
      // Network blips and 5xx: keep polling a while. 4xx: give up.
      if ((status && status < 500 && status !== 429) || ++transientErrors > 10) throw err;
      await new Promise((r) => setTimeout(r, POLL_MS * 2));
      continue;
    }

    if (data.status === "done") {
      const video = data.video ?? {};
      if (video.respect_moderation === false || !video.url) {
        throw new XaiError("Blocked by xAI content moderation");
      }
      const bytes = await downloadWithRetry(video.url);
      const asset = addOutput(job, bytes, { mime: "video/mp4", duration: video.duration });
      change(id, {
        status: "done",
        progress: 100,
        outputAssetIds: [asset.id],
        costUsd: ticksToUsd(data.usage?.cost_in_usd_ticks),
        model: data.model ?? job.model,
      });
      emitStatus();
      return;
    }
    if (data.status === "failed" || data.status === "expired") {
      const e = data.error;
      throw new XaiError(e?.message ? `${e.message}${e.code ? ` (${e.code})` : ""}` : `Video generation ${data.status}`);
    }
    if (typeof data.progress === "number" && data.progress !== job.progress) change(id, { progress: data.progress });
    if (Date.now() - started > VIDEO_TIMEOUT_MS) throw new XaiError("Timed out waiting for xAI (30 min)");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** On boot: resume polling videos that were in flight; fail anything that never reached xAI. */
export function resumeJobs() {
  for (const job of store.listJobs()) {
    if (job.status !== "running" && job.status !== "queued") continue;
    if (job.kind === "video" && job.xaiRequestId) {
      console.log(`[jobs] resuming ${job.id} (${job.xaiRequestId})`);
      store.updateJob(job.id, { status: "running" });
      pollVideo(job.id).catch((err) => failJob(job.id, err));
    } else {
      store.updateJob(job.id, { status: "failed", error: "Interrupted by a server restart before xAI accepted it" });
    }
  }
}
