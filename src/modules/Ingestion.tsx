// IngestionView (§4.1) — webhook WhatsApp. Backlog de purga LGPD em destaque.

import { useIngestion } from "../hooks/useIngestion";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { BarMini } from "../components/BarMini";
import { StackedBar } from "../components/StackedBar";
import { Meter } from "../components/Meter";
import { Skeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { KpiSkeleton } from "./Overview";

export function Ingestion() {
  const { data, isLoading, isError, error, refetch } = useIngestion();

  if (isLoading) {
    return (
      <Wrap>
        <KpiGrid><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></KpiGrid>
        <Panel title="Volume inbound"><Skeleton rows={4} /></Panel>
      </Wrap>
    );
  }
  if (isError) {
    return (
      <Wrap>
        <ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} />
      </Wrap>
    );
  }
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const d = data.data;
  return (
    <Wrap>
      <KpiGrid>
        <StatTile label="Mensagens recebidas" value={d.inboundTotal} source="live" spark={d.inboundSeries} />
        <StatTile label="Backlog de purga" value={d.purge.pending} tone={d.purge.overTtl ? "down" : "warn"} source="live" />
        <StatTile label="Dedup (reentregas)" value={d.dedup ?? "—"} source="live" />
      </KpiGrid>

      <Panel title="Volume inbound" sub="por bucket do período" asOf={data.as_of}>
        {d.inboundSeries.length === 0 ? (
          <EmptyState title="sem mensagens no período" />
        ) : (
          <BarMini data={d.inboundSeries} h={120} color="var(--accent)" />
        )}
      </Panel>

      <Panel title="Distribuição de ack" sub="por classe de status" asOf={data.as_of}>
        {d.ack.every((a) => a.count === 0) ? (
          <EmptyState title="sem ack registrado" sub="aproximação por outbound_messages.status" />
        ) : (
          <StackedBar segments={d.ack.map((a) => ({ label: a.label, count: a.count, tone: a.tone }))} />
        )}
      </Panel>

      <Panel
        title="Backlog de purga (LGPD)"
        sub="idade do registro mais antigo vs TTL"
        asOf={data.as_of}
      >
        <Meter
          label="Idade do mais antigo"
          used={d.purge.oldestH}
          max={d.purge.ttlH}
          unit="h"
          tone={d.purge.overTtl ? "down" : "warn"}
          hint={
            d.purge.overTtl
              ? "Algum registro está acima do TTL — purga atrasada (worker parado?)"
              : "Dentro do TTL configurado"
          }
        />
      </Panel>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Ingestão" sub="ingestion · whatsapp" />
      {children}
    </div>
  );
}
