// Resultados aguardando ciência (módulo 21a; spec §5 etapa 6 e "Alertas";
// contrato §3, D7): os do próprio solicitante, os negados pela regulação e a
// fila da equipe de referência. Quem está na equipe é do api (403 not_in_team
// = sem equipe ativa). As listas vêm sem andamento: o motivo da negação vem em
// `denied_reason` (A47) e a
// marca de crítico por escalada aparecem no exame aberto (nenhuma leitura de
// detalhe por linha). Páginas de 50 (C14). Dado de saúde: gcTime 0.
import { useState, type ReactNode } from "react";
import { ApiError, errorCode, listPendingAcknowledgements, listTeamAcknowledgements, type ExamOrder } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  ESCALATION_LABEL, EXAMS_DISABLED, EXAMS_NO_ROLE, EXAM_PENDING_KEY, EXAM_TEAM_KEY, canUseExams, escalationReason, examError, examRoles,
  fmtDay, overdueLabel, pendingNoticeText
} from "../lib/exams";
import { fmtDateTime } from "../lib/format";
import { useExamOrderPages } from "../hooks/useExamOrderPages";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { secondaryButtonStyle } from "../components/formStyles";
import { ExamOrderDetail } from "./exams/ExamOrderDetail";
import { alert, muted, row, stack } from "./exams/styles";

const NOT_IN_TEAM = "você não está numa equipe ativa desta unidade";

function LoadMore({ show, busy, onClick }: { show: boolean; busy: boolean; onClick(): void }) {
  if (!show) return null;
  return <div><button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onClick}>Carregar mais</button></div>;
}

export function ExamAcknowledgements() {
  const { user } = useAuth();
  const allowed = !!user && canUseExams(user) && examRoles(user).professional;
  const userId = user?.id ?? null;
  const pending = useExamOrderPages([ EXAM_PENDING_KEY, userId, "pages" ], (before) => listPendingAcknowledgements(before), allowed);
  const team = useExamOrderPages([ EXAM_TEAM_KEY, userId, "pages" ], (before) => listTeamAcknowledgements(before), allowed);
  const [ open, setOpen ] = useState<string | null>(null);

  if (!user) return null;
  if (!canUseExams(user)) return <Frame><EmptyState title={EXAMS_DISABLED} /></Frame>;
  if (!allowed) return <Frame><EmptyState title={EXAMS_NO_ROLE} /></Frame>;

  const denied = pending.query.data?.pages[0]?.denied ?? [];
  const pendingMore = !!pending.query.hasNextPage;
  const teamNotInTeam = team.query.error instanceof ApiError && team.query.error.status === 403 && errorCode(team.query.error) === "not_in_team";

  const exam: Column<ExamOrder>[] = [
    { label: "Paciente", w: "1.3fr", card: "title", render: (o) => o.patient.display_name },
    { label: "Exame", w: "1.7fr", render: (o) => (
      <span style={row}><span>{o.label}</span>{o.priority === "urgent" && <Tag tone="urgent">urgente</Tag>}</span>
    ) }
  ];
  const openCol: Column<ExamOrder> = { label: "", w: "auto", align: "right", card: "actions", render: (o) => (
    <button type="button" aria-label={`Abrir ${o.label} de ${o.patient.display_name}`} style={secondaryButtonStyle} onClick={() => setOpen(o.id)}>Abrir</button>
  ) };
  const resultCol: Column<ExamOrder> = { label: "Resultado", w: "1fr", render: (o) => (
    <span style={row}><span>{fmtDay(o.result?.released_on)}</span>{o.result?.critical && <Tag tone="down">crítico</Tag>}</span>
  ) };

  return (
    <Frame>
      {open && <ExamOrderDetail key={open} id={open} onClose={() => setOpen(null)} />}
      <Panel title="Aguardando sua ciência"
        sub={pendingNoticeText(pending.orders.length, 0, pendingMore) || "resultados dos exames que você pediu"}>
        {pending.query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {pending.query.isError && <p role="alert" style={alert}>{examError(pending.query.error)}</p>}
        {pending.query.isSuccess && (
          <>
            <DataTable cols={[ ...exam, resultCol, { label: "Prazo", w: "1.2fr", render: (o) => overdueLabel(o.overdue) }, openCol ]}
              rows={pending.orders} rowKey={(o) => o.id} empty="nenhum resultado aguardando sua ciência" />
            <LoadMore show={pendingMore} busy={pending.query.isFetchingNextPage} onClick={() => void pending.query.fetchNextPage()} />
          </>
        )}
      </Panel>
      {denied.length > 0 && (
        <Panel title="Exames negados" sub="decisão da regulação">
          <DataTable cols={[ ...exam, { label: "Desde", w: "1fr", render: (o) => fmtDateTime(o.status_changed_at) },
            { label: "Motivo", w: "1.5fr", render: (o) => o.denied_reason || "—" }, openCol ]}
            rows={denied} rowKey={(o) => o.id} />
        </Panel>
      )}
      <Panel title="Fila da equipe" sub="resultados críticos, com ciência vencida ou de solicitante sem vínculo">
        {team.query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {team.query.isError && (teamNotInTeam
          ? <EmptyState title={NOT_IN_TEAM} />
          : <p role="alert" style={alert}>{examError(team.query.error)}</p>)}
        {team.query.isSuccess && (
          <>
            <DataTable cols={[ ...exam,
              { label: "Motivo", w: "1.2fr", render: (o) => ESCALATION_LABEL[escalationReason(o)] },
              { label: "Solicitante", w: "1.2fr", render: (o) => o.requester.name },
              resultCol, openCol ]}
              rows={team.orders} rowKey={(o) => o.id} empty="a fila da equipe está vazia" />
            <LoadMore show={!!team.query.hasNextPage} busy={team.query.isFetchingNextPage} onClick={() => void team.query.fetchNextPage()} />
          </>
        )}
      </Panel>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={stack}>
      <PageHeader title="Resultados aguardando ciência" sub="exames · ciência e fila da equipe" />
      {children}
    </div>
  );
}
