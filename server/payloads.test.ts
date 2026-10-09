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

describe("live-API guards", () => {
  const v15 = "grok-imagine-video-1.5";

  it("rejects prompts over 4096 UTF-8 bytes, presets included", () => {
    const ascii = "a".repeat(4000);
    assert.doesNotThrow(() => buildVideoRequest({ mode: "text", prompt: ascii, model: v15 }, resolve));
    assert.throws(() => buildVideoRequest({ mode: "text", prompt: ascii, model: v15, cameraId: "dolly-zoom", effectId: "disintegrate" }, resolve), /bytes/);
    assert.throws(() => buildVideoRequest({ mode: "text", prompt: "灯".repeat(1400), model: v15 }, resolve), /4200\/4096 bytes/);
  });

  it("reference tags must point at attached media; a pinned start frame owns <IMAGE_0>", () => {
    const base = { mode: "reference" as const, model: v15, referenceAssetIds: ["r1", "r2"] };
    assert.doesNotThrow(() => buildVideoRequest({ ...base, prompt: "<IMAGE_0> hands <IMAGE_1> a cup" }, resolve));
    assert.throws(() => buildVideoRequest({ ...base, prompt: "<IMAGE_2> waves" }, resolve), /<IMAGE_2>.*only 2 images/);
    assert.doesNotThrow(() => buildVideoRequest({ ...base, imageAssetId: "s", prompt: "open on <IMAGE_0>; <IMAGE_2> waves" }, resolve));
    assert.throws(() => buildVideoRequest({ ...base, prompt: "<IMAGE_0> says hi with <AUDIO_0>" }, resolve), /<AUDIO_0>/);
    assert.doesNotThrow(() => buildVideoRequest({ ...base, voiceIds: ["eve"], prompt: "<IMAGE_0> says hi with <AUDIO_0>" }, resolve));
  });

  it("checks edit/extend source length when the duration is known", () => {
    const dur = (d: number) => () => d;
    const edit = { mode: "edit" as const, prompt: "night", model: "grok-imagine-video", videoAssetId: "v" };
    assert.doesNotThrow(() => buildVideoRequest(edit, resolve, dur(8.74)));
    assert.throws(() => buildVideoRequest(edit, resolve, dur(10)), /≤ 8.7s/);
    const extend = { mode: "extend" as const, prompt: "more", model: "grok-imagine-video", videoAssetId: "v", duration: 4 };
    assert.throws(() => buildVideoRequest(extend, resolve, dur(1.5)), /2-15s/);
    assert.throws(() => buildVideoRequest(extend, resolve, dur(16)), /2-15s/);
    assert.doesNotThrow(() => buildVideoRequest(extend, resolve, dur(15.04)));
    assert.doesNotThrow(() => buildVideoRequest(extend, resolve)); // unknown duration: let xAI decide
  });
});

describe("mp4Duration", () => {
  const box = (type: string, payload: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length);
    head.write(type, 4, "ascii");
    return Buffer.concat([head, payload]);
  };
  const mvhd = (version: 0 | 1, timescale: number, duration: number) => {
    const p = Buffer.alloc(version ? 32 : 20);
    p[0] = version;
    if (version) {
      p.writeUInt32BE(timescale, 20);
      p.writeBigUInt64BE(BigInt(duration), 24);
    } else {
      p.writeUInt32BE(timescale, 12);
      p.writeUInt32BE(duration, 16);
    }
    return box("mvhd", p);
  };

  it("reads v0 and v1 mvhd, with moov after mdat", async () => {
    const { mp4Duration } = await import("./store");
    const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isom"));
    assert.equal(mp4Duration(Buffer.concat([ftyp, box("mdat", Buffer.alloc(64)), box("moov", mvhd(0, 1000, 4042))])), 4.042);
    assert.equal(mp4Duration(Buffer.concat([ftyp, box("moov", mvhd(1, 24000, 98000))])), 4.083);
    assert.equal(mp4Duration(Buffer.concat([ftyp, box("mdat", Buffer.alloc(8))])), undefined);
    assert.equal(mp4Duration(Buffer.from("garbage")), undefined);
  });
});
