import { useEffect, useState } from "react";
import { INPUT_IMAGE_USD, IMAGE_ASPECTS, IMAGE_MODELS, IMAGE_QUALITIES, IMAGE_RESOLUTIONS, IMAGE_STYLES, imageModel, MAX_IMAGE_INPUTS } from "../../shared/catalog";
import type { ImageJobRequest } from "../../shared/types";
import { api } from "../api";
import { Feed } from "../components/Feed";
import { MultiSlot } from "../components/MediaSlot";
import { AspectPicker, Icon, money, PresetGrid, PromptBox, Section, Segmented, Select, Slider } from "../components/ui";
import { usePersistent, useApp } from "../store";

const DEFAULTS: Required<Omit<ImageJobRequest, "styleId">> & { styleId?: string } = {
  prompt: "",
  model: "grok-imagine-image-2.0",
  n: 2,
  aspectRatio: "auto",
  resolution: "1k",
  quality: "auto",
  styleId: undefined,
  inputAssetIds: [],
};

export function ImageStudio() {
  const { status, toast, handoff, takeHandoff, assets, setSettingsOpen } = useApp();
  const [form, setForm] = usePersistent("biggsfield.image", DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const h = takeHandoff("image");
    if (!h) return;
    if (h.target === "image-source") {
      setForm((f) => ({ ...f, inputAssetIds: [...f.inputAssetIds.filter((id) => id !== h.assetId), h.assetId].slice(-MAX_IMAGE_INPUTS) }));
    } else if (h.target === "reuse") {
      setForm({ ...DEFAULTS, ...(h.job.request as ImageJobRequest), inputAssetIds: (h.job.request as ImageJobRequest).inputAssetIds ?? [] });
    }
  }, [handoff, takeHandoff, setForm]);

  const model = imageModel(form.model) ?? IMAGE_MODELS[0];
  const sources = form.inputAssetIds.filter((id) => assets[id]);
  const estimate = model.pricePerImage * form.n + INPUT_IMAGE_USD * sources.length;

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.createImage({
        prompt: form.prompt,
        model: form.model,
        n: form.n,
        aspectRatio: form.aspectRatio,
        resolution: form.resolution,
        quality: model.supportsQuality ? form.quality : undefined,
        styleId: form.styleId,
        inputAssetIds: sources,
      });
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!status?.hasKey && (form.prompt.trim() || form.styleId) && !submitting;

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
          <Section title="Prompt">
            <PromptBox
              value={form.prompt}
              onChange={(v) => set("prompt", v)}
              kind="image"
              placeholder={sources.length ? "Describe the edit, e.g. “Put the jacket from <IMAGE_1> on the person in <IMAGE_0>”" : "Describe the image you want…"}
            />
          </Section>

          <Section title="Source images" aside={<span className="muted small">{sources.length ? "Edit mode" : "Optional · enables editing"}</span>}>
            <MultiSlot ids={sources} onChange={(ids) => set("inputAssetIds", ids)} max={MAX_IMAGE_INPUTS} label="Add" onTag={(t) => set("prompt", `${form.prompt}${form.prompt && !form.prompt.endsWith(" ") ? " " : ""}${t} `)} />
          </Section>

          <Section title="Style">
            <PresetGrid presets={IMAGE_STYLES} value={form.styleId} onChange={(v) => set("styleId", v)} />
          </Section>

          <Section title="Model">
            <Select value={form.model} onChange={(v) => set("model", v)} options={IMAGE_MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note }))} />
          </Section>

          <Section title="Aspect ratio">
            <AspectPicker value={form.aspectRatio} options={IMAGE_ASPECTS} onChange={(v) => set("aspectRatio", v)} />
          </Section>

          <div className="row-2">
            <Section title="Resolution">
              <Segmented value={form.resolution} options={IMAGE_RESOLUTIONS.map((r) => ({ id: r, label: r.toUpperCase() }))} onChange={(v) => set("resolution", v)} />
            </Section>
            {model.supportsQuality && (
              <Section title="Quality">
                <Segmented value={form.quality} options={IMAGE_QUALITIES.map((q) => ({ id: q, label: q[0].toUpperCase() + q.slice(1) }))} onChange={(v) => set("quality", v)} />
              </Section>
            )}
          </div>

          <Section title="Images per run">
            <Slider value={form.n} min={1} max={10} onChange={(v) => set("n", v)} />
          </Section>
        </div>

        <div className="panel-foot">
          {!status?.hasKey ? (
            <button type="button" className="btn primary block" onClick={() => setSettingsOpen(true)}>
              <Icon name="key" /> Add your xAI API key
            </button>
          ) : (
            <button type="submit" className="btn primary block lg" disabled={!canSubmit}>
              <Icon name="sparkle" /> {sources.length ? "Edit" : "Generate"} <span className="btn-meta">~{money(estimate)}</span>
            </button>
          )}
        </div>
      </form>

      <main className="canvas">
        <Feed
          kind="image"
          empty={
            <>
              <Icon name="image" size={34} />
              <h2>Create with Grok Imagine</h2>
              <p className="muted">Write a prompt, pick a style, hit Generate. Add source images to edit or combine them.</p>
            </>
          }
        />
      </main>
    </div>
  );
}
