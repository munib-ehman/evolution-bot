/**
 * Structured logging for the /api functions (and dev-api.ts, so dev === prod).
 *
 * One JSON object per line via console — Vercel Edge captures console output
 * into the project log stream; the Vite dev server prints to the terminal.
 *
 * PII rules for `fields`: shop domains and UUIDs are fine; NEVER emails,
 * access tokens, customer names, chat/message content, or raw IPs (hash IPs
 * with hashKey() from _ratelimit.ts first).
 */

type LogLevel = "info" | "warn" | "error";

export function log(
  level: LogLevel,
  route: string,
  event: string,
  fields?: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console
  console[level](JSON.stringify({ ts: new Date().toISOString(), level, route, event, ...fields }));
}

export interface RouteLogger {
  reqId: string;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** Bind a route name + a fresh request id into every line. */
export function routeLogger(route: string): RouteLogger {
  const reqId = crypto.randomUUID();
  const emit =
    (level: LogLevel) =>
    (event: string, fields?: Record<string, unknown>): void =>
      log(level, route, event, { reqId, ...fields });
  return { reqId, info: emit("info"), warn: emit("warn"), error: emit("error") };
}
