import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Asset, Job } from "../shared/types";

export const DATA_DIR = resolve(process.env.DATA_DIR ?? "data");
export const MEDIA_DIR = join(DATA_DIR, "media");
const DB_FILE = join(DATA_DIR, "db.json");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

mkdirSync(MEDIA_DIR, { recursive: true });

interface Db {
  jobs: Job[];
  assets: Asset[];
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    console.error(`Could not parse ${file}; starting fresh (old file kept as .corrupt)`, err);
    renameSync(file, `${file}.corrupt`);
    return fallback;
  }
}

function writeJsonAtomic(file: string, data: unknown, mode = 0o644) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  renameSync(tmp, file);
}

const db: Db = readJson<Db>(DB_FILE, { jobs: [], assets: [] });

let flushTimer: NodeJS.Timeout | undefined;
function persist() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => writeJsonAtomic(DB_FILE, db), 150);
}
export function flushNow() {
  clearTimeout(flushTimer);
  writeJsonAtomic(DB_FILE, db);
}

export const newId = () => randomUUID().replace(/-/g, "").slice(0, 16);

// ---- jobs ----

export const listJobs = () => [...db.jobs].sort((a, b) => b.createdAt - a.createdAt);
export const getJob = (id: string) => db.jobs.find((j) => j.id === id);

export function insertJob(job: Job) {
  db.jobs.push(job);
  persist();
  return job;
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const job = getJob(id);
  if (!job) return undefined;
  Object.assign(job, patch, { updatedAt: Date.now() });
  persist();
  return job;
}

export function deleteJob(id: string) {
  db.jobs = db.jobs.filter((j) => j.id !== id);
  persist();
}

export const totalSpend = () => db.jobs.reduce((sum, j) => sum + (j.costUsd ?? 0), 0);

// ---- assets ----

export const listAssets = () => [...db.assets].sort((a, b) => b.createdAt - a.createdAt);
export const getAsset = (id: string) => db.assets.find((a) => a.id === id);

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

export function sniffMime(buf: Buffer): string | undefined {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  return undefined;
}

/** Duration in seconds from the MP4 `moov/mvhd` box; undefined if it can't be found. */
export function mp4Duration(buf: Buffer): number | undefined {
  const findBox = (start: number, end: number, type: string): [number, number] | undefined => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = buf.readUInt32BE(pos);
      let header = 8;
      if (size === 1) {
        if (pos + 16 > end) return undefined;
        size = Number(buf.readBigUInt64BE(pos + 8));
        header = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < header || pos + size > end) return undefined;
      if (buf.toString("ascii", pos + 4, pos + 8) === type) return [pos + header, pos + size];
      pos += size;
    }
    return undefined;
  };
  try {
    const moov = findBox(0, buf.length, "moov");
    const mvhd = moov && findBox(moov[0], moov[1], "mvhd");
    if (!mvhd) return undefined;
    const p = mvhd[0];
    const v1 = buf[p] === 1;
    const timescale = buf.readUInt32BE(p + (v1 ? 20 : 12));
    const duration = v1 ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
    return timescale > 0 && duration > 0 ? Math.round((duration / timescale) * 1000) / 1000 : undefined;
  } catch {
    return undefined;
  }
}

export function saveAsset(data: Buffer, meta: Omit<Asset, "id" | "file" | "mime" | "kind" | "createdAt"> & { mime?: string }): Asset {
  const mime = sniffMime(data) ?? meta.mime;
  if (!mime || !EXT[mime]) throw new Error(`Unsupported media type${mime ? ` ${mime}` : ""}; use JPEG, PNG, WebP or MP4`);
  const id = newId();
  const file = `${id}.${EXT[mime]}`;
  writeFileSync(join(MEDIA_DIR, file), data);
  // For video, trust the container over whatever the caller reported (xAI reports only the
  // added seconds for extensions; browsers can't always read uploaded metadata).
  const duration = mime === "video/mp4" ? (mp4Duration(data) ?? meta.duration) : meta.duration;
  const asset: Asset = {
    ...meta,
    duration,
    id,
    file,
    mime,
    kind: mime.startsWith("video/") ? "video" : "image",
    createdAt: Date.now(),
  };
  db.assets.push(asset);
  persist();
  return asset;
}

export function updateAsset(id: string, patch: Partial<Pick<Asset, "favorite" | "duration">>) {
  const asset = getAsset(id);
  if (!asset) return undefined;
  Object.assign(asset, patch);
  persist();
  return asset;
}

export function deleteAsset(id: string) {
  const asset = getAsset(id);
  if (!asset) return;
  db.assets = db.assets.filter((a) => a.id !== id);
  try {
    unlinkSync(join(MEDIA_DIR, asset.file));
  } catch {
    // already gone
  }
  persist();
}

export function assetDataUrl(asset: Asset): string {
  return `data:${asset.mime};base64,${readFileSync(join(MEDIA_DIR, asset.file)).toString("base64")}`;
}

// ---- settings (API key entered in the UI) ----

interface Settings {
  apiKey?: string;
}

let settings: Settings = readJson<Settings>(SETTINGS_FILE, {});

export const getSettings = () => settings;

export function saveSettings(next: Settings) {
  settings = next;
  // Holds the API key: owner-only permissions.
  writeJsonAtomic(SETTINGS_FILE, settings, 0o600);
}
