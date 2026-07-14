# Evolution — the 3D conversational AI copilot for ecommerce founders 🚀🤖

A friendly **3D avatar "business partner"** for ecommerce founders. Founders open
the page, see a 3D character, and can **type or talk** to it — discuss store
issues and hand it tasks like product research or platform questions. Evolution
**speaks its answers out loud with lip-synced mouth movement**.

**The whole thing costs $0 to build and $0 to run.** All speech recognition and
speech synthesis run **100% in the shopper's browser, on the shopper's device** —
nothing you pay for touches a request. It deploys as a **static site** (GitHub
Pages / Netlify / Cloudflare Pages). The only optional external call is the LLM
"brain," which defaults to a **built-in mock mode** (no key, no signup) and can be
upgraded to a **free-tier** provider via environment variables.

---

## ✨ What it does

- **3D avatar** (Ready Player Me GLB) that renders on the GPU, idles (blinks + gentle
  head/breathing motion), and lip-syncs while speaking.
- **Text-first chat** — the text box is always the primary interface (cheapest,
  works everywhere). Voice is an opt-in mic button.
- **Talk to it** — speech-to-text via the browser's Web Speech API (instant, zero
  download), or fully-local Moonshine/Whisper via Transformers.js.
- **It talks back** — Kokoro TTS runs in-browser (WebGPU, with WASM fallback) and
  streams audio; the avatar's jaw/visemes are driven by the live audio amplitude.
- **Product brain** — answers from a simple `products.json` using lightweight
  keyword retrieval, in mock mode or through a real LLM.
- **Graceful degradation** — detects WebGPU (→ WASM fallback), offers a browser-voice
  fallback if Kokoro can't load, a text-only mode for weak devices, and a built-in
  procedural avatar if the GLB URL ever fails.

---

## 🧱 The fully-free architecture

| Concern | Choice | Where it runs | Cost | License |
|---|---|---|---|---|
| Framework | Vite + React + TypeScript | build/dev | $0 | MIT |
| 3D | three + @react-three/fiber + drei | shopper's GPU | $0 | MIT |
| Avatar | Ready Player Me GLB (by URL) | shopper's browser | $0 | free for commercial |
| TTS | Kokoro via `kokoro-js` (`onnx-community/Kokoro-82M-v1.0-ONNX`) | shopper's browser (WebGPU/WASM) | $0 | Apache-2.0 |
| STT (default) | Web Speech API (`webkitSpeechRecognition`) | shopper's browser | $0 | browser built-in |
| STT (local option) | Transformers.js — Moonshine / Whisper | shopper's browser | $0 | Apache-2.0 |
| Lip-sync | Web Audio `AnalyserNode` → morph targets | shopper's browser | $0 | — |
| LLM brain | Mock (default) **or** any OpenAI-compatible endpoint | client → optional free-tier API | $0 on free tier | — |
| Hosting | Static site | GitHub Pages / Netlify / Cloudflare | $0 | — |

Model weights download **once** from the Hugging Face CDN and are cached by the
browser (via Transformers.js / kokoro-js — IndexedDB/Cache API). No model files are
committed to the repo. No backend, no database, no telemetry, no trackers.

**The end-to-end loop** (see `src/hooks/useAssistant.ts`):

```
[text typed] ─┐
              ├─▶ LLM brain (mock or free-tier API) ─▶ reply text
[mic → STT] ──┘                                          │
                                                         ▼
                              Kokoro TTS (streaming) ─▶ Web Audio playback
                                                         │
                                          AnalyserNode amplitude ─▶ avatar lip-sync
```

---

## 🚀 Run it locally

Requirements: Node 18+ (works on Node 24).

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173) in **Chrome or Edge**
(best Web Speech + WebGPU support). That's it — no key, no signup. It runs in
**mock mode** with rule-based answers from the catalog.

> On first use of voice, Kokoro downloads (~300 MB) and is then cached. You'll see
> a small "warming up…" indicator. This happens **once**.

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
npm run typecheck  # type-check only
```

---

## 🧠 Switch the LLM: mock mode ↔ free-tier provider

By default there's **no LLM** — the mock brain answers from `products.json`. To use
a real model, copy `.env.example` to `.env` and set **one** free-tier provider:

```bash
cp .env.example .env
```

```dotenv
# Example: Groq free tier (fast) — https://console.groq.com/keys
VITE_LLM_BASE_URL=https://api.groq.com/openai/v1
VITE_LLM_API_KEY=gsk_your_free_key_here
VITE_LLM_MODEL=llama-3.3-70b-versatile
```

Then restart `npm run dev`. The header badge switches from **"Mock mode · $0"** to
**"LLM connected"**. `.env.example` also lists ready-to-paste configs for
**OpenRouter** (free models), **Google Gemini** (free tier), and **local Ollama /
LM Studio** (any OpenAI-compatible endpoint works).

- The key is **never hardcoded** — it's read from `.env`, which is git-ignored.
- Delete/blank the vars to instantly fall back to mock mode.
- ⚠️ Vite inlines `VITE_*` vars into the client bundle. That's fine for **your own**
  demo/free-tier key, but for a public production store, proxy the LLM through a
  tiny serverless function so the key isn't shipped to browsers. (STT/TTS still run
  fully client-side; only the brain would move behind a proxy.)

---

## 🧑‍🎨 Swap the avatar

Evolution loads a Ready Player Me GLB **by URL** — no files in the repo.

1. Create a free avatar at **https://readyplayer.me** and copy its `.glb` URL.
2. Keep the morph targets for lip-sync by appending:
   `?morphTargets=ARKit,Oculus%20Visemes&textureAtlas=1024`
3. Paste it into **Settings → Avatar → Ready Player Me GLB URL**, or change
   `DEFAULT_AVATAR_URL` in `src/avatar/constants.ts`.

If a URL fails to load, the app automatically shows a **built-in procedural head**
(still blinks + lip-syncs) so nothing breaks.

---

## 🛒 Edit the products

Edit **`public/products.json`** (name, price, description, tags). The mock brain and
the retrieval context both read from it — no rebuild of logic needed, no database.

---

## ☁️ Deploy free (static site)

Build once: `npm run build` → outputs to `dist/`. `base: "./"` is already set so it
works on any subpath.

**GitHub Pages**
```bash
npm run build
npx gh-pages -d dist        # or push dist/ via a Pages action
```
Add your `VITE_*` env vars as repo secrets and inject them at build time if you use
a real LLM (otherwise it deploys in mock mode — still fully functional).

**Netlify** — build command `npm run build`, publish directory `dist`. Add `VITE_*`
vars under Site settings → Environment variables.

**Cloudflare Pages** — framework preset "Vite", build command `npm run build`, output
`dist`. Add `VITE_*` vars under Settings → Environment variables.

> All three offer free tiers that comfortably host this static site. No server, no
> functions required (unless you later add an LLM proxy).

---

## 🔐 Privacy & cost notes

- **No audio is ever uploaded to a paid service.** Kokoro TTS and the local
  Moonshine/Whisper STT run entirely on-device. (The default Web Speech API may use
  the browser's own recognizer, which is free and keyless; switch to Moonshine/Whisper
  in settings for fully-local, no-upload recognition.)
- **No telemetry, analytics, or trackers.**
- **Browser cache/IndexedDB** is used only to cache model weights (that's the intended
  behavior of kokoro-js / Transformers.js). Nothing critical depends on storage.

See **[COSTS.md](./COSTS.md)** for a component-by-component $0 breakdown.

---

## 🗂️ Project structure

```
src/
  audio/speechEngine.ts     Web Audio playback + AnalyserNode amplitude (lip-sync source)
  avatar/                   R3F scene, RPM avatar, procedural fallback, error boundary
  llm/                      config, system prompt, keyword retrieval, mock brain, API client
  stt/                      Web Speech recognizer + Transformers.js (Moonshine/Whisper)
  tts/                      Kokoro (streaming) + browser-speech fallback + dispatcher
  hooks/useAssistant.ts     the STT → LLM → TTS → lip-sync orchestration
  components/               chat UI, composer + mic, settings, icons
public/products.json        the store catalog (edit me)
```

## 📄 License

MIT (this project). Bundled/loaded models: Kokoro-82M and Moonshine/Whisper ONNX are
Apache-2.0; Ready Player Me avatars are free for commercial use under their terms.
Verify third-party terms for your own production use.
