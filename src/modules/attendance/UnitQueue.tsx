import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  callAttendance, callNext, closeAttendance, errorCode, getScreening, listUnitQueue,
  type AppointmentRequestSummary, type AttendanceOutcome, type HealthUnit, type QueueRow, type Screening
} from "../../lib/api";
import { ATTENDANCE_REFETCH_MS, attendanceError, splitReferenceUnits } from "../../lib/attendance";
import { fmtDateTime, fmtHourMinute } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { Tag } from "../../components/Tag";
import { COLOR_LABEL, COLOR_TONE, screeningError, waitLabel, waitedMinutes } from "../../lib/screening";
import { ScreeningDetail, ScreeningDetailLoader } from "./ScreeningDetail";
import { ScreeningForm } from "./ScreeningForm";

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
}

// Módulo 18: a escuta aberta no painel — a que veio na chamada, uma lida pelo
// id ("Ver escuta") ou a reavaliação de quem espera com destino "no dia".
type ScreeningPanel =
  | { kind: "called"; screening: Screening }
  | { kind: "view"; id: string }
  | { kind: "reassess"; row: QueueRow; screening: Screening };

// Vermelho no topo e destacado (spec §4); a ordem é do api.
const redRow = (r: QueueRow) =>
  r.screening?.color === "red" ? { background: "var(--down-bg)", boxShadow: "inset 3px 0 0 var(--down)" } : undefined;

const OUTCOME_LABEL: Record<Exclude<AttendanceOutcome, "left">, string> = {
  discharged: "Atendido e liberado",
  referred: "Encaminhado",
  return: "Retorno"
};

// missing_role (o papel health_professional foi revogado) precisa recarregar
// a sessão além de invalidar o vínculo: canCareRole vem de user.memberships
// (AuthContext), não da query de vínculo — só onClinicalRefused não bastaria
// para esconder os botões clínicos sem um F5.
function handleClinicalRefusal(code: string | undefined, reload: () => void, onClinicalRefused?: () => void) {
  if (code !== "missing_link" && code !== "missing_role") return;
  onClinicalRefused?.();
  if (code === "missing_role") void reload();
}

export function UnitQueue({ unit, units, canCare, careBlocked, onClinicalRefused, now = () => new Date() }: Props) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const query = useQuery({ queryKey: [ "unitQueue", unit.id ], queryFn: () => listUnitQueue(unit.id),
    refetchInterval: ATTENDANCE_REFETCH_MS
  });
  const [ closing, setClosing ] = useState<QueueRow | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const [ actionError, setActionError ] = useState<string | null>(null);
  const [ callingNext, setCallingNext ] = useState(false);
  const [ rowBusy, setRowBusy ] = useState<string | null>(null);
  const [ panel, setPanel ] = useState<ScreeningPanel | null>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: [ "unitQueue", unit.id ] });
  }

  async function onCallNext() {
    if (callingNext) return;
    setCallingNext(true); setActionError(null);
    try {
      const result = await callNext(unit.id);
      // Contrato §9: a escuta vem dentro de `attendance`.
      if (result.attendance.screening) setPanel({ kind: "called", screening: result.attendance.screening });
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
      setActionError(attendanceError(err));
    } finally {
      setCallingNext(false);
    }
  }

  async function onCall(row: QueueRow) {
    if (rowBusy) return;
    setRowBusy(row.id); setActionError(null);
    try {
      const result = await callAttendance(row.id, unit.id);
      if (result.attendance.screening) setPanel({ kind: "called", screening: result.attendance.screening });
      invalidate();
    } catch (err) {
      const code = errorCode(err);
      // already_called: outro profissional chamou primeiro — recarrega em
      // vez de mostrar erro parado.
      if (code === "already_called") { invalidate(); return; }
      handleClinicalRefusal(code, () => void auth.reload(), onClinicalRefused);
      setActionError(attendanceError(err));
    } finally {
      setRowBusy(null);
    }
  }

  async function onLeft(row: QueueRow) {
    if (rowBusy) return;
    setRowBusy(row.id); setActionError(null);
    try {
      await closeAttendance(row.id, "left", undefined, undefined);
      invalidate();
    } catch (err) {
      if (errorCode(err) === "already_closed") { invalidate(); return; }
      setActionError(attendanceError(err));
    } finally {
      setRowBusy(null);
    }
  }

  async function onReassess(row: QueueRow) {
    if (rowBusy || !row.screening?.id) return;
    setRowBusy(row.id); setActionError(null);
    try {
      setPanel({ kind: "reassess", row, screening: await getScreening(row.screening.id) });
    } catch (err) {
      handleClinicalRefusal(errorCode(err), () => void auth.reload(), onClinicalRefused);
      setActionError(screeningError(err));
    } finally {
      setRowBusy(null);
    }
  }

  const at = now();
  const waiting = query.data?.waiting ?? [];
  const inCare = query.data?.in_care ?? [];

  return (
    <Panel title="Fila" right={canCare && (
      <button
        type="button"
        disabled={callingNext}
        onClick={() => void onCallNext()}
        style={callingNext ? disabledButtonStyle : buttonStyle}
      >
        Chamar próximo
      </button>
    )}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {done && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{done}</p>}
        {actionError && actionError !== careBlocked && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{actionError}</p>
        )}
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
                <DataTable<QueueRow>
                  rowStyle={redRow}
                  cols={[
                    { label: "CPF", w: "1.5fr", render: (r) => r.cpf_masked },
                    { label: "Cor", w: "0.8fr", render: (r) => colorTag(r) },
                    { label: "Chegada", w: "1fr", render: (r) => fmtDateTime(r.checked_in_at) },
                    { label: "Espera", w: "0.8fr", render: (r) =>
                      waitLabel(r.screening?.waited_minutes ?? waitedMinutes(r.checked_in_at, at)) },
                    { label: "Protocolo", w: "1.5fr", render: (r) => r.protocol_name ?? "—" },
                    { label: "Prioridade", w: "1fr", render: (r) => String(r.priority ?? "—") },
                    {
                      label: "Origem", w: "1.5fr", render: (r) =>
                        r.source === "appointment" ? `Agendamento ${fmtHourMinute(r.appointment_time)}` : "—"
                    },
                    {
                      label: "", w: "auto", align: "right", render: (r) => (
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          {canCare && r.screening?.id && r.screening.destination === "same_day" && (
                            <button type="button" disabled={rowBusy === r.id} onClick={() => void onReassess(r)}
                              style={rowBusy === r.id ? disabledButtonStyle : secondaryButtonStyle}>
                              Reavaliar
                            </button>
                          )}
                          {canCare && (
                            <button
                              type="button"
                              disabled={rowBusy === r.id}
                              onClick={() => void onCall(r)}
                              style={rowBusy === r.id ? disabledButtonStyle : secondaryButtonStyle}
                            >
                              Chamar
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={rowBusy === r.id}
                            onClick={() => void onLeft(r)}
                            style={rowBusy === r.id ? disabledButtonStyle : secondaryButtonStyle}
                          >
                            Saiu sem atendimento
                          </button>
                        </div>
                      )
                    }
                  ]}
                  rows={waiting}
                  rowKey={(r) => r.id}
                />
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
                    { label: "CPF", w: "1.5fr", render: (r) => r.cpf_masked },
                    { label: "Cor", w: "0.8fr", render: (r) => colorTag(r) },
                    { label: "Protocolo", w: "1.5fr", render: (r) => r.protocol_name ?? "—" },
                    { label: "Prioridade", w: "1fr", render: (r) => String(r.priority ?? "—") },
                    { label: "Chamada", w: "2fr", render: (r) => `chamado por ${r.called_by_name} às ${fmtHourMinute(r.called_at)}` },
                    ...(canCare ? [ {
                      label: "", w: "auto" as const, align: "right" as const, render: (r: QueueRow) => (
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          {r.screening?.id && (
                            <button type="button" style={secondaryButtonStyle}
                              onClick={() => setPanel({ kind: "view", id: r.screening!.id })}>
                              Ver escuta
                            </button>
                          )}
                          <button type="button" style={secondaryButtonStyle} onClick={() => setClosing(r)}>Encerrar</button>
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
            onDone={() => { setPanel(null); invalidate(); setDone("Reavaliação registrada."); }}
            onClosed={(message) => { setPanel(null); invalidate(); setActionError(message); }}
            onCancel={() => setPanel(null)}
          />
        )}

        {closing && (
          <ClosePanel
            key={closing.id}
            row={closing}
            unit={unit}
            units={units}
            onClinicalRefused={onClinicalRefused}
            onCancel={() => setClosing(null)}
            onDone={(appointmentRequest) => {
              setClosing(null);
              setPanel(null);
              invalidate();
              // o pedido nasce na tela Pedidos (desta unidade ou de outra, se
              // encaminhado) — invalida pelo prefixo para cobrir as duas.
              if (appointmentRequest) {
                void queryClient.invalidateQueries({ queryKey: [ "unitRequests" ] });
                setDone(`Pedido de agendamento criado na ${appointmentRequest.target_unit_name}`);
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
  const [ outcome, setOutcome ] = useState<Exclude<AttendanceOutcome, "left">>("discharged");
  // Módulo 11 (D4): a primeira unidade de referência, por nome, já vem
  // escolhida; o profissional troca ou volta para "—". null = ainda não
  // mexeu, e aí vale a sugestão (que pode chegar depois, com `units`).
  const [ referralChoice, setReferralChoice ] = useState<string | null>(null);
  const { referenceUnits, otherUnits } = splitReferenceUnits(units, row.reference_unit_ids, unit.id);
  const referralUnitId = referralChoice ?? referenceUnits[0]?.id ?? "";
  const [ note, setNote ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const referralIncomplete = outcome === "referred" && !referralUnitId && !note.trim();
  const disabled = busy || referralIncomplete;

  const targetUnitName = outcome === "return"
    ? unit.name
    : (outcome === "referred" && referralUnitId ? units.find((u) => u.id === referralUnitId)?.name : undefined);

  async function confirm() {
    if (disabled) return;
    setBusy(true); setError(null);
    try {
      const result = await closeAttendance(row.id, outcome,
        outcome === "referred" ? referralUnitId || undefined : undefined, note || undefined);
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
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Encerrar atendimento</strong>
      <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--ink3)" }}>
        {row.cpf_masked} · {row.protocol_name ?? "—"} · chegou às {fmtDateTime(row.checked_in_at)}
      </p>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

      <label style={labelStyle}>
        Desfecho
        <select value={outcome} onChange={(e) => setOutcome(e.target.value as Exclude<AttendanceOutcome, "left">)} style={inputStyle}>
          {(Object.keys(OUTCOME_LABEL) as (Exclude<AttendanceOutcome, "left">)[]).map((o) => (
            <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
          ))}
        </select>
      </label>

      {outcome === "referred" && (
        <>
          <label style={labelStyle}>
            Unidade de destino
            <select value={referralUnitId} onChange={(e) => setReferralChoice(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {referenceUnits.map((u) => <option key={u.id} value={u.id}>{`${u.name} · referência`}</option>)}
              {otherUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Descrição
            <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle}
              aria-describedby="referral-note-notice" />
          </label>
          <FrozenTextNotice id="referral-note-notice" />
        </>
      )}

      {outcome === "return" && (
        <>
          <label style={labelStyle}>
            Nota (opcional)
            <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle}
              aria-describedby="return-note-notice" />
          </label>
          <FrozenTextNotice id="return-note-notice" />
        </>
      )}

      {targetUnitName && (
        <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--ink3)" }}>
          Gera pedido de agendamento na {targetUnitName}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={disabled} onClick={() => void confirm()} style={disabled ? disabledButtonStyle : buttonStyle}>
          Confirmar encerramento
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };

// Cor da escuta; "aguardando acolhimento" é só um marcador neutro (não é dado
// clínico), por isso a recepção também o vê (contrato §9). A recepção vê só a
// cor (contratos §4): nada de queixa nem sinais nesta tela.
function colorTag(r: QueueRow) {
  if (r.screening) return <Tag tone={COLOR_TONE[r.screening.color]}>{COLOR_LABEL[r.screening.color]}</Tag>;
  if (r.awaiting_screening) return <Tag tone="neutral">aguardando acolhimento</Tag>;
  return "—";
}
