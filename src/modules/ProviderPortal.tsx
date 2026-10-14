// src/modules/ProviderPortal.tsx
// Portal do prestador (módulo 21a; spec §6 e decisão 9; contrato §6): as
// guias do prestador do usuário `exam_provider`, por situação e em atraso.
// O isolamento é do api (guia de outro prestador = 404); a tela não tem
// caminho para prontuário, linha do tempo ou consulta.
import { useRef, useState, type ReactNode } from "react";
import { listProviderOrders, type ProviderOrder } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  EXAMS_DISABLED, EXAMS_NO_ROLE, PROVIDER_ORDERS_KEY, canUseExams, cpfTail, examError, examRoles, fmtDay, overdueLabel
} from "../lib/exams";
import { fmtDateTime } from "../lib/format";
import { useExamOrderPages } from "../hooks/useExamOrderPages";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { secondaryButtonStyle } from "../components/formStyles";
import { SegmentedControl } from "../shell/SegmentedControl";
import { ProviderOrderPanel } from "./exams/ProviderOrderPanel";
import { alert, muted, okText, row, stack } from "./exams/styles";

type PortalTab = "awaiting_schedule" | "scheduled" | "collected" | "overdue";

export function ProviderPortal() {
  const { user } = useAuth();
  const allowed = canUseExams(user) && examRoles(user).provider;
  const [ tab, setTab ] = useState<PortalTab>("awaiting_schedule");
  // Só o id: a guia aberta vem da lista relida; fora dela (404, outro
  // prestador, saiu da situação da aba), o painel fecha.
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ gone, setGone ] = useState<string | null>(null);
  const { query, orders } = useExamOrderPages([ PROVIDER_ORDERS_KEY, tab ],
    (before) => listProviderOrders(tab === "overdue" ? { overdue: true, before } : { statuses: [ tab ], before }), allowed);
  // O número em atraso vem em toda página; enquanto a aba nova carrega, vale o último lido.
  const lastOverdue = useRef(0);
  const freshOverdue = query.data?.pages[0]?.overdue_count;
  if (freshOverdue !== undefined) lastOverdue.current = freshOverdue;

  if (!user) return null;
  if (!canUseExams(user)) return <Frame><EmptyState title={EXAMS_DISABLED} /></Frame>;
  if (!allowed) return <Frame><EmptyState title={EXAMS_NO_ROLE} /></Frame>;

  const open = openId ? orders.find((o) => o.id === openId) ?? null : null;
  const overdueCount = freshOverdue ?? lastOverdue.current;
  const tabs: { key: PortalTab; label: string }[] = [
    { key: "awaiting_schedule", label: "A agendar" },
    { key: "scheduled", label: "Agendadas" },
    { key: "collected", label: "Coletadas" },
    { key: "overdue", label: overdueCount > 0 ? `Em atraso (${overdueCount})` : "Em atraso" }
  ];

  return (
    <Frame>
      {overdueCount > 0 && (
        <p role="status" style={{ ...alert, fontWeight: 600 }}>{overdueCount === 1 ? "1 guia em atraso" : `${overdueCount} guias em atraso`}</p>
      )}
      {notice && <p style={okText}>{notice}</p>}
      {gone && <p role="alert" style={alert}>{gone}</p>}
      {open && (
        <ProviderOrderPanel key={open.id} order={open} onClose={() => setOpenId(null)}
          onDone={(text) => { setOpenId(null); setNotice(text); }}
          onGone={(text) => { setOpenId(null); setGone(text); }} />
      )}
      <Panel title="Guias do prestador" sub="coletas e resultados · prazos da cidade">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SegmentedControl<PortalTab> options={tabs} value={tab} onChange={(t) => { setTab(t); setOpenId(null); }} />
          {query.isPending && <p className="mono" style={muted}>carregando…</p>}
          {query.isError && <p role="alert" style={alert}>{examError(query.error)}</p>}
          {query.isSuccess && (
            <DataTable<ProviderOrder>
              cols={[
                { label: "Código", w: "1fr", render: (o) => <span className="mono">{o.short_code}</span> },
                { label: "Paciente", w: "1.4fr", card: "title", render: (o) => o.patient.name },
                { label: "Nascimento", w: "0.9fr", render: (o) => fmtDay(o.patient.birth_date) },
                { label: "CPF", w: "0.9fr", render: (o) => cpfTail(o.patient.cpf_last3) },
                { label: "Exame", w: "1.6fr", render: (o) => (
                  <span style={row}><span>{o.label}</span>{o.priority === "urgent" && <Tag tone="urgent">urgente</Tag>}</span>
                ) },
                { label: "Agendado", w: "1fr", render: (o) => (o.scheduled_at ? fmtDateTime(o.scheduled_at) : "—") },
                { label: "Prazo", w: "1.1fr", render: (o) => overdueLabel(o.overdue) },
                { label: "", w: "auto", align: "right", card: "actions", render: (o) => (
                  <button type="button" aria-label={`Abrir guia ${o.short_code}`} style={secondaryButtonStyle}
                    onClick={() => { setNotice(null); setGone(null); setOpenId(o.id); }}>Abrir</button>
                ) }
              ]}
              rows={orders} rowKey={(o) => o.id} empty="nenhuma guia nesta situação"
            />
          )}
          {query.hasNextPage && (
            <div><button type="button" style={secondaryButtonStyle} onClick={() => void query.fetchNextPage()}>Carregar mais</button></div>
          )}
        </div>
      </Panel>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={stack}>
      <PageHeader title="Portal do prestador" sub="guias do seu laboratório" />
      {children}
    </div>
  );
}
