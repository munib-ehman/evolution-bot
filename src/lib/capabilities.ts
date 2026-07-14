/**
 * Runtime capability detection. Everything here is free and local — it just
 * tells the UI which in-browser features are available so we can degrade
 * gracefully (WebGPU → WASM → text-only) and never hard-crash on a weak device.
 */

let webgpuCache: boolean | null = null;

/** True if the browser exposes a usable WebGPU adapter (fast path for models). */
export async function hasWebGPU(): Promise<boolean> {
  if (webgpuCache !== null) return webgpuCache;
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) {
      webgpuCache = false;
      return false;
    }
    const adapter = await gpu.requestAdapter();
    webgpuCache = !!adapter;
  } catch {
    webgpuCache = false;
  }
  return webgpuCache;
}

/** Browser-native speech recognition (Chrome/Edge/Safari). Zero download. */
export function hasWebSpeech(): boolean {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/** Browser-native speech synthesis — our free TTS fallback if Kokoro can't load. */
export function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Mic capture is needed for the local (Transformers.js) STT engines. */
export function hasMicrophone(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Rough "is this device likely to cope with ~300MB in-browser models?" heuristic. */
export function looksLowPowered(): boolean {
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if (typeof mem === "number" && mem > 0 && mem < 4) return true;
  if (typeof cores === "number" && cores > 0 && cores < 4) return true;
  return false;
}
