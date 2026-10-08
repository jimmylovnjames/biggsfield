import type { AppStatus, Asset, ImageJobRequest, Job, VideoJobRequest } from "../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new Error(data?.error ?? (text.slice(0, 200) || `HTTP ${res.status}`));
  return data as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  status: () => request<AppStatus>("/api/status"),
  saveKey: (apiKey: string) => request<AppStatus>("/api/settings", jsonInit("PUT", { apiKey })),
  jobs: () => request<Job[]>("/api/jobs"),
  assets: () => request<Asset[]>("/api/assets"),
  createImage: (req: ImageJobRequest) => request<Job>("/api/jobs/image", jsonInit("POST", req)),
  createVideo: (req: VideoJobRequest) => request<Job>("/api/jobs/video", jsonInit("POST", req)),
  deleteJob: (id: string, outputs: boolean) => request<void>(`/api/jobs/${id}${outputs ? "?outputs=1" : ""}`, { method: "DELETE" }),
  deleteAsset: (id: string) => request<void>(`/api/assets/${id}`, { method: "DELETE" }),
  favorite: (id: string, favorite: boolean) => request<Asset>(`/api/assets/${id}`, jsonInit("PATCH", { favorite })),
  enhance: (prompt: string, kind: "image" | "video") => request<{ prompt: string }>("/api/enhance", jsonInit("POST", { prompt, kind })),
};

function videoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      resolve(Number.isFinite(v.duration) ? v.duration : undefined);
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      resolve(undefined);
      URL.revokeObjectURL(url);
    };
    v.src = url;
  });
}

export async function uploadFile(file: File): Promise<Asset> {
  const params = new URLSearchParams({ name: file.name });
  if (file.type.startsWith("video/")) {
    const d = await videoDuration(file);
    if (d) params.set("duration", d.toFixed(2));
  }
  return request<Asset>(`/api/uploads?${params}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
}

export const mediaUrl = (a: Asset) => `/media/${a.file}`;
