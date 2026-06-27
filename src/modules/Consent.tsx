// ConsentView (§4.3) — LGPD. Quebra por versão + timeline de revogações.

import { useConsent } from "../hooks/useConsent";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { DataTable } from "../components/DataTable";
import { BarMini } from "../components/BarMini";
import { Skeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { KpiSkeleton } from "./Overview";
import { fmtNumber } from "../lib/format";

export function Consent() {
  const { data, isLoading, isError, error, refetch } = useConsent();

  if (isLoading) return <Wrap><KpiGrid><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Por versão"><Skeleton rows={4} /></Panel></Wrap>;
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const d = data.data;
  return (
    <Wrap>
      <KpiGrid>
        <StatTile label="Concedidos" value={d.given} tone="ok" source="live" />
        <StatTile label="Revogados" value={d.revoked} tone="warn" source="live" />
        <StatTile label="Recusados" value={d.declined ?? "—"} source="live" />
      </KpiGrid>

      <Panel title="Por versão" sub="consent_version" asOf={data.as_of}>
        <DataTable
          cols={[
            { label: "Versão", w: "2fr", render: (r) => <span className="mono">{r.version}</span> },
            { label: "Concedidos", w: "1fr", align: "right", render: (r) => <span className="mono">{fmtNumber(r.given)}</span> },
            { label: "Share", w: "1fr", align: "right", render: (r) => <span className="mono">{r.share}%</span> }
          ]}
          rows={d.byVersion}
          rowKey={(r) => r.version}
          empty="nenhuma versão registrada"
        />
      </Panel>

      <Panel title="Revogações" sub="timeline" asOf={data.as_of}>
        {d.revocationsSeries.every((v) => v === 0) ? (
          <EmptyState title="sem revogações no período" />
        ) : (
          <BarMini data={d.revocationsSeries} color="var(--warn)" h={120} />
        )}
      </Panel>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Consentimento" sub="consent · lgpd" />
      {children}
    </div>
  );
}
