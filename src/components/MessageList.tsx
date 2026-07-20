import { useEffect, useRef } from "react";
import type { Message } from "../types";
import type { AssistantStatus } from "../hooks/useAssistant";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  messages: Message[];
  status: AssistantStatus;
  /** Fired when the owner clicks "Ask the team to fix this" under a report. */
  onEscalate?: (taskTool: string, note: string) => void;
}

export function MessageList({ messages, status, onEscalate }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  return (
    <div className="transcript" role="log" aria-live="polite">
      {messages.map((m) =>
        m.markdown ? (
          <div key={m.id} className="bubble assistant report">
            {m.content ? (
              // Safe: renderMarkdown escapes the source before parsing, so
              // only marked's own generated tags can appear here.
              <div className="report-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
            ) : (
              <span className="report-progress">{m.progress ?? "Working…"}</span>
            )}
            {m.escalate && !m.pending && onEscalate && (
              <button
                type="button"
                className="report-escalate"
                onClick={() => onEscalate(m.escalate!.taskTool, m.escalate!.note)}
              >
                Ask the team to fix this
              </button>
            )}
          </div>
        ) : (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ),
      )}

      {status === "thinking" && !messages.some((m) => m.pending && m.markdown) && (
        <div className="bubble assistant typing" aria-label="Assistant is thinking">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
