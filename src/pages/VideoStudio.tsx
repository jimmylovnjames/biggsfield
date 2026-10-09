import { useEffect, useState } from "react";
import {
  CAMERA_MOTIONS,
  composeVideoPrompt,
  INPUT_IMAGE_USD,
  INPUT_VIDEO_USD_PER_SECOND,
  utf8Bytes,
  VIDEO_ASPECTS,
  VIDEO_EFFECTS,
  VIDEO_LIMITS,
  VIDEO_MODELS,
  VIDEO_MODES,
  videoModel,
  VOICES,
} from "../../shared/catalog";
import type { KeyframeInput, VideoJobRequest, VideoMode } from "../../shared/types";
import { api } from "../api";
import { Feed } from "../components/Feed";
import { MediaSlot, MultiSlot } from "../components/MediaSlot";
import { AspectPicker, Icon, money, PresetGrid, PromptBox, Section, Segmented, Select, Slider, Toggle } from "../components/ui";
import { usePersistent, useApp } from "../store";

interface VideoForm {
  mode: VideoMode;
  prompt: string;
  model: string;
  duration: number;
  extendDuration: number;
  aspectRatio: string;
  resolution: string;
  audio: boolean;
  cameraId?: string;
  effectId?: string;
  imageAssetId?: string;
  /** Optional pinned first frame in reference mode; kept apart from the image-mode start image. */
  refStartAssetId?: string;
  lastFrameAssetId?: string;
  keyframes: { assetId?: string; t: number }[];
  referenceAssetIds: string[];
  voiceIds: string[];
  videoAssetId?: string;
}

const DEFAULTS: VideoForm = {
  mode: "text",
  prompt: "",
  model: "grok-imagine-video-1.5",
  duration: VIDEO_LIMITS.defaultDuration,
  extendDuration: VIDEO_LIMITS.extendDefault,
  aspectRatio: "16:9",
  resolution: "720p",
  audio: true,
  keyframes: [],
  referenceAssetIds: [],
  voiceIds: [],
};

/** Renumber <IMAGE_n> tags when a pinned start frame (which owns <IMAGE_0>) comes or goes. */
const shiftImageTags = (prompt: string, delta: 1 | -1) =>
  prompt.replace(/<IMAGE_(\d+)>( ?)/g, (_m, n: string, space: string) => (Number(n) + delta < 0 ? "" : `<IMAGE_${Number(n) + delta}>${space}`));

const maxTag = (prompt: string, name: "IMAGE" | "AUDIO") =>
  Math.max(-1, ...[...prompt.matchAll(new RegExp(`<${name}_(\\d+)>`, "g"))].map((m) => Number(m[1])));

const modelsFor = (mode: VideoMode) => VIDEO_MODELS.filter((m) => m.modes.includes(mode));

/** Keep model/resolution/duration valid whenever the mode or model changes. */
function normalize(f: VideoForm): VideoForm {
  const options = modelsFor(f.mode);
  const model = options.find((m) => m.id === f.model) ?? options[0];
  const pinned = f.mode === "frames" || f.mode === "reference";
  const resolutions = pinned ? model.referenceResolutions : model.resolutions;
  const resolution = resolutions.includes(f.resolution) ? f.resolution : resolutions.includes("720p") ? "720p" : resolutions[0];
  const maxDuration = f.mode === "reference" ? model.referenceMaxDuration : VIDEO_LIMITS.maxDuration;
  return { ...f, model: model.id, resolution, duration: Math.min(f.duration, maxDuration) };
}

export function VideoStudio() {
  const { status, toast, handoff, takeHandoff, assets, setSettingsOpen } = useApp();
  const [stored, setForm] = usePersistent<VideoForm>("biggsfield.video", DEFAULTS);
  const form = normalize(stored);
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof VideoForm>(k: K, v: VideoForm[K]) => setForm((f) => normalize({ ...f, [k]: v }));
  const appendToPrompt = (t: string) => set("prompt", `${form.prompt}${form.prompt && !form.prompt.endsWith(" ") ? " " : ""}${t} `);

  // In reference mode a pinned start frame is <IMAGE_0> and pushes references to <IMAGE_1>+, so keep
  // tags already in the prompt pointing at the same pictures when the start frame comes or goes.
  const pinsStart = (f: VideoForm) => f.model !== "grok-imagine-video" && !!f.refStartAssetId && !!assets[f.refStartAssetId];
  const updatePinned = (patch: Partial<VideoForm>) =>
    setForm((f) => {
      const next = normalize({ ...f, ...patch });
      const before = pinsStart(f);
      const after = pinsStart(next);
      if (before === after || next.mode !== "reference") return next;
      return { ...next, prompt: shiftImageTags(next.prompt, after ? 1 : -1) };
    });

  useEffect(() => {
    const h = takeHandoff("video");
    if (!h) return;
    if (h.target === "video-slot") {
      setForm((f) => {
        const next = { ...f, mode: h.mode };
        if (h.slot === "image") next.imageAssetId = h.assetId;
        if (h.slot === "last") next.lastFrameAssetId = h.assetId;
        if (h.slot === "video") next.videoAssetId = h.assetId;
        if (h.slot === "ref") next.referenceAssetIds = [...f.referenceAssetIds.filter((id) => id !== h.assetId), h.assetId];
        return normalize(next);
      });
    } else if (h.target === "reuse") {
      const r = h.job.request as VideoJobRequest;
      setForm(
        normalize({
          ...DEFAULTS,
          mode: r.mode,
          prompt: r.prompt ?? "",
          model: r.model,
          duration: r.mode === "extend" ? DEFAULTS.duration : (r.duration ?? DEFAULTS.duration),
          extendDuration: r.mode === "extend" ? (r.duration ?? DEFAULTS.extendDuration) : DEFAULTS.extendDuration,
          aspectRatio: r.aspectRatio ?? DEFAULTS.aspectRatio,
          resolution: r.resolution ?? DEFAULTS.resolution,
          audio: r.audio !== false,
          cameraId: r.cameraId,
          effectId: r.effectId,
          imageAssetId: r.mode === "reference" ? undefined : r.imageAssetId,
          refStartAssetId: r.mode === "reference" ? r.imageAssetId : undefined,
          lastFrameAssetId: r.lastFrameAssetId,
          keyframes: r.keyframes ?? [],
          referenceAssetIds: r.referenceAssetIds ?? [],
          voiceIds: r.voiceIds ?? [],
          videoAssetId: r.videoAssetId,
        }),
      );
    }
  }, [handoff, takeHandoff, setForm]);

  const model = videoModel(form.model)!;
  const { mode } = form;
  const live = (id?: string) => (id && assets[id] ? id : undefined);
  const imageId = live(form.imageAssetId);
  const refStartId = model.id === "grok-imagine-video" ? undefined : live(form.refStartAssetId);
  const lastId = live(form.lastFrameAssetId);
  const videoId = live(form.videoAssetId);
  const refs = form.referenceAssetIds.filter((id) => assets[id]);
  const keyframes = form.keyframes.filter((k) => live(k.assetId)) as KeyframeInput[];
  const source = videoId ? assets[videoId] : undefined;
  const voices = model.voices ? form.voiceIds : [];

  // ---- validation (mirrors server rules so the button explains itself)
  let blocker = "";
  const hasPrompt = form.prompt.trim().length > 0 || !!form.cameraId || !!form.effectId;
  if (mode === "text" && !hasPrompt) blocker = "Write a prompt";
  if (mode === "image" && !imageId) blocker = "Add a start image";
  if (mode === "frames" && !lastId && keyframes.length === 0) blocker = "Add an end frame or a keyframe";
  if (mode === "frames" && keyframes.some((k) => !(k.t > 0 && k.t < form.duration))) blocker = `Keyframe times must be between 0 and ${form.duration}s`;
  if (mode === "reference" && !refs.length && !voices.length) blocker = "Add a reference image or voice";
  if (mode === "reference" && !hasPrompt) blocker = "Write a prompt";
  if ((mode === "edit" || mode === "extend") && !videoId) blocker = "Add a source video";
  if ((mode === "edit" || mode === "extend") && !form.prompt.trim()) blocker = mode === "edit" ? "Describe the edit" : "Describe what happens next";
  const slack = VIDEO_LIMITS.durationSlack;
  if (mode === "edit" && source?.duration && source.duration > VIDEO_LIMITS.editMaxSource + slack) blocker = `Edit sources must be ≤ ${VIDEO_LIMITS.editMaxSource}s (this is ${source.duration.toFixed(1)}s)`;
  if (mode === "extend" && source?.duration && (source.duration < VIDEO_LIMITS.extendMinSource || source.duration > VIDEO_LIMITS.extendMaxSource + slack)) {
    blocker = `Extend sources must be ${VIDEO_LIMITS.extendMinSource}-${VIDEO_LIMITS.extendMaxSource}s (this is ${source.duration.toFixed(1)}s)`;
  }
  if (mode === "reference") {
    const images = refs.length + (refStartId ? 1 : 0);
    const imageTag = maxTag(form.prompt, "IMAGE");
    const audioTag = maxTag(form.prompt, "AUDIO");
    if (imageTag >= images) blocker = `<IMAGE_${imageTag}> has no image attached`;
    if (audioTag >= voices.length) blocker = `<AUDIO_${audioTag}> has no voice selected`;
  }
  const promptBytes = utf8Bytes(composeVideoPrompt(form.prompt, mode === "edit" ? undefined : form.cameraId, form.effectId));
  if (promptBytes > VIDEO_LIMITS.maxPromptBytes) blocker = `Prompt too long (${promptBytes}/${VIDEO_LIMITS.maxPromptBytes} bytes)`;

  const seconds = mode === "edit" ? (source?.duration ?? VIDEO_LIMITS.editMaxSource) : mode === "extend" ? form.extendDuration : form.duration;
  const inputImages =
    mode === "image" ? (imageId ? 1 : 0) : mode === "frames" ? (imageId ? 1 : 0) + (lastId ? 1 : 0) + keyframes.length : mode === "reference" ? refs.length + (refStartId ? 1 : 0) : 0;
  const sourceSeconds = mode === "edit" || mode === "extend" ? (source?.duration ?? (mode === "edit" ? VIDEO_LIMITS.editMaxSource : 0)) : 0;
  const estimate = seconds * model.pricePerSecond + inputImages * INPUT_IMAGE_USD + sourceSeconds * INPUT_VIDEO_USD_PER_SECOND;
  const pinned = mode === "frames" || mode === "reference";
  const resolutions = pinned ? model.referenceResolutions : model.resolutions;
  const maxDuration = mode === "reference" ? model.referenceMaxDuration : VIDEO_LIMITS.maxDuration;

  const submit = async () => {
    const req: VideoJobRequest = { mode, prompt: form.prompt, model: form.model, effectId: form.effectId };
    if (mode !== "edit") req.cameraId = form.cameraId;
    if (mode === "extend") req.duration = form.extendDuration;
    else if (mode !== "edit") req.duration = form.duration;
    if (mode === "text" || mode === "frames" || mode === "reference") req.aspectRatio = form.aspectRatio;
    if (mode !== "edit" && mode !== "extend") {
      req.resolution = form.resolution;
      req.audio = form.audio;
    }
    if (mode === "image" || mode === "frames") req.imageAssetId = imageId;
    if (mode === "reference") req.imageAssetId = refStartId;
    if (mode === "frames") {
      req.lastFrameAssetId = lastId;
      req.keyframes = keyframes;
    }
    if (mode === "reference") {
      req.referenceAssetIds = refs;
      req.voiceIds = voices;
    }
    if (mode === "edit" || mode === "extend") req.videoAssetId = videoId;

    setSubmitting(true);
    try {
      await api.createVideo(req);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!status?.hasKey && !blocker && !submitting;
  const modeInfo = VIDEO_MODES.find((m) => m.id === mode)!;
  const promptOptional = mode === "image" || mode === "frames";

  return (
    <div className="studio">
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <div className="panel-scroll">
          <Section title="Mode" aside={<span className="muted small">{modeInfo.hint}</span>}>
            <Segmented wrap value={mode} options={VIDEO_MODES.map((m) => ({ id: m.id, label: m.label, title: m.hint }))} onChange={(v) => set("mode", v)} />
          </Section>

          {mode === "image" && (
            <Section title="Start image">
              <MediaSlot kind="image" assetId={imageId} onChange={(id) => set("imageAssetId", id)} label="Drop an image" hint="Becomes the first frame; output keeps its aspect ratio" />
            </Section>
          )}

          {mode === "frames" && (
            <>
              <div className="row-2">
                <Section title="Start frame">
                  <MediaSlot kind="image" assetId={imageId} onChange={(id) => set("imageAssetId", id)} label="First" hint="Optional" />
                </Section>
                <Section title="End frame">
                  <MediaSlot kind="image" assetId={lastId} onChange={(id) => set("lastFrameAssetId", id)} label="Last" hint="Same as start = loop" />
                </Section>
              </div>
              <Section
                title="Keyframes"
                aside={
                  form.keyframes.length < VIDEO_LIMITS.maxKeyframes && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => {
                        const n = form.keyframes.length + 1;
                        const spaced = Array.from({ length: n }, (_, i) => Math.round(((form.duration * (i + 1)) / (n + 1)) * 3) / 3);
                        set("keyframes", [...form.keyframes.map((k, i) => ({ ...k, t: k.assetId ? k.t : spaced[i] })), { t: spaced[n - 1] }]);
                      }}
                    >
                      <Icon name="plus" size={14} /> Add
                    </button>
                  )
                }
              >
                {form.keyframes.length === 0 && <p className="muted small">Pin up to 4 images at exact moments inside the clip.</p>}
                <div className="keyframes">
                  {form.keyframes.map((k, i) => (
                    <div key={i} className="keyframe">
                      <MediaSlot
                        kind="image"
                        assetId={live(k.assetId)}
                        onChange={(id) => set("keyframes", form.keyframes.map((x, j) => (j === i ? { ...x, assetId: id } : x)))}
                        label={`Key ${i + 1}`}
                      />
                      <label className="kf-time">
                        <span className="muted small">at</span>
                        <input
                          type="number"
                          min={0.34}
                          max={form.duration - 0.34}
                          step={1 / 3}
                          value={Number(k.t.toFixed(2))}
                          onChange={(e) => set("keyframes", form.keyframes.map((x, j) => (j === i ? { ...x, t: Number(e.target.value) } : x)))}
                        />
                        <span className="muted small">s</span>
                      </label>
                      <button type="button" className="icon-btn sm" onClick={() => set("keyframes", form.keyframes.filter((_, j) => j !== i))} aria-label="Remove keyframe">
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {mode === "reference" && (
            <>
              <Section title="Reference images" aside={<span className="muted small">Characters, outfits, products, places</span>}>
                <MultiSlot ids={refs} onChange={(ids) => set("referenceAssetIds", ids)} max={model.maxReferenceImages} label="Add" onTag={appendToPrompt} tagOffset={refStartId ? 1 : 0} />
              </Section>
              {model.voices && (
                <Section title="Voices" aside={<span className="muted small">Up to {VIDEO_LIMITS.maxVoices} · lip-synced</span>}>
                  <div className="voices">
                    {VOICES.map((v) => {
                      const i = form.voiceIds.indexOf(v);
                      return (
                        <button
                          key={v}
                          type="button"
                          className={`voice${i >= 0 ? " on" : ""}`}
                          onClick={() =>
                            set("voiceIds", i >= 0 ? form.voiceIds.filter((x) => x !== v) : form.voiceIds.length < VIDEO_LIMITS.maxVoices ? [...form.voiceIds, v] : form.voiceIds)
                          }
                        >
                          {v[0].toUpperCase() + v.slice(1)}
                          {i >= 0 && (
                            <span
                              className="tag"
                              onClick={(e) => {
                                e.stopPropagation();
                                appendToPrompt(`<AUDIO_${i}>`);
                              }}
                            >{`<AUDIO_${i}>`}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </Section>
              )}
              {model.id !== "grok-imagine-video" && (
                <Section title="Start frame" aside={<span className="muted small">Optional</span>}>
                  <MediaSlot
                    kind="image"
                    assetId={refStartId}
                    onChange={(id) => updatePinned({ refStartAssetId: id })}
                    label="Pin first frame"
                    hint="Becomes <IMAGE_0>; references shift to <IMAGE_1>+"
                    tag="<IMAGE_0>"
                    onTag={() => appendToPrompt("<IMAGE_0>")}
                  />
                </Section>
              )}
            </>
          )}

          {(mode === "edit" || mode === "extend") && (
            <Section title="Source video" aside={<span className="muted small">{mode === "edit" ? `MP4 ≤ ${VIDEO_LIMITS.editMaxSource}s` : `MP4, ${VIDEO_LIMITS.extendMinSource}-${VIDEO_LIMITS.extendMaxSource}s`}</span>}>
              <MediaSlot kind="video" assetId={videoId} onChange={(id) => set("videoAssetId", id)} label="Drop a clip" hint={mode === "edit" ? "Output keeps its length, ratio and resolution (≤720p)" : "Continues from the last frame"} />
            </Section>
          )}

          <Section title="Prompt">
            <PromptBox
              value={form.prompt}
              onChange={(v) => set("prompt", v)}
              kind="video"
              optional={promptOptional}
              counter={`${promptBytes}/${VIDEO_LIMITS.maxPromptBytes} bytes`}
              placeholder={
                mode === "edit"
                  ? "What should change? Say what must stay the same."
                  : mode === "extend"
                    ? "What happens next?"
                    : mode === "reference"
                      ? refStartId
                        ? "Open on <IMAGE_0>; the person from <IMAGE_1> walks in wearing the jacket from <IMAGE_2>…"
                        : "The person from <IMAGE_0> walks onto the stage wearing the jacket from <IMAGE_1>…"
                      : "Describe the shot: subject, action, setting, light, sound…"
              }
            />
          </Section>

          {mode !== "edit" && (
            <Section title="Camera motion">
              <PresetGrid presets={CAMERA_MOTIONS} value={form.cameraId} onChange={(v) => set("cameraId", v)} animated />
            </Section>
          )}

          <Section title="Effect">
            <PresetGrid presets={VIDEO_EFFECTS} value={form.effectId} onChange={(v) => set("effectId", v)} />
          </Section>

          <Section title="Model">
            <Select value={form.model} onChange={(v) => updatePinned({ model: v })} options={modelsFor(mode).map((m) => ({ id: m.id, label: m.label, note: `${m.note} · $${m.pricePerSecond}/s` }))} />
          </Section>

          {mode === "extend" ? (
            <Section title="Added length">
              <Slider value={form.extendDuration} min={VIDEO_LIMITS.extendMin} max={VIDEO_LIMITS.extendMax} onChange={(v) => set("extendDuration", v)} suffix="s" />
            </Section>
          ) : mode !== "edit" ? (
            <Section title="Duration">
              <Slider value={form.duration} min={VIDEO_LIMITS.minDuration} max={maxDuration} onChange={(v) => set("duration", v)} suffix="s" />
            </Section>
          ) : null}

          {(mode === "text" || mode === "frames" || mode === "reference") && (
            <Section title="Aspect ratio">
              <AspectPicker value={form.aspectRatio} options={VIDEO_ASPECTS} onChange={(v) => set("aspectRatio", v)} />
            </Section>
          )}

          {mode !== "edit" && mode !== "extend" && (
            <div className="row-2">
              <Section title="Resolution">
                <Segmented value={form.resolution} options={resolutions.map((r) => ({ id: r, label: r }))} onChange={(v) => set("resolution", v)} />
              </Section>
              <Section title="Audio">
                <Toggle checked={form.audio} onChange={(v) => set("audio", v)} label={form.audio ? "Sound on" : "Silent"} />
              </Section>
            </div>
          )}
        </div>

        <div className="panel-foot">
          {!status?.hasKey ? (
            <button type="button" className="btn primary block" onClick={() => setSettingsOpen(true)}>
              <Icon name="key" /> Add your xAI API key
            </button>
          ) : (
            <button type="submit" className="btn primary block lg" disabled={!canSubmit} title={blocker}>
              <Icon name="video" /> {blocker || (mode === "edit" ? "Edit video" : mode === "extend" ? "Extend video" : "Generate video")}
              {!blocker && <span className="btn-meta">~{money(estimate)}</span>}
            </button>
          )}
        </div>
      </form>

      <main className="canvas">
        <Feed
          kind="video"
          empty={
            <>
              <Icon name="video" size={34} />
              <h2>Direct a shot</h2>
              <p className="muted">Pick a mode, describe the action, add a camera move. Renders take a minute or two and keep running if you close the tab.</p>
            </>
          }
        />
      </main>
    </div>
  );
}
