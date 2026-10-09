// src/modules/SignatureOverview.tsx
// Painel de assinatura do municipal_admin (módulo 19b, F-19.14; spec §9;
// contrato §7): quem tem certificado, quem vence em 30 dias, pendentes há
// mais de 24 h, documentos por modo e assinaturas inválidas/indeterminadas.
// Só leitura; o período é no fuso da cidade (padrão: 30 dias).
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSignatureOverview, type OverviewProfessional, type OverviewSignatureRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { hasFeature } from "../lib/features";
import { fmtDateTime } from "../lib/format";
import {
  CERTIFICATE_STATUS_VIEW, OVERVIEW_KEY, SIGNATURE_DISABLED, VERIFICATION_VIEW, canSeeSignatureOverview,
  SIMULATED_NOTICE, defaultOverviewPeriod, documentLabel, fmtDay, isPendingOverdue, overviewSummary, signatureError, usesSimulatedPsc
} from "../lib/signature";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { KeyValue } from "../components/KeyValue";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { inputStyle } from "../components/formStyles";

export function SignatureOverview() {
  const { user } = useAuth();
  const allowed = canSeeSignatureOverview(user);
  const [ period, setPeriod ] = useState(() => defaultOverviewPeriod(Date.now()));
  const inverted = !!period.from && !!period.to && period.from > period.to;
  const query = useQuery({
    queryKey: [ OVERVIEW_KEY, period.from, period.to ],
    queryFn: () => getSignatureOverview({ from: period.from, to: period.to }),
    enabled: allowed && !inverted && !!period.from && !!period.to
  });

  if (!allowed) {
    return (
      <div style={page}>
        <PageHeader title="Painel de assinatura" sub="cidade · assinatura digital · só leitura" />
        <EmptyState title={hasFeature(user, "digital_signature") ? "só o administrador municipal vê este painel" : SIGNATURE_DISABLED} />
      </div>
    );
  }

  const nowMs = Date.now();
  const data = query.data;
  const summary = data ? overviewSummary(data, nowMs) : null;

  const professionalCols: Column<OverviewProfessional>[] = [
    { label: "Profissional", w: "2fr", render: (p) => p.name },
    {
      label: "Certificado", w: "1.5fr", render: (p) => {
        const view = CERTIFICATE_STATUS_VIEW[p.certificate_status] ?? { label: p.certificate_status, tone: "neutral" };
        return <Tag tone={view.tone}>{view.label}</Tag>;
      }
    },
    {
      label: "Válido até", w: "1.2fr", render: (p) => (
        <span style={row}>
          <span>{fmtDay(p.not_after)}</span>
          {typeof p.expires_in_days === "number" && <span style={muted}>{`${p.expires_in_days} ${Math.abs(p.expires_in_days) === 1 ? "dia" : "dias"}`}</span>}
        </span>
      )
    },
    { label: "Pendentes", w: "0.8fr", align: "right", render: (p) => String(p.pending_count) },
    {
      label: "Pendente mais antiga", w: "2fr", render: (p) => p.oldest_pending_at ? (
        <span style={row}>
          <span>{fmtDateTime(p.oldest_pending_at)}</span>
          {isPendingOverdue(p.oldest_pending_at, nowMs) && <Tag tone="warn">há mais de 24 h</Tag>}
        </span>
      ) : "—"
    }
  ];

  const invalidCols: Column<OverviewSignatureRow>[] = [
    { label: "Documento", w: "1fr", render: (r) => documentLabel(r.document_type) },
    { label: "Assinado por", w: "2fr", render: (r) => r.signer_name },
    {
      label: "Estado", w: "1fr", render: (r) => {
        const view = VERIFICATION_VIEW[r.verification] ?? { label: r.verification, tone: "warn" as const };
        return (
          <span style={row}>
            <Tag tone={view.tone}>{view.label}</Tag>
            {r.simulated === true && <Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag>}
          </span>
        );
      }
    },
    { label: "Verificado em", w: "1.4fr", render: (r) => fmtDateTime(r.verified_at) }
  ];

  return (
    <div style={page}>
      <PageHeader
        title="Painel de assinatura"
        sub="cidade · assinatura digital · só leitura"
        right={(
          <div style={row}>
            <label style={label}>
              De
              <input type="date" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} style={dateInput} />
            </label>
            <label style={label}>
              Até
              <input type="date" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} style={dateInput} />
            </label>
          </div>
        )}
      />
      {usesSimulatedPsc(user) && <div><Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag></div>}
      {inverted && <p role="alert" style={alert}>a data inicial vem depois da final</p>}
      {query.isError && <p role="alert" style={alert}>{signatureError(query.error)}</p>}
      {query.isPending && !inverted && <p style={muted}>carregando…</p>}

      {data && summary && (
        <>
          <Panel title="Profissionais" sub="certificado e pendentes de cada profissional">
            <div style={body}>
              <div style={grid}>
                <KeyValue k="Com certificado" v={String(summary.withCertificate)} />
                <KeyValue k="Sem certificado" v={String(summary.withoutCertificate)} />
                <KeyValue k="Vencendo em 30 dias" v={String(summary.expiring)} />
                <KeyValue k="Pendentes há mais de 24 h" v={String(summary.pendingOverdue)} />
              </div>
              <DataTable cols={professionalCols} rows={data.professionals} rowKey={(p) => p.user_id}
                empty="nenhum profissional de saúde na cidade" />
            </div>
          </Panel>

          <Panel title="Documentos por modo" sub="consultas e adendos finalizados no período">
            <div style={grid}>
              <KeyValue k="Digital" v={String(data.documents_by_mode.digital ?? 0)} />
              <KeyValue k="Papel" v={String(data.documents_by_mode.manual ?? 0)} />
              <KeyValue k="Pendente" v={String(data.documents_by_mode.pending ?? 0)} />
            </div>
          </Panel>

          <Panel title="Assinaturas inválidas ou indeterminadas" sub="na última validação">
            <DataTable cols={invalidCols} rows={data.invalid_or_indeterminate} rowKey={(r) => r.signature_id}
              empty="nenhuma assinatura inválida ou indeterminada no período" />
          </Panel>
        </>
      )}
    </div>
  );
}

const page: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };
const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--ink3)" };
const dateInput: CSSProperties = { ...inputStyle, marginTop: 0, width: 150 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
