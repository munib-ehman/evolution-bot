export interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  tags: string[];
}

export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  /** Final/committed text of the message. */
  content: string;
  /** True while the assistant reply is still being produced or spoken. */
  pending?: boolean;
  /** Render content as a markdown report bubble (skill runs). */
  markdown?: boolean;
  /** Status line shown while a skill run hasn't produced tokens yet. */
  progress?: string;
  /** Offer a "Queue this fix" action under a finished report. */
  escalate?: { taskTool: string; note: string };
  /** Persisted Shopify proposal. The model can prepare it but cannot execute it. */
  action?: import("./lib/actions").ShopifyActionProposal;
  /** Customer-specific cart recovery work waiting for merchant approval. */
  recoveryProposal?: import("./lib/recovery").RecoveryCampaignProposal;
}

/** Speech-to-text engine choice, selectable in Settings. */
export type SttEngine = "webspeech" | "moonshine" | "whisper";

/** Text-to-speech engine choice. */
export type TtsEngine = "kokoro" | "browser" | "off";

export interface Settings {
  sttEngine: SttEngine;
  ttsEngine: TtsEngine;
  voice: string;
  avatarUrl: string;
  /** When true, skip all in-browser AI models and just show text chat. */
  textOnly: boolean;
}
