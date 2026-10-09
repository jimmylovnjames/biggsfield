# Biggsfield

A self-hosted, Higgsfield-style studio for **xAI Grok Imagine**. You bring an xAI API key; it gives you a cinematic image and video workflow with camera-motion presets, effects, a persistent library, and live render tracking.

## Quick start

```bash
npm install
cp .env.example .env          # optional: put XAI_API_KEY here, or paste it in Settings later
npm run build && npm start     # → http://127.0.0.1:8787
```

Development (hot reload on both sides): `npm run dev` → http://localhost:5173

**Try it without a key or spending anything:** `npm run dev:mock` (or `npm run start:mock`). Every xAI call is simulated locally with the same request/response shapes. You need `ffmpeg` on your PATH for the fake videos. Put `[fail]` or `[block]` in a prompt to see error and moderation handling.

Requires Node 20.12 or newer.

**Verify against the real API:** with the server running on your key, `npm run smoke` runs enhance → image → image edit → image-to-video (about $0.10). `npm run smoke -- --full` also covers text-to-video, frames with a keyframe, references with a voice, multi-image edit, video edit and extend (about $0.95). Every mode passed live on 2026-10-09.

## What you get

| | |
|---|---|
| **Image studio** | Text-to-image and editing with 1–5 source images (`<IMAGE_n>` tags). 15 style presets, all 16 aspect ratios, 1k/2k, quality, and 1–10 images per run. Models: Imagine Image 2.0, Quality, and classic. |
| **Video studio** | Six modes: **Text**, **Image** (animate a still), **Frames** (start/end frame plus up to 4 timed keyframes), **References** (up to 14 images and 3 lip-synced preset voices), **Edit** (restyle a clip ≤ 8.7s), and **Extend** (add 2–10s). |
| **Camera motions** | 25 presets with animated previews: dolly, crash zoom, dolly zoom, 360 orbit, FPV drone, bullet time, whip pan, snorricam, crane, hyperlapse and more. |
| **Effects** | 14 presets: disintegrate, levitate, set on fire, freeze, melt, glitch, paparazzi, explosion, turn to metal, and others. |
| **Prompt enhancer** | One-click rewrite using a Grok text model (`grok-4.3` by default, `reasoning_effort: none`, about 2s). It keeps `<IMAGE_n>`/`<AUDIO_n>` tags. |
| **Library** | Every output is downloaded to your disk, because xAI's URLs are temporary. Filter, search, favorite, and download. One click hands any image to Animate, Edit, Start/End frame, or Reference, and any video to Extend or Edit. You can also drag outputs onto any input slot. |
| **Live jobs** | Renders run on the server and stream progress over SSE. Closing the tab doesn't stop them, and a server restart resumes polling for videos that were in flight. |
| **Cost tracking** | Each Generate button shows a list-price estimate. Each finished job shows the actual cost xAI reports (`usage.cost_in_usd_ticks`), and the header shows the running total. |

The model capability matrix lives in `shared/catalog.ts`. The UI only offers combinations the API accepts: for example, Edit and Extend are only available on `grok-imagine-video`, 1080p isn't offered for reference or pinned-frame runs, and the classic model is capped at 7 references and 10s. The server re-validates every request in `server/payloads.ts`.

## How it works

```
browser (React/Vite) ──REST + SSE──▶ Express server ──▶ api.x.ai
                                       │  /v1/images/generations | /edits   (sync, b64_json)
                                       │  /v1/videos/generations | /edits | /extensions → request_id
                                       │  GET /v1/videos/{id} polled every 4s → download MP4
                                       ▼
                                  data/db.json + data/media/*
```

- The API key never reaches the browser. Inputs (uploads or library items) are sent to xAI as base64 data URLs, so nothing has to be publicly hosted.
- `data/` holds everything: the job DB, the media files, and `settings.json` (a key pasted in the UI is stored there with mode 0600). Back that folder up if you care about your library.

## Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `XAI_API_KEY` | — | Takes precedence over a key saved in Settings |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | |
| `APP_PASSWORD` | — | HTTP basic-auth password; any username works |
| `DATA_DIR` | `./data` | |
| `XAI_TEXT_MODEL` | `grok-4.3` | Used by the prompt enhancer |
| `XAI_TEXT_REASONING` | `none` | `reasoning_effort` for the enhancer; leave it empty to omit the field |
| `XAI_MOCK` | `0` | `1` turns on mock mode |

## Caveats

- **Exposing it:** anyone who can reach the server can spend your xAI credits. It binds to localhost by default. If you change `HOST`, set `APP_PASSWORD` and put it behind HTTPS.
- **Hosting:** it isn't serverless-friendly. It needs a long-running Node process and a writable disk, so a VPS, Docker host, or your own machine works; Vercel and Netlify functions don't.
- **Pricing:** estimates use xAI's list prices plus two input charges that aren't in the docs but matched every live job exactly: $0.01 per input image and $0.01 per second of input video. Video edit and extend are billed for the added seconds plus the source. The cost xAI reports for each job is the number to trust.
- **API key scopes:** a key restricted to the image and video endpoints works for everything except Enhance, which needs chat access.
- **Reference tags:** with a pinned start frame, the start frame is `<IMAGE_0>` and references start at `<IMAGE_1>`. The UI renumbers tags for you, and the server rejects tags that point at nothing.
- **Voices:** the voice list (`eve`, `ara`, `leo`, `rex`, `sal`) mirrors xAI's TTS roster. An unknown voice returns an error listing the valid IDs.

## Scripts

`npm run dev` · `npm run dev:mock` · `npm run build` · `npm start` · `npm run start:mock` · `npm run typecheck` · `npm test` (request-builder tests that check every mode against the documented xAI payload shapes)
