// ReportsView (F-04.6). Lista de relatórios (metadados apenas — LGPD).

import { useReports } from "../hooks/useReports";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { Skeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { fmtDateTime } from "../lib/format";
import type { Tone } from "../theme/tokens";
import type { ReportRow } from "../lib/types";

export function Reports() {
  const { data, isLoading, isError, error, refetch } = useReports();

  if (isLoading) return <Wrap><Panel title="Relatórios"><Skeleton rows={5} /></Panel></Wrap>;
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const d = data.data;
  return (
    <Wrap>
      <Panel title="Relatórios" sub="report_snapshots (metadados)" asOf={data.as_of}>
        <DataTable
          cols={[
            { label: "Data", w: "2fr", render: (r) => <span className="mono">{fmtDateTime(r.createdAt)}</span> },
            { label: "Tier", w: "1fr", render: (r) => <Tag tone={tierTone(r.tier)}>{r.tier ?? "—"}</Tag> },
            { label: "Protocolo", w: "2fr", render: (r) => <span className="mono">{r.protocol}</span> },
            { label: "Expiração", w: "1fr", render: (r) => <Tag tone={r.live ? "ok" : "neutral"}>{r.live ? "ativo" : "expirado"}</Tag> }
          ]}
          rows={d.reports}
          rowKey={(r: ReportRow) => r.id}
          empty="nenhum relatório no período"
        />
      </Panel>
    </Wrap>
  );
}

function tierTone(t: string | null): Tone {
  if (t === "alta") return "down";
  if (t === "media") return "warn";
  if (t === "baixa") return "ok";
  return "neutral";
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Relatórios" sub="reports" />
      {children}
    </div>
  );
}
