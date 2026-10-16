// src/modules/exams/ExamOrderDetail.tsx
// O exame (contrato §2 `<exam_order>` e §3): situação, andamento, resultado e
// as ações que o papel da sessão tem na situação de agora. Ler grava a trilha
// no api (regras do 19a); nada fica no cache (gcTime 0, staleTime 0). Toda
// ação relê as listas e o próprio exame; 409 invalid_transition (alguém agiu
// antes) fecha o formulário, explica e relê — sem botões até a releitura.
// Duas visões (clínica e administrativa): mostra-se o que vem; CID e CNS de
// quem pediu só quando o api manda (A42/A44).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acknowledgeExam, cancelExam, collectExam, errorCode, getExamOrder, listEnabledProviders, registerExamResult, scheduleExam, setGalRequisition,
  type ExamEvent
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  DETAIL_TRANSITION_REREAD, EXAM_ORDER_KEY, EXAM_PROVIDER_REFS_KEY, ORIGIN_LABEL, criticalFromTrail, escalationLabel, eventLabel, examActions, examError, examRoles,
  examStatusLabel, examStatusTone, overdueLabel, refreshExams, scheduleBody
} from "../../lib/exams";
import { cityIsoDate, fmtDateTime } from "../../lib/format";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { ConfirmButton } from "../../components/ConfirmButton";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { ExamResultBlock } from "./ExamResultBlock";
import { GalRequisitionForm } from "./GalRequisitionForm";
import { ReasonForm } from "./ReasonForm";
import { ResultForm } from "./ResultForm";
import { ScheduleForm } from "./ScheduleForm";
import { alert, grid, list, muted, panel, row, title } from "./styles";

type Mode = null | "schedule" | "result" | "cancel" | "acknowledge" | "gal";

const CLOSED = new Set([ "denied", "cancelled" ]);

// C1: ator `system` vem sem nome. C2: o motivo da escalada é um código.
function eventText(e: ExamEvent): string {
  const actor = e.actor.type === "system" ? "Sistema" : e.actor.name ?? "—";
  const reason = e.reason ? (e.kind === "escalated" ? escalationLabel(e.reason) : e.reason) : null;
  return `${fmtDateTime(e.occurred_at)} · ${eventLabel(e.kind)} · ${actor}${reason ? ` — ${reason}` : ""}`;
}

// `focusOnOpen`: aberto abaixo de uma tabela, o foco vai para o título do
// exame (uma vez, quando ele chega) — leitor de tela e teclado acham o detalhe.
export function ExamOrderDetail({ id, onClose, onChanged, focusOnOpen = false }: {
  id: string; onClose(): void; onChanged?(): void; focusOnOpen?: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ EXAM_ORDER_KEY, id ], queryFn: () => getExamOrder(id), gcTime: 0, staleTime: 0, retry: false });
  const [ mode, setMode ] = useState<Mode>(null);
  const [ rereading, setRereading ] = useState(false);
  const message = useActionMessage();
  const order = query.data;
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const focused = useRef(false);
  const loaded = !!order;
  useEffect(() => {
    const el = headingRef.current;
    if (!focusOnOpen || !loaded || focused.current || !el) return;
    focused.current = true;
    el.focus();
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, [ focusOnOpen, loaded ]);
  const needsProvider = mode === "schedule" && !!order && !order.provider;
  const providers = useQuery({
    queryKey: [ EXAM_PROVIDER_REFS_KEY, order?.sigtap_code ?? "" ],
    queryFn: () => listEnabledProviders(order?.sigtap_code),
    enabled: needsProvider, retry: false
  });

  // Formulários: a recusa comum volta para o formulário (ele mostra); a de
  // situação velha fecha o formulário, explica e relê.
  async function act(run: () => Promise<void>, okText: string): Promise<void> {
    message.start();
    try {
      await run();
    } catch (err) {
      if (errorCode(err) !== "invalid_transition") throw err;
      setMode(null);
      message.fail(DETAIL_TRANSITION_REREAD);
      await reread();
      return;
    }
    setMode(null);
    message.ok(okText);
    await reread();
    onChanged?.();
  }
  // Sem botões até a releitura: a situação de antes poderia oferecer ação velha.
  async function reread(): Promise<void> {
    setRereading(true);
    try { await refreshExams(queryClient); } finally { setRereading(false); }
  }
  // Confirmação de um clique: a recusa aparece na mensagem do exame.
  const confirm = (run: () => Promise<void>, okText: string) => () =>
    act(run, okText).catch((err) => message.fail(examError(err)));

  if (query.isPending) {
    return <section aria-label="Exame" style={panel}><p className="mono" style={muted}>carregando o exame…</p></section>;
  }
  if (query.isError || !order) {
    return (
      <section aria-label="Exame" style={panel}>
        <p role="alert" style={alert}>{examError(query.error)}</p>
        <div><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button></div>
      </section>
    );
  }

  const roles = examRoles(user);
  const actions = examActions(order, roles, user?.id ?? null);
  const requester = order.requester.user_id ? order.requester.name : `${order.requester.name} (digitado)`;
  const scheduled = order.scheduled_at ? `${fmtDateTime(order.scheduled_at)} · ${order.scheduled_place ?? ""}` : "—";
  const criticalInTrail = criticalFromTrail(order.events);

  return (
    <section aria-label={`Exame ${order.label}`} style={panel}>
      <div style={row}>
        <h3 ref={headingRef} tabIndex={-1} style={title}>{order.label}</h3>
        <Tag tone={examStatusTone(order.status)}>{examStatusLabel(order.status)}</Tag>
        {order.priority === "urgent" && <Tag tone="urgent">urgente</Tag>}
        {order.escalated && <Tag tone="warn">na fila da equipe</Tag>}
      </div>
      <div style={grid}>
        <KeyValue k="Código" v={order.short_code} />
        <KeyValue k="Paciente" v={order.patient.display_name} mono={false} />
        <KeyValue k="SIGTAP" v={order.sigtap_code} />
        {order.cid10_justification && <KeyValue k="CID-10" v={order.cid10_justification} />}
        <KeyValue k="Origem" v={ORIGIN_LABEL[order.origin] ?? order.origin} mono={false} />
        <KeyValue k="Solicitante" v={requester} mono={false} />
        {order.requester.cns && <KeyValue k="CNS do solicitante" v={order.requester.cns} />}
        <KeyValue k="Unidade" v={order.unit.name} mono={false} />
        <KeyValue k="Prestador" v={order.provider?.name ?? "—"} mono={false} />
        {order.gal_requisition && <KeyValue k="Requisição GAL" v={order.gal_requisition} />}
        <KeyValue k="Agendado" v={scheduled} mono={false} />
        <KeyValue k="Prazo" v={overdueLabel(order.overdue)} mono={false} />
      </div>
      {order.events && order.events.length > 0 && (
        <ol aria-label="andamento" style={list}>
          {order.events.map((e, i) => <li key={`${e.kind}:${e.occurred_at}:${i}`}>{eventText(e)}</li>)}
        </ol>
      )}
      {order.result && (
        <ExamResultBlock key={order.result.id} result={order.result} critical={criticalInTrail}
          onExpired={() => void query.refetch()} />
      )}
      {order.superseded_results && order.superseded_results.length > 0 && (
        <section aria-label="Laudos substituídos" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={muted}>o cidadão vê só o laudo vigente</p>
          {order.superseded_results.map((r) => (
            <ExamResultBlock key={r.id} result={r} superseded onExpired={() => void query.refetch()} />
          ))}
        </section>
      )}
      <ActionMessage message={message.message} />

      {mode === null && rereading && <p className="mono" style={muted}>relendo o exame…</p>}
      {mode === null && !rereading && (
        <div style={row}>
          {actions.schedule && (
            <button type="button" style={secondaryButtonStyle} onClick={() => setMode("schedule")}>
              {order.status === "scheduled" ? "Reagendar" : "Agendar"}
            </button>
          )}
          {actions.collect && (
            <ConfirmButton label="Registrar coleta" question="Confirmar que o material foi coletado?"
              onConfirm={confirm(() => collectExam(order.id), "Coleta registrada.")} />
          )}
          {actions.result && <button type="button" style={secondaryButtonStyle} onClick={() => setMode("result")}>Registrar resultado</button>}
          {order.gal_requisition === null && (roles.reception || roles.professional) && !CLOSED.has(order.status) && (
            <button type="button" style={secondaryButtonStyle} onClick={() => setMode("gal")}>Registrar requisição do GAL</button>
          )}
          {actions.acknowledge && !actions.acknowledgeNeedsReason && (
            <ConfirmButton label="Dar ciência" variant="primary" question="Confirmar que você viu este resultado?"
              onConfirm={confirm(() => acknowledgeExam(order.id), "Ciência registrada.")} />
          )}
          {actions.acknowledgeNeedsReason && (
            <button type="button" style={secondaryButtonStyle} onClick={() => setMode("acknowledge")}>Dar ciência pela equipe</button>
          )}
          {actions.cancel && <button type="button" style={secondaryButtonStyle} onClick={() => setMode("cancel")}>Cancelar exame</button>}
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
        </div>
      )}

      {mode === "schedule" && needsProvider && providers.isPending && <p className="mono" style={muted}>carregando prestadores…</p>}
      {mode === "schedule" && needsProvider && providers.isError && (
        <>
          <p role="alert" style={alert}>{examError(providers.error)}</p>
          <div><button type="button" style={secondaryButtonStyle} onClick={() => setMode(null)}>Voltar</button></div>
        </>
      )}
      {mode === "schedule" && (!needsProvider || providers.isSuccess) && (
        <ScheduleForm providers={needsProvider ? providers.data ?? [] : null} onCancel={() => setMode(null)}
          onSubmit={(d) => act(() => scheduleExam(order.id, scheduleBody(d, order.provider?.id)), "Exame agendado.")} />
      )}
      {mode === "result" && (
        <ResultForm fields={order.result_fields ?? []} today={cityIsoDate()} submitLabel="Registrar resultado" onCancel={() => setMode(null)}
          onSubmit={(input) => act(() => registerExamResult(order.id, input), "Resultado registrado.")} />
      )}
      {mode === "gal" && (
        <GalRequisitionForm current={order.gal_requisition ?? null} onCancel={() => setMode(null)}
          onSubmit={(v) => act(() => setGalRequisition(order.id, v), "Requisição do GAL registrada.")} />
      )}
      {mode === "cancel" && (
        <ReasonForm label="Motivo do cancelamento" submitLabel="Cancelar exame" onCancel={() => setMode(null)}
          onSubmit={(reason) => act(() => cancelExam(order.id, reason), "Exame cancelado.")} />
      )}
      {mode === "acknowledge" && (
        <ReasonForm label="Motivo da ciência pela equipe" submitLabel="Dar ciência" onCancel={() => setMode(null)}
          onSubmit={(reason) => act(() => acknowledgeExam(order.id, reason), "Ciência registrada.")} />
      )}
    </section>
  );
}
