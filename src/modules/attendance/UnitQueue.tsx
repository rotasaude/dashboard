import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  callAttendance, callNext, closeAttendance, errorCode, getScreening, listUnitQueue,
  type AppointmentRequestSummary, type HealthUnit, type QueueRow, type CallResult, type Screening
} from "../../lib/api";
import { ATTENDANCE_REFETCH_MS, attendanceError } from "../../lib/attendance";
import { EMPTY_OUTCOME, outcomeBody, outcomeProblem, outcomeView, type OutcomeDraft } from "../../lib/outcome";
import { fmtDateTime, fmtHourMinute } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { secondaryButtonStyle } from "../../components/formStyles";
import { Tag } from "../../components/Tag";
import { ActionButton } from "../../components/ActionButton";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ActionMessage } from "../../components/ActionMessage";
import { useActionMessage } from "../../lib/useActionMessage";
import { useReveal } from "../../lib/useReveal";
import { arrivalLabel, personLabel, priorityLabel, staleArrival } from "../../lib/queueLabels";
import { COLOR_LABEL, COLOR_TONE, screeningError, waitLabel, waitedMinutes } from "../../lib/screening";
import { ScreeningDetail, ScreeningDetailLoader } from "./ScreeningDetail";
import { ScreeningForm } from "./ScreeningForm";
import { OutcomeFields } from "./OutcomeFields";
import { ConsultationWorkspace } from "../consultation/ConsultationWorkspace";
import { DeclarationPanel } from "./DeclarationPanel";
import { PatientTimeline } from "../timeline/PatientTimeline";

// UnitQueue (Task 7) — a fila da unidade atual (spec §6 "Fila"), em duas
// partes: "Aguardando" (ordenada pela API — prioridade, depois chegada — esta
// tela não reordena) e "Em atendimento" (com quem chamou e desde quando).
// `canCare` (health_professional) chama e registra o desfecho clínico;
// `citizen_verifier` (recepção) só marca "Saiu sem atendimento" em
// Aguardando — ação que os dois papéis têm. `already_called` (outro
// profissional chamou primeiro) e `queue_empty` ("Chamar próximo" com a fila
// vazia) recarregam a fila em vez de mostrar erro parado, no mesmo padrão do
// `already_closed` de ontem (OpenAttendances).
interface Props {
  unit: HealthUnit;
  units: HealthUnit[];
  canCare: boolean;
  careBlocked?: string | null;
  onClinicalRefused?(): void;
  now?(): Date;
  // Módulo 19: `clinical_record` ligado na sessão (consulta e nome de exibição).
  clinicalRecord?: boolean;
  onGoToSecurity?(): void;
  // Módulo 19c: `clinical_documents` ligado na sessão (declaração de comparecimento).
  clinicalDocuments?: boolean;
  // Tem o papel de profissional (vínculo ou não): emite com o próprio CBO, sem matrícula.
  professional?: boolean;
  // Módulo 20: `patient_timeline` ligado na sessão. Sem o prontuário (modo
  // integrated), a linha do tempo abre pelo atendimento chamado.
  patientTimeline?: boolean;
}

// Módulo 18: a escuta aberta no painel — a que veio na chamada, uma lida pelo
// id ("Ver escuta") ou a reavaliação de quem espera com destino "no dia".
type ScreeningPanel =
  | { kind: "called"; screening: Screening }
  | { kind: "view"; id: string }
  | { kind: "reassess"; row: QueueRow; screening: Screening }
  // Módulo 19: a consulta do atendimento chamado (traz a escuta do dia no painel do paciente).
  | { kind: "consultation"; attendanceId: string }
  // Módulo 20: a linha do tempo do atendimento chamado, quando não há prontuário.
  | { kind: "timeline"; attendanceId: string };

// Vermelho no topo e destacado (spec §4); a ordem é do api.
const redRow = (r: QueueRow) =>
  r.screening?.color === "red" ? { background: "var(--down-bg)", boxShadow: "inset 3px 0 0 var(--down)" } : undefined;

// missing_role (o papel health_professional foi revogado) precisa recarregar
// a sessão além de invalidar o vínculo: canCareRole vem de user.memberships
// (AuthContext), não da query de vínculo — só onClinicalRefused não bastaria
// para esconder os botões clínicos sem um F5.
function handleClinicalRefusal(code: string | undefined, reload: () => void, onClinicalRefused?: () => void) {
  if (code !== "missing_link" && code !== "missing_role") return;
  onClinicalRefused?.();
  if (code === "missing_role") void reload();
}

export function UnitQueue({
  unit, units, canCare, careBlocked, onClinicalRefused, now = () => new Date(), clinicalRecord = false, onGoToSecurity,
  clinicalDocuments = false, professional = false, patientTimeline = false
}: Props) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const query = useQuery({ queryKey: [ "unitQueue", unit.id ], queryFn: () => listUnitQueue(unit.id),
    refetchInterval: ATTENDANCE_REFETCH_MS
  });
  const [ closing, setClosing ] = useState<QueueRow | null>(null);
  // Uma mensagem por vez, junto das ações, limpa quando a próxima começa (FC-02).
  const msg = useActionMessage();
  // Botão "Encerrar" que abriu o painel, para devolver o foco ao cancelar (FC-13).
  const closeOpener = useRef<HTMLElement | null>(null);
  const [ callingNext, setCallingNext ] = useState(false);
  const [ rowBusy, setRowBusy ] = useState<string | null>(null);
  const [ panel, setPanel ] = useState<ScreeningPanel | null>(null);
  // Módulo 19c: a linha guardada aqui segura o painel mesmo que a pessoa saia da fila.
  const [ declaring, setDeclaring ] = useState<QueueRow | null>(null);
  const timelineButton = canCare && patientTimeline && !clinicalRecord;
  const declarationButton = (r: QueueRow) => clinicalDocuments && (
    <button type="button" style={secondaryButtonStyle} onClick={() => setDeclaring(r)}>Declaração</button>
  );

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: [ "unitQueue", unit.id ] });
  }

  // Com o prontuário ligado, a chamada abre a consulta (a escuta do dia está
  // no painel do paciente); sem ele, a escuta abre como no módulo 18.
  function openCalled(result: CallResult) {
    if (clinicalRecord) setPanel({ kind: "consultation", attendanceId: result.attendance.id });
    else setPanel(result.attendance.screening ? { kind: "called", screening: result.attendance.screening } : null);
  }

  // Pessoa: nome de exibição (módulo 19, D3, também para a recepção) em cima e
  // o CPF mascarado embaixo; sem nome, o CPF (FC-07/FC-15).
  const personCol = { label: "Pessoa", w: "1.6fr" as const, render: (r: QueueRow) => {
    const p = personLabel(r);
    return (
      <span style={{ display: "flex", flexDirection: "column" }}>
        <strong style={{ fontWeight: 600 }}>{p.title}</strong>
        {p.sub && <span className="mono" style={{ fontSize: 11, color: "var(--ink2)" }}>{p.sub}</span>}
      </span>
    );
  } };

  async function onCallNext() {
    if (callingNext) return;
    setCallingNext(true); msg.start();
    try {
      const result = await callNext(unit.id);
      // Contrato §9: a escuta vem dentro de `attendance`.
      openCalled(result);
      invalidate();
    } catch (err) {
      const code = errorCode(err);
      // queue_empty: outro profissional esvaziou a fila entre o clique e a
      // resposta — a lista de Aguardando já mostra "Ninguém aguardando" ao
      // recarregar, sem precisar de um alerta parado (mesmo padrão do
      // already_closed de OpenAttendances).
      if (code === "queue_empty") { invalidate(); return; }
      // Com SKIP LOCKED a api nova praticamente nunca devolve already_called
      // no chamar próximo; o ramo fica para uma api antiga durante o deploy e
      // é inofensivo.
      // already_called: outro profissional chamou o mesmo primeiro da fila —
      // recarrega em vez de mostrar erro parado (mesmo padrão de onCall).
      if (code === "already_called") { invalidate(); return; }
      handleClinicalRefusal(code, () => void auth.reload(), onClinicalRefused);
      msg.fail(attendanceError(err));
    } finally {
      setCallingNext(false);
    }
  }

  async function onCall(row: QueueRow) {
    if (rowBusy) return;
    setRowBusy(row.id); msg.start();
    try {
      const result = await callAttendance(row.id, unit.id);
      openCalled(result);
      invalidate();
    } catch (err) {
      const code = errorCode(err);
      // already_called: outro profissional chamou primeiro — recarrega em
      // vez de mostrar erro parado.
      if (code === "already_called") { invalidate(); return; }
      handleClinicalRefusal(code, () => void auth.reload(), onClinicalRefused);
      msg.fail(attendanceError(err));
    } finally {
      setRowBusy(null);
    }
  }

  async function onLeft(row: QueueRow) {
    if (rowBusy) return;
    setRowBusy(row.id); msg.start();
    try {
      await closeAttendance(row.id, "left", undefined, undefined);
      invalidate();
      msg.ok(`${personLabel(row).title} marcado como saiu sem atendimento`);
    } catch (err) {
      if (errorCode(err) === "already_closed") { invalidate(); return; }
      msg.fail(attendanceError(err));
    } finally {
      setRowBusy(null);
    }
  }

  async function onReassess(row: QueueRow) {
    if (rowBusy || !row.screening?.id) return;
    setRowBusy(row.id); msg.start();
    try {
      setPanel({ kind: "reassess", row, screening: await getScreening(row.screening.id) });
    } catch (err) {
      handleClinicalRefusal(errorCode(err), () => void auth.reload(), onClinicalRefused);
      msg.fail(screeningError(err));
    } finally {
      setRowBusy(null);
    }
  }

  const at = now();
  // Uma pessoa por lista, e quem já está em atendimento sai de Aguardando
  // (FC-19: a API pode devolver a mesma linha nas duas durante a chamada).
  const uniq = (rows: QueueRow[]) => rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i);
  const inCare = uniq(query.data?.in_care ?? []);
  const inCareIds = new Set(inCare.map((r) => r.id));
  const waiting = uniq((query.data?.waiting ?? []).filter((r) => !inCareIds.has(r.id)));
  const staleCount = waiting.filter((r) => staleArrival(r.checked_in_at, at)).length;
  const consultationRow = panel?.kind === "consultation" ? inCare.find((r) => r.id === panel.attendanceId) : undefined;
  const consultationRef = useReveal<HTMLElement>(panel?.kind === "consultation");

  // A consulta aberta fecha quando a pessoa dela sai de Em atendimento (FC-03).
  useEffect(() => {
    if (panel?.kind === "consultation" && query.isSuccess && !consultationRow) setPanel(null);
  }, [ panel, query.isSuccess, consultationRow ]);

  return (
    <Panel title="Fila" right={canCare && (
      <ActionButton busy={callingNext} onClick={onCallNext}>Chamar próximo</ActionButton>
    )}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <ActionMessage message={msg.message && msg.message.text !== careBlocked ? msg.message : null} />
        {query.isError && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{attendanceError(query.error)}</p>
        )}
        {careBlocked && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{careBlocked}</p>}

        {!query.isError && (
          <>
            <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <strong>Aguardando</strong>
              {query.isPending ? (
                <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
              ) : waiting.length === 0 ? (
                <EmptyState title="Ninguém aguardando" />
              ) : (
                <>
                {staleCount > 0 && (
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--warn)" }}>
                    {staleCount === 1 ? "1 pessoa" : `${staleCount} pessoas`} na fila desde dias anteriores
                  </p>
                )}
                <DataTable<QueueRow>
                  rowStyle={redRow}
                  cols={[
                    personCol,
                    { label: "Cor", w: "0.8fr", render: (r) => colorTag(r) },
                    { label: "Chegada", w: "1fr", render: (r) => arrivalLabel(r.checked_in_at, at) },
                    { label: "Espera", w: "0.8fr", render: (r) => {
                      const wait = waitLabel(r.screening?.waited_minutes ?? waitedMinutes(r.checked_in_at, at));
                      const stale = staleArrival(r.checked_in_at, at);
                      return stale ? <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>{wait}<Tag tone="warn">{stale}</Tag></span> : wait;
                    } },
                    { label: "Protocolo", w: "1.5fr", render: (r) => r.protocol_name ?? "—" },
                    { label: "Prioridade", w: "1fr", render: (r) => priorityLabel(r.priority) },
                    {
                      label: "Origem", w: "1.5fr", render: (r) =>
                        r.source === "appointment" ? `Agendamento ${fmtHourMinute(r.appointment_time)}` : null
                    },
                    {
                      label: "", w: "auto", align: "right", render: (r) => (
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          {canCare && r.screening?.id && r.screening.destination === "same_day" && (
                            <ActionButton variant="secondary" busy={rowBusy === r.id} onClick={() => onReassess(r)}>Reavaliar</ActionButton>
                          )}
                          {canCare && (
                            <ActionButton variant="secondary" busy={rowBusy === r.id} onClick={() => onCall(r)}>Chamar</ActionButton>
                          )}
                          {declarationButton(r)}
                          {/* Irreversível: confirma nomeando a pessoa, afastado de Chamar (FC-01). */}
                          <span style={{ marginLeft: 8 }}>
                            <ConfirmButton label="Saiu sem atendimento" variant="danger"
                              question={`Confirmar que ${personLabel(r).title} saiu sem atendimento?`}
                              onConfirm={() => onLeft(r)} />
                          </span>
                        </div>
                      )
                    }
                  ]}
                  rows={waiting}
                  rowKey={(r) => r.id}
                />
                </>
              )}
            </section>

            <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <strong>Em atendimento</strong>
              {query.isPending ? (
                <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
              ) : inCare.length === 0 ? (
                <EmptyState title="ninguém em atendimento" />
              ) : (
                <DataTable<QueueRow>
                  cols={[
                    personCol,
                    { label: "Cor", w: "0.8fr", render: (r) => colorTag(r) },
                    { label: "Protocolo", w: "1.5fr", render: (r) => r.protocol_name ?? "—" },
                    { label: "Prioridade", w: "1fr", render: (r) => priorityLabel(r.priority) },
                    { label: "Chamada", w: "2fr", render: (r) => `chamado por ${r.called_by_name} às ${fmtHourMinute(r.called_at)}` },
                    ...(canCare || clinicalDocuments ? [ {
                      label: "", w: "auto" as const, align: "right" as const, render: (r: QueueRow) => (
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          {declarationButton(r)}
                          {canCare && clinicalRecord && (
                            <button type="button" style={secondaryButtonStyle}
                              onClick={() => setPanel({ kind: "consultation", attendanceId: r.id })}>
                              Consulta
                            </button>
                          )}
                          {timelineButton && (
                            <button type="button" style={secondaryButtonStyle}
                              onClick={() => setPanel({ kind: "timeline", attendanceId: r.id })}>
                              Linha do tempo
                            </button>
                          )}
                          {canCare && r.screening?.id && (
                            <button type="button" style={secondaryButtonStyle}
                              onClick={() => setPanel({ kind: "view", id: r.screening!.id })}>
                              Ver escuta
                            </button>
                          )}
                          {canCare && <button type="button" style={secondaryButtonStyle}
                            onClick={(e) => { closeOpener.current = e.currentTarget; setClosing(r); }}>Encerrar</button>}
                        </div>
                      )
                    } ] : [])
                  ]}
                  rows={inCare}
                  rowKey={(r) => r.id}
                />
              )}
            </section>
          </>
        )}

        {canCare && panel?.kind === "called" && <ScreeningDetail screening={panel.screening} onClose={() => setPanel(null)} />}
        {canCare && panel?.kind === "view" && <ScreeningDetailLoader key={panel.id} id={panel.id} onClose={() => setPanel(null)}
          onError={(err) => handleClinicalRefusal(errorCode(err), () => void auth.reload(), onClinicalRefused)} />}
        {canCare && panel?.kind === "reassess" && (
          <ScreeningForm
            key={panel.screening.id}
            mode="reassess"
            screening={panel.screening}
            citizenLabel={`${panel.row.cpf_masked} · chegou às ${fmtHourMinute(panel.row.checked_in_at)}`}
            unit={unit}
            units={units}
            types={null}
            onDone={() => { setPanel(null); invalidate(); msg.ok("Reavaliação registrada."); }}
            onClosed={(message) => { setPanel(null); invalidate(); msg.fail(message); }}
            onCancel={() => setPanel(null)}
          />
        )}

        {canCare && clinicalRecord && panel?.kind === "consultation" && (
          <section ref={consultationRef} aria-labelledby="consulta-titulo" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {consultationRow && (
            <h3 id="consulta-titulo" style={{ margin: 0, fontSize: 14 }}>
              {`Consulta de ${personLabel(consultationRow).title} · chamada às ${fmtHourMinute(consultationRow.called_at)}`}
            </h3>
          )}
          <ConsultationWorkspace
            key={panel.attendanceId}
            attendanceId={panel.attendanceId}
            referenceUnitIds={inCare.find((r) => r.id === panel.attendanceId)?.reference_unit_ids}
            unit={unit}
            units={units}
            onGoToSecurity={onGoToSecurity}
            onClose={() => setPanel(null)}
            onFinalized={() => {
              invalidate();
              void queryClient.invalidateQueries({ queryKey: [ "unitRequests" ] });
              msg.ok("Consulta finalizada e atendimento encerrado.");
            }}
          />
          </section>
        )}

        {timelineButton && panel?.kind === "timeline" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16, border: "1px solid var(--rule2)", borderRadius: 8 }}>
            <PatientTimeline key={panel.attendanceId} subject={{ attendanceId: panel.attendanceId }} />
            <div><button type="button" style={secondaryButtonStyle} onClick={() => setPanel(null)}>Fechar linha do tempo</button></div>
          </div>
        )}

        {clinicalDocuments && declaring && (
          <DeclarationPanel key={declaring.id} row={declaring} professional={professional} onClose={() => setDeclaring(null)} />
        )}

        {closing && (
          <ClosePanel
            key={closing.id}
            row={closing}
            unit={unit}
            units={units}
            onClinicalRefused={onClinicalRefused}
            onCancel={() => { setClosing(null); queueMicrotask(() => closeOpener.current?.focus()); }}
            onDone={(appointmentRequest) => {
              setClosing(null);
              setPanel(null);
              invalidate();
              // o pedido nasce na tela Pedidos (desta unidade ou de outra, se
              // encaminhado) — invalida pelo prefixo para cobrir as duas.
              if (appointmentRequest) {
                void queryClient.invalidateQueries({ queryKey: [ "unitRequests" ] });
                msg.ok(`Pedido de agendamento criado na ${appointmentRequest.target_unit_name}`);
              }
            }}
          />
        )}
      </div>
    </Panel>
  );
}

function ClosePanel(
  { row, unit, units, onClinicalRefused, onCancel, onDone }: {
    row: QueueRow; unit: HealthUnit; units: HealthUnit[];
    onClinicalRefused?(): void;
    onCancel(): void; onDone(appointmentRequest: AppointmentRequestSummary | null): void;
  }
) {
  const auth = useAuth();
  // Campos e regras em OutcomeFields/outcome.ts (módulo 19: a finalização da
  // consulta usa os mesmos). A primeira unidade de referência vem escolhida.
  const [ draft, setDraft ] = useState<OutcomeDraft>(EMPTY_OUTCOME);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const { referralUnitId } = outcomeView(draft, row.reference_unit_ids, unit, units);
  const problem = outcomeProblem(draft, referralUnitId);
  const disabled = busy || problem !== null;
  // Abre à vista, com o foco no título que nomeia a pessoa (FC-04).
  const ref = useReveal<HTMLElement>(true);

  async function confirm() {
    if (disabled) return;
    setBusy(true); setError(null);
    try {
      const body = outcomeBody(draft, referralUnitId);
      const result = await closeAttendance(row.id, body.outcome, body.referral_unit_id, body.referral_note);
      onDone(result.appointmentRequest);
    } catch (err) {
      const code = errorCode(err);
      if (code === "already_closed") { onDone(null); return; }
      handleClinicalRefusal(code, () => void auth.reload(), onClinicalRefused);
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section ref={ref} onKeyDown={(e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); }}
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Encerrar atendimento de {personLabel(row).title}</h3>
      <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--ink3)" }}>
        {row.cpf_masked} · {row.protocol_name ?? "—"} · chegou às {fmtDateTime(row.checked_in_at)}
      </p>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

      <OutcomeFields value={draft} onChange={setDraft} referenceIds={row.reference_unit_ids} unit={unit} units={units} />

      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton busy={busy} disabledReason={problem} onClick={confirm}>Confirmar encerramento</ActionButton>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

// Cor da escuta; "aguardando acolhimento" é só um marcador neutro (não é dado
// clínico), por isso a recepção também o vê (contrato §9). A recepção vê só a
// cor (contratos §4): nada de queixa nem sinais nesta tela.
function colorTag(r: QueueRow) {
  if (r.screening) return <Tag tone={COLOR_TONE[r.screening.color]}>{COLOR_LABEL[r.screening.color]}</Tag>;
  if (r.awaiting_screening) return <Tag tone="neutral">aguardando acolhimento</Tag>;
  return "—";
}
