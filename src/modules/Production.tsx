// src/modules/Production.tsx
// Produção e-SUS (módulo 16; ADR 0028; spec §6.5; contratos §5.3): leitura
// para municipal_admin e analyst, só com `ledi_export` ligado na sessão.
// Reenviar ficha recusada é do municipal_admin, com step-up. Se a API disser
// `feature_disabled` com a sessão ainda dizendo ligada (o mantenedor desligou
// agora), a tela mostra "desligado" e relê a sessão UMA vez, para o menu
// esconder a tela; nunca entra em laço.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProduction, resendFicha, type LediFicha } from "../lib/api";
import { useAuth } from "../lib/auth";
import { featureDisabledKey, hasFeature } from "../lib/features";
import { competenceLabel, competenceOptions } from "../lib/competence";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime, fmtNumber } from "../lib/format";
import {
  FICHA_STATUS, PRODUCTION_KEY, RESEND_STALE, alertBanner, canReadProduction, canResend, deadlinePhrase, hasNextPage,
  productionError, productionErrorCode
} from "../lib/production";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";

const DISABLED_TITLE = "o envio da produção ao e-SUS está desligado nesta cidade";
const DISABLED_SUB = "quem liga é a equipe do Rota Saúde, depois que o operador da plataforma e a administração da cidade completam a configuração (veja Integrações)";

export function Production({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const { user, reload } = useAuth();
  const queryClient = useQueryClient();
  const roles = user?.memberships.map((m) => m.role) ?? [];
  const canRead = !!user && !user.operator && canReadProduction(roles);
  const switchedOn = hasFeature(user, "ledi_export");
  const [ competence, setCompetence ] = useState<string | null>(null);
  const [ page, setPage ] = useState(1);
  const [ resending, setResending ] = useState<LediFicha | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [ PRODUCTION_KEY, competence, page ],
    queryFn: () => getProduction(competence, page),
    enabled: canRead && switchedOn
  });
  const disabledByServer = query.isError && featureDisabledKey(query.error) !== null;
  const reloaded = useRef(false);

  useEffect(() => {
    if (disabledByServer && !reloaded.current) {
      reloaded.current = true;
      reload().catch(() => {});
    }
  }, [ disabledByServer, reload ]);

  if (!user) return null;
  if (!canRead) return <Frame><EmptyState title="seu papel não permite ver a produção" /></Frame>;
  if (!switchedOn || disabledByServer) return <Frame><EmptyState title={DISABLED_TITLE} sub={DISABLED_SUB} /></Frame>;

  const data = query.data;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [ PRODUCTION_KEY ] });
  const banner = data ? alertBanner(data.alert) : null;
  const options = competenceOptions(todayInCity(), data?.competence);

  // Página seguinte fixa a competência que está na tela: na virada do mês, a
  // "corrente" da API mudaria entre a página 1 e a 2.
  function goTo(next: number) {
    setCompetence((current) => current ?? data?.competence ?? null);
    setPage(next);
  }

  const cols: Column<LediFicha>[] = [
    { label: "Tipo", w: "1fr", render: (f) => <span className="mono">{f.ficha_type}</span> },
    { label: "Situação", w: "1.2fr", render: (f) =>
      <Tag tone={FICHA_STATUS[f.status]?.tone}>{FICHA_STATUS[f.status]?.label ?? f.status}</Tag> },
    { label: "Tentativas", w: "0.7fr", align: "right", render: (f) => <span className="mono">{fmtNumber(f.attempts)}</span> },
    { label: "Último erro", w: "2fr", render: (f) => f.last_error ?? "—" },
    { label: "Criada em", w: "1fr", render: (f) => fmtDateTime(f.created_at) },
    { label: "Aceita em", w: "1fr", render: (f) => fmtDateTime(f.accepted_at) },
    { label: "", w: "auto", align: "right", render: (f) => canResend(roles, f) && (
      <button type="button" aria-label={`Reenviar ficha ${f.id}`} style={secondaryButtonStyle}
        onClick={() => { setDone(null); setResending(f); }}>
        Reenviar
      </button>
    ) }
  ];

  return (
    <Frame right={
      <label style={selectLabel}>
        Competência
        <select value={competence ?? data?.competence ?? ""} style={inputStyle}
          onChange={(e) => { setCompetence(e.target.value); setPage(1); }}>
          {options.map((c) => <option key={c} value={c}>{competenceLabel(c)}</option>)}
        </select>
      </label>
    }>
      {query.isError && <p role="alert" style={alertStyle}>{productionError(query.error)}</p>}
      {done && <p role="status" style={statusStyle}>{done}</p>}
      {query.isPending && <p className="mono" style={loadingStyle}>carregando…</p>}

      {resending && (
        <SensitiveAction
          key={resending.id}
          title="Reenviar ficha recusada"
          description="A ficha volta para a fila e é enviada de novo ao PEC da cidade."
          requiresStepUp
          confirmLabel="Reenviar"
          run={async () => { await resendFicha(resending.id); }}
          onDone={() => {
            setResending(null);
            setDone("Ficha reenviada para a fila. A situação muda quando o PEC responder.");
            refresh();
          }}
          onCancel={() => setResending(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => {
            const code = productionErrorCode(err);
            if (code === "invalid_competence") return productionError(err);
            if (featureDisabledKey(err) !== null) { refresh(); return productionError(err); }
            if (code !== "not_rejected") return null;
            refresh();
            return RESEND_STALE;
          }}
        />
      )}

      {data && (
        <>
          {banner && (
            <p role={banner.tone === "down" ? "alert" : "status"}
              style={{ ...bannerStyle, color: banner.tone === "down" ? "var(--down)" : "var(--warn)" }}>
              {banner.text}
            </p>
          )}
          <p style={deadlineStyle}>{deadlinePhrase(data.deadline_on, data.business_days_left)}</p>
          <KpiGrid min={140}>
            <StatTile label="Aceitas" value={data.counts.accepted} tone="ok" />
            <StatTile label="Recusadas" value={data.counts.rejected} tone={data.counts.rejected > 0 ? "down" : undefined} />
            <StatTile label="Pendentes" value={data.counts.pending} />
            {typeof data.counts.sending === "number" && <StatTile label="Enviando" value={data.counts.sending} />}
            <StatTile label="Falharam" value={data.counts.failed} tone={data.counts.failed > 0 ? "down" : undefined} />
          </KpiGrid>

          <Panel title="Motivos de recusa" sub="agrupados pela mensagem do PEC">
            <DataTable<{ message: string; count: number }>
              cols={[
                { label: "Motivo", w: "3fr", render: (r) => r.message },
                { label: "Fichas", w: "0.7fr", align: "right", render: (r) => <span className="mono">{fmtNumber(r.count)}</span> }
              ]}
              rows={data.rejections}
              rowKey={(r) => r.message}
              empty="nenhuma recusa nesta competência"
            />
          </Panel>

          <Panel title="Fichas" sub={`competência ${competenceLabel(data.competence)} · página ${page}`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <DataTable<LediFicha> cols={cols} rows={data.fichas} rowKey={(f) => f.id} empty="nenhuma ficha nesta página" />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" disabled={page === 1} style={page === 1 ? disabledButtonStyle : secondaryButtonStyle}
                  onClick={() => goTo(page - 1)}>
                  Página anterior
                </button>
                <button type="button" disabled={!hasNextPage(page, data.fichas_total)}
                  style={hasNextPage(page, data.fichas_total) ? buttonStyle : disabledButtonStyle}
                  onClick={() => goTo(page + 1)}>
                  Próxima página
                </button>
              </div>
            </div>
          </Panel>
        </>
      )}
    </Frame>
  );
}

function Frame({ right, children }: { right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Produção e-SUS" sub="envio da produção ao PEC da cidade" right={right} />
      {children}
    </div>
  );
}

const selectLabel = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)", minWidth: 140 };
const alertStyle = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const statusStyle = { margin: 0, fontSize: 13, fontWeight: 600 };
const loadingStyle = { margin: 0, fontSize: 10.5, color: "var(--ink3)" };
const bannerStyle = { margin: 0, fontSize: 13, fontWeight: 600 };
const deadlineStyle = { margin: 0, fontSize: 12.5, color: "var(--ink2)" };
