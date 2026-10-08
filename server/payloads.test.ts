import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildImageRequest, buildVideoRequest, ValidationError } from "./payloads";

const resolve = (id: string, kind: "image" | "video") => `data:${kind === "image" ? "image/png" : "video/mp4"};base64,${id}`;

describe("image requests", () => {
  const base = { prompt: "a fox", model: "grok-imagine-image-2.0", n: 2, aspectRatio: "16:9", resolution: "2k" };

  it("text-to-image hits /generations with b64 output", () => {
    const r = buildImageRequest({ ...base, quality: "medium", styleId: "noir" }, resolve);
    assert.equal(r.path, "/v1/images/generations");
    assert.deepEqual(r.body, {
      model: "grok-imagine-image-2.0",
      prompt: "a fox. Style: black and white film noir, hard shadows, venetian blind light, smoky atmosphere",
      n: 2,
      aspect_ratio: "16:9",
      resolution: "2k",
      response_format: "b64_json",
      quality: "medium",
    });
  });

  it("drops quality for models that don't support it and for auto", () => {
    assert.equal(buildImageRequest({ ...base, model: "grok-imagine-image", quality: "low" }, resolve).body.quality, undefined);
    assert.equal(buildImageRequest({ ...base, quality: "auto" }, resolve).body.quality, undefined);
  });

  it("one source image → /edits with `image`", () => {
    const r = buildImageRequest({ ...base, inputAssetIds: ["a"] }, resolve);
    assert.equal(r.path, "/v1/images/edits");
    assert.deepEqual(r.body.image, { url: "data:image/png;base64,a", type: "image_url" });
    assert.equal(r.body.images, undefined);
  });

  it("several source images → /edits with `images`", () => {
    const r = buildImageRequest({ ...base, inputAssetIds: ["a", "b"] }, resolve);
    assert.equal((r.body.images as unknown[]).length, 2);
    assert.equal(r.body.image, undefined);
    assert.deepEqual(r.inputAssetIds, ["a", "b"]);
  });

  it("rejects bad input", () => {
    assert.throws(() => buildImageRequest({ ...base, prompt: " " }, resolve), ValidationError);
    assert.throws(() => buildImageRequest({ ...base, n: 11 }, resolve), ValidationError);
    assert.throws(() => buildImageRequest({ ...base, aspectRatio: "7:5" }, resolve), ValidationError);
    assert.throws(() => buildImageRequest({ ...base, inputAssetIds: ["1", "2", "3", "4", "5", "6"] }, resolve), ValidationError);
  });
});

describe("video requests", () => {
  const v15 = "grok-imagine-video-1.5";

  it("text-to-video with camera + effect presets", () => {
    const r = buildVideoRequest(
      { mode: "text", prompt: "a lighthouse", model: v15, duration: 10, aspectRatio: "9:16", resolution: "1080p", audio: false, cameraId: "dolly-in", effectId: "rain" },
      resolve,
    );
    assert.equal(r.path, "/v1/videos/generations");
    assert.equal(r.body.duration, 10);
    assert.equal(r.body.aspect_ratio, "9:16");
    assert.equal(r.body.resolution, "1080p");
    assert.equal(r.body.generate_audio, false);
    assert.match(String(r.body.prompt), /^a lighthouse Heavy rain .* Camera: smooth slow dolly in/);
  });

  it("image-to-video omits aspect_ratio and sends image.url", () => {
    const r = buildVideoRequest({ mode: "image", prompt: "", model: v15, imageAssetId: "img", aspectRatio: "16:9" }, resolve);
    assert.deepEqual(r.body.image, { url: "data:image/png;base64,img" });
    assert.equal(r.body.aspect_ratio, undefined);
    assert.equal(r.body.prompt, undefined);
    assert.equal(r.body.generate_audio, undefined);
  });

  it("frames: first/last/keyframes", () => {
    const r = buildVideoRequest(
      { mode: "frames", prompt: "", model: v15, duration: 6, imageAssetId: "a", lastFrameAssetId: "b", keyframes: [{ assetId: "k", t: 3 }] },
      resolve,
    );
    assert.deepEqual(r.body.last_frame, { url: "data:image/png;base64,b" });
    assert.deepEqual(r.body.keyframes, [{ image: { url: "data:image/png;base64,k" }, timestamp_s: 3 }]);
    assert.deepEqual(r.inputAssetIds, ["a", "b", "k"]);
  });

  it("frames: keyframes must be strictly inside the clip and ≥1/3s apart", () => {
    const req = { mode: "frames" as const, prompt: "", model: v15, duration: 6, lastFrameAssetId: "b" };
    assert.throws(() => buildVideoRequest({ ...req, keyframes: [{ assetId: "k", t: 6 }] }, resolve), ValidationError);
    assert.throws(() => buildVideoRequest({ ...req, keyframes: [{ assetId: "k", t: 2 }, { assetId: "j", t: 2.1 }] }, resolve), ValidationError);
    assert.throws(() => buildVideoRequest({ ...req, lastFrameAssetId: undefined }, resolve), /end frame or at least one keyframe/);
    assert.throws(() => buildVideoRequest({ ...req, resolution: "1080p" }, resolve), ValidationError);
  });

  it("reference: images + voices", () => {
    const r = buildVideoRequest(
      { mode: "reference", prompt: "<IMAGE_0> waves", model: v15, referenceAssetIds: ["r1", "r2"], voiceIds: ["Eve"], resolution: "720p" },
      resolve,
    );
    assert.deepEqual(r.body.reference_images, [{ url: "data:image/png;base64,r1" }, { url: "data:image/png;base64,r2" }]);
    assert.deepEqual(r.body.reference_audios, [{ voice_id: "eve" }]);
  });

  it("reference: enforces per-model limits", () => {
    const refs = Array.from({ length: 8 }, (_, i) => `r${i}`);
    assert.throws(() => buildVideoRequest({ mode: "reference", prompt: "x", model: "grok-imagine-video", referenceAssetIds: refs }, resolve), /at most 7/);
    assert.throws(() => buildVideoRequest({ mode: "reference", prompt: "x", model: "grok-imagine-video", referenceAssetIds: ["a"], voiceIds: ["eve"] }, resolve), /voice/);
    assert.throws(() => buildVideoRequest({ mode: "reference", prompt: "x", model: "grok-imagine-video", referenceAssetIds: ["a"], duration: 12 }, resolve), /1-10s/);
    assert.throws(() => buildVideoRequest({ mode: "reference", prompt: "x", model: v15, referenceAssetIds: ["a"], resolution: "1080p" }, resolve), ValidationError);
  });

  it("edit → /edits, no duration/aspect/resolution", () => {
    const r = buildVideoRequest({ mode: "edit", prompt: "make it night", model: "grok-imagine-video", videoAssetId: "v", duration: 5, aspectRatio: "1:1", resolution: "720p" }, resolve);
    assert.equal(r.path, "/v1/videos/edits");
    assert.deepEqual(r.body, { model: "grok-imagine-video", prompt: "make it night", video: { url: "data:video/mp4;base64,v" } });
  });

  it("extend → /extensions with 2-10s duration", () => {
    const r = buildVideoRequest({ mode: "extend", prompt: "she turns", model: "grok-imagine-video", videoAssetId: "v", duration: 6 }, resolve);
    assert.equal(r.path, "/v1/videos/extensions");
    assert.equal(r.body.duration, 6);
    assert.throws(() => buildVideoRequest({ mode: "extend", prompt: "x", model: "grok-imagine-video", videoAssetId: "v", duration: 12 }, resolve), /2-10s/);
  });

  it("rejects modes a model can't do", () => {
    assert.throws(() => buildVideoRequest({ mode: "edit", prompt: "x", model: v15, videoAssetId: "v" }, resolve), /does not support edit/);
    assert.throws(() => buildVideoRequest({ mode: "reference", prompt: "x", model: "grok-imagine-video-1.5-lite", referenceAssetIds: ["a"] }, resolve), ValidationError);
    assert.throws(() => buildVideoRequest({ mode: "text", prompt: "", model: v15 }, resolve), /Prompt is required/);
  });
});
