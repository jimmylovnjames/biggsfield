import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import { getSettings, newId } from "./store";

const BASE_URL = process.env.XAI_BASE_URL ?? "https://api.x.ai";
export const TEXT_MODEL = process.env.XAI_TEXT_MODEL ?? "grok-4.3";
/** reasoning_effort for the prompt enhancer; set XAI_TEXT_REASONING= (empty) to omit the field. */
export const TEXT_REASONING = process.env.XAI_TEXT_REASONING ?? "none";
export const MOCK = process.argv.includes("--mock") || process.env.XAI_MOCK === "1";

export class XaiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function apiKey(): { key?: string; source: "env" | "settings" | null } {
  if (process.env.XAI_API_KEY) return { key: process.env.XAI_API_KEY, source: "env" };
  const stored = getSettings().apiKey;
  return stored ? { key: stored, source: "settings" } : { source: null };
}

export interface XaiClient {
  post(path: string, body: Record<string, unknown>): Promise<any>;
  get(path: string): Promise<{ status: number; json: any }>;
  download(url: string): Promise<Buffer>;
}

function errorMessage(status: number, text: string): string {
  try {
    const j = JSON.parse(text);
    const msg = j?.error?.message ?? (typeof j?.error === "string" ? j.error : undefined) ?? j?.message ?? j?.detail;
    if (msg) return `${msg} (HTTP ${status})`;
  } catch {
    // not JSON
  }
  return `${text.slice(0, 300) || "Request failed"} (HTTP ${status})`;
}

const realClient: XaiClient = {
  async post(path, body) {
    const { key } = apiKey();
    if (!key) throw new XaiError("No xAI API key configured. Add one in Settings or set XAI_API_KEY.");
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    const text = await res.text();
    if (!res.ok) throw new XaiError(errorMessage(res.status, text), res.status);
    return JSON.parse(text);
  },
  async get(path) {
    const { key } = apiKey();
    if (!key) throw new XaiError("No xAI API key configured.");
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) throw new XaiError(errorMessage(res.status, text), res.status);
    return { status: res.status, json: JSON.parse(text) };
  },
  async download(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new XaiError(`Download failed (HTTP ${res.status})`, res.status);
    return Buffer.from(await res.arrayBuffer());
  },
};

// ---------------------------------------------------------------------------
// Mock client: same wire shapes as the real API, no network, no cost.
// Prompts containing "[fail]" fail, "[block]" trip moderation.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MOCK_VIDEO_MS = Number(process.env.MOCK_VIDEO_MS ?? 6000);
const mockVideos = new Map<string, { started: number; body: Record<string, unknown>; path: string }>();
const TICKS_PER_USD = 1e10;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function dims(aspect: unknown, long: number): [number, number] {
  const [a, b] = String(aspect ?? "16:9").split(":").map(Number);
  if (!a || !b) return [long, long];
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return a >= b ? [long, even((long * b) / a)] : [even((long * a) / b), long];
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** A small gradient-with-sun PNG whose colours derive from the prompt. */
export function mockPng(seed: string, aspect: unknown): Buffer {
  const [w, h] = dims(aspect === "auto" ? "1:1" : aspect, 512);
  const hv = hash(seed);
  const top = hsl(hv % 360, 0.65, 0.55);
  const bottom = hsl((hv >> 9) % 360, 0.7, 0.18);
  const sun = hsl((hv >> 17) % 360, 0.9, 0.7);
  const cx = w * (0.25 + ((hv >> 3) % 50) / 100);
  const cy = h * 0.42;
  const r = Math.min(w, h) * 0.18;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    const t = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const glow = Math.max(0, 1 - d / (r * 2.2)) ** 2;
      const inSun = d < r ? 1 : 0;
      for (let c = 0; c < 3; c++) {
        const base = top[c] * (1 - t) + bottom[c] * t;
        raw[row + 1 + x * 3 + c] = Math.min(255, inSun ? sun[c] : base + glow * (sun[c] - base) * 0.8);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function mockMp4(seconds: number, aspect: unknown): Promise<Buffer> {
  const [w, h] = dims(aspect, 320);
  const out = join(tmpdir(), `biggsfield-mock-${newId()}.mp4`);
  try {
    await promisify(execFile)("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=24:duration=${seconds}`,
      "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-c:a", "aac", "-shortest", out,
    ]);
    return await readFile(out);
  } catch (err) {
    throw new XaiError(`Mock video needs ffmpeg on PATH (${(err as Error).message.split("\n")[0]})`);
  } finally {
    await rm(out, { force: true });
  }
}

function mockGuard(body: Record<string, unknown>) {
  const prompt = String(body.prompt ?? "");
  if (prompt.includes("[fail]")) throw new XaiError("Mock failure requested by prompt (HTTP 400)", 400);
}

const mockClient: XaiClient = {
  async post(path, body) {
    mockGuard(body);
    if (process.env.MOCK_LOG) console.log("[mock xai] POST", path, JSON.stringify(body, (_k, v) => (typeof v === "string" && v.startsWith("data:") ? `${v.slice(0, 32)}…` : v)));
    if (path.startsWith("/v1/images/")) {
      await sleep(1200);
      const n = Number(body.n ?? 1);
      const data = Array.from({ length: n }, (_, i) => ({
        b64_json: mockPng(`${body.prompt}#${i}#${Date.now()}`, body.aspect_ratio).toString("base64"),
        mime_type: "image/png",
      }));
      const price = body.model === "grok-imagine-image" ? 0.02 : body.model === "grok-imagine-image-quality" ? 0.05 : 0.04;
      const inputs = body.images ? (body.images as unknown[]).length : body.image ? 1 : 0;
      return { data, usage: { cost_in_usd_ticks: Math.round((n * price + inputs * 0.01) * TICKS_PER_USD) } };
    }
    if (path.startsWith("/v1/videos/")) {
      const request_id = `mock-${newId()}`;
      mockVideos.set(request_id, { started: Date.now(), body, path });
      return { request_id };
    }
    if (path === "/v1/chat/completions") {
      const messages = body.messages as { content: string }[];
      const user = messages[messages.length - 1].content.replace(/^[\s\S]*?Prompt:\s*/, "");
      return { choices: [{ message: { content: `${user.trim()}, golden-hour rim light, rich atmospheric depth, crisp detail` } }] };
    }
    throw new XaiError(`Mock has no route for ${path}`, 404);
  },
  async get(path) {
    const id = path.split("/").pop()!;
    const job = mockVideos.get(id);
    if (!job) throw new XaiError("Request not found (HTTP 404)", 404);
    const elapsed = Date.now() - job.started;
    if (elapsed < MOCK_VIDEO_MS) return { status: 202, json: { status: "pending", progress: Math.floor((elapsed / MOCK_VIDEO_MS) * 99) } };
    const prompt = String(job.body.prompt ?? "");
    if (prompt.includes("[block]")) {
      return { status: 200, json: { status: "done", video: { url: null, duration: 0, respect_moderation: false }, model: job.body.model } };
    }
    // Like the real API: an extension reports only the added seconds, but the file is source + extension.
    const sourceSecs = job.path.endsWith("/extensions") || job.path.endsWith("/edits") ? 6 : 0;
    const duration = job.path.endsWith("/extensions") ? Number(job.body.duration ?? 6) : job.path.endsWith("/edits") ? sourceSecs : Number(job.body.duration ?? 8);
    const fileSecs = job.path.endsWith("/extensions") ? sourceSecs + duration : duration;
    const rate = job.body.model === "grok-imagine-video-1.5" ? 0.08 : job.body.model === "grok-imagine-video-1.5-lite" ? 0.02 : 0.05;
    const inputImages = (job.body.image ? 1 : 0) + (job.body.last_frame ? 1 : 0) + ((job.body.keyframes as unknown[])?.length ?? 0) + ((job.body.reference_images as unknown[])?.length ?? 0);
    const cost = duration * rate + inputImages * 0.01 + sourceSecs * 0.01;
    return {
      status: 200,
      json: {
        status: "done",
        progress: 100,
        model: job.body.model,
        video: { url: `mock://${id}?d=${fileSecs}&a=${job.body.aspect_ratio ?? "16:9"}`, duration, respect_moderation: true },
        usage: { cost_in_usd_ticks: Math.round(cost * TICKS_PER_USD) },
      },
    };
  },
  async download(url) {
    const u = new URL(url);
    return mockMp4(Math.min(Number(u.searchParams.get("d")) || 4, 15), u.searchParams.get("a"));
  },
};

export const xai: XaiClient = MOCK ? mockClient : realClient;

export const ticksToUsd = (ticks: unknown) => (typeof ticks === "number" ? ticks / TICKS_PER_USD : undefined);
