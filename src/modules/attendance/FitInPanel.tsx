// Encaixe (módulo 17; spec §4.3, ADR 0029): horário extra dentro do turno, com
// justificativa (≥ 10, texto congelado) e contado contra o limite do turno. O
// contador vem da agenda do dia; o api confere sob lock, e o 409 fit_in_limit
// recarrega a agenda para a tela mostrar o número de verdade. Turno cancelado
// não recebe encaixe. A tela só confere que o início cai dentro do turno; o fim
// (início + duração do tipo) é o api quem confere, com 422 outside_shift (P7).
// A justificativa vai só no corpo do POST, nunca na URL.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bookAppointment, errorCode, getUnitAgenda, type HealthUnit, type RequestRow } from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { cityLocalIso, fmtHourMinute } from "../../lib/format";
import { FIT_IN_REASON_MIN, confirmationWarning } from "../../lib/scheduling";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

interface Props { row: RequestRow; unit: HealthUnit; date: string; onBack(): void; onDone(): void }

// A mesma chave da agenda da unidade: recarregar uma recarrega a outra.
export const unitAgendaKey = (unitId: string, date: string) => [ "unitAgenda", unitId, date ] as const;

export function FitInPanel({ row, unit, date, onBack, onDone }: Props) {
  const queryClient = useQueryClient();
  const agenda = useQuery({ queryKey: unitAgendaKey(unit.id, date), queryFn: () => getUnitAgenda(unit.id, date) });
  const [ shiftId, setShiftId ] = useState("");
  const [ time, setTime ] = useState("");
  const [ reason, setReason ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const options = (agenda.data?.professionals ?? []).flatMap((p) =>
    p.shifts.filter((s) => !s.cancelled_at).map((s) => ({ professional: p, shift: s })));
  const chosen = options.find((o) => o.shift.shift_id === shiftId) ?? null;
  const startsAt = /^\d{2}:\d{2}$/.test(time) ? cityLocalIso(`${date}T${time}`) : null;
  const span = chosen ? `${fmtHourMinute(chosen.shift.starts_at)}–${fmtHourMinute(chosen.shift.ends_at)}` : "";
  const inside = !chosen || !startsAt ||
    (Date.parse(startsAt) >= Date.parse(chosen.shift.starts_at) && Date.parse(startsAt) < Date.parse(chosen.shift.ends_at));
  const atLimit = !!chosen && chosen.shift.fit_in_count >= chosen.shift.fit_in_limit;
  const reasonOk = reason.trim().length >= FIT_IN_REASON_MIN;
  const ready = !!chosen && !!startsAt && inside && !atLimit && reasonOk && !busy;
  const warning = startsAt && inside ? confirmationWarning(new Date(startsAt), new Date()) : null;

  async function submit() {
    if (!ready || !chosen || !startsAt) return;
    setBusy(true); setError(null);
    try {
      await bookAppointment(row.id, unit.id, {
        kind: "fit_in", professional_id: chosen.professional.id, shift_id: chosen.shift.shift_id, starts_at: startsAt,
        appointment_type_key: row.appointment_type_key, reason: reason.trim()
      });
      onDone();
    } catch (err) {
      const code = errorCode(err);
      if (code === "request_not_open") { onDone(); return; }
      if (code === "fit_in_limit") void queryClient.invalidateQueries({ queryKey: unitAgendaKey(unit.id, date) });
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Encaixe" style={panel}>
      <strong>{`Encaixe — ${row.appointment_type_name}`}</strong>
      {error && <p role="alert" style={alert}>{error}</p>}
      {agenda.isError && <p role="alert" style={alert}>{attendanceError(agenda.error)}</p>}
      {agenda.isSuccess && options.length === 0 && <p style={hint}>nenhum turno ativo neste dia para encaixar</p>}
      <label style={{ ...label, maxWidth: 420 }}>Turno
        <select value={shiftId} style={inputStyle} onChange={(e) => { setShiftId(e.target.value); setError(null); }}>
          <option value="">escolha…</option>
          {options.map(({ professional, shift }) => (
            <option key={shift.shift_id} value={shift.shift_id}>
              {`${professional.name} · ${fmtHourMinute(shift.starts_at)}–${fmtHourMinute(shift.ends_at)} · encaixes ${shift.fit_in_count} de ${shift.fit_in_limit}`}
            </option>
          ))}
        </select>
      </label>
      {chosen && <p style={hint}>{`Encaixes neste turno: ${chosen.shift.fit_in_count} de ${chosen.shift.fit_in_limit}`}</p>}
      {atLimit && <p role="alert" style={{ ...alert, fontWeight: 600 }}>limite de encaixes atingido neste turno</p>}
      <label style={{ ...label, maxWidth: 200 }}>Início do encaixe
        <input type="time" value={time} style={inputStyle} onChange={(e) => { setTime(e.target.value); setError(null); }} />
      </label>
      {!inside && <small style={hint}>{`o encaixe precisa começar dentro do turno (${span})`}</small>}
      <label style={label}>Justificativa do encaixe
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 60 }}
          aria-describedby="fit-in-reason-notice" />
      </label>
      <FrozenTextNotice id="fit-in-reason-notice" />
      {reason !== "" && !reasonOk && <small style={hint}>{`pelo menos ${FIT_IN_REASON_MIN} caracteres`}</small>}
      {warning && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{warning}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!ready} onClick={() => void submit()} style={ready ? buttonStyle : disabledButtonStyle}>
          Confirmar encaixe
        </button>
        <button type="button" disabled={busy} onClick={onBack} style={secondaryButtonStyle}>Voltar às vagas</button>
      </div>
    </section>
  );
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
