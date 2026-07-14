/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of an OpenAI-compatible chat completions API (e.g. Groq / OpenRouter). */
  readonly VITE_LLM_BASE_URL?: string;
  /** API key for the LLM provider. Kept out of source — supplied via .env only. */
  readonly VITE_LLM_API_KEY?: string;
  /** Model id to request from the provider. */
  readonly VITE_LLM_MODEL?: string;
  /** Supabase project URL — set together with the anon key to enable the magic-link login gate. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable key (sb_publishable_…) — the current name for the browser-safe key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Supabase anon (public) key — legacy name for the same browser-safe key. Either works. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/* ── Minimal Web Speech API typings (not guaranteed in the standard TS DOM lib) ── */
interface SpeechRecognitionResultLike {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResultItem {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResultItem;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((ev: Event) => void) | null;
  onstart: ((ev: Event) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface Window {
  webkitSpeechRecognition?: SpeechRecognitionCtor;
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitAudioContext?: typeof AudioContext;
}
