// Botão de ação (spec 6a §3.3/§3.6): ocupado e bloqueado usam aria-disabled
// (o foco não se perde), o motivo do bloqueio fica visível e ligado ao botão,
// e um clique repetido durante a ação não dispara de novo.
import { useId, useRef, useState, type ReactNode } from "react";
import { buttonStyle, dangerButtonStyle, disabledButtonStyle, secondaryButtonStyle } from "./formStyles";

export function ActionButton({ children, onClick, busy, disabledReason, variant = "primary", type = "button" }: {
  children: ReactNode; onClick(): void | Promise<void>; busy?: boolean; disabledReason?: string | null;
  variant?: "primary" | "secondary" | "danger"; type?: "button" | "submit";
}) {
  const reasonId = useId();
  const running = useRef(false);
  const [ pending, setPending ] = useState(false);
  const isBusy = busy || pending;
  const blocked = isBusy || !!disabledReason;
  const base = variant === "danger" ? dangerButtonStyle : variant === "secondary" ? secondaryButtonStyle : buttonStyle;

  async function handle() {
    if (blocked || running.current) return;
    running.current = true;
    setPending(true);
    try { await onClick(); } finally { running.current = false; setPending(false); }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button type={type} onClick={(e) => { if (blocked) e.preventDefault(); void handle(); }} aria-disabled={blocked || undefined}
        aria-busy={isBusy || undefined} aria-describedby={disabledReason ? reasonId : undefined}
        style={blocked ? disabledButtonStyle : base}>
        {children}{isBusy ? " …" : null}
      </button>
      {disabledReason && <p id={reasonId} style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{disabledReason}</p>}
    </span>
  );
}
