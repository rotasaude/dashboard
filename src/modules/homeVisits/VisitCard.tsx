// src/modules/homeVisits/VisitCard.tsx
// Um cartão por visita da folha (módulo 24b; nada de tabela, para caber em 375 px). Mostra hora, turno, desfecho, imóvel, pessoa,
// motivos por rótulo, medidas e, na retirada, o motivo. Nunca a observação (só no detalhe). O rótulo do botão leva só a hora.
import type { HomeVisit, HomeVisitDomains } from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import { measurementsText, outcomeLabel, propertyLabel, reasonLabel, shiftLabel } from "../../lib/homeVisits";
import { Tag } from "../../components/Tag";
import { ActionButton } from "../../components/ActionButton";
import { muted, row } from "../exams/styles";

export const NO_NAME = "pessoa sem nome no cadastro";
const OUTCOME_TONE: Record<string, string> = { "1": "ok", "2": "info", "3": "neutral" };

function personText(v: HomeVisit): string {
  if (v.subject === "none") return "imóvel sem pessoa";
  const name = v.patient?.display_name ?? NO_NAME;
  return v.subject === "family_responsible" ? `família — responsável ${name}` : name;
}

export function VisitCard({ visit, domains, canWithdraw, onWithdraw, busy }: {
  visit: HomeVisit; domains: HomeVisitDomains; canWithdraw: boolean; onWithdraw(): void; busy?: boolean;
}) {
  const time = fmtHourMinute(visit.occurred_at);
  const withdrawn = visit.state === "withdrawn";
  const reasons = visit.reasons.map((c) => reasonLabel(domains, c)).join(", ");
  const measures = measurementsText(domains, visit.measurements);
  const place = visit.household?.address_short ?? `imóvel sem cadastro · ${propertyLabel(domains, visit.property_type)}`;
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: 6, opacity: withdrawn ? 0.75 : 1 }}>
      <div style={row}>
        <strong className="mono">{time}</strong>
        <span style={muted}>{shiftLabel(visit.shift)}</span>
        <Tag tone={OUTCOME_TONE[String(visit.outcome)] ?? "neutral"} mono={false}>{outcomeLabel(visit.outcome)}</Tag>
        {withdrawn && <Tag tone="down" mono={false}>retirada</Tag>}
        {visit.out_of_area && <Tag tone="info" mono={false}>fora da área</Tag>}
      </div>
      <span style={{ fontSize: 13, overflowWrap: "anywhere" }}>{personText(visit)}</span>
      <span style={muted}>{place}</span>
      {reasons && <span style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{reasons}</span>}
      {measures.length > 0 && <span style={muted}>{measures.join(" · ")}</span>}
      {withdrawn && visit.withdrawn?.reason && <span style={muted}>retirada: {visit.withdrawn.reason}</span>}
      {canWithdraw && !withdrawn && (
        <div><ActionButton variant="secondary" busy={busy} onClick={onWithdraw}>{`Retirar visita das ${time}`}</ActionButton></div>
      )}
    </article>
  );
}
