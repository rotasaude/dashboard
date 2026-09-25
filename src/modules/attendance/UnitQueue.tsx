import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError, callAttendance, callNext, closeAttendance, listUnitQueue,
  type AppointmentRequestSummary, type AttendanceOutcome, type HealthUnit, type QueueRow
} from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { fmtDateTime, fmtTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

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
}

const OUTCOME_LABEL: Record<Exclude<AttendanceOutcome, "left">, string> = {
  discharged: "Atendido e liberado",
  referred: "Encaminhado",
  return: "Retorno"
};

function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? (err.body as { error?: string } | undefined)?.error : undefined;
}

export function UnitQueue({ unit, units, canCare }: Props) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ "unitQueue", unit.id ], queryFn: () => listUnitQueue(unit.id) });
  const [ closing, setClosing ] = useState<QueueRow | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const [ actionError, setActionError ] = useState<string | null>(null);
  const [ callingNext, setCallingNext ] = useState(false);
  const [ rowBusy, setRowBusy ] = useState<string | null>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: [ "unitQueue", unit.id ] });
  }

  async function onCallNext() {
    if (callingNext) return;
    setCallingNext(true); setActionError(null);
    try {
      await callNext(unit.id);
      invalidate();
    } catch (err) {
      // queue_empty: outro profissional esvaziou a fila entre o clique e a
      // resposta — a lista de Aguardando já mostra "Ninguém aguardando" ao
      // recarregar, sem precisar de um alerta parado (mesmo padrão do
      // already_closed de OpenAttendances).
      if (errorCode(err) === "queue_empty") { invalidate(); return; }
      setActionError(attendanceError(err));
    } finally {
      setCallingNext(false);
    }
  }

  async function onCall(row: QueueRow) {
    if (rowBusy) return;
    setRowBusy(row.id); setActionError(null);
    try {
      await callAttendance(row.id, unit.id);
      invalidate();
    } catch (err) {
      // already_called: outro profissional chamou primeiro — recarrega em
      // vez de mostrar erro parado.
      if (errorCode(err) === "already_called") { invalidate(); return; }
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
        {actionError && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{actionError}</p>
        )}
        {query.isError && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{attendanceError(query.error)}</p>
        )}

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
                  cols={[
                    { label: "CPF", w: "1.5fr", render: (r) => r.cpf_masked },
                    { label: "Chegada", w: "1fr", render: (r) => fmtDateTime(r.checked_in_at) },
                    { label: "Protocolo", w: "1.5fr", render: (r) => r.protocol_name ?? "—" },
                    { label: "Prioridade", w: "1fr", render: (r) => String(r.priority ?? "—") },
                    {
                      label: "Origem", w: "1.5fr", render: (r) =>
                        r.source === "appointment" ? `Agendamento ${fmtTime(r.appointment_time)}` : "—"
                    },
                    {
                      label: "", w: "auto", align: "right", render: (r) => (
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
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
                    { label: "Protocolo", w: "1.5fr", render: (r) => r.protocol_name ?? "—" },
                    { label: "Prioridade", w: "1fr", render: (r) => String(r.priority ?? "—") },
                    { label: "Chamada", w: "2fr", render: (r) => `chamado por ${r.called_by_name} às ${fmtTime(r.called_at)}` },
                    ...(canCare ? [ {
                      label: "", w: "auto" as const, align: "right" as const, render: (r: QueueRow) => (
                        <button type="button" style={secondaryButtonStyle} onClick={() => setClosing(r)}>Encerrar</button>
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

        {closing && (
          <ClosePanel
            key={closing.id}
            row={closing}
            unit={unit}
            units={units}
            onCancel={() => setClosing(null)}
            onDone={(appointmentRequest) => {
              setClosing(null);
              invalidate();
              if (appointmentRequest) setDone(`Pedido de agendamento criado na ${appointmentRequest.target_unit_name}`);
            }}
          />
        )}
      </div>
    </Panel>
  );
}

function ClosePanel(
  { row, unit, units, onCancel, onDone }: {
    row: QueueRow; unit: HealthUnit; units: HealthUnit[];
    onCancel(): void; onDone(appointmentRequest: AppointmentRequestSummary | null): void;
  }
) {
  const [ outcome, setOutcome ] = useState<Exclude<AttendanceOutcome, "left">>("discharged");
  const [ referralUnitId, setReferralUnitId ] = useState("");
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
      const result = await closeAttendance(row.id, outcome, referralUnitId || undefined, note || undefined);
      onDone(result.appointmentRequest);
    } catch (err) {
      if (errorCode(err) === "already_closed") { onDone(null); return; }
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
            <select value={referralUnitId} onChange={(e) => setReferralUnitId(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Descrição
            <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
          </label>
        </>
      )}

      {outcome === "return" && (
        <label style={labelStyle}>
          Nota (opcional)
          <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
        </label>
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
