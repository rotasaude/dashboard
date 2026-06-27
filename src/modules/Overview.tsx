// OverviewView (§4.0) — entrada do console.
//
// 5 KPIs + 4 painéis resumo (Ingestão&triagem, Filas, Saúde, Eventos).
// Hoje composição é client-side (6 hooks paralelos via React Query).
// Otimização futura (ADR 0007 read-side): /overview pode devolver
// queuesSummary/projections/recentEvents embutidos pra reduzir chamadas.

import { useOverview } from "../hooks/useOverview";
import { useIngestion } from "../hooks/useIngestion";
import { useConversations } from "../hooks/useConversations";
import { useQueues } from "../hooks/useQueues";
import { useHealth } from "../hooks/useHealth";
import { useEvents } from "../hooks/useEvents";
import { StatTile } from "../components/StatTile";
import { Skeleton } from "../components/Skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { Sparkline } from "../components/Sparkline";
import { Funnel } from "../components/Funnel";
import { KeyValue } from "../components/KeyValue";
import { Tag } from "../components/Tag";
import { StatusDot } from "../components/StatusDot";
import { Divider } from "../components/Divider";
import { fmtNumber, fmtTime } from "../lib/format";
import type { ModuleId } from "../shell/modules";

interface Props {
  onNavigate?: (id: ModuleId) => void;
}

export function Overview({ onNavigate }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Visão geral" sub="overview" />
      <KpisRow />
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 }}>
        <IngestionTriagePanel />
        <QueuesSummaryPanel onNavigate={onNavigate} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14 }}>
        <HealthSummaryPanel onNavigate={onNavigate} />
        <EventsSummaryPanel onNavigate={onNavigate} />
      </div>
    </div>
  );
}

// ─── Linha 1 — 5 KPIs ────────────────────────────────────────────────────────

function KpisRow() {
  const { data, isLoading, isError, error, refetch } = useOverview();
  if (isLoading) return <KpiGrid5>{Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}</KpiGrid5>;
  if (isError)   return <ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} />;
  if (!data || data.data.kpis.length === 0) {
    return (
      <Panel title="KPIs" asOf={data?.as_of}>
        <EmptyState title="Sem dados no escopo" sub="ajuste o período ou o município" />
      </Panel>
    );
  }
  return (
    <KpiGrid5>
      {data.data.kpis.map((kpi) => (
        <StatTile
          key={kpi.id}
          label={kpi.label}
          value={kpi.value}
          unit={kpi.unit}
          delta={kpi.delta}
          tone={kpi.tone}
          spark={kpi.spark}
          source={kpi.source}
        />
      ))}
    </KpiGrid5>
  );
}

function KpiGrid5({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
      {children}
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--radius-panel)",
        padding: "13px 15px",
        minHeight: 104
      }}
    >
      <Skeleton rows={3} />
    </div>
  );
}

// ─── Linha 2A — Ingestão & triagem ───────────────────────────────────────────

function IngestionTriagePanel() {
  const ingestion = useIngestion();
  const conversations = useConversations();
  const asOf = ingestion.data?.as_of || conversations.data?.as_of;

  return (
    <Panel
      title="Ingestão & triagem"
      sub="volume diário · §4.1 / §4.4"
      source="proj"
      asOf={asOf}
    >
      {/* Bloco inbound */}
      {ingestion.isLoading ? (
        <Skeleton rows={2} height={20} />
      ) : ingestion.isError ? (
        <ErrorState message="erro ao carregar ingestão" onRetry={() => ingestion.refetch()} />
      ) : ingestion.data && ingestion.data.data.inboundSeries.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <SectionTitle>inbound (WhatsApp)</SectionTitle>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink2)" }}>
              {fmtNumber(ingestion.data.data.inboundTotal)} msgs
            </span>
          </div>
          <Sparkline data={ingestion.data.data.inboundSeries} color="var(--accent)" h={42} />
        </div>
      ) : (
        <EmptyState title="sem inbound no período" />
      )}

      <Divider spacing={6} />

      {/* Funil de conversas */}
      {conversations.isLoading ? (
        <Skeleton rows={3} />
      ) : conversations.isError ? (
        <ErrorState message="erro ao carregar conversas" onRetry={() => conversations.refetch()} />
      ) : conversations.data && conversations.data.data.funnel.some((f) => f.count > 0) ? (
        <div>
          <SectionTitle>funil de conversas</SectionTitle>
          <div style={{ marginTop: 10 }}>
            <Funnel steps={conversations.data.data.funnel} />
          </div>
        </div>
      ) : (
        <EmptyState title="sem conversas no período" />
      )}
    </Panel>
  );
}

// ─── Linha 2B — Filas · Solid Queue ──────────────────────────────────────────

function QueuesSummaryPanel({ onNavigate }: { onNavigate?: (id: ModuleId) => void }) {
  const { data, isLoading, isError, error, refetch } = useQueues();
  return (
    <Panel
      title="Filas · Solid Queue"
      sub="resumo operacional · §4.7"
      source="live"
      asOf={data?.as_of}
      right={<OpenLink onClick={() => onNavigate?.("queues")} />}
    >
      {isLoading && <Skeleton rows={4} />}
      {isError && <ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} />}
      {data && (() => {
        const d = data.data;
        const urgent = d.queues.find((q) => q.urgent);
        const backlogTotal = d.queues.reduce((acc, q) => acc + q.depth, 0);
        const failedAll = d.failedExecutions.length;
        const recurringDelayed = d.recurring.filter((r) => r.delayedMin > 0).length;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Faixa urgent */}
            {urgent ? (
              <UrgentStrip
                depth={urgent.depth}
                oldestS={urgent.oldestS}
                failed={urgent.failed}
              />
            ) : (
              <div
                className="mono"
                style={{
                  padding: "11px 13px",
                  borderRadius: 8,
                  background: "var(--sunken)",
                  border: "1px solid var(--rule)",
                  fontSize: 11,
                  color: "var(--ink3)"
                }}
              >
                :urgent — sem atividade
              </div>
            )}
            {/* 3 KeyValues */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10
              }}
            >
              <KeyValue k="backlog total" v={fmtNumber(backlogTotal)} />
              <KeyValue
                k="failed (todas)"
                v={fmtNumber(failedAll)}
                vc={failedAll > 0 ? "var(--down)" : "var(--ink)"}
              />
              <KeyValue
                k="recurring atrasadas"
                v={fmtNumber(recurringDelayed)}
                vc={recurringDelayed > 0 ? "var(--warn)" : "var(--ink)"}
              />
            </div>
          </div>
        );
      })()}
    </Panel>
  );
}

function UrgentStrip({ depth, oldestS, failed }: { depth: number; oldestS: number; failed: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 13px",
        borderRadius: 8,
        background: "var(--down-bg)",
        border: "1px solid color-mix(in oklch, var(--down), transparent 72%)"
      }}
    >
      <Tag tone="urgent">:urgent</Tag>
      <div style={{ display: "flex", gap: 18 }}>
        <KeyValue k="depth" v={fmtNumber(depth)} />
        <KeyValue
          k="idade"
          v={`${fmtNumber(oldestS)}s`}
          vc={oldestS > 60 ? "var(--down)" : "var(--ink)"}
        />
        <KeyValue k="failed" v={fmtNumber(failed)} vc="var(--down)" />
      </div>
    </div>
  );
}

// ─── Linha 3A — Saúde das projeções ──────────────────────────────────────────

function HealthSummaryPanel({ onNavigate }: { onNavigate?: (id: ModuleId) => void }) {
  const { data, isLoading, isError, error, refetch } = useHealth();
  return (
    <Panel
      title="Saúde das projeções"
      sub="frescor & drift · §4.9"
      right={<OpenLink onClick={() => onNavigate?.("health")} />}
    >
      {isLoading && <Skeleton rows={3} />}
      {isError && <ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} />}
      {data && data.data.projections.length === 0 && <EmptyState title="sem projeções monitoradas" />}
      {data && data.data.projections.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {data.data.projections.map((p) => {
            const isWarn = p.status === "warn";
            return (
              <div
                key={p.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <StatusDot level={p.status} size={7} />
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      color: "var(--ink2)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {p.name}
                  </span>
                </div>
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: isWarn ? "var(--warn)" : "var(--ink3)",
                    whiteSpace: "nowrap"
                  }}
                >
                  drift {p.driftMin ?? "—"}min
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Linha 3B — Eventos de domínio ───────────────────────────────────────────

function EventsSummaryPanel({ onNavigate }: { onNavigate?: (id: ModuleId) => void }) {
  const { data, isLoading, isError, error, refetch } = useEvents();
  return (
    <Panel
      title="Eventos de domínio"
      sub="referências apenas · §4.8"
      source="live"
      asOf={data?.as_of}
      right={<OpenLink onClick={() => onNavigate?.("events")} />}
    >
      {isLoading && <Skeleton rows={4} />}
      {isError && <ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} />}
      {data && data.data.stream.length === 0 && <EmptyState title="sem eventos recentes" />}
      {data && data.data.stream.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {data.data.stream.slice(0, 5).map((e, i, arr) => (
            <div
              key={`${e.at}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "60px 1.1fr 1.4fr",
                gap: 10,
                padding: "8px 2px",
                alignItems: "center",
                borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--rule)"
              }}
            >
              <span className="mono" style={{ fontSize: 11, color: "var(--ink4)" }}>
                {fmtTime(e.at)}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--accent)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
                title={e.name}
              >
                {e.name}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink3)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
                title={e.ref}
              >
                {e.ref}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── Auxiliares ──────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10.5,
        color: "var(--ink3)",
        textTransform: "uppercase",
        letterSpacing: 0.6
      }}
    >
      {children}
    </span>
  );
}

function OpenLink({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--accent)"
      }}
    >
      abrir →
    </button>
  );
}
