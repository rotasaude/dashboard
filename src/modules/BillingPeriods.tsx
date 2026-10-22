// src/modules/BillingPeriods.tsx
// Competências por estabelecimento faturante (contrato §5; spec §5.4–§5.6):
// unidades não-APS e laboratório municipal com produção na competência, com o
// resumo da última conferência (BPA-I, BPA-C, não faturáveis por motivo,
// pendências). As pendências, recalculadas na hora, só no clique. O faturista
// fecha (gera o arquivo, nova versão a cada fechamento) e reabre com motivo,
// os dois com step-up; o municipal_admin lê. Abre na competência anterior.
// Nada relê sozinho: só ao abrir, ao trocar a competência e depois de uma ação.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { closeBillingPeriod, errorCode, listBillingPeriods, reopenBillingPeriod, type BillingPeriod } from "../lib/api";
import {
  EXPORTS_KEY, PERIODS_KEY, billingError, closeDescription, closingCompetence, establishmentLabel, isStale, notBillableText, periodStatusText,
  reasonProblem
} from "../lib/billing";
import { competenceLabel, competenceOptions } from "../lib/competence";
import { todayInCity } from "../lib/campaigns";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, panel, row, stack } from "./exams/styles";
import { BillingGate } from "./billing/BillingGate";
import { ExportsPanel } from "./billing/ExportsPanel";
import { PendingPanel } from "./billing/PendingPanel";

export function BillingPeriods({ onGoToSecurity, today = todayInCity() }: { onGoToSecurity?(): void; today?: string } = {}) {
  return (
    <BillingGate title="Competências e arquivo BPA" sub="faturamento · fechamento por estabelecimento (CNES), pendências e arquivo do BPA Magnético"
      allow={(r) => r.clerk || r.admin}>
      {(roles) => <PeriodsBody clerk={roles.clerk} today={today} onGoToSecurity={onGoToSecurity} />}
    </BillingGate>
  );
}

// Filtro "abertas" (E18): todas as competências abertas, de qualquer mês.
const OPEN = "open";

type Opened = { kind: "pending" | "exports" | "close" | "reopen"; period: BillingPeriod };

function PeriodsBody({ clerk, today, onGoToSecurity }: { clerk: boolean; today: string; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const [ competence, setCompetence ] = useState(() => closingCompetence(today));
  const [ opened, setOpened ] = useState<Opened | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const list = useQuery({
     queryKey: [ PERIODS_KEY, competence ], queryFn: () => (competence === OPEN ? listBillingPeriods(null, "open") : listBillingPeriods(competence)),
    gcTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false
  });
  const reload = () => void queryClient.invalidateQueries({ queryKey: [ PERIODS_KEY ] });
  const open = (kind: Opened["kind"], period: BillingPeriod) => { setNotice(null); setOpened({ kind, period }); };
  const nameOf = (p: BillingPeriod) => `${competenceLabel(p.competence)} · ${p.establishment.name}`;
  // Recusa que diz que a competência mudou por outra pessoa: relê a lista.
  const translate = (err: unknown) => {
    if (isStale(err)) reload();
    return errorCode(err) ? billingError(err) : null;
  };

  const cols: Column<BillingPeriod>[] = [
    { label: "Competência", w: "0.8fr", render: (p) => competenceLabel(p.competence) },
    { label: "Estabelecimento", w: "1.8fr", card: "title", render: (p) => establishmentLabel(p.establishment) },
    { label: "Situação", w: "1.3fr", render: (p) => <Tag tone={p.status === "closed" ? "ok" : "neutral"} mono={false}>{periodStatusText(p)}</Tag> },
    { label: "BPA-I", w: "0.6fr", align: "right", render: (p) => String(p.summary.bpa_i_lines) },
    { label: "BPA-C", w: "0.6fr", align: "right", render: (p) => String(p.summary.bpa_c_lines) },
    { label: "Não faturáveis", w: "2fr", render: (p) => notBillableText(p.summary) },
    { label: "Pendências", w: "0.8fr", align: "right", render: (p) => String(p.summary.pending) },
    { label: "", w: "auto", align: "right", card: "actions", render: (p) => (
      <div data-row-actions style={row}>
        <button type="button" style={secondaryButtonStyle} onClick={() => open("pending", p)}>Pendências</button>
        <button type="button" style={secondaryButtonStyle} onClick={() => open("exports", p)}>Versões</button>
        {clerk && p.status === "open" && <button type="button" style={buttonStyle} onClick={() => open("close", p)}>Fechar e gerar arquivo</button>}
        {clerk && p.status === "closed" && <button type="button" style={secondaryButtonStyle} onClick={() => open("reopen", p)}>Reabrir</button>}
      </div>
    ) }
  ];

  return (
    <div style={stack}>
      <Panel title="Estabelecimentos" sub="não-APS e laboratório municipal com produção na competência" right={
        <label style={selectLabel}>
          Competência
          <select value={competence} style={inputStyle} onChange={(e) => { setOpened(null); setNotice(null); setCompetence(e.target.value); }}>
            <option value={OPEN}>abertas</option>
            {competenceOptions(today, competence === OPEN ? null : competence).map((c) => <option key={c} value={c}>{competenceLabel(c)}</option>)}
          </select>
        </label>
      }>
        <div style={{ ...stack, padding: 16 }}>
          {notice && <p role="status" style={statusStyle}>{notice}</p>}
          {list.isPending && <p className="mono" style={muted}>carregando…</p>}
          {list.isError && <p role="alert" style={alert}>{billingError(list.error)}</p>}
          {list.isSuccess && list.data.length === 0 && <EmptyState title="nenhum estabelecimento com produção nesta competência" />}
          {list.isSuccess && list.data.length > 0 && <DataTable<BillingPeriod> cols={cols} rows={list.data} rowKey={(p) => p.id} />}
        </div>
      </Panel>
      {opened?.kind === "pending" && <PendingPanel key={opened.period.id} period={opened.period} canFix={clerk} onClose={() => setOpened(null)} />}
      {opened?.kind === "exports" && (
        <ExportsPanel key={opened.period.id} period={opened.period} canDownload={clerk} onClose={() => setOpened(null)} />
      )}
      {clerk && opened?.kind === "close" && (
        <SensitiveAction
          key={`close:${opened.period.id}`}
          title={`Fechar ${nameOf(opened.period)}`}
          description={closeDescription(opened.period)}
          requiresStepUp
          confirmLabel="Confirmar fechamento"
          run={async () => { await closeBillingPeriod(opened.period.id); }}
          onDone={() => {
            setNotice(`Competência ${competenceLabel(opened.period.competence)} fechada para ${opened.period.establishment.name}; o arquivo está em Versões.`);
            setOpened(null);
            reload();
            void queryClient.invalidateQueries({ queryKey: [ EXPORTS_KEY ] });
          }}
          onCancel={() => setOpened(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={translate}
        />
      )}
      {clerk && opened?.kind === "reopen" && (
        <ReopenAction key={`reopen:${opened.period.id}`} period={opened.period} title={`Reabrir ${nameOf(opened.period)}`}
          onDone={() => {
            setNotice(`Competência reaberta. O próximo fechamento gera a versão ${opened.period.version + 1}.`);
            setOpened(null);
            reload();
          }}
          onCancel={() => setOpened(null)} onGoToSecurity={onGoToSecurity} translateError={translate} />
      )}
    </div>
  );
}

// Motivo revisado ANTES do step-up (padrão "Revisar" da configuração): fora de
// 10..500, nem se pede o código do autenticador, e o api nem é chamado.
function ReopenAction({ period, title, onDone, onCancel, onGoToSecurity, translateError }: {
  period: BillingPeriod; title: string; onDone(): void; onCancel(): void; onGoToSecurity?(): void; translateError(err: unknown): string | null;
}) {
  const [ reason, setReason ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const history = `A versão ${period.version} do arquivo fica no histórico; o próximo fechamento gera a versão ${period.version + 1}. O motivo fica na trilha.`;

  function review() {
    const problem = reasonProblem(reason);
    setError(problem);
    if (!problem) setConfirming(true);
  }

  if (confirming) {
    return (
      <SensitiveAction
        title={title}
        description={`${history} Motivo: ${reason.trim()}`}
        requiresStepUp
        confirmLabel="Confirmar reabertura"
        run={async () => { await reopenBillingPeriod(period.id, reason.trim()); }}
        onDone={onDone}
        onCancel={() => setConfirming(false)}
        onGoToSecurity={onGoToSecurity}
        translateError={translateError}
      />
    );
  }

  return (
    <section aria-label={title} style={panel}>
      <strong>{title}</strong>
      <p style={muted}>{history}</p>
      <label style={fieldLabel}>
        Motivo da reabertura
        <textarea value={reason} rows={3} style={inputStyle} onChange={(e) => { setError(null); setReason(e.target.value); }} />
      </label>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <button type="button" style={buttonStyle} onClick={review}>Revisar</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  );
}

const selectLabel: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink2)" };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
