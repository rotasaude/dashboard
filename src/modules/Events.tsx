// EventsView (§4.8) — domain_events. Stream + filtro por tipo (chips).
// Payload SEMPRE referência (ADR 0003/0009).

import { useState } from "react";
import { useEvents } from "../hooks/useEvents";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { BarMini } from "../components/BarMini";
import { Skeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { KpiSkeleton } from "./Overview";
import { fmtDateTime } from "../lib/format";

export function Events() {
  const [ filter, setFilter ] = useState("todos");
  const { data, isLoading, isError, error, refetch } = useEvents(filter);

  if (isLoading) return <Wrap><KpiGrid><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Stream"><Skeleton rows={5} /></Panel></Wrap>;
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const d = data.data;
  const series = d.byType.slice(0, 24).map((b) => b.count);
  return (
    <Wrap>
      <KpiGrid>
        <StatTile label="Eventos no período" value={d.total} source="live" />
        <StatTile label="Retenção" value={d.retentionMonths} unit="meses" source="live" />
      </KpiGrid>

      <Panel title="Contagem por tipo" sub="byType (top 24)" asOf={data.as_of}>
        {series.length === 0 ? <EmptyState title="sem eventos" /> : <BarMini data={series} h={80} />}
      </Panel>

      <Panel
        title="Stream"
        sub="referências apenas (ADR 0009)"
        right={<FilterChips current={filter} options={d.filters} onChange={setFilter} />}
        asOf={data.as_of}
      >
        <DataTable
          cols={[
            { label: "Em", w: "1fr", render: (e) => <span className="mono">{fmtDateTime(e.at)}</span> },
            { label: "Evento", w: "2fr", render: (e) => <Tag>{e.name}</Tag> },
            { label: "Actor", w: "1fr", render: (e) => <span className="mono">{e.actor}</span> },
            { label: "Ref", w: "3fr", render: (e) => <span className="mono" style={{ color: "var(--ink3)" }}>{e.ref}</span> }
          ]}
          rows={d.stream}
          rowKey={(e, i) => `${e.at}-${i}`}
          empty="nenhum evento no filtro atual"
        />
      </Panel>

      <Panel title="Replay anchor" sub="ponto de partida do replay" asOf={data.as_of}>
        {d.replayAnchor ? (
          <div className="mono" style={{ fontSize: 11.5, color: "var(--ink2)" }}>
            <div>seq: <span style={{ color: "var(--ink)" }}>{d.replayAnchor.seq}</span></div>
            <div>at: <span style={{ color: "var(--ink)" }}>{fmtDateTime(d.replayAnchor.at)}</span></div>
          </div>
        ) : (
          <EmptyState title="sem eventos persistidos" />
        )}
      </Panel>
    </Wrap>
  );
}

function FilterChips({ current, options, onChange }: { current: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className="mono"
          style={{
            padding: "3px 8px",
            fontSize: 10.5,
            color: o === current ? "var(--ink)" : "var(--ink3)",
            background: o === current ? "var(--accent-bg)" : "var(--sunken)",
            border: `1px solid ${o === current ? "var(--accent)" : "var(--rule)"}`,
            borderRadius: 999
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Eventos & auditoria" sub="events · domain_events" />
      {children}
    </div>
  );
}
