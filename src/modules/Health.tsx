// HealthView (§4.9) — frescor das projeções + recurring.

import { useHealth } from "../hooks/useHealth";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { Skeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { KpiSkeleton } from "./Overview";
import { fmtTime, fmtNumber } from "../lib/format";

export function Health() {
  const { data, isLoading, isError, error, refetch } = useHealth();

  if (isLoading) return <Wrap><KpiGrid><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Projeções"><Skeleton rows={4} /></Panel></Wrap>;
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const d = data.data;
  const drift = d.driftOverall ?? 0;
  return (
    <Wrap>
      <KpiGrid>
        <StatTile label="Drift máximo (proj)" value={d.driftOverall ?? "—"} unit={d.driftOverall !== null ? "min" : ""} tone={drift > 30 ? "warn" : "ok"} source="live" />
        <StatTile label="Projeções monitoradas" value={d.projections.length} source="live" />
      </KpiGrid>

      <Panel title="Frescor das projeções" sub="updated_at vs limiar" asOf={data.as_of}>
        <DataTable
          cols={[
            { label: "Projeção", w: "2fr", render: (p) => <span className="mono">{p.name}</span> },
            { label: "Updated", w: "1fr", render: (p) => <span className="mono">{p.updatedAt ? fmtTime(p.updatedAt) : "—"}</span> },
            { label: "Drift", w: "1fr", align: "right", render: (p) => <span className="mono">{p.driftMin !== null ? `${fmtNumber(p.driftMin)} min` : "—"}</span> },
            { label: "Limiar", w: "1fr", align: "right", render: (p) => <span className="mono">{p.thresholdMin} min</span> },
            { label: "Status", w: "1fr", render: (p) => <Tag tone={statusTone(p.status)}>{p.status}</Tag> }
          ]}
          rows={d.projections}
          rowKey={(p) => p.name}
          empty="nenhuma projeção monitorada"
        />
      </Panel>

      <Panel title="Recurring tasks" sub="cruzar com Filas" asOf={data.as_of}>
        <DataTable
          cols={[
            { label: "Tarefa", w: "2fr", render: (r) => <span className="mono">{r.name || r.key}</span> },
            { label: "Schedule", w: "2fr", render: (r) => <span className="mono">{r.schedule}</span> },
            { label: "Último", w: "1fr", render: (r) => <span className="mono">{r.lastAgo}</span> },
            { label: "Status", w: "1fr", render: (r) => <Tag tone={r.status === "ok" ? "ok" : "warn"}>{r.status}</Tag> }
          ]}
          rows={d.recurring}
          rowKey={(r) => r.key}
          empty="sem recurring"
        />
      </Panel>
    </Wrap>
  );
}

function statusTone(s: string): string {
  if (s === "ok") return "ok";
  if (s === "warn") return "warn";
  if (s === "down") return "down";
  return "neutral";
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Saúde" sub="health · projeções" />
      {children}
    </div>
  );
}
