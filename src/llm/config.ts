/**
 * LLM configuration, read from Vite env vars at build time. No key is ever
 * hardcoded — everything comes from `.env` (git-ignored). If the base URL or key
 * is missing, the app runs in MOCK MODE with rule-based answers: $0, no signup.
 */
export const llmConfig = {
  baseUrl: (import.meta.env.VITE_LLM_BASE_URL ?? "").trim(),
  apiKey: (import.meta.env.VITE_LLM_API_KEY ?? "").trim(),
  model: (import.meta.env.VITE_LLM_MODEL ?? "").trim(),
};

/** True when no real provider is configured — the default, zero-cost path. */
export const isMockMode = !llmConfig.baseUrl || !llmConfig.apiKey;
