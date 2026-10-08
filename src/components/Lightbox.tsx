import { useEffect } from "react";
import { api, mediaUrl } from "../api";
import { useApp } from "../store";
import { AssetMedia, jobChips, useAssetActions } from "./Feed";
import { Icon, money } from "./ui";

export function Lightbox() {
  const { lightbox, assets, jobs, closeAsset, openAsset, toast, send } = useApp();
  const actionsFor = useAssetActions();
  const asset = lightbox ? assets[lightbox.id] : undefined;
  const ids = (lightbox?.ids ?? []).filter((id) => assets[id]);
  const idx = asset ? ids.indexOf(asset.id) : -1;

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAsset();
      if (e.key === "ArrowRight" && idx >= 0 && idx < ids.length - 1) openAsset(ids[idx + 1], ids);
      if (e.key === "ArrowLeft" && idx > 0) openAsset(ids[idx - 1], ids);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, idx, ids, closeAsset, openAsset]);

  if (!lightbox || !asset) return null;
  const job = asset.jobId ? jobs.find((j) => j.id === asset.jobId) : undefined;
  const prompt = job?.prompt ?? asset.prompt ?? "";

  const remove = async () => {
    if (!confirm("Delete this from your library? This can't be undone.")) return;
    await api.deleteAsset(asset.id).catch((err) => toast(err.message, "error"));
    closeAsset();
  };

  return (
    <div className="lightbox" onClick={closeAsset} role="dialog" aria-label="Media viewer">
      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-media">
          <AssetMedia asset={asset} controls />
          {idx > 0 && (
            <button type="button" className="nav-btn left" onClick={() => openAsset(ids[idx - 1], ids)} aria-label="Previous">
              <Icon name="chevronL" />
            </button>
          )}
          {idx >= 0 && idx < ids.length - 1 && (
            <button type="button" className="nav-btn right" onClick={() => openAsset(ids[idx + 1], ids)} aria-label="Next">
              <Icon name="chevronR" />
            </button>
          )}
        </div>
        <aside className="lightbox-side">
          <div className="modal-head">
            <span className="muted small">{asset.source === "upload" ? "Upload" : new Date(asset.createdAt).toLocaleString()}</span>
            <button type="button" className="icon-btn" onClick={closeAsset} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
          {prompt && (
            <div className="lb-prompt">
              <p>{prompt}</p>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(job?.finalPrompt ?? prompt);
                  toast("Prompt copied");
                }}
              >
                <Icon name="copy" size={14} /> Copy prompt
              </button>
            </div>
          )}
          {job && (
            <div className="chips">
              {jobChips(job).map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
              {job.costUsd !== undefined && <span className="chip cost">{money(job.costUsd)}</span>}
            </div>
          )}
          <div className="lb-actions">
            {actionsFor(asset).map((a) => (
              <button key={a.label} type="button" className="btn" onClick={a.run}>
                <Icon name={a.icon} size={15} /> {a.label}
              </button>
            ))}
            {job && (
              <button type="button" className="btn" onClick={() => send({ target: "reuse", job })}>
                <Icon name="copy" size={15} /> Reuse settings
              </button>
            )}
          </div>
          <div className="lb-actions row">
            <a className="btn primary" href={mediaUrl(asset)} download={`biggsfield-${asset.id}.${asset.file.split(".").pop()}`}>
              <Icon name="download" size={15} /> Download
            </a>
            <button
              type="button"
              className={`btn${asset.favorite ? " fav" : ""}`}
              onClick={() => api.favorite(asset.id, !asset.favorite).catch((err) => toast(err.message, "error"))}
              aria-pressed={!!asset.favorite}
            >
              <Icon name="heart" size={15} /> {asset.favorite ? "Saved" : "Favorite"}
            </button>
            <button type="button" className="btn danger-hover" onClick={remove} aria-label="Delete">
              <Icon name="trash" size={15} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
