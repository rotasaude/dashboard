// Faixa do alerta do envio à BNAFAR (módulo 27b; contrato §3 "Alerta", Q34, Q42). As contagens são do api; a frase é de `alertLines`.
// Sem alerta, nada aparece.
import type { BnafarAlert } from "../../lib/api";
import { alertLines } from "../../lib/bnafar";

export function AlertBand({ alert }: { alert: BnafarAlert }) {
  const lines = alertLines(alert);
  if (lines.length === 0) return null;
  return (
    <div role="alert" style={band}>
      {lines.map((line) => <p key={line} style={{ margin: 0 }}>{line}</p>)}
    </div>
  );
}

const band = {
  display: "flex", flexDirection: "column" as const, gap: 4, padding: "10px 14px", borderRadius: 8, fontSize: 12.5,
  color: "var(--down)", border: "1px solid color-mix(in oklch, var(--down), transparent 72%)", background: "var(--down-bg)"
};
