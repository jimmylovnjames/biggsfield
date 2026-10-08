import "./env";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { ServerEvent } from "../shared/types";
import { appStatus, emit, events, resumeJobs, submitImageJob, submitVideoJob } from "./jobs";
import { ValidationError } from "./payloads";
import * as store from "./store";
import { MOCK, TEXT_MODEL, xai, XaiError } from "./xai";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const PASSWORD = process.env.APP_PASSWORD ?? "";
const DIST = resolve("dist");
const MAX_IMAGE_UPLOAD = 20 * 1024 * 1024;
const MAX_VIDEO_UPLOAD = 100 * 1024 * 1024;

const app = express();
app.disable("x-powered-by");

// Optional shared password (HTTP basic auth, any username).
if (PASSWORD) {
  const expected = Buffer.from(PASSWORD);
  app.use((req, res, next) => {
    const header = req.headers.authorization ?? "";
    const given = Buffer.from(header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString().split(":").slice(1).join(":") : "");
    const ok = given.length === expected.length && timingSafeEqual(given, expected);
    if (ok) return next();
    res.set("WWW-Authenticate", 'Basic realm="Biggsfield"').status(401).send("Authentication required");
  });
}

const json = express.json({ limit: "1mb" });
const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

// ---- status & settings

app.get("/api/status", (_req, res) => {
  res.json(appStatus());
});

app.put(
  "/api/settings",
  json,
  wrap((req, res) => {
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (process.env.XAI_API_KEY) throw new ValidationError("XAI_API_KEY is set in the environment and takes precedence");
    store.saveSettings({ ...store.getSettings(), apiKey: apiKey || undefined });
    const status = appStatus();
    emit({ type: "status", status });
    res.json(status);
  }),
);

// ---- live updates (SSE)

app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  const send = (e: ServerEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  events.on("event", send);
  req.on("close", () => {
    clearInterval(ping);
    events.off("event", send);
  });
});

// ---- jobs

app.get("/api/jobs", (_req, res) => {
  res.json(store.listJobs());
});

app.post("/api/jobs/image", json, wrap((req, res) => res.status(202).json(submitImageJob(req.body))));
app.post("/api/jobs/video", json, wrap((req, res) => res.status(202).json(submitVideoJob(req.body))));

app.delete("/api/jobs/:id", (req, res) => {
  const job = store.getJob(String(req.params.id));
  if (!job) return void res.status(404).json({ error: "Not found" });
  if (req.query.outputs === "1") {
    for (const assetId of job.outputAssetIds) {
      store.deleteAsset(assetId);
      emit({ type: "asset-deleted", id: assetId });
    }
  }
  store.deleteJob(job.id);
  emit({ type: "job-deleted", id: job.id });
  emit({ type: "status", status: appStatus() });
  res.status(204).end();
});

// ---- assets

app.get("/api/assets", (_req, res) => {
  res.json(store.listAssets());
});

app.post(
  "/api/uploads",
  express.raw({ type: () => true, limit: MAX_VIDEO_UPLOAD }),
  wrap((req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new ValidationError("Empty upload");
    const mime = store.sniffMime(body);
    if (!mime) throw new ValidationError("Unsupported file. Use JPEG, PNG, WebP or MP4.");
    if (mime.startsWith("image/") && body.length > MAX_IMAGE_UPLOAD) throw new ValidationError("Images must be under 20 MiB");
    const duration = Number(req.query.duration);
    const asset = store.saveAsset(body, {
      source: "upload",
      prompt: typeof req.query.name === "string" ? req.query.name.slice(0, 200) : undefined,
      duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    });
    emit({ type: "asset", asset });
    res.status(201).json(asset);
  }),
);

app.patch(
  "/api/assets/:id",
  json,
  wrap((req, res) => {
    const patch: { favorite?: boolean } = {};
    if (typeof req.body?.favorite === "boolean") patch.favorite = req.body.favorite;
    const asset = store.updateAsset(String(req.params.id), patch);
    if (!asset) return void res.status(404).json({ error: "Not found" });
    emit({ type: "asset", asset });
    res.json(asset);
  }),
);

app.delete("/api/assets/:id", (req, res) => {
  const id = String(req.params.id);
  store.deleteAsset(id);
  emit({ type: "asset-deleted", id });
  res.status(204).end();
});

// ---- prompt enhancer (Grok text model)

const ENHANCE_SYSTEM = {
  image:
    "You rewrite prompts for an AI image generator. Keep the user's subject and intent. Add concrete detail: composition, lens, lighting, palette, texture, mood. One paragraph, under 90 words. Output only the prompt.",
  video:
    "You rewrite prompts for an AI video generator. Keep the user's subject and intent. Describe the subject, the action as it unfolds over time, the setting, lighting, camera framing and movement, and ambient sound. Keep any <IMAGE_n> or <AUDIO_n> tags exactly. One paragraph, under 120 words. Output only the prompt.",
};

app.post(
  "/api/enhance",
  json,
  wrap(async (req, res) => {
    const prompt = String(req.body?.prompt ?? "").trim();
    const kind = req.body?.kind === "video" ? "video" : "image";
    if (!prompt) throw new ValidationError("Write a prompt first");
    const out = await xai.post("/v1/chat/completions", {
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: ENHANCE_SYSTEM[kind] },
        { role: "user", content: `Prompt: ${prompt}` },
      ],
    });
    const text = String(out?.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
    if (!text) throw new XaiError("Empty response from the text model");
    res.json({ prompt: text });
  }),
);

// ---- media + SPA

app.use("/media", express.static(store.MEDIA_DIR, { immutable: true, maxAge: "365d", fallthrough: false }));

if (existsSync(DIST)) {
  app.use(express.static(DIST, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(join(DIST, "index.html"));
  });
}

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as Error & { status?: number; type?: string };
  if (e instanceof ValidationError) return void res.status(400).json({ error: e.message });
  if (e instanceof XaiError) return void res.status(502).json({ error: e.message });
  if (e.type === "entity.too.large") return void res.status(413).json({ error: "File too large" });
  if (e.status === 404) return void res.status(404).json({ error: "Not found" });
  console.error(err);
  res.status(500).json({ error: e.message ?? "Internal error" });
});

resumeJobs();

const shutdown = () => {
  store.flushNow();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(PORT, HOST, () => {
  const local = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";
  console.log(`Biggsfield API on http://${HOST}:${PORT}${MOCK ? "  [MOCK MODE: no xAI calls, no cost]" : ""}`);
  console.log(`Data dir: ${store.DATA_DIR}`);
  if (existsSync(DIST)) console.log(`Serving UI from ${DIST}`);
  if (!local && !PASSWORD) {
    console.warn("WARNING: listening on a non-loopback address without APP_PASSWORD. Anyone who can reach this port can spend your xAI credits.");
  }
});
