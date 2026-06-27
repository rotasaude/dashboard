// QueuesView (§4.7) — Solid Queue. Ressalva do §5 vive no centro de notificações.

import { useQueues } from "../hooks/useQueues";
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
import { fmtDuration, fmtNumber } from "../lib/format";

export function Queues() {
  const { data, isLoading, isError, error, refetch } = useQueues();

  if (isLoading) return <Wrap><KpiGrid><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Filas"><Skeleton rows={5} /></Panel></Wrap>;
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const d = data.data;
  const totalDepth = d.queues.reduce((acc, q) => acc + q.depth, 0);
  const totalFailed = d.failedExecutions.length;

  return (
    <Wrap>
      <KpiGrid>
        <StatTile label="Profundidade total" value={totalDepth} source="live" />
        <StatTile label="Mais antigo pendente" value={fmtDuration(d.oldestPendingS)} source="live" />
        <StatTile label="Falhas (recentes)" value={totalFailed} tone={totalFailed > 0 ? "down" : "ok"} source="live" />
      </KpiGrid>

      <Panel title="Filas" sub="profundidade · idade · falhas" asOf={data.as_of}>
        <DataTable
          cols={[
            { label: "Fila", w: "2fr", render: (q) => (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="mono">{q.name}</span>
                {q.urgent && <Tag tone="warn">urgent</Tag>}
              </span>
            ) },
            { label: "Depth", w: "1fr", align: "right", render: (q) => <span className="mono">{fmtNumber(q.depth)}</span> },
            { label: "Mais antigo", w: "1fr", align: "right", render: (q) => <span className="mono">{fmtDuration(q.oldestS)}</span> },
            { label: "Running", w: "1fr", align: "right", render: (q) => <span className="mono">{fmtNumber(q.running)}</span> },
            { label: "Scheduled", w: "1fr", align: "right", render: (q) => <span className="mono">{fmtNumber(q.scheduled)}</span> },
            { label: "Failed", w: "1fr", align: "right", render: (q) => <span className="mono" style={{ color: q.failed > 0 ? "var(--down)" : "inherit" }}>{fmtNumber(q.failed)}</span> },
            { label: "Estado", w: "1fr", render: (q) => <Tag tone={q.tone}>{q.tone}</Tag> }
          ]}
          rows={d.queues}
          rowKey={(q) => q.name}
          empty="nenhuma fila com atividade"
        />
      </Panel>

      <Panel title="Execuções falhadas" sub="failed_executions" asOf={data.as_of}>
        <DataTable
          cols={[
            { label: "Em", w: "1fr", render: (f) => <span className="mono">{f.at}</span> },
            { label: "Job", w: "2fr", render: (f) => <span className="mono">{f.jobClass}</span> },
            { label: "Fila", w: "1fr", render: (f) => <span className="mono">{f.queue}</span> },
            { label: "Erro", w: "3fr", render: (f) => <span className="mono" style={{ color: "var(--down)" }}>{f.error || "—"}</span> }
          ]}
          rows={d.failedExecutions}
          rowKey={(_, i) => `fe-${i}`}
          empty="nenhuma execução falhada"
        />
      </Panel>

      <Panel title="Recurring tasks" sub="agendadas" asOf={data.as_of}>
        <DataTable
          cols={[
            { label: "Tarefa", w: "2fr", render: (r) => <span className="mono">{r.name || r.key}</span> },
            { label: "Schedule", w: "2fr", render: (r) => <span className="mono">{r.schedule}</span> },
            { label: "Último", w: "1fr", render: (r) => <span className="mono">{r.lastAgo}</span> },
            { label: "Status", w: "1fr", render: (r) => <Tag tone={r.status === "ok" ? "ok" : "warn"}>{r.status}</Tag> }
          ]}
          rows={d.recurring}
          rowKey={(r) => r.key}
          empty="nenhuma recurring task configurada"
        />
      </Panel>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Filas & jobs" sub="queues · solid queue" />
      {children}
    </div>
  );
}
