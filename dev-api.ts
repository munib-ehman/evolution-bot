/**
 * Dev-server twin of the Vercel functions in api/ — implements /api/chat and
 * /api/tts as Vite middleware so `npm run dev` behaves exactly like
 * production. Reads GROQ_API_KEY from .env (server-side only; never
 * VITE_-prefixed). Kept in lockstep with api/chat.ts and api/tts.ts via the
 * shared constants in api/_shared.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";
import {
  GROQ_BASE,
  CHAT_MODEL_DEFAULT,
  CHAT_MAX_MESSAGES,
  CHAT_MAX_TOTAL_CHARS,
  TTS_MODEL_DEFAULT,
  TTS_MAX_CHARS,
  mapVoice,
} from "./api/_shared";
import { runAudit, resolveUserFull } from "./api/_audit";
import { runShopifyAuthStart, runShopifyCallback, type ShopifyEnv } from "./api/_shopify";
import { runSkill, type SkillRunBody } from "./api/_skills";
import type { SkillEnv } from "./api/_skillTools";
import { sendTaskEmail } from "./api/_email";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, text?: string): void {
  res.statusCode = status;
  if (text) {
    res.setHeader("Content-Type", "text/plain");
    res.end(text);
  } else {
    res.end();
  }
}

/** Pipe one of OUR web Responses (any status, streaming or JSON) to Node. */
async function pipeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (response.body) {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
  }
  res.end();
}

async function pipeUpstream(res: ServerResponse, upstream: Response, fallbackType: string): Promise<void> {
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    send(res, 502, `Upstream error (${upstream.status}). ${detail.slice(0, 200)}`);
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", upstream.headers.get("content-type") ?? fallbackType);
  res.setHeader("Cache-Control", "no-store");
  for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
    res.write(chunk);
  }
  res.end();
}

export function devApi(): Plugin {
  let key = "";
  let chatModel = CHAT_MODEL_DEFAULT;
  let ttsModel = TTS_MODEL_DEFAULT;
  let auditEnv: ShopifyEnv = {};
  let skillEnv: SkillEnv = {};

  return {
    name: "dev-api",
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), "");
      key = (env.GROQ_API_KEY ?? "").trim();
      chatModel = (env.GROQ_CHAT_MODEL ?? "").trim() || CHAT_MODEL_DEFAULT;
      ttsModel = (env.GROQ_TTS_MODEL ?? "").trim() || TTS_MODEL_DEFAULT;
      auditEnv = {
        groqKey: key,
        groqModel: (env.GROQ_CHAT_MODEL ?? "").trim(),
        groqResearchModel: (env.GROQ_RESEARCH_MODEL ?? "").trim(),
        supabaseUrl: (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim(),
        serviceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
        shopifyApiKey: (env.SHOPIFY_API_KEY ?? "").trim(),
        shopifyApiSecret: (env.SHOPIFY_API_SECRET ?? "").trim(),
        shopifyScopes: (env.SHOPIFY_SCOPES ?? "").trim(),
      };
      skillEnv = {
        ...auditEnv, // includes the Shopify app creds for token refresh
        resendKey: (env.RESEND_API_KEY ?? "").trim(),
        resendFrom: (env.RESEND_FROM ?? "").trim(),
        teamEmails: (env.TEAM_NOTIFY_EMAILS ?? "").trim(),
      };
      if (!key) {
        server.config.logger.warn(
          "[dev-api] GROQ_API_KEY not set in .env — /api/chat and /api/tts will report unconfigured (the app falls back to mock replies and the in-browser voice).",
        );
      }

      server.middlewares.use("/api/chat", (req, res) => {
        void (async () => {
          if (req.method === "GET") return send(res, key ? 204 : 503);
          if (req.method !== "POST") return send(res, 405, "Method not allowed");
          if (!key) return send(res, 503, "LLM proxy not configured.");
          let messages: { role: string; content: string }[];
          try {
            const body = JSON.parse(await readBody(req)) as { messages?: unknown };
            if (!Array.isArray(body.messages)) throw new Error("bad");
            messages = body.messages as { role: string; content: string }[];
          } catch {
            return send(res, 400, "Invalid request body.");
          }
          if (messages.length === 0 || messages.length > CHAT_MAX_MESSAGES) {
            return send(res, 400, "Too many messages.");
          }
          const total = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
          if (total > CHAT_MAX_TOTAL_CHARS) return send(res, 400, "Conversation too large.");

          const upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: chatModel, messages, temperature: 0.7, max_tokens: 220, stream: true }),
          });
          await pipeUpstream(res, upstream, "text/event-stream");
        })().catch((err) => {
          if (!res.headersSent) send(res, 500, String(err));
          else res.end();
        });
      });

      server.middlewares.use("/api/audit", (req, res) => {
        void (async () => {
          if (req.method === "GET") return send(res, 204);
          if (req.method !== "POST") return send(res, 405, "Method not allowed");
          let url: unknown;
          try {
            url = (JSON.parse(await readBody(req)) as { url?: unknown }).url;
          } catch {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Invalid request body." }));
          }
          const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : null;
          const { status, body } = await runAudit(url, auth, auditEnv);
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        })().catch((err) => {
          if (!res.headersSent) send(res, 500, String(err));
          else res.end();
        });
      });

      server.middlewares.use("/api/shopify-auth", (req, res) => {
        void (async () => {
          if (req.method === "GET") {
            return send(res, auditEnv.shopifyApiKey && auditEnv.shopifyApiSecret ? 204 : 503);
          }
          if (req.method !== "POST") return send(res, 405, "Method not allowed");
          let shop: unknown;
          try {
            shop = (JSON.parse(await readBody(req)) as { shop?: unknown }).shop;
          } catch {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Invalid request body." }));
          }
          const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : null;
          const origin = `http://${req.headers.host ?? "localhost:5173"}`;
          const { status, body } = await runShopifyAuthStart(shop, auth, origin, auditEnv);
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        })().catch((err) => {
          if (!res.headersSent) send(res, 500, String(err));
          else res.end();
        });
      });

      server.middlewares.use("/api/shopify-callback", (req, res) => {
        void (async () => {
          const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost:5173"}`);
          const { redirect } = await runShopifyCallback(url, auditEnv);
          res.statusCode = 302;
          res.setHeader("Location", redirect);
          res.end();
        })().catch((err) => {
          if (!res.headersSent) send(res, 500, String(err));
          else res.end();
        });
      });

      server.middlewares.use("/api/skill", (req, res) => {
        void (async () => {
          if (req.method === "GET") return send(res, 204);
          if (req.method !== "POST") return send(res, 405, "Method not allowed");
          let body: SkillRunBody;
          try {
            body = JSON.parse(await readBody(req)) as SkillRunBody;
          } catch {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Invalid request body." }));
          }
          const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : null;
          const origin = `http://${req.headers.host ?? "localhost:5173"}`;
          await pipeResponse(res, await runSkill(body, auth, origin, skillEnv));
        })().catch((err) => {
          if (!res.headersSent) send(res, 500, String(err));
          else res.end();
        });
      });

      server.middlewares.use("/api/task-notify", (req, res) => {
        void (async () => {
          if (req.method !== "POST") return send(res, 405, "Method not allowed");
          let taskId = "";
          try {
            const body = JSON.parse(await readBody(req)) as { taskId?: unknown };
            taskId = typeof body.taskId === "string" ? body.taskId : "";
          } catch {
            return send(res, 400);
          }
          if (!/^[0-9a-f-]{36}$/i.test(taskId)) return send(res, 400);
          const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : null;
          const user = await resolveUserFull(skillEnv, auth);
          if (!user) return send(res, 401);
          if (skillEnv.resendKey && skillEnv.supabaseUrl && skillEnv.serviceRoleKey) {
            try {
              const lookup = await fetch(
                `${skillEnv.supabaseUrl}/rest/v1/tasks?id=eq.${taskId}&user_id=eq.${user.id}&select=tool,request&limit=1`,
                {
                  headers: {
                    apikey: skillEnv.serviceRoleKey,
                    Authorization: `Bearer ${skillEnv.serviceRoleKey}`,
                  },
                  signal: AbortSignal.timeout(4_000),
                },
              );
              const rows = lookup.ok ? ((await lookup.json()) as { tool?: string; request?: string }[]) : [];
              if (rows[0]) {
                await sendTaskEmail(skillEnv, {
                  userEmail: user.email,
                  shopDomain: null,
                  tool: rows[0].tool ?? "custom",
                  request: rows[0].request ?? "",
                  taskId,
                  origin: `http://${req.headers.host ?? "localhost:5173"}`,
                });
              }
            } catch {
              /* best-effort */
            }
          }
          send(res, 204);
        })().catch((err) => {
          if (!res.headersSent) send(res, 500, String(err));
          else res.end();
        });
      });

      server.middlewares.use("/api/tts", (req, res) => {
        void (async () => {
          if (req.method === "GET") return send(res, key ? 204 : 503);
          if (req.method !== "POST") return send(res, 405, "Method not allowed");
          if (!key) return send(res, 503, "TTS proxy not configured.");
          let text = "";
          let voice: string | undefined;
          try {
            const body = JSON.parse(await readBody(req)) as { text?: unknown; voice?: unknown };
            if (typeof body.text !== "string") throw new Error("bad");
            text = body.text.trim();
            voice = typeof body.voice === "string" ? body.voice : undefined;
          } catch {
            return send(res, 400, "Invalid request body.");
          }
          if (!text) return send(res, 400, "Empty text.");
          if (text.length > TTS_MAX_CHARS) return send(res, 400, `Text too long (max ${TTS_MAX_CHARS} chars).`);

          const upstream = await fetch(`${GROQ_BASE}/audio/speech`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: ttsModel, voice: mapVoice(voice), input: text, response_format: "wav" }),
          });
          await pipeUpstream(res, upstream, "audio/wav");
        })().catch((err) => {
          if (!res.headersSent) send(res, 500, String(err));
          else res.end();
        });
      });
    },
  };
}
