import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Preset } from "../../shared/catalog";
import { api } from "../api";
import { useApp } from "../store";

const paths: Record<string, string> = {
  image: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-.01",
  video: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  play: "M7 4l13 8-13 8z",
  redo: "M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5",
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4",
  wand: "M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.6 1.4L21 13l-1.4.6L19 15l-.6-1.4L17 13l1.4-.6z",
  copy: "M8 8h12v12H8zM4 16V4h12",
  chevronL: "M15 5l-7 7 7 7",
  chevronR: "M9 5l7 7-7 7",
  extend: "M3 6h10v12H3zM16 9l5 3-5 3M13 12h8",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  key: "M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z",
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEscape();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  wrap,
}: {
  value: T;
  options: { id: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  wrap?: boolean;
}) {
  return (
    <div className={`segmented${wrap ? " wrap" : ""}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          className={o.id === value ? "on" : ""}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { id: string; label: string; note?: string }[] }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
          {o.note ? ` — ${o.note}` : ""}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
      {label}
    </label>
  );
}

export function Slider({ value, min, max, step = 1, onChange, suffix }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>
        {value}
        {suffix}
      </output>
    </div>
  );
}

function ratioBox(r: string) {
  if (r === "auto") return { w: 16, h: 16 };
  const [a, b] = r.split(":").map(Number);
  const s = 18 / Math.max(a, b);
  return { w: Math.max(5, a * s), h: Math.max(5, b * s) };
}

export function AspectPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="aspects">
      {options.map((r) => {
        const { w, h } = ratioBox(r);
        return (
          <button key={r} type="button" className={r === value ? "on" : ""} onClick={() => onChange(r)} aria-pressed={r === value}>
            <span className="ratio-box" style={{ width: w, height: h, borderStyle: r === "auto" ? "dashed" : "solid" }} />
            {r}
          </button>
        );
      })}
    </div>
  );
}

export function PromptBox({
  value,
  onChange,
  kind,
  placeholder,
  optional,
  counter,
}: {
  value: string;
  onChange: (v: string) => void;
  kind: "image" | "video";
  placeholder: string;
  optional?: boolean;
  /** Replaces the default character counter, e.g. a byte count against an API cap. */
  counter?: ReactNode;
}) {
  const { toast, status } = useApp();
  const [busy, setBusy] = useState(false);
  const enhance = async () => {
    setBusy(true);
    try {
      const { prompt } = await api.enhance(value, kind);
      onChange(prompt);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="prompt">
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={5} maxLength={4000} aria-label="Prompt" />
      <div className="prompt-bar">
        <span className="muted small">
          {optional ? "Optional · " : ""}
          {counter ?? `${value.length}/4000`}
        </span>
        <button type="button" className="btn ghost sm" onClick={enhance} disabled={busy || !value.trim() || !status?.hasKey} title={`Rewrite with ${status?.textModel ?? "Grok"}`}>
          <Icon name="sparkle" size={15} /> {busy ? "Enhancing…" : "Enhance"}
        </button>
      </div>
    </div>
  );
}

export function PresetGrid({ presets, value, onChange, animated }: { presets: Preset[]; value?: string; onChange: (id?: string) => void; animated?: boolean }) {
  return (
    <div className="presets">
      <button type="button" className={`preset none${!value ? " on" : ""}`} onClick={() => onChange(undefined)}>
        <span className="preset-art">
          <Icon name="close" size={16} />
        </span>
        <span className="preset-label">None</span>
      </button>
      {presets.map((p) => (
        <button key={p.id} type="button" className={`preset${p.id === value ? " on" : ""}`} onClick={() => onChange(p.id === value ? undefined : p.id)} title={p.prompt}>
          <span className="preset-art" style={{ "--h": p.hue ?? 200 } as CSSProperties}>
            {animated && <span className={`scene ${p.anim ?? ""}`} />}
          </span>
          <span className="preset-label">{p.label}</span>
        </button>
      ))}
    </div>
  );
}

export const money = (n: number | undefined) =>
  n === undefined ? "" : n < 0.1 && n > 0 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;

export function timeAgo(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}
