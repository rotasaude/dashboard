// EventsView (§4.8) — domain_events. Stream + filtro por tipo (chips ou busca
// livre, nome exato ou prefixo "x.*") + janela própria de datas (F-07.13).
// Payload SEMPRE referência (ADR 0003/0009).

import { useState, type FormEvent } from "react";
import { useEvents, type EventsWindow } from "../hooks/useEvents";
import { ApiError } from "../lib/api";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
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

// A API devolve no máximo os 50 mais recentes, sem paginação.
const STREAM_CAP = 50;

export function Events() {
  const [ filter, setFilter ] = useState("todos");
  const [ search, setSearch ] = useState("");
  const [ from, setFrom ] = useState("");
  const [ to, setTo ] = useState("");

  // Datas YYYY-MM-DD comparam como texto. Janela incompleta ou invertida não
  // vai para a API: o painel segue o período global.
  const inverted = from !== "" && to !== "" && from > to;
  const span: EventsWindow | null = from && to && !inverted ? { from, to } : null;

  const chooseChip = (name: string) => { setSearch(""); setFilter(name); };
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setFilter(search.trim() || "todos");
  };

  return (
    <Wrap>
      <Panel title="Filtros" sub={span ? `janela própria · ${span.from} → ${span.to}` : "período global"}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={labelStyle}>
            De
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={fieldStyle} />
          </label>
          <label style={labelStyle}>
            Até
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={fieldStyle} />
          </label>
          {(from || to) && (
            <button type="button" onClick={() => { setFrom(""); setTo(""); }} style={secondaryButtonStyle}>
              Usar período global
            </button>
          )}
          <form role="search" onSubmit={submitSearch} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <label style={labelStyle}>
              Nome do evento
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="triage.completed ou triage.*"
                className="mono"
                style={{ ...fieldStyle, minWidth: 220 }}
              />
            </label>
            <button type="submit" style={secondaryButtonStyle}>Buscar</button>
          </form>
        </div>
        {inverted && (
          <p role="alert" style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--down)" }}>
            A data inicial deve ser anterior ou igual à final; seguindo o período global.
          </p>
        )}
      </Panel>
      <EventsBody filter={filter} span={span} onChip={chooseChip} />
    </Wrap>
  );
}

function EventsBody({ filter, span, onChip }: { filter: string; span: EventsWindow | null; onChip: (v: string) => void }) {
  const { data, isLoading, isError, error, refetch } = useEvents({ name: filter, window: span });

  if (isLoading) return <><KpiGrid><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Stream"><Skeleton rows={5} /></Panel></>;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="sem dados" />;

  const d = data.data;
  const series = d.byType.slice(0, 24).map((b) => b.count);
  return (
    <>
      <KpiGrid asOf={data.as_of}>
        <StatTile label="Eventos no período" value={d.total} source="live" />
        <StatTile label="Retenção" value={d.retentionMonths} unit="meses" source="live" />
      </KpiGrid>

      <Panel title="Contagem por tipo" sub="byType (top 24)" asOf={data.as_of}>
        {series.length === 0 ? <EmptyState title="sem eventos" /> : <BarMini data={series} h={80} />}
      </Panel>

      <Panel
        title="Stream"
        sub="referências apenas (ADR 0009)"
        right={<FilterChips current={filter} options={d.filters} onChange={onChip} />}
        asOf={data.as_of}
      >
        {d.total > STREAM_CAP && (
          <p className="mono" style={{ margin: "0 0 8px", fontSize: 11, color: "var(--ink3)" }}>
            mostrando os {STREAM_CAP} mais recentes de {d.total}
          </p>
        )}
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
    </>
  );
}

// 422 = filtro recusado pela API (datas ou período inválidos): mostra o motivo.
function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 422) {
    const body = error.body as { message?: string } | null;
    return `Filtro recusado: ${body?.message || "parâmetros inválidos"}`;
  }
  return (error as Error)?.message || "Erro";
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
const fieldStyle = { ...inputStyle, width: "auto" };

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
