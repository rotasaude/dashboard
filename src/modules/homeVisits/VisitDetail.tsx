// src/modules/homeVisits/VisitDetail.tsx
// Detalhe de uma visita (módulo 24b, F-24.10): a única tela que mostra a observação (leitura nominal, com trilha, uma vez).
// O motivo da retirada vem nulo para quem não é o dono nem enfermeiro/médico da equipe: a frase diz isso, sem inventar motivo.
import { useQuery } from "@tanstack/react-query";
import { getHomeVisit, type HomeVisitDomains } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { fmtDateTime, fmtHourMinute } from "../../lib/format";
import {
  HV_VISIT_KEY, NOMINAL_QUERY, homeVisitError, measurementsText, originLabel, outcomeLabel, propertyLabel, reasonLabel, shiftLabel
} from "../../lib/homeVisits";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { alert, box, grid, muted } from "../exams/styles";
import { personText } from "./VisitCard";

export const WITHDRAW_REASON_HIDDEN = "motivo visível só para o dono e o enfermeiro ou médico da equipe";

export function VisitDetail({ id, domains }: { id: string; domains: HomeVisitDomains }) {
  const q = useQuery({ queryKey: [ HV_VISIT_KEY, id ], queryFn: () => getHomeVisit(id), ...NOMINAL_QUERY });
  if (q.isError) return <p role="alert" style={alert}>{homeVisitError(q.error)}</p>;
  if (!q.data) return <p role="status" style={muted}>Carregando a visita…</p>;
  const v = q.data;
  const measures = measurementsText(domains, v.measurements);
  return (
    <section aria-label={`Visita das ${fmtHourMinute(v.occurred_at)}`} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong className="mono">{fmtDay(v.occurred_at)} {fmtHourMinute(v.occurred_at)}</strong>
        <Tag tone={v.outcome === 1 ? "ok" : v.outcome === 2 ? "info" : "neutral"} mono={false}>{outcomeLabel(v.outcome)}</Tag>
        {v.state === "withdrawn" && <Tag tone="down" mono={false}>retirada</Tag>}
        {v.out_of_area && <Tag tone="info" mono={false}>fora da área</Tag>}
      </div>
      <div style={grid}>
        <KeyValue k="Turno" v={shiftLabel(v.shift)} mono={false} />
        <KeyValue k="Pessoa" v={personText(v)} mono={false} />
        <KeyValue k="Imóvel" v={v.household?.address_short ?? `sem cadastro · ${propertyLabel(domains, v.property_type)}`} mono={false} />
        <KeyValue k="Microárea" v={v.micro_area?.code ?? "—"} mono={false} />
        <KeyValue k="Registrada por" v={v.recorded_by.name ?? "—"} mono={false} />
        <KeyValue k="Origem" v={originLabel(v.origin)} mono={false} />
      </div>
      <KeyValue k="Motivos" v={v.reasons.length ? v.reasons.map((c) => reasonLabel(domains, c)).join(", ") : "—"} mono={false} />
      {measures.length > 0 && <KeyValue k="Medidas" v={measures.join(" · ")} mono={false} />}
      <div style={box}>
        <strong style={{ fontSize: 12.5 }}>Observação</strong>
        {v.note ? <p style={{ margin: 0, fontSize: 13, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{v.note}</p> : <p style={muted}>sem observação</p>}
      </div>
      {v.withdrawn && (
        <div style={box}>
          <strong style={{ fontSize: 12.5 }}>Retirada</strong>
          <p style={muted}>em {fmtDateTime(v.withdrawn.at)} por {v.withdrawn.by.name ?? "—"}</p>
          {v.withdrawn.reason ? <p style={{ margin: 0, fontSize: 13, overflowWrap: "anywhere" }}>{v.withdrawn.reason}</p> : <p style={muted}>{WITHDRAW_REASON_HIDDEN}</p>}
        </div>
      )}
    </section>
  );
}
