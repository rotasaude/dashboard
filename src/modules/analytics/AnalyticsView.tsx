// src/modules/analytics/AnalyticsView.tsx
// Moldura de toda aba: carregando, erro traduzido, vazio (nunca consolidou) e,
// com dado, o carimbo antes do conteúdo. `as_of` nulo nunca mostra zeros.
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { AnalyticsDataMap, AnalyticsEnvelope, AnalyticsFront } from "../../lib/api";
import { EMPTY_SUB, EMPTY_TITLE, analyticsError } from "../../lib/analytics";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { DataStamp } from "./DataStamp";

interface Props<F extends AnalyticsFront> {
  result: UseQueryResult<AnalyticsEnvelope<F>, Error>;
  children(data: AnalyticsDataMap[F]): ReactNode;
}

export function AnalyticsView<F extends AnalyticsFront>({ result, children }: Props<F>) {
  if (result.isPending) return <Skeleton rows={6} />;
  if (result.isError) return <ErrorState message={analyticsError(result.error)} onRetry={() => void result.refetch()} />;
  const { as_of: asOf, stale, data } = result.data;
  if (!asOf) {
    return <Panel title="Analytics"><EmptyState title={EMPTY_TITLE} sub={EMPTY_SUB} /></Panel>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <DataStamp asOf={asOf} stale={stale} />
      {children(data)}
    </div>
  );
}
