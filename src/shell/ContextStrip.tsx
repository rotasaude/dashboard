// ContextStrip.tsx — faixa de contexto sempre visível: o que muda os números
// (período), onde se está (cidade) e avisos legais (sessão de assinatura).
import type { ReactNode } from "react";

export function ContextStrip({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="shell-context" aria-label="Contexto">
      {left}
      {right && <div className="shell-context-end">{right}</div>}
    </div>
  );
}
