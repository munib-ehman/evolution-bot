import { useEffect, useRef } from "react";
import type { Message } from "../types";
import type { AssistantStatus } from "../hooks/useAssistant";

interface Props {
  messages: Message[];
  status: AssistantStatus;
}

export function MessageList({ messages, status }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  return (
    <div className="transcript" role="log" aria-live="polite">
      {messages.map((m) => (
        <div key={m.id} className={`bubble ${m.role}`}>
          {m.content}
        </div>
      ))}

      {status === "thinking" && (
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
