import { useCallback, useState } from "react";
import { api } from "./api";
import { Lightbox } from "./components/Lightbox";
import { Icon, money, useEscape } from "./components/ui";
import { ImageStudio } from "./pages/ImageStudio";
import { Library } from "./pages/Library";
import { VideoStudio } from "./pages/VideoStudio";
import { AppProvider, useApp, type Page } from "./store";

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "image", label: "Image", icon: "image" },
  { id: "video", label: "Video", icon: "video" },
  { id: "library", label: "Library", icon: "grid" },
];

function Logo() {
  return (
    <span className="logo">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M10 8h8a5 5 0 0 1 1.8 9.7A5.5 5.5 0 0 1 18.5 28H10z" fill="var(--accent-ink)" />
      </svg>
      <span>Biggsfield</span>
    </span>
  );
}

function Header() {
  const { page, go, status, jobs, setSettingsOpen } = useApp();
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  return (
    <header className="topbar">
      <Logo />
      <nav className="nav">
        {NAV.map((n) => (
          <a key={n.id} href={`#/${n.id}`} className={page === n.id ? "on" : ""} onClick={(e) => (e.preventDefault(), go(n.id))}>
            <Icon name={n.icon} size={16} />
            {n.label}
          </a>
        ))}
      </nav>
      <div className="topbar-right">
        {status?.mock && <span className="badge warn" title="No real xAI calls are made">Mock mode</span>}
        {running > 0 && (
          <span className="badge live">
            <span className="dot" /> {running} rendering
          </span>
        )}
        <span className="badge" title="Total spend reported by xAI for generations in this library">
          {money(status?.spendUsd ?? 0)} spent
        </span>
        <button type="button" className={`icon-btn${status && !status.hasKey ? " attention" : ""}`} onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <Icon name="gear" />
        </button>
      </div>
    </header>
  );
}

function Settings() {
  const { status, setStatus, setSettingsOpen, toast } = useApp();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  useEscape(useCallback(() => setSettingsOpen(false), [setSettingsOpen]));
  const save = async (value: string) => {
    setBusy(true);
    try {
      setStatus(await api.saveKey(value));
      toast(value ? "API key saved" : "API key removed");
      setKey("");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="modal-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <h3 className="label">xAI API key</h3>
        {status?.mock ? (
          <p className="muted">Mock mode is on: every xAI call is simulated locally. Restart without <code>--mock</code> to use your real key.</p>
        ) : status?.keySource === "env" ? (
          <p className="muted">
            Using <code>XAI_API_KEY</code> from the server environment.
          </p>
        ) : (
          <>
            <p className="muted small">
              {status?.keySource === "settings" ? "A key is saved on this server. Paste a new one to replace it." : "No key yet."} Get one at{" "}
              <a href="https://console.x.ai" target="_blank" rel="noreferrer">
                console.x.ai
              </a>
              . It's stored only in <code>data/settings.json</code> on the machine running Biggsfield and never sent back to the browser.
            </p>
            <form
              className="key-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) void save(key.trim());
              }}
            >
              <input type="password" placeholder="xai-…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" aria-label="xAI API key" />
              <button type="submit" className="btn primary" disabled={busy || !key.trim()}>
                Save
              </button>
            </form>
            {status?.keySource === "settings" && (
              <button type="button" className="btn ghost sm danger-hover" onClick={() => save("")} disabled={busy}>
                Remove saved key
              </button>
            )}
          </>
        )}
        <h3 className="label">Prompt enhancer</h3>
        <p className="muted small">
          Uses <code>{status?.textModel}</code> (set <code>XAI_TEXT_MODEL</code> to change).
        </p>
        <h3 className="label">Pricing</h3>
        <p className="muted small">
          Estimates on the Generate buttons use xAI's list prices. The spend counter sums the actual cost xAI reports for each finished job.
        </p>
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const { page, settingsOpen } = useApp();
  return (
    <div className="app">
      <Header />
      {page === "image" && <ImageStudio />}
      {page === "video" && <VideoStudio />}
      {page === "library" && <Library />}
      <Lightbox />
      {settingsOpen && <Settings />}
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
