// src/modules/campaigns/CampaignPanel.tsx
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCampaign, getCampaignOptions, type Campaign, type CampaignStats, type SmsStatus } from "../../lib/api";
import {
  CAMPAIGNS_KEY, CAMPAIGN_OPTIONS_KEY, FAILURE_LABEL, SMS_STATUS_LABEL, SMS_STATUS_ORDER, STATUS_LABEL, STATUS_TONE,
  campaignError, campaignKey
} from "../../lib/campaigns";
import { describeAudience } from "../../lib/audiencePhrase";
import { fmtDateTime, fmtNumber, fmtPercent } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { CampaignLifecycleDialog, type LifecycleAction } from "./CampaignLifecycleDialog";
import { alertStyle, columnStyle, noteStyle, rowStyle, warnStyle } from "./styles";

// Painel da campanha (spec 2026-09-29 §6.3 e §7): só agregados, nenhuma lista
// de destinatários. Enquanto está "enviando", relê sozinho.
export const SENDING_REFETCH_MS = 5_000;
export const GATEWAY_ALERT = "SMS não enviado: a plataforma ainda não tem provedor de SMS";

export function statusLine(c: Campaign): string {
  switch (c.status) {
    case "draft": return "rascunho";
    case "scheduled": return `agendada para ${fmtDateTime(c.send_at)}`;
    case "sending": return "enviando — congelando o público";
    case "sent": return `enviada em ${fmtDateTime(c.dispatched_at)}`;
    case "failed": return "não enviada";
    case "cancelled": return "cancelada";
  }
}

export interface CampaignPanelProps {
  campaignId: string;
  onBack(): void;
  onEdit(id: string): void;
  onGoToSecurity(): void;
}

export function CampaignPanel({ campaignId, onBack, onEdit, onGoToSecurity }: CampaignPanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: campaignKey(campaignId),
    queryFn: () => getCampaign(campaignId),
    refetchInterval: (q) => (q.state.data?.status === "sending" ? SENDING_REFETCH_MS : false)
  });
  const options = useQuery({ queryKey: CAMPAIGN_OPTIONS_KEY, queryFn: getCampaignOptions });
  const [ acting, setActing ] = useState<LifecycleAction | null>(null);
  const back = <button type="button" style={secondaryButtonStyle} onClick={onBack}>Voltar à lista</button>;

  if (query.isError) return <Panel title="Campanha" right={back}><p role="alert" style={alertStyle}>{campaignError(query.error)}</p></Panel>;
  if (query.isPending) return <Panel title="Campanha" right={back}><p className="mono" style={noteStyle}>carregando…</p></Panel>;
  const c = query.data;
  const phrase = options.data
    ? describeAudience(c.audience, options.data)
    : options.isError ? describeAudience(c.audience, { neighborhoods: [], units: [] }) : "carregando o público…";

  function finished(next: Campaign) {
    setActing(null);
    queryClient.setQueryData(campaignKey(next.id), next);
    void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY });
    if (next.status === "draft") onEdit(next.id);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel title={c.title} sub={statusLine(c)} right={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Tag tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Tag>
          {back}
        </div>
      }>
        <div style={columnStyle}>
          {c.status === "failed" && (
            <p role="alert" style={warnStyle}>
              Não enviada: {FAILURE_LABEL[c.failure_reason ?? ""] ?? "motivo não informado"}
            </p>
          )}
          <p style={{ margin: 0, fontSize: 13 }}><strong>Público:</strong> {phrase}</p>
          {c.status === "scheduled" && !acting && (
            <div style={rowStyle}>
              <button type="button" style={secondaryButtonStyle} onClick={() => setActing("unschedule")}>Desagendar…</button>
              <button type="button" style={secondaryButtonStyle} onClick={() => setActing("cancel")}>Cancelar campanha…</button>
            </div>
          )}
          {acting && (
            <CampaignLifecycleDialog key={acting} campaign={c} action={acting} onDone={finished}
              onCancel={() => setActing(null)} onGoToSecurity={onGoToSecurity} />
          )}
        </div>
      </Panel>

      {c.stats ? <Aggregates campaign={c} stats={c.stats} /> : <NoStatsNote status={c.status} />}

      <Panel title="Aviso" sub="como está no wpda">
        <article aria-label="Texto do aviso" style={{ fontSize: 15, lineHeight: 1.5 }}>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.body}</p>
        </article>
      </Panel>
    </div>
  );
}

function Aggregates({ campaign: c, stats }: { campaign: Campaign; stats: CampaignStats }) {
  const recipients = c.recipients_count ?? 0;
  const readPct = recipients > 0 ? fmtPercent((stats.read_count / recipients) * 100) : "—";
  const unavailable = stats.sms.unavailable ?? 0;
  const failed = stats.sms.failed ?? 0;

  return (
    <Panel title="Resultado" sub="só contagens — nenhuma lista de pessoas">
      <div style={columnStyle}>
        {unavailable > 0 && (
          <p role="alert" style={warnStyle}>
            {GATEWAY_ALERT} ({fmtNumber(unavailable)} {unavailable === 1 ? "pessoa" : "pessoas"})
          </p>
        )}
        {failed > 0 && (
          <p role="alert" style={warnStyle}>{fmtNumber(failed)} SMS {failed === 1 ? "falhou" : "falharam"} no envio</p>
        )}
        <dl style={{ display: "flex", gap: 32, margin: 0, flexWrap: "wrap" }}>
          <Stat label="Destinatários" value={fmtNumber(c.recipients_count)} />
          <Stat label="Telefones" value={fmtNumber(c.phones_count)} />
          <Stat label="Lidos" value={`${fmtNumber(stats.read_count)} (${readPct})`} />
        </dl>
        {c.sms_enabled === false ? (
          <p style={noteStyle}>SMS desligado nesta cidade no momento do envio: só o aviso no wpda.</p>
        ) : (
          <DataTable<SmsStatus>
            cols={[
              { label: "SMS", w: "3fr", render: (s) => SMS_STATUS_LABEL[s] },
              { label: "Pessoas", w: "1fr", align: "right", render: (s) => <span className="mono">{fmtNumber(stats.sms[s] ?? 0)}</span> }
            ]}
            rows={SMS_STATUS_ORDER}
            rowKey={(s) => s}
          />
        )}
      </div>
    </Panel>
  );
}

// A API só manda `stats` com status "sent"; nos outros, nenhum número é
// inventado: só uma nota do que esperar.
function NoStatsNote({ status }: { status: Campaign["status"] }) {
  const text: Partial<Record<Campaign["status"], string>> = {
    sending: "Os números aparecem quando o envio terminar.",
    scheduled: "Os números aparecem depois do envio.",
    draft: "Os números aparecem depois do envio."
  };
  const note = text[status];
  return note ? <p style={noteStyle}>{note}</p> : null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={noteStyle}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{value}</dd>
    </div>
  );
}
