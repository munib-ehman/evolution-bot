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
