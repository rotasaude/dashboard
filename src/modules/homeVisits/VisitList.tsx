// src/modules/homeVisits/VisitList.tsx
// Visitas da equipe (módulo 24b, F-24.10): lista nominal, uma linha por visita, sem a observação (só no detalhe). Em 375 px vira
// cartão: a hora é o título e o "Abrir" a ação.
import type { HomeVisit } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { fmtHourMinute } from "../../lib/format";
import { outcomeLabel } from "../../lib/homeVisits";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { personText } from "./VisitCard";

export function VisitList({ visits, onOpen }: { visits: HomeVisit[]; onOpen(visit: HomeVisit): void }) {
  const cols: Column<HomeVisit>[] = [
    { label: "Quando", w: "1fr", card: "title", render: (v) => <span className="mono">{fmtDay(v.occurred_at)} {fmtHourMinute(v.occurred_at)}</span> },
    { label: "Pessoa", w: "1.6fr", render: (v) => personText(v) },
    { label: "Imóvel", w: "1.6fr", render: (v) => v.household?.address_short ?? "imóvel sem cadastro" },
    { label: "Desfecho", w: "1fr", render: (v) => (
      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
        <Tag tone={v.outcome === 1 ? "ok" : v.outcome === 2 ? "info" : "neutral"} mono={false}>{outcomeLabel(v.outcome)}</Tag>
        {v.state === "withdrawn" && <Tag tone="down" mono={false}>retirada</Tag>}
      </span>
    ) },
    { label: "Registrada por", w: "1fr", render: (v) => v.recorded_by.name ?? "—" },
    { label: "", w: "auto", card: "actions", render: (v) => (
      <button type="button" style={secondaryButtonStyle} aria-label={`Abrir visita das ${fmtHourMinute(v.occurred_at)}`} onClick={() => onOpen(v)}>Abrir</button>
    ) }
  ];
  return <DataTable cols={cols} rows={visits} rowKey={(v) => v.id} label="Visitas da equipe" empty="nenhuma visita neste período" />;
}
