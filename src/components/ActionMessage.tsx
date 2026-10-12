// A mensagem fica logo abaixo das ações que a geraram e recebe o foco, para o
// resultado não se perder longe do clique (spec 6a §3.4).
import { useEffect, useRef } from "react";
import type { ActionMessageValue } from "../lib/useActionMessage";

export function ActionMessage({ message }: { message: ActionMessageValue }) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [ message ]);
  if (!message) return null;
  return (
    <p ref={ref} tabIndex={-1} role={message.kind === "ok" ? "status" : "alert"}
      style={{ margin: "8px 0 0", fontSize: 13, color: message.kind === "ok" ? "var(--ok)" : "var(--down)" }}>
      {message.text}
    </p>
  );
}
