// ClassificationView (§4.5) + drill-down de Trail.
// IMPORTANTE LGPD (ADR 0015): trail só carrega regra/referência/saída.

import { useState } from "react";
import { useClassification } from "../hooks/useClassification";
import { useTriageTrail } from "../hooks/useTriageTrail";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { StackedBar } from "../components/StackedBar";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { Skeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { KpiSkeleton } from "./Overview";
import { fmtNumber, fmtTime } from "../lib/format";

export function Classification() {
  const [ trailOf, setTrailOf ] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useClassification();

  if (isLoading) return <Wrap><KpiGrid><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Distribuição"><Skeleton rows={4} /></Panel></Wrap>;
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const d = data.data;
  return (
    <Wrap>
      <KpiGrid>
        {d.tiers.map((t) => (
          <StatTile key={t.key} label={`Tier ${t.label}`} value={t.count} tone={t.tone} source="live" />
        ))}
        <StatTile label="Casos priority" value={d.priorityTrue} tone="warn" spark={d.priorityTrend} source="live" />
      </KpiGrid>

      <Panel title="Distribuição de tier" sub="total no período" asOf={data.as_of}>
        {d.tiers.every((t) => t.count === 0) ? (
          <EmptyState title="sem triagens classificadas" />
        ) : (
          <StackedBar segments={d.tiers} />
        )}
      </Panel>

      <Panel title="Tier por protocolo" sub="pivot" asOf={data.as_of}>
        <DataTable
          cols={[
            { label: "Protocolo", w: "3fr", render: (r) => <span className="mono">{r.protocol}</span> },
            { label: "Low", w: "1fr", align: "right", render: (r) => <span className="mono">{fmtNumber(r.low)}</span> },
            { label: "Medium", w: "1fr", align: "right", render: (r) => <span className="mono">{fmtNumber(r.medium)}</span> },
            { label: "High", w: "1fr", align: "right", render: (r) => <span className="mono">{fmtNumber(r.high)}</span> }
          ]}
          rows={d.byProtocol}
          rowKey={(r) => r.protocol}
          empty="sem quebra por protocolo"
        />
      </Panel>

      <Panel title="Modo de scoring" sub="weighted vs decision_table" asOf={data.as_of}>
        {d.byMode.length === 0 ? (
          <EmptyState title="modo não registrado no outcome" />
        ) : (
          <StackedBar
            segments={d.byMode.map((m) => ({ label: m.label, count: m.count, tone: m.mode === "weighted" ? "info" : "accent" }))}
          />
        )}
      </Panel>

      <Panel
        title="Amostra de inspeção"
        sub="referências apenas — sem dado clínico"
        right={<Tag tone="info">sem dado clínico</Tag>}
        asOf={data.as_of}
      >
        <DataTable
          cols={[
            { label: "Triagem", w: "2fr", render: (r) => <span className="mono">{r.id.slice(0, 12)}…</span> },
            { label: "Tier", w: "1fr", render: (r) => <Tag tone={tierTone(r.tier)}>{r.tier || "—"}</Tag> },
            { label: "Priority", w: "1fr", render: (r) => (r.priority ? <Tag tone="warn">sim</Tag> : <span className="mono" style={{ color: "var(--ink3)" }}>não</span>) },
            { label: "Modo", w: "1fr", render: (r) => <span className="mono">{r.mode || "—"}</span> },
            { label: "Protocolo", w: "2fr", render: (r) => <span className="mono">{r.protocol}</span> },
            { label: "Trail", w: "auto", align: "right", render: () => <span className="mono" style={{ color: "var(--accent)" }}>ver →</span> }
          ]}
          rows={d.sampleTriages}
          rowKey={(r) => r.id}
          onRowClick={(r) => setTrailOf(r.id)}
          empty="sem amostras"
        />
      </Panel>

      {trailOf && <TrailDrawer triageId={trailOf} onClose={() => setTrailOf(null)} />}
    </Wrap>
  );
}

function TrailDrawer({ triageId, onClose }: { triageId: string; onClose: () => void }) {
  const { data, isLoading, isError, error } = useTriageTrail(triageId);
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,20,40,0.32)",
        backdropFilter: "blur(2px)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 80
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          background: "var(--panel)",
          borderLeft: "1px solid var(--rule)",
          padding: 20,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Trail de classificação</h2>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>
              triage_id={triageId}
            </span>
          </div>
          <button onClick={onClose} className="mono" style={{ fontSize: 11, color: "var(--ink2)", padding: "4px 10px", border: "1px solid var(--rule)", borderRadius: 6 }}>
            fechar
          </button>
        </div>

        <Tag tone="info">sem dado clínico — só regras e referências (ADR 0015)</Tag>

        {isLoading && <Skeleton rows={6} />}
        {isError && <ErrorState message={(error as Error)?.message || "Erro"} />}
        {data && (
          <>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>
              protocol: <span style={{ color: "var(--ink) " }}>{data.data.protocol}</span> · mode:{" "}
              <span style={{ color: "var(--ink)" }}>{data.data.mode || "—"}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.data.steps.length === 0 ? (
                <EmptyState title="sem eventos de classificação para esta triagem" />
              ) : (
                data.data.steps.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid var(--rule)",
                      borderRadius: 8,
                      padding: 10,
                      background: "var(--sunken)"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <Tag tone={evTone(s.ev)}>{s.ev}</Tag>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>
                        {fmtTime(s.at)}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: 11.5, marginTop: 6, color: "var(--ink2)" }}>
                      rule: <span style={{ color: "var(--ink)" }}>{s.rule || "—"}</span>
                      <br />
                      ref: <span style={{ color: "var(--ink)" }}>{s.ref || "—"}</span>
                      <br />
                      out: <span style={{ color: "var(--ink)" }}>{s.out || "—"}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function tierTone(t: string | null) {
  if (t === "low") return "ok";
  if (t === "medium") return "warn";
  if (t === "high") return "down";
  return "neutral";
}

function evTone(ev: string) {
  if (ev === "tier_assigned") return "accent";
  if (ev === "priority_rule") return "warn";
  if (ev === "rule_matched") return "info";
  return "neutral";
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Classificação" sub="classification · scoring" />
      {children}
    </div>
  );
}
