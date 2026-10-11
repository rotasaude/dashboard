// Painel do SNCR do municipal_admin (módulo 19d, F-19.29; spec §7; contrato
// §6): o saldo de números SNCR de cada prescritor (RCE e RET), quem está com
// saldo baixo e quem nunca pediu. Só leitura. Nenhum número SNCR, CPF ou dado
// de paciente: o admin vê só contagens.
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSncrOverview, type SncrOverviewProfessional } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime, fmtNumber } from "../lib/format";
import { CONTROLLED_DISABLED } from "../lib/clinicalDocuments";
import {
  SNCR_OVERVIEW_KEY, SNCR_SIMULATED_NOTICE, canSeeSncrOverview, controlledError, controlledOn, overviewSummary, sortOverview, usesSimulatedSncr
} from "../lib/controlled";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { KeyValue } from "../components/KeyValue";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";

const SUB = "cidade · números de receita da Anvisa · só leitura";

export function SncrOverview() {
  const { user } = useAuth();
  const allowed = canSeeSncrOverview(user);
  const query = useQuery({ queryKey: [ SNCR_OVERVIEW_KEY ], queryFn: getSncrOverview, enabled: allowed, retry: false });

  if (!allowed) {
    return (
      <div style={page}>
        <PageHeader title="Painel do SNCR" sub={SUB} />
        <EmptyState title={controlledOn(user) ? "só o administrador municipal vê este painel" : CONTROLLED_DISABLED} />
      </div>
    );
  }

  const data = query.data;
  const summary = data ? overviewSummary(data) : null;
  const cols: Column<SncrOverviewProfessional>[] = [
    { label: "Profissional", w: "2fr", render: (p) => p.name },
    { label: "RCE livres", w: "1fr", align: "right", render: (p) => fmtNumber(p.rce_free) },
    { label: "RET livres", w: "1fr", align: "right", render: (p) => fmtNumber(p.ret_free) },
    { label: "Saldo", w: "1fr", render: (p) => p.low
      ? <Tag tone="warn" mono={false}>saldo baixo</Tag>
      : <Tag tone="ok" mono={false}>ok</Tag> },
    { label: "Último pedido", w: "1.4fr", render: (p) => (p.last_request_at ? fmtDateTime(p.last_request_at) : "nunca pediu") }
  ];

  return (
    <div style={page}>
      <PageHeader title="Painel do SNCR" sub={SUB} />
      {(usesSimulatedSncr(user) || data?.simulated === true) && <div><Tag tone="warn" mono={false}>{SNCR_SIMULATED_NOTICE}</Tag></div>}
      {query.isPending && <p style={muted}>carregando…</p>}
      {query.isError && <p role="alert" style={alert}>{controlledError(query.error)}</p>}
      {data && summary && (
        <Panel title="Prescritores" sub="números livres de cada médico e dentista; saldo baixo = menos de 50 livres em um dos tipos">
          <div style={body}>
            <div style={grid}>
              <KeyValue k="Prescritores" v={String(summary.professionals)} />
              <KeyValue k="Com saldo baixo" v={String(summary.low)} />
              <KeyValue k="Nunca pediram" v={String(summary.neverRequested)} />
            </div>
            <DataTable cols={cols} rows={sortOverview(data.professionals)} rowKey={(p) => p.user_id}
              empty="nenhum médico ou dentista com números do SNCR" />
          </div>
        </Panel>
      )}
    </div>
  );
}

const page: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
