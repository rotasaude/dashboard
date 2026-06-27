// TriagesView (§4.4).

import { useTriages } from "../hooks/useTriages";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { BarMini } from "../components/BarMini";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { Skeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { KpiSkeleton } from "./Overview";
import { fmtNumber } from "../lib/format";

export function Triages() {
  const { data, isLoading, isError, error, refetch } = useTriages();

  if (isLoading) return <Wrap><KpiGrid><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Volume"><Skeleton rows={4} /></Panel></Wrap>;
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const d = data.data;
  return (
    <Wrap>
      <KpiGrid>
        <StatTile label="Iniciadas" value={d.started} source="live" />
        <StatTile label="Concluídas" value={d.completed} tone="ok" source="live" />
        <StatTile label="Taxa de conclusão" value={d.completionRate} unit="%" tone={d.completionRate >= 70 ? "ok" : d.completionRate >= 40 ? "warn" : "down"} source="live" />
      </KpiGrid>

      <Panel title="Volume" sub="iniciadas por bucket" asOf={data.as_of}>
        {d.series.every((v) => v === 0) ? (
          <EmptyState title="sem triagens no período" />
        ) : (
          <BarMini data={d.series} h={120} />
        )}
      </Panel>

      <Panel title="Por protocolo / versão" sub="protocol_definition" asOf={data.as_of}>
        <DataTable
          cols={[
            { label: "Versão", w: "3fr", render: (r) => <span className="mono">{r.version}</span> },
            { label: "Status", w: "1fr", render: (r) => <Tag tone={statusTone(r.status)}>{r.status}</Tag> },
            { label: "Contagem", w: "1fr", align: "right", render: (r) => <span className="mono">{fmtNumber(r.count)}</span> },
            { label: "Share", w: "1fr", align: "right", render: (r) => <span className="mono">{r.share}%</span> }
          ]}
          rows={d.byProtocol}
          rowKey={(r) => r.version}
          empty="nenhuma versão observada"
        />
      </Panel>
    </Wrap>
  );
}

function statusTone(s: string): string {
  if (s === "active" || s === "published") return "ok";
  if (s === "retired") return "neutral";
  if (s === "draft") return "info";
  return "neutral";
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Triagens" sub="triages" />
      {children}
    </div>
  );
}
