// ProtocolsView (§4.6) + drill-down de detalhe.
// Sinaliza "quatro olhos colapsado" (created_by == published_by).

import { useState } from "react";
import { useProtocols, useProtocolDetail } from "../hooks/useProtocols";
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
import { fmtDateTime } from "../lib/format";
import type { ProtocolRow } from "../lib/types";

export function Protocols() {
  const [ openId, setOpenId ] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useProtocols();

  if (isLoading) return <Wrap><KpiGrid><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Lista"><Skeleton rows={5} /></Panel></Wrap>;
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const list = data.data.list;
  const published = list.filter((p) => p.status === "published").length;
  const fourEyesCollapsed = list.filter((p) => p.fourEyes === false).length;

  return (
    <Wrap>
      <KpiGrid>
        <StatTile label="Protocolos & versões" value={list.length} source="live" />
        <StatTile label="Publicados" value={published} tone="ok" source="live" />
        <StatTile label="4-olhos colapsado" value={fourEyesCollapsed} tone={fourEyesCollapsed > 0 ? "warn" : "ok"} source="live" />
      </KpiGrid>

      <Panel title="Protocolos & versões" sub="autoria · publicação · validação" asOf={data.as_of}>
        <DataTable<ProtocolRow>
          cols={[
            { label: "ID", w: "2fr", render: (r) => <span className="mono">{r.id}</span> },
            { label: "Versão", w: "1fr", render: (r) => <span className="mono">{r.version}</span> },
            { label: "Status", w: "1fr", render: (r) => <Tag tone={statusTone(r.status)}>{r.status}</Tag> },
            { label: "4-olhos", w: "1fr", render: (r) => (
              r.fourEyes === false
                ? <Tag tone="warn">colapsado</Tag>
                : r.fourEyes === true
                  ? <Tag tone="ok">ok</Tag>
                  : <span className="mono" style={{ color: "var(--ink3)" }}>—</span>
            ) },
            { label: "Schema", w: "1fr", render: (r) => <Tag tone={gateTone(r.schema)}>{r.schema}</Tag> },
            { label: "Linter", w: "1fr", render: (r) => <Tag tone={gateTone(r.linter)}>{r.linter}</Tag> },
            { label: "Detalhe", w: "auto", align: "right", render: () => <span className="mono" style={{ color: "var(--accent)" }}>ver →</span> }
          ]}
          rows={list}
          rowKey={(r) => `${r.id}-${r.version}`}
          onRowClick={(r) => setOpenId(r.id)}
          empty="nenhum protocolo cadastrado"
        />
      </Panel>

      {openId && <DetailDrawer id={openId} onClose={() => setOpenId(null)} />}
    </Wrap>
  );
}

function DetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, isError, error } = useProtocolDetail(id);
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
          width: "min(640px, 100%)",
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
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Detalhe do protocolo</h2>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{id}</span>
          </div>
          <button onClick={onClose} className="mono" style={{ fontSize: 11, color: "var(--ink2)", padding: "4px 10px", border: "1px solid var(--rule)", borderRadius: 6 }}>
            fechar
          </button>
        </div>

        {isLoading && <Skeleton rows={6} />}
        {isError && <ErrorState message={(error as Error)?.message || "Erro"} />}
        {data && (
          <>
            <Panel title="Versões" sub="histórico" asOf={data.as_of}>
              <DataTable
                cols={[
                  { label: "Versão", w: "1fr", render: (v) => <span className="mono">{v.version}</span> },
                  { label: "Status", w: "1fr", render: (v) => <Tag tone={statusTone(v.status)}>{v.status}</Tag> },
                  { label: "Por", w: "1fr", render: (v) => <span className="mono">{v.publishedBy || v.createdBy || "—"}</span> },
                  { label: "4-olhos", w: "1fr", render: (v) => v.fourEyes === false ? <Tag tone="warn">colap.</Tag> : v.fourEyes === true ? <Tag tone="ok">ok</Tag> : <span className="mono">—</span> },
                  { label: "Em", w: "1fr", render: (v) => <span className="mono">{fmtDateTime(v.at)}</span> }
                ]}
                rows={data.data.versions}
                rowKey={(v) => v.version}
                empty="sem versões"
              />
            </Panel>
            <Panel title="Eventos" sub="protocol.* · auditoria" asOf={data.as_of}>
              <DataTable
                cols={[
                  { label: "Em", w: "1fr", render: (e) => <span className="mono">{fmtDateTime(e.at)}</span> },
                  { label: "Evento", w: "2fr", render: (e) => <Tag>{e.name}</Tag> },
                  { label: "Actor", w: "1fr", render: (e) => <span className="mono">{e.actor || "sistema"}</span> },
                  { label: "Ref", w: "1fr", render: (e) => <span className="mono" style={{ color: "var(--ink3)" }}>{e.ref}</span> }
                ]}
                rows={data.data.events}
                rowKey={(e, i) => `${e.at}-${i}`}
                empty="nenhum evento"
              />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function statusTone(s: string): string {
  if (s === "published" || s === "active") return "ok";
  if (s === "draft") return "info";
  if (s === "retired") return "neutral";
  return "neutral";
}

function gateTone(g: string): string {
  if (g === "ok") return "ok";
  if (g === "warn") return "warn";
  if (g === "fail") return "down";
  return "neutral";
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Protocolos" sub="protocols · governança" />
      {children}
    </div>
  );
}
