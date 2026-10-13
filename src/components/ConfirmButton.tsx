// Confirmação em dois passos no próprio lugar (spec 6a §3.5), para ação
// irreversível que não pede código. Ação com código continua no SensitiveAction.
// O foco vai para a pergunta (nunca para Confirmar: um segundo Enter não pode
// executar), e enquanto a ação roda Cancelar e Escape não fazem nada — senão a
// tela voltaria ao botão com a ação ainda em curso e ela poderia rodar duas vezes.
// `onConfirm` trata e mostra os próprios erros (ex.: ActionMessage.fail).
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import { disabledButtonStyle, secondaryButtonStyle } from "./formStyles";

export function ConfirmButton({ label, question, onConfirm, variant = "secondary", disabledReason }: {
  label: string; question: string; onConfirm(): void | Promise<void>;
  variant?: "primary" | "secondary" | "danger"; disabledReason?: string | null;
}) {
  const [ asking, setAsking ] = useState(false);
  const [ running, setRunning ] = useState(false);
  const questionRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    if (asking) questionRef.current?.focus();
    else if (wasAsking.current) triggerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasAsking.current = asking;
  }, [ asking ]);

  async function confirm() {
    setRunning(true);
    try { await onConfirm(); } catch { /* quem chama mostra o erro */ } finally { setRunning(false); setAsking(false); }
  }

  if (!asking) {
    return (
      <span ref={triggerRef}>
        <ActionButton variant={variant} disabledReason={disabledReason} onClick={() => setAsking(true)}>{label}</ActionButton>
      </span>
    );
  }
  return (
    <div role="group" aria-label={question}
      onKeyDown={(e) => { if (e.key === "Escape" && !running) { e.stopPropagation(); setAsking(false); } }}
      style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span ref={questionRef} tabIndex={-1}>{question}</span>
      <ActionButton variant={variant === "danger" ? "danger" : "primary"} onClick={confirm}>Confirmar</ActionButton>
      <button type="button" aria-disabled={running || undefined} style={running ? disabledButtonStyle : secondaryButtonStyle}
        onClick={() => { if (!running) setAsking(false); }}>Cancelar</button>
    </div>
  );
}
