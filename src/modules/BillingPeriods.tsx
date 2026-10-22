// src/modules/BillingPeriods.tsx
// Competências por estabelecimento faturante (contrato §5; spec §5.4–§5.6):
// unidades não-APS e laboratório municipal com produção na competência, com o
// resumo da última conferência (BPA-I, BPA-C, não faturáveis por motivo,
// pendências). As pendências, recalculadas na hora, só no clique. Abre na
// competência anterior (a que se fecha no começo do mês). Nada relê sozinho.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { listBillingPeriods, type BillingPeriod } from "../lib/api";
import { PERIODS_KEY, billingError, closingCompetence, establishmentLabel, notBillableText, periodStatusText } from "../lib/billing";
import { competenceLabel, competenceOptions } from "../lib/competence";
import { todayInCity } from "../lib/campaigns";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, row, stack } from "./exams/styles";
import { BillingGate } from "./billing/BillingGate";
import { PendingPanel } from "./billing/PendingPanel";

export function BillingPeriods({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <BillingGate title="Competências e arquivo BPA" sub="faturamento · fechamento por estabelecimento (CNES), pendências e arquivo do BPA Magnético"
      allow={(r) => r.clerk || r.admin}>
      {() => <PeriodsBody today={today} />}
    </BillingGate>
  );
}

// Filtro "abertas" (E18): todas as competências abertas, de qualquer mês.
const OPEN = "open";

type Opened = { kind: "pending"; period: BillingPeriod };

function PeriodsBody({ today }: { today: string }) {
  const [ competence, setCompetence ] = useState(() => closingCompetence(today));
  const [ opened, setOpened ] = useState<Opened | null>(null);
  const list = useQuery({
     queryKey: [ PERIODS_KEY, competence ], queryFn: () => (competence === OPEN ? listBillingPeriods(null, "open") : listBillingPeriods(competence)),
    gcTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false
  });

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
        <button type="button" style={secondaryButtonStyle} onClick={() => setOpened({ kind: "pending", period: p })}>Pendências</button>
      </div>
    ) }
  ];

  return (
    <div style={stack}>
      <Panel title="Estabelecimentos" sub="não-APS e laboratório municipal com produção na competência" right={
        <label style={selectLabel}>
          Competência
          <select value={competence} style={inputStyle} onChange={(e) => { setOpened(null); setCompetence(e.target.value); }}>
            <option value={OPEN}>abertas</option>
            {competenceOptions(today, competence === OPEN ? null : competence).map((c) => <option key={c} value={c}>{competenceLabel(c)}</option>)}
          </select>
        </label>
      }>
        <div style={{ ...stack, padding: 16 }}>
          {list.isPending && <p className="mono" style={muted}>carregando…</p>}
          {list.isError && <p role="alert" style={alert}>{billingError(list.error)}</p>}
          {list.isSuccess && list.data.length === 0 && <EmptyState title="nenhum estabelecimento com produção nesta competência" />}
          {list.isSuccess && list.data.length > 0 && <DataTable<BillingPeriod> cols={cols} rows={list.data} rowKey={(p) => p.id} />}
        </div>
      </Panel>
      {opened?.kind === "pending" && <PendingPanel key={opened.period.id} period={opened.period} onClose={() => setOpened(null)} />}
    </div>
  );
}

const selectLabel: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink2)" };
