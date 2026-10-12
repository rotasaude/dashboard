// Confirmação em dois passos no próprio lugar (spec 6a §3.5), para ação
// irreversível que não pede código. Ação com código continua no SensitiveAction.
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import { secondaryButtonStyle } from "./formStyles";

export function ConfirmButton({ label, question, onConfirm, variant = "secondary", disabledReason }: {
  label: string; question: string; onConfirm(): void | Promise<void>;
  variant?: "primary" | "secondary" | "danger"; disabledReason?: string | null;
}) {
  const [ asking, setAsking ] = useState(false);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    if (asking) groupRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else if (wasAsking.current) triggerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasAsking.current = asking;
  }, [ asking ]);

  if (!asking) {
    return (
      <span ref={triggerRef}>
        <ActionButton variant={variant} disabledReason={disabledReason} onClick={() => setAsking(true)}>{label}</ActionButton>
      </span>
    );
  }
  return (
    <div ref={groupRef} role="group" aria-label={question}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAsking(false); } }}
      style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span>{question}</span>
      <ActionButton variant={variant === "danger" ? "danger" : "primary"}
        onClick={async () => { await onConfirm(); setAsking(false); }}>Confirmar</ActionButton>
      <button type="button" style={secondaryButtonStyle} onClick={() => setAsking(false)}>Cancelar</button>
    </div>
  );
}
