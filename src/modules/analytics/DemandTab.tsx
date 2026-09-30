// src/modules/analytics/DemandTab.tsx
// Demanda por território (F-14.3; spec §3.4, contratos §1.1). Bairro e
// protocolo recortam as métricas de triagem; unidade recorta atendimentos e
// pedidos. O total do período das triagens é o `triages_total` da API; o
// cliente nunca soma os pontos da série.
import { useState } from "react";
import type { AnalyticsQuery, DemandData } from "../../lib/api";
import { CLOSED_REASON_LABEL, KIND_LABEL, labelOr, rangeDates, type AnalyticsRange } from "../../lib/analytics";
import { useAnalytics } from "../../hooks/useAnalytics";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { AnalyticsView } from "./AnalyticsView";
import { SeriesBlock } from "./SeriesBlock";
import { CellValue } from "./values";
import { NeighborhoodSelect, ProtocolSelect, UnitSelect, filterRowStyle, noteStyle } from "./Filters";

interface DemandFilter { neighborhood_id: string | null; health_unit_id: string | null; protocol_name: string | null }
const NO_FILTER: DemandFilter = { neighborhood_id: null, health_unit_id: null, protocol_name: null };

export function DemandTab({ range }: { range: AnalyticsRange }) {
  const [ filter, setFilter ] = useState<DemandFilter>(NO_FILTER);
  const query: AnalyticsQuery = { ...rangeDates(range), granularity: range.granularity, ...filter };
  const result = useAnalytics("demand", query);
  // data.units: todas as unidades da cidade, independentes do recorte.
  const units = result.data?.data.units ?? [];
  const set = (patch: Partial<DemandFilter>) => setFilter((current) => ({ ...current, ...patch }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div role="group" aria-label="Recortes" style={filterRowStyle}>
        <NeighborhoodSelect value={filter.neighborhood_id} onChange={(v) => set({ neighborhood_id: v })} />
        <ProtocolSelect name={filter.protocol_name} version={null} withVersion={false}
          onChange={(name) => set({ protocol_name: name })} />
        <UnitSelect value={filter.health_unit_id} units={units} onChange={(v) => set({ health_unit_id: v })} />
      </div>
      <p style={noteStyle}>Bairro e protocolo recortam as triagens; unidade recorta atendimentos e pedidos.</p>
      <AnalyticsView result={result}>{(data) => <DemandBody data={data} />}</AnalyticsView>
    </div>
  );
}

function DemandBody({ data }: { data: DemandData }) {
  const common = { periods: data.periods, granularity: data.granularity ?? "week", kind: "count" as const };
  return (
    <>
      <SeriesBlock {...common} title="Triagens" sub="iniciadas · concluídas · interrompidas" lines={[
        { key: "started", label: "Iniciadas", series: data.triages.started, total: data.triages_total.started },
        { key: "completed", label: "Concluídas", series: data.triages.completed, total: data.triages_total.completed },
        { key: "aborted", label: "Interrompidas", series: data.triages.aborted, total: data.triages_total.aborted }
      ]} />
      <SeriesBlock {...common} title="Triagens concluídas por tier"
        lines={data.by_tier.map((r) => ({ key: r.tier, label: r.tier, series: r.series, total: r.total }))} />
      <SeriesBlock {...common} title="Triagens concluídas por protocolo"
        lines={data.by_protocol.map((r) => ({ key: r.protocol_name, label: r.protocol_name, series: r.series, total: r.total }))} />
      <Panel title="Triagens concluídas por bairro" sub="período inteiro">
        <DataTable
          cols={[
            { label: "Bairro", w: "2fr", render: (r: DemandData["by_neighborhood"][number]) => r.name },
            { label: "Triagens", w: "1fr", align: "right", render: (r: DemandData["by_neighborhood"][number]) => (
              <span className="mono"><CellValue value={r.total} /></span>
            ) }
          ]}
          rows={data.by_neighborhood}
          rowKey={(r) => r.neighborhood_id ?? "none"}
          empty="sem triagens concluídas no período"
        />
      </Panel>
      <SeriesBlock {...common} title="Atendimentos por unidade" sub="check-ins"
        lines={data.attendances_by_unit.map((r) => ({ key: r.health_unit_id, label: r.name, series: r.series, total: r.total }))} />
      <SeriesBlock {...common} title="Pedidos abertos" sub="por tipo, na unidade de destino"
        lines={data.requests_opened.map((r) => ({ key: r.kind, label: labelOr(KIND_LABEL, r.kind), series: r.series, total: r.total }))} />
      <SeriesBlock {...common} title="Pedidos encerrados" sub="por motivo"
        lines={data.requests_closed.map((r) => ({ key: r.reason, label: labelOr(CLOSED_REASON_LABEL, r.reason), series: r.series, total: r.total }))} />
    </>
  );
}
