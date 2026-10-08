import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppStatus, Asset, Job, ServerEvent, VideoMode } from "../shared/types";
import { api } from "./api";

export type Page = "image" | "video" | "library";

/** Cross-page hand-off: "animate this image", "reuse these settings", etc. */
export type Handoff =
  | { target: "image-source"; assetId: string }
  | { target: "video-slot"; mode: VideoMode; slot: "image" | "last" | "ref" | "video"; assetId: string }
  | { target: "reuse"; job: Job };

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface Ctx {
  status: AppStatus | null;
  jobs: Job[];
  assets: Record<string, Asset>;
  assetList: Asset[];
  page: Page;
  go: (p: Page) => void;
  handoff: Handoff | null;
  send: (h: Handoff) => void;
  takeHandoff: (page: Page) => Handoff | null;
  toast: (text: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
  lightbox: { id: string; ids: string[] } | null;
  openAsset: (id: string, ids?: string[]) => void;
  closeAsset: () => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  setStatus: (s: AppStatus) => void;
}

const AppContext = createContext<Ctx | null>(null);

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
};

const pageFromHash = (): Page => {
  const h = location.hash.replace(/^#\/?/, "");
  return h === "video" || h === "library" ? h : "image";
};

const handoffPage = (h: Handoff): Page =>
  h.target === "image-source" ? "image" : h.target === "video-slot" ? "video" : h.job.kind;

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [jobMap, setJobMap] = useState<Record<string, Job>>({});
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [page, setPage] = useState<Page>(pageFromHash);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lightbox, setLightbox] = useState<Ctx["lightbox"]>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handoffRef = useRef<Handoff | null>(null);
  const jobMapRef = useRef(jobMap);
  jobMapRef.current = jobMap;

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, js, as] = await Promise.all([api.status(), api.jobs(), api.assets()]);
      setStatus(s);
      setJobMap(Object.fromEntries(js.map((j) => [j.id, j])));
      setAssets(Object.fromEntries(as.map((a) => [a.id, a])));
    } catch (err) {
      toast(`Can't reach the server: ${(err as Error).message}`, "error");
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const es = new EventSource("/api/events");
    let opened = false;
    es.onopen = () => {
      // Resync after a reconnect so nothing missed while offline is lost.
      if (opened) void load();
      opened = true;
    };
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as ServerEvent;
      switch (e.type) {
        case "job":
          if (jobMapRef.current[e.job.id]?.status !== "failed" && e.job.status === "failed") toast(`Generation failed: ${e.job.error}`, "error");
          setJobMap((m) => ({ ...m, [e.job.id]: e.job }));
          break;
        case "job-deleted":
          setJobMap(({ [e.id]: _, ...rest }) => rest);
          break;
        case "asset":
          setAssets((m) => ({ ...m, [e.asset.id]: e.asset }));
          break;
        case "asset-deleted":
          setAssets(({ [e.id]: _, ...rest }) => rest);
          break;
        case "status":
          setStatus(e.status);
          break;
      }
    };
    return () => es.close();
  }, [load, toast]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((p: Page) => {
    location.hash = `/${p}`;
    setPage(p);
  }, []);

  const send = useCallback(
    (h: Handoff) => {
      handoffRef.current = h;
      setHandoff(h);
      setLightbox(null);
      go(handoffPage(h));
    },
    [go],
  );

  const takeHandoff = useCallback((p: Page) => {
    const h = handoffRef.current;
    if (!h || handoffPage(h) !== p) return null;
    handoffRef.current = null;
    setHandoff(null);
    return h;
  }, []);

  const jobs = useMemo(() => Object.values(jobMap).sort((a, b) => b.createdAt - a.createdAt), [jobMap]);
  const assetList = useMemo(() => Object.values(assets).sort((a, b) => b.createdAt - a.createdAt), [assets]);

  const value: Ctx = {
    status,
    jobs,
    assets,
    assetList,
    page,
    go,
    handoff,
    send,
    takeHandoff,
    toast,
    toasts,
    lightbox,
    openAsset: (id, ids) => setLightbox({ id, ids: ids ?? [id] }),
    closeAsset: () => setLightbox(null),
    settingsOpen,
    setSettingsOpen,
    setStatus,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** useState persisted to localStorage (best-effort; storage can be unavailable). */
export function usePersistent<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [key, value]);
  return [value, setValue];
}
