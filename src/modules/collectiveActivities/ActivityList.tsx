// src/modules/collectiveActivities/ActivityList.tsx
// Atividades coletivas da equipe (módulo 24b, F-24.12): uma linha por atividade, sem pessoa, tema nem procedimento (a lista do api
// não traz as chaves, Q57a). Mostra só a situação da ficha: "Gerar de novo" e "Reenviar" ficam na Produção (Q12/Q70). Em 375 px vira
// cartão: a data é o título e o "Abrir" a ação.
import type { CollectiveActivitySummary, CollectiveDomains } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { fichaLabel, shiftLabel } from "../../lib/homeVisits";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";

export const activityTypeLabel = (domains: CollectiveDomains, code: number): string => domains.activity_types.find((t) => t.code === code)?.label ?? String(code);
export const placeText = (a: Pick<CollectiveActivitySummary, "place">): string => ("health_unit" in a.place ? a.place.health_unit.name : a.place.text);

export function ActivityList({ activities, domains, onOpen }: {
  activities: CollectiveActivitySummary[]; domains: CollectiveDomains; onOpen(a: CollectiveActivitySummary): void;
}) {
  const cols: Column<CollectiveActivitySummary>[] = [
    { label: "Data", w: "0.9fr", card: "title", render: (a) => <strong>{fmtDay(a.held_on)}</strong> },
    { label: "Turno", w: "0.7fr", card: "pair", render: (a) => shiftLabel(a.shift) },
    { label: "Tipo", w: "1.6fr", render: (a) => activityTypeLabel(domains, a.activity_type) },
    { label: "Local", w: "1.4fr", render: (a) => <span style={{ overflowWrap: "anywhere" }}>{placeText(a)}</span> },
    { label: "Participantes", w: "0.8fr", card: "pair", render: (a) => a.participants_count },
    { label: "Situação", w: "1.8fr", render: (a) => {
      const f = fichaLabel(a.ficha);
      return (
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {a.state === "mistaken" && <Tag tone="down" mono={false}>registrada por engano</Tag>}
          <Tag tone={f.tone} mono={false}>{f.text}</Tag>
        </span>
      );
    } },
    { label: "", w: "auto", card: "actions", render: (a) => (
      <button type="button" style={secondaryButtonStyle} aria-label={`Abrir atividade de ${fmtDay(a.held_on)}`} onClick={() => onOpen(a)}>Abrir</button>
    ) }
  ];
  return <DataTable cols={cols} rows={activities} rowKey={(a) => a.id} label="Atividades coletivas" empty="nenhuma atividade neste período" />;
}
