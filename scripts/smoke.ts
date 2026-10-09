// Live end-to-end check against a running Biggsfield server (and therefore the real xAI API,
// unless the server was started with --mock). Uses the cheapest settings that still exercise
// every request shape.
//
//   npm start                     # in one terminal, with XAI_API_KEY set
//   npm run smoke                 # ~$0.10: enhance, image, image edit, image→video (Lite)
//   npm run smoke -- --full       # ~$0.95: adds text/frames+keyframe/reference+voice (1.5), multi-image edit, edit + extend (classic)
//
// Flags: --base http://127.0.0.1:8787   --max-usd 1.5   --user name:password (if APP_PASSWORD is set)
import type { AppStatus, Asset, ImageJobRequest, Job, VideoJobRequest } from "../shared/types";
import { imageModel, videoModel } from "../shared/catalog";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = opt("base", "http://127.0.0.1:8787").replace(/\/$/, "");
const FULL = flag("full");
const MAX_USD = Number(opt("max-usd", "1.5"));
const USER = opt("user", "");
const headers: Record<string, string> = USER ? { Authorization: `Basic ${Buffer.from(USER).toString("base64")}` } : {};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}
const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

interface Step {
  name: string;
  estimate: number;
  run: () => Promise<{ cost?: number; note?: string; outputs?: Asset[] }>;
}

const results: { name: string; ok: boolean; secs: number; cost?: number; note?: string }[] = [];

async function waitForJob(id: string, timeoutMs = 15 * 60_000): Promise<Job> {
  const started = Date.now();
  let lastProgress = -1;
  for (;;) {
    const job = (await call<Job[]>("/api/jobs")).find((j) => j.id === id);
    if (!job) throw new Error("job disappeared");
    if (job.status === "done") return job;
    if (job.status === "failed") throw new Error(job.error ?? "failed");
    if (job.progress !== undefined && job.progress !== lastProgress) {
      lastProgress = job.progress;
      process.stdout.write(`    … ${job.mode} · ${job.model} · ${job.progress}%\n`);
    }
    if (Date.now() - started > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function outputsOf(job: Job): Promise<Asset[]> {
  const assets = await call<Asset[]>("/api/assets");
  return job.outputAssetIds.map((id) => assets.find((a) => a.id === id)!).filter(Boolean);
}

async function checkMedia(asset: Asset) {
  const res = await fetch(`${BASE}/media/${asset.file}`, { headers });
  if (!res.ok) throw new Error(`media ${asset.file} → HTTP ${res.status}`);
  const bytes = (await res.arrayBuffer()).byteLength;
  if (bytes < 1000) throw new Error(`media ${asset.file} suspiciously small (${bytes} B)`);
  return bytes;
}

async function image(req: ImageJobRequest) {
  const job = await waitForJob((await post<Job>("/api/jobs/image", req)).id);
  const outputs = await outputsOf(job);
  if (outputs.length !== req.n) throw new Error(`expected ${req.n} image(s), got ${outputs.length}`);
  const sizes = await Promise.all(outputs.map(checkMedia));
  return { cost: job.costUsd, outputs, note: `${outputs.map((o) => o.mime).join(",")} ${sizes.map((s) => `${Math.round(s / 1024)}KB`).join(",")}` };
}

async function video(req: VideoJobRequest) {
  const job = await waitForJob((await post<Job>("/api/jobs/video", req)).id);
  const [out] = await outputsOf(job);
  if (!out || out.kind !== "video") throw new Error("no video output");
  const bytes = await checkMedia(out);
  return { cost: job.costUsd, outputs: [out], note: `${out.duration ?? "?"}s, ${Math.round(bytes / 1024)}KB, model ${job.model}` };
}

async function runStep(step: Step) {
  const t0 = Date.now();
  console.log(`▶ ${step.name}`);
  try {
    const r = await step.run();
    results.push({ name: step.name, ok: true, secs: (Date.now() - t0) / 1000, cost: r.cost, note: r.note });
    console.log(`  ✓ ${r.note ?? ""}${r.cost !== undefined ? ` · $${r.cost.toFixed(3)}` : ""}`);
    return r;
  } catch (err) {
    results.push({ name: step.name, ok: false, secs: (Date.now() - t0) / 1000, note: (err as Error).message });
    console.log(`  ✗ ${(err as Error).message}`);
    return undefined;
  }
}

const img = (n: number, model = "grok-imagine-image") => imageModel(model)!.pricePerImage * n;
const vid = (secs: number, model: string) => videoModel(model)!.pricePerSecond * secs;
const LITE = "grok-imagine-video-1.5-lite";
const V15 = "grok-imagine-video-1.5";
const CLASSIC = "grok-imagine-video";

const status = await call<AppStatus>("/api/status");
console.log(`Server ${BASE} · ${status.mock ? "MOCK MODE (no real xAI calls)" : "LIVE xAI"} · key: ${status.keySource ?? (status.mock ? "n/a" : "none")}`);
if (!status.hasKey) {
  console.error("No API key configured on the server. Set XAI_API_KEY or add one in Settings.");
  process.exit(2);
}

const estimate = img(1) + img(1, "grok-imagine-image-2.0") + vid(1, LITE) + (FULL ? vid(1, V15) + vid(2, V15) + vid(1, V15) + img(1, "grok-imagine-image-2.0") + vid(2, CLASSIC) + vid(2, CLASSIC) + vid(4, CLASSIC) : 0);
console.log(`Plan: ${FULL ? "full" : "quick"} · list-price estimate ~$${estimate.toFixed(2)} (cap $${MAX_USD})\n`);
if (estimate > MAX_USD) {
  console.error(`Estimate exceeds --max-usd ${MAX_USD}; aborting.`);
  process.exit(2);
}

await runStep({
  name: `enhance prompt (${status.textModel})`,
  estimate: 0,
  run: async () => {
    const { prompt } = await post<{ prompt: string }>("/api/enhance", { prompt: "a lighthouse in a storm", kind: "video" });
    if (prompt.length < 20) throw new Error(`too short: ${prompt}`);
    return { note: `"${prompt.slice(0, 70)}…"` };
  },
});

const base = await runStep({
  name: "text→image · grok-imagine-image · 1:1 1k ×1",
  estimate: img(1),
  run: () => image({ prompt: "a red paper boat on a still pond, overhead, soft morning light", model: "grok-imagine-image", n: 1, aspectRatio: "1:1", resolution: "1k" }),
});
const baseId = base?.outputs?.[0]?.id;

const edited = baseId
  ? await runStep({
      name: "image edit · grok-imagine-image-2.0 · 1 source",
      estimate: img(1, "grok-imagine-image-2.0"),
      run: () => image({ prompt: "Make the boat bright yellow. Keep everything else the same.", model: "grok-imagine-image-2.0", n: 1, aspectRatio: "auto", resolution: "1k", quality: "low", inputAssetIds: [baseId] }),
    })
  : undefined;

if (baseId) {
  await runStep({
    name: "image→video · 1.5 Lite · 1s 480p",
    estimate: vid(1, LITE),
    run: () => video({ mode: "image", prompt: "the boat drifts slowly, ripples spread", model: LITE, duration: 1, resolution: "480p", audio: false, imageAssetId: baseId }),
  });
}

if (FULL) {
  const editedId = edited?.outputs?.[0]?.id;
  const parallelSteps: Promise<unknown>[] = [
    runStep({
      name: "text→video · 1.5 · 1s 480p 16:9 silent + camera preset",
      estimate: vid(1, V15),
      run: () => video({ mode: "text", prompt: "a paper boat on a rain-soaked street", model: V15, duration: 1, aspectRatio: "16:9", resolution: "480p", audio: false, cameraId: "dolly-in" }),
    }),
  ];
  if (baseId) {
    parallelSteps.push(
      runStep({
        name: "frames · 1.5 · start=end (loop) + keyframe @1s · 2s 480p",
        estimate: vid(2, V15),
        run: () => video({ mode: "frames", prompt: "", model: V15, duration: 2, aspectRatio: "1:1", resolution: "480p", audio: false, imageAssetId: baseId, lastFrameAssetId: baseId, keyframes: [{ assetId: editedId ?? baseId, t: 1 }] }),
      }),
      runStep({
        name: "reference · 1.5 · 1 image + voice eve · 1s 480p",
        estimate: vid(1, V15),
        run: () => video({ mode: "reference", prompt: "The boat from <IMAGE_0> floats past while a narrator with the voice from <AUDIO_0> says hello.", model: V15, duration: 1, aspectRatio: "16:9", resolution: "480p", referenceAssetIds: [baseId], voiceIds: ["eve"] }),
      }),
    );
    if (editedId) {
      parallelSteps.push(
        runStep({
          name: "multi-image edit · 2.0 · 2 sources",
          estimate: img(1, "grok-imagine-image-2.0"),
          run: () => image({ prompt: "Place the boat from <IMAGE_1> next to the boat in <IMAGE_0>.", model: "grok-imagine-image-2.0", n: 1, aspectRatio: "16:9", resolution: "1k", quality: "low", inputAssetIds: [baseId, editedId] }),
        }),
      );
    }
  }
  const sourceStep = runStep({
    name: "text→video · classic · 2s 480p (source for edit/extend)",
    estimate: vid(2, CLASSIC),
    run: () => video({ mode: "text", prompt: "a paper boat drifting across a puddle, static shot", model: CLASSIC, duration: 2, aspectRatio: "16:9", resolution: "480p", audio: false }),
  });
  parallelSteps.push(
    sourceStep.then(async (src) => {
      const srcId = src?.outputs?.[0]?.id;
      if (!srcId) return;
      await Promise.all([
        runStep({
          name: "video edit · classic",
          estimate: vid(2, CLASSIC),
          run: () => video({ mode: "edit", prompt: "Make it night with neon reflections. Keep the boat and motion the same.", model: CLASSIC, videoAssetId: srcId }),
        }),
        runStep({
          name: "video extend · classic · +2s",
          estimate: vid(4, CLASSIC),
          run: () => video({ mode: "extend", prompt: "The boat bumps the curb and spins.", model: CLASSIC, duration: 2, videoAssetId: srcId }),
        }),
      ]);
    }),
  );
  await Promise.all(parallelSteps);
}

const after = await call<AppStatus>("/api/status");
const spent = results.reduce((s, r) => s + (r.cost ?? 0), 0);
console.log("\n" + results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(62)} ${r.secs.toFixed(0).padStart(4)}s  ${r.cost !== undefined ? `$${r.cost.toFixed(3)}` : "      "}  ${r.ok ? "" : r.note}`).join("\n"));
console.log(`\nReported cost this run: $${spent.toFixed(3)} · library total: $${after.spendUsd.toFixed(3)}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} step(s) failed.` : "All steps passed.");
process.exit(failed ? 1 : 0);
