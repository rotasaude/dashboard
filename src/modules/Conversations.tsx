// ConversationsView (§4.2) — FSM e funil.

import { useConversations } from "../hooks/useConversations";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { Funnel } from "../components/Funnel";
import { StackedBar } from "../components/StackedBar";
import { Skeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { KpiSkeleton } from "./Overview";
import { fmtPercent, fmtNumber } from "../lib/format";

export function Conversations() {
  const { data, isLoading, isError, error, refetch } = useConversations();

  if (isLoading) {
    return (
      <Wrap>
        <KpiGrid><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></KpiGrid>
        <Panel title="Funil FSM"><Skeleton rows={4} /></Panel>
      </Wrap>
    );
  }
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const d = data.data;
  return (
    <Wrap>
      <KpiGrid>
        <StatTile label="Conversas ativas agora" value={d.live} tone="info" source="live" />
        <StatTile label="Taxa de abandono" value={d.abandonRate ?? "—"} unit={d.abandonRate !== null ? "%" : ""} source="live" />
        <StatTile label="Tempo médio até conclusão" value={d.avgToCompleteMin ?? "—"} unit={d.avgToCompleteMin !== null ? "min" : ""} source="live" />
      </KpiGrid>

      <Panel title="Funil FSM" sub="por estado da conversa" asOf={data.as_of}>
        {d.funnel.every((f) => f.count === 0) ? (
          <EmptyState title="sem conversas no período" />
        ) : (
          <Funnel steps={d.funnel} />
        )}
      </Panel>

      <Panel title="Saídas" sub="estados terminais (revoked como proxy)" asOf={data.as_of}>
        {d.exits.every((e) => e.count === 0) ? (
          <EmptyState title="nenhuma saída registrada" />
        ) : (
          <StackedBar segments={d.exits} />
        )}
      </Panel>

      <Panel title="Vivas agora" sub="awaiting_consent · consented" asOf={data.as_of}>
        <div className="mono" style={{ display: "flex", gap: 24, fontSize: 12 }}>
          <span>aguardando: <strong>{fmtNumber(d.liveActive.awaiting)}</strong></span>
          <span>em curso: <strong>{fmtNumber(d.liveActive.inProgress)}</strong></span>
          {d.abandonRate !== null && <span>abandono: <strong>{fmtPercent(d.abandonRate)}</strong></span>}
        </div>
      </Panel>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Conversas" sub="conversations · fsm" />
      {children}
    </div>
  );
}
