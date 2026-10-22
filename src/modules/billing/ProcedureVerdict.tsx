// src/modules/billing/ProcedureVerdict.tsx
// A crítica do procedimento como o api devolveu (contrato §2): "faturável ·
// BPA-I" ou "não faturável — motivo"; a apresentação em atraso (B7) e a
// SIGTAP de outra competência quando a da data não foi importada.
import type { PerformedProcedure } from "../../lib/api";
import { LATE_TEXT, fallbackNotice, verdict } from "../../lib/billing";
import { Tag } from "../../components/Tag";

export function ProcedureVerdict({ p }: { p: PerformedProcedure }) {
  const v = verdict(p);
  const fallback = fallbackNotice(p);
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <Tag tone={v.tone} mono={false}>{v.text}</Tag>
      {p.late && <Tag tone="info" mono={false}>{LATE_TEXT}</Tag>}
      {fallback && <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>{fallback}</span>}
    </span>
  );
}
