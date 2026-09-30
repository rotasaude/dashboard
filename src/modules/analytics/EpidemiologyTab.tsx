// src/modules/analytics/EpidemiologyTab.tsx
// Epidemiologia (F-14.7; contratos §1.4): só perguntas `boolean`/`enum` que o
// autor marcou `analytic` (ADR 0025), agregadas por bairro, nunca por pessoa.
// Prompt e opções vêm da versão mais recente que marcou a pergunta.
import { useState } from "react";
import type { AnalyticsQuery, EpidemiologyData } from "../../lib/api";
import { EPI_EMPTY_TITLE, EPI_HOWTO, rangeDates, type AnalyticsRange } from "../../lib/analytics";
import { useAnalytics } from "../../hooks/useAnalytics";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { AnalyticsView } from "./AnalyticsView";
import { SeriesBlock } from "./SeriesBlock";
import { NeighborhoodSelect, ProtocolSelect, filterRowStyle, noteStyle } from "./Filters";

interface EpiFilter { neighborhood_id: string | null; protocol_name: string | null; protocol_version: number | null }
const NO_FILTER: EpiFilter = { neighborhood_id: null, protocol_name: null, protocol_version: null };

export function EpidemiologyTab({ range }: { range: AnalyticsRange }) {
  const [ filter, setFilter ] = useState<EpiFilter>(NO_FILTER);
  const query: AnalyticsQuery = { ...rangeDates(range), granularity: range.granularity, ...filter };
  const result = useAnalytics("epidemiology", query);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div role="group" aria-label="Recortes" style={filterRowStyle}>
        <NeighborhoodSelect value={filter.neighborhood_id}
          onChange={(v) => setFilter((f) => ({ ...f, neighborhood_id: v }))} />
        <ProtocolSelect name={filter.protocol_name} version={filter.protocol_version} withVersion
          onChange={(name, version) => setFilter((f) => ({ ...f, protocol_name: name, protocol_version: version }))} />
      </div>
      <p style={noteStyle}>Respostas agregadas por bairro, nunca por pessoa. Só entram perguntas marcadas pelo autor do protocolo.</p>
      <AnalyticsView result={result}>{(data) => <EpidemiologyBody data={data} />}</AnalyticsView>
    </div>
  );
}

function EpidemiologyBody({ data }: { data: EpidemiologyData }) {
  if (data.questions.length === 0) {
    return (
      <Panel title="Epidemiologia">
        <EmptyState title={EPI_EMPTY_TITLE} />
        <p style={{ ...noteStyle, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>{EPI_HOWTO}</p>
      </Panel>
    );
  }
  return (
    <>
      {data.questions.map((q) => (
        <SeriesBlock key={`${q.protocol_name}/${q.question_id}`} title={q.prompt}
          sub={`${q.protocol_name} · ${q.answer_type === "boolean" ? "sim/não" : "lista"}`}
          kind="count" periods={data.periods} granularity={data.granularity ?? "week"}
          lines={q.options.map((o) => ({ key: o.value, label: o.label, series: o.series, total: o.total }))} />
      ))}
    </>
  );
}
