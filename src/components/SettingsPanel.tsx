import { useState } from "react";
import type { Settings, SttEngine, TtsEngine } from "../types";
import { VOICES } from "../tts";
import { llmConfig } from "../llm/config";
import { CloseIcon } from "./icons";

interface Props {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  isMockMode: boolean;
  onClose: () => void;
}

export function SettingsPanel({ settings, updateSettings, isMockMode, onClose }: Props) {
  const [avatarDraft, setAvatarDraft] = useState(settings.avatarUrl);

  return (
    <div className="settings-overlay" role="dialog" aria-label="Settings" aria-modal="true">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="icon-btn ghost" onClick={onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>

        {/* ── LLM brain status ────────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Assistant brain</h3>
          {isMockMode ? (
            <p className="muted">
              Running in <strong>mock mode</strong> — rule-based answers from the catalog. No key, no
              cost. Add a free-tier LLM key in <code>.env</code> to make Evolution smarter (see README).
            </p>
          ) : (
            <p className="muted">
              Connected to <strong>{new URL(llmConfig.baseUrl).host}</strong>
              {llmConfig.model ? ` · model ${llmConfig.model}` : ""}.
            </p>
          )}
        </section>

        {/* ── Voice output ────────────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Voice output (TTS)</h3>
          <label className="field">
            <span>Engine</span>
            <select
              value={settings.ttsEngine}
              onChange={(e) => updateSettings({ ttsEngine: e.target.value as TtsEngine })}
            >
              <option value="kokoro">Kokoro — natural, in-browser (~300MB once)</option>
              <option value="browser">Browser voice — instant, no download</option>
              <option value="off">Off — text only</option>
            </select>
          </label>

          {settings.ttsEngine === "kokoro" && (
            <label className="field">
              <span>Voice</span>
              <select value={settings.voice} onChange={(e) => updateSettings({ voice: e.target.value })}>
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        {/* ── Voice input ─────────────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Voice input (STT)</h3>
          <label className="field">
            <span>Engine</span>
            <select
              value={settings.sttEngine}
              onChange={(e) => updateSettings({ sttEngine: e.target.value as SttEngine })}
            >
              <option value="webspeech">Browser (Web Speech) — instant, no download</option>
              <option value="moonshine">Moonshine — fully local, English (~50MB)</option>
              <option value="whisper">Whisper — fully local, multilingual (~75MB)</option>
            </select>
          </label>
          <p className="muted small">
            The local options never upload your audio anywhere — recognition runs on your device.
          </p>
        </section>

        {/* ── Avatar ──────────────────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Avatar</h3>
          <label className="field">
            <span>Ready Player Me GLB URL</span>
            <input
              type="text"
              value={avatarDraft}
              onChange={(e) => setAvatarDraft(e.target.value)}
              placeholder="https://models.readyplayer.me/xxxx.glb"
              spellCheck={false}
            />
          </label>
          <button
            className="btn"
            onClick={() => updateSettings({ avatarUrl: avatarDraft.trim() })}
            disabled={!avatarDraft.trim() || avatarDraft.trim() === settings.avatarUrl}
          >
            Load avatar
          </button>
          <p className="muted small">
            Create your own free at readyplayer.me. Keep the ARKit + Oculus Visemes morph targets for
            lip-sync.
          </p>
        </section>

        {/* ── Conversation mode ───────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Conversation</h3>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.textOnly}
              onChange={(e) => updateSettings({ textOnly: e.target.checked })}
            />
            <span>Text-only mode (skip all in-browser AI models)</span>
          </label>
        </section>
      </div>
    </div>
  );
}
