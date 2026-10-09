import { useRef, useState, type DragEvent } from "react";
import type { Asset, MediaKind } from "../../shared/types";
import { mediaUrl, uploadFile } from "../api";
import { useApp } from "../store";
import { Icon, useEscape } from "./ui";

export const ASSET_DRAG_TYPE = "application/x-biggsfield-asset";

function useDropUpload(kind: MediaKind, onAssets: (assets: Asset[]) => void, max = 1) {
  const { toast, assets } = useApp();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const handleFiles = async (files: File[]) => {
    const wanted = files.filter((f) => f.type.startsWith(`${kind}/`)).slice(0, max);
    if (!wanted.length) {
      if (files.length) toast(`Drop ${kind === "image" ? "a JPEG, PNG or WebP image" : "an MP4 video"}`, "error");
      return;
    }
    setBusy(true);
    try {
      const uploaded: Asset[] = [];
      for (const f of wanted) uploaded.push(await uploadFile(f));
      onAssets(uploaded);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      const id = e.dataTransfer.getData(ASSET_DRAG_TYPE);
      if (id) {
        const a = assets[id];
        if (a?.kind === kind) onAssets([a]);
        else toast(`That slot takes ${kind === "image" ? "an image" : "a video"}`, "error");
        return;
      }
      void handleFiles([...e.dataTransfer.files]);
    },
  };
  return { busy, over, handleFiles, dropProps };
}

function Thumb({ asset }: { asset: Asset }) {
  return asset.kind === "video" ? (
    <video src={mediaUrl(asset)} muted loop playsInline preload="metadata" onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
  ) : (
    <img src={mediaUrl(asset)} alt="" loading="lazy" />
  );
}

/** A single input slot: upload, drop a file, drag from the feed, or pick from the library. */
export function MediaSlot({
  kind,
  assetId,
  onChange,
  label,
  hint,
  tag,
  onTag,
}: {
  kind: MediaKind;
  assetId?: string;
  onChange: (id?: string) => void;
  label: string;
  hint?: string;
  tag?: string;
  onTag?: () => void;
}) {
  const { assets } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const { busy, over, handleFiles, dropProps } = useDropUpload(kind, (a) => onChange(a[0].id));
  const asset = assetId ? assets[assetId] : undefined;

  return (
    <div className={`slot${over ? " over" : ""}${asset ? " filled" : ""}`} {...dropProps}>
      {asset ? (
        <>
          <Thumb asset={asset} />
          <div className="slot-overlay">
            {tag && (
              <button type="button" className="tag" onClick={onTag} title="Insert tag into prompt">
                {tag}
              </button>
            )}
            <button type="button" className="icon-btn sm" onClick={() => onChange(undefined)} aria-label={`Remove ${label}`}>
              <Icon name="close" size={14} />
            </button>
          </div>
          {asset.duration ? <span className="slot-badge">{asset.duration.toFixed(1)}s</span> : null}
        </>
      ) : (
        <div className="slot-empty">
          <span className="slot-label">{busy ? "Uploading…" : label}</span>
          {hint && <span className="muted small">{hint}</span>}
          <div className="slot-actions">
            <button type="button" className="btn sm" onClick={() => input.current?.click()} disabled={busy}>
              <Icon name="upload" size={14} /> Upload
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setPicking(true)} disabled={busy}>
              Library
            </button>
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={kind === "image" ? "image/jpeg,image/png,image/webp" : "video/mp4"}
        onChange={(e) => {
          void handleFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {picking && <AssetPicker kind={kind} onPick={(id) => onChange(id)} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** A row of image slots (references / edit sources) with <IMAGE_n> tags. */
export function MultiSlot({
  ids,
  onChange,
  max,
  label,
  onTag,
  tagOffset = 0,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  max: number;
  label: string;
  onTag?: (tag: string) => void;
  /** First tag index; 1 when a pinned start frame already owns <IMAGE_0>. */
  tagOffset?: number;
}) {
  const { assets } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const live = ids.filter((id) => assets[id]);
  const room = max - live.length;
  const { busy, over, handleFiles, dropProps } = useDropUpload("image", (a) => onChange([...live, ...a.map((x) => x.id)].slice(0, max)), Math.max(room, 0));

  return (
    <div className={`multislot${over ? " over" : ""}`} {...dropProps}>
      {live.map((id, i) => (
        <div key={id} className="mini">
          <img src={mediaUrl(assets[id])} alt="" />
          <button type="button" className="tag" onClick={() => onTag?.(`<IMAGE_${i + tagOffset}>`)} title="Insert tag into prompt">
            {`<IMAGE_${i + tagOffset}>`}
          </button>
          <button type="button" className="icon-btn xs" onClick={() => onChange(live.filter((x) => x !== id))} aria-label="Remove image">
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      {room > 0 && (
        <div className="mini add">
          <button type="button" onClick={() => input.current?.click()} disabled={busy} title="Upload images">
            <Icon name={busy ? "redo" : "plus"} size={18} />
            <span>{busy ? "Uploading" : label}</span>
          </button>
          <button type="button" className="mini-lib" onClick={() => setPicking(true)}>
            Library
          </button>
        </div>
      )}
      <span className="muted small multislot-count">
        {live.length}/{max}
      </span>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          void handleFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {picking && (
        <AssetPicker
          kind="image"
          onPick={(id) => onChange(live.includes(id) ? live : [...live, id].slice(0, max))}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

export function AssetPicker({ kind, onPick, onClose }: { kind: MediaKind; onPick: (id: string) => void; onClose: () => void }) {
  const { assetList } = useApp();
  useEscape(onClose);
  const items = assetList.filter((a) => a.kind === kind);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Pick from library">
        <div className="modal-head">
          <h2>Pick {kind === "image" ? "an image" : "a video"}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {items.length === 0 ? (
          <p className="muted">Nothing in your library yet.</p>
        ) : (
          <div className="picker-grid">
            {items.map((a) => (
              <button
                key={a.id}
                type="button"
                className="picker-item"
                onClick={() => {
                  onPick(a.id);
                  onClose();
                }}
                title={a.prompt}
              >
                <Thumb asset={a} />
                {a.source === "upload" && <span className="slot-badge">upload</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
