import { useEffect, useState, type ReactNode } from "react";
import { CAMERA_MOTIONS, findPreset, IMAGE_STYLES, imageModel, VIDEO_EFFECTS, VIDEO_MODES, videoModel } from "../../shared/catalog";
import type { Asset, ImageJobRequest, Job, MediaKind, VideoJobRequest } from "../../shared/types";
import { api, mediaUrl } from "../api";
import { useApp } from "../store";
import { ASSET_DRAG_TYPE } from "./MediaSlot";
import { Icon, money, timeAgo } from "./ui";

export function jobChips(job: Job): string[] {
  if (job.kind === "image") {
    const r = job.request as ImageJobRequest;
    return [
      job.mode === "edit" ? `Edit · ${job.inputAssetIds.length} src` : "Create",
      imageModel(r.model)?.label ?? r.model,
      r.aspectRatio,
      r.resolution,
      `${r.n}×`,
      findPreset(IMAGE_STYLES, r.styleId)?.label,
    ].filter(Boolean) as string[];
  }
  const r = job.request as VideoJobRequest;
  return [
    VIDEO_MODES.find((m) => m.id === r.mode)?.label,
    videoModel(r.model)?.label ?? r.model,
    r.mode === "edit" ? undefined : r.duration ? `${r.duration}s` : undefined,
    ["text", "frames", "reference"].includes(r.mode) ? r.aspectRatio : undefined,
    r.mode === "edit" || r.mode === "extend" ? undefined : r.resolution,
    r.audio === false ? "No audio" : undefined,
    findPreset(CAMERA_MOTIONS, r.cameraId)?.label,
    findPreset(VIDEO_EFFECTS, r.effectId)?.label,
    r.voiceIds?.length ? `Voice: ${r.voiceIds.join(", ")}` : undefined,
  ].filter(Boolean) as string[];
}

function useNow(active: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

export function AssetMedia({ asset, controls }: { asset: Asset; controls?: boolean }) {
  if (asset.kind === "video") {
    return controls ? (
      <video src={mediaUrl(asset)} controls loop playsInline autoPlay />
    ) : (
      <video
        src={mediaUrl(asset)}
        muted
        loop
        playsInline
        preload="metadata"
        onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
        onMouseLeave={(e) => e.currentTarget.pause()}
      />
    );
  }
  return <img src={mediaUrl(asset)} alt={asset.prompt ?? ""} loading="lazy" />;
}

/** Hand an asset to another tool: animate, extend, use as reference… */
export function useAssetActions() {
  const { send } = useApp();
  return (asset: Asset) =>
    asset.kind === "image"
      ? [
          { label: "Animate", icon: "play", run: () => send({ target: "video-slot", mode: "image", slot: "image", assetId: asset.id }) },
          { label: "Edit image", icon: "wand", run: () => send({ target: "image-source", assetId: asset.id }) },
          { label: "Start frame", icon: "film", run: () => send({ target: "video-slot", mode: "frames", slot: "image", assetId: asset.id }) },
          { label: "End frame", icon: "film", run: () => send({ target: "video-slot", mode: "frames", slot: "last", assetId: asset.id }) },
          { label: "Video reference", icon: "layers", run: () => send({ target: "video-slot", mode: "reference", slot: "ref", assetId: asset.id }) },
        ]
      : [
          { label: "Extend", icon: "extend", run: () => send({ target: "video-slot", mode: "extend", slot: "video", assetId: asset.id }) },
          { label: "Edit video", icon: "wand", run: () => send({ target: "video-slot", mode: "edit", slot: "video", assetId: asset.id }) },
        ];
}

function OutputTile({ asset, ids }: { asset: Asset; ids: string[] }) {
  const { openAsset } = useApp();
  const actions = useAssetActions()(asset);
  const primary = actions[0];
  return (
    <div className="tile" draggable onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)}>
      <button type="button" className="tile-open" onClick={() => openAsset(asset.id, ids)} aria-label="Open">
        <AssetMedia asset={asset} />
      </button>
      <div className="tile-actions">
        <button type="button" className="chip-btn" onClick={primary.run}>
          <Icon name={primary.icon} size={13} /> {primary.label}
        </button>
        <a className="icon-btn sm" href={mediaUrl(asset)} download={`biggsfield-${asset.id}.${asset.file.split(".").pop()}`} aria-label="Download">
          <Icon name="download" size={14} />
        </a>
      </div>
      {asset.duration ? <span className="slot-badge">{Math.round(asset.duration)}s</span> : null}
    </div>
  );
}

function aspectStyle(job: Job) {
  const ar = (job.request as { aspectRatio?: string }).aspectRatio;
  if (!ar || ar === "auto") return { aspectRatio: job.kind === "video" ? "16 / 9" : "1 / 1" };
  const [a, b] = ar.split(":");
  return { aspectRatio: `${a} / ${b}` };
}

export function JobCard({ job }: { job: Job }) {
  const { assets, toast, send } = useApp();
  const active = job.status === "queued" || job.status === "running";
  useNow(active);
  const outputs = job.outputAssetIds.map((id) => assets[id]).filter(Boolean);
  const placeholders = job.kind === "image" ? (job.request as ImageJobRequest).n : 1;
  const elapsed = Math.round((Date.now() - job.createdAt) / 1000);
  const [expanded, setExpanded] = useState(false);

  const retry = async () => {
    try {
      if (job.kind === "image") await api.createImage(job.request as ImageJobRequest);
      else await api.createVideo(job.request as VideoJobRequest);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  const remove = async () => {
    const withOutputs = outputs.length > 0 && confirm("Delete this generation and its outputs from your library?");
    if (outputs.length > 0 && !withOutputs) return;
    await api.deleteJob(job.id, withOutputs).catch((err) => toast(err.message, "error"));
  };

  return (
    <article className={`job ${job.kind} ${job.status}`}>
      <header className="job-head">
        <div className="chips">
          {jobChips(job).map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
        <span className="muted small nowrap">
          {job.costUsd !== undefined && <b className="cost">{money(job.costUsd)}</b>} {timeAgo(job.createdAt)}
        </span>
      </header>

      {job.prompt && (
        <p className={`job-prompt${expanded ? " open" : ""}`} onClick={() => setExpanded((v) => !v)} title={job.finalPrompt}>
          {job.prompt}
        </p>
      )}

      {active && (
        <div className={`job-grid n${Math.min(placeholders, 4)}`}>
          {Array.from({ length: placeholders }, (_, i) => (
            <div key={i} className="placeholder" style={aspectStyle(job)}>
              <div className="shimmer" />
              <div className="placeholder-info">
                <span>{job.status === "queued" ? "Queued" : job.kind === "video" ? "Rendering video" : "Generating"}</span>
                <span className="muted small">
                  {job.progress ? `${job.progress}% · ` : ""}
                  {elapsed}s
                </span>
              </div>
              {job.kind === "video" && <div className="progress" style={{ width: `${Math.max(job.progress ?? 0, 3)}%` }} />}
            </div>
          ))}
        </div>
      )}

      {job.status === "failed" && <div className="job-error">{job.error ?? "Failed"}</div>}

      {outputs.length > 0 && (
        <div className={`job-grid n${Math.min(outputs.length, 4)}`}>
          {outputs.map((a) => (
            <OutputTile key={a.id} asset={a} ids={outputs.map((o) => o.id)} />
          ))}
        </div>
      )}

      <footer className="job-foot">
        <button type="button" className="btn ghost sm" onClick={() => send({ target: "reuse", job })}>
          <Icon name="copy" size={14} /> Reuse settings
        </button>
        {!active && (
          <button type="button" className="btn ghost sm" onClick={retry}>
            <Icon name="redo" size={14} /> {job.status === "failed" ? "Retry" : "Run again"}
          </button>
        )}
        <button type="button" className="btn ghost sm danger-hover" onClick={remove} disabled={active} title={active ? "Wait for it to finish" : "Delete"}>
          <Icon name="trash" size={14} />
        </button>
      </footer>
    </article>
  );
}

export function Feed({ kind, empty }: { kind: MediaKind; empty: ReactNode }) {
  const { jobs } = useApp();
  const mine = jobs.filter((j) => j.kind === kind);
  if (!mine.length) return <div className="feed-empty">{empty}</div>;
  return (
    <div className="feed">
      {mine.map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </div>
  );
}
