import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MicIcon, SendIcon } from "./icons";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
  /** True when voice is available (mic supported + voice not disabled). */
  canTalk: boolean;
  /** True while the chat view is the visible one (composer stays mounted). */
  active: boolean;
  /** Jump back to the voice stage and start listening right away. */
  onVoice: () => void;
}

/**
 * The chat-view composer: a text box with one morphing action button.
 * Empty box → mic (returns you to the voice stage, already listening).
 * Typing → send. One button, no competing controls.
 */
export function Composer({ onSend, disabled, canTalk, active, onVoice }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // When the chat view opens, put the cursor straight into the box.
  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const showMic = canTalk && !value.trim();

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        ref={inputRef}
        className="composer-input"
        placeholder="Type a message…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        aria-label="Message"
      />

      {showMic ? (
        <button
          type="button"
          className="icon-btn mic-cta"
          onClick={onVoice}
          aria-label="Switch to voice"
          title="Switch to voice"
        >
          <MicIcon size={20} />
        </button>
      ) : (
        <button
          type="submit"
          className="icon-btn send"
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          title="Send"
        >
          <SendIcon size={18} />
        </button>
      )}
    </form>
  );
}
