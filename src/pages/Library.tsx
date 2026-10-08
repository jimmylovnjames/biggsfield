import { useState } from "react";
import { AssetMedia } from "../components/Feed";
import { ASSET_DRAG_TYPE } from "../components/MediaSlot";
import { Icon, Segmented } from "../components/ui";
import { useApp } from "../store";

type Filter = "all" | "image" | "video" | "favorites" | "uploads";

export function Library() {
  const { assetList, openAsset, go } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const items = assetList.filter((a) => {
    if (filter === "uploads" ? a.source !== "upload" : a.source !== "generated") return false;
    if (filter === "image" || filter === "video") if (a.kind !== filter) return false;
    if (filter === "favorites" && !a.favorite) return false;
    return !q || (a.prompt ?? "").toLowerCase().includes(q);
  });
  const ids = items.map((a) => a.id);

  return (
    <div className="library">
      <div className="library-bar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All" },
            { id: "image", label: "Images" },
            { id: "video", label: "Videos" },
            { id: "favorites", label: "Favorites" },
            { id: "uploads", label: "Uploads" },
          ]}
        />
        <input className="search" type="search" placeholder="Search prompts…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search prompts" />
      </div>

      {items.length === 0 ? (
        <div className="feed-empty">
          <Icon name="grid" size={34} />
          <h2>{assetList.length ? "Nothing matches" : "Your library is empty"}</h2>
          <p className="muted">Everything you generate is saved here, on your own disk.</p>
          {!assetList.length && (
            <div className="row-gap">
              <button type="button" className="btn primary" onClick={() => go("image")}>
                Create an image
              </button>
              <button type="button" className="btn" onClick={() => go("video")}>
                Make a video
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="masonry">
          {items.map((a) => (
            <button
              key={a.id}
              type="button"
              className="masonry-item"
              onClick={() => openAsset(a.id, ids)}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id)}
              title={a.prompt}
            >
              <AssetMedia asset={a} />
              {a.kind === "video" && (
                <span className="slot-badge">
                  <Icon name="play" size={10} /> {a.duration ? `${Math.round(a.duration)}s` : ""}
                </span>
              )}
              {a.favorite && (
                <span className="fav-badge">
                  <Icon name="heart" size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
