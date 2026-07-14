/**
 * Safe localStorage helpers. Settings persistence is a NICE-TO-HAVE only — the
 * app must work if storage is unavailable (private mode, blocked cookies), so
 * every access is wrapped and failures are swallowed. Nothing critical lives here.
 */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — ignore, settings just won't persist */
  }
}
