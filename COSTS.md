# 💸 COSTS — proof this is $0

The golden rule for this project: **totally free, zero cost, open-source only.**
Here's every component and what it costs you.

## Build & run: $0

| Component | What it is | Runs where | Your cost |
|---|---|---|---|
| Vite + React + TypeScript | Build tooling & UI framework | Your machine / CI | **$0** (MIT) |
| three / @react-three/fiber / drei | 3D rendering | **Shopper's GPU** | **$0** (MIT) |
| Ready Player Me avatar | GLB loaded by URL | **Shopper's browser** | **$0** (free for commercial) |
| Kokoro TTS (`kokoro-js`) | Text-to-speech | **Shopper's browser** (WebGPU/WASM) | **$0** (Apache-2.0) |
| Web Speech API | Default speech-to-text | **Shopper's browser** | **$0** (browser built-in) |
| Transformers.js (Moonshine/Whisper) | Optional fully-local STT | **Shopper's browser** | **$0** (Apache-2.0) |
| Lip-sync | Web Audio amplitude → morph targets | **Shopper's browser** | **$0** |
| Model weights | Downloaded once, then cached | HF CDN → browser cache | **$0** (public CDN) |
| Hosting | Static site | GitHub Pages / Netlify / Cloudflare (free tier) | **$0** |

**No paid APIs. No cloud GPU. No server. No database. No subscriptions. No
telemetry.** Because all AI inference (STT + TTS) happens on the *shopper's* device,
there is no per-request cost that lands on you — traffic scales for free.

## Why there's no server cost

The app is a **pure static front-end**. `npm run build` emits plain HTML/JS/CSS/WASM
to `dist/`. Any static host serves it. There is no backend to pay for or keep running.

## The one optional cost: the LLM "brain"

The **only** thing that can touch an external paid service is the LLM, and it's
optional:

- **Default = mock mode.** No key, no signup, no network call for answers — rule-based
  responses from `products.json`. **$0 forever.**
- **Free-tier providers.** Groq, Google Gemini, and OpenRouter (free models) all have
  no-cost tiers. Configure via `.env` (`VITE_LLM_*`). **$0** within those tiers.
- **Self-host later.** Point `VITE_LLM_BASE_URL` at a local Ollama / LM Studio /
  llama.cpp server (OpenAI-compatible). **$0**, fully private, no third party.

### How to guarantee you stay at $0
1. Ship it in **mock mode** (default) — the entire demo works.
2. Or use a **free-tier** key and stay within its limits.
3. Or run a **local** LLM server for unlimited, private, free inference.

You only start paying if *you choose* to exceed a provider's free tier — and even then
STT, TTS, 3D, lip-sync, and hosting remain $0. Only the brain would incur cost.

## One-time bandwidth (not a charge to you)

On a shopper's first visit, models download from the **free public Hugging Face CDN**
and are then browser-cached:

- Kokoro TTS ≈ 300 MB (q8 build is smaller)
- Whisper-tiny ≈ 75 MB · Moonshine-tiny ≈ 50 MB (only if the local STT option is used)

This is served by the CDN, not by you, and only happens once per device.
