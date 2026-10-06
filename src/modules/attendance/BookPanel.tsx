// Marcar a partir do pedido (módulo 17; spec §4, contratos §4.2–§4.3). A
// recepção escolhe dia, profissional e vaga calculada pelo api. Marcação livre
// (sem profissional) só em dia sem nenhum turno na unidade (`legacy_days`).
// Vaga que some entre a leitura e o clique (slot_taken, slot_unavailable,
// invalid_time — o início já passou —, use_slots) recarrega as vagas e deixa a
// pessoa escolher de novo: a tela nunca marca outra vaga sozinha.
// Pedido já marcado que precisa remarcar (`appointment` não nulo) só remarca
// numa vaga: o api recusa a marcação livre com request_not_open.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError, bookAppointment, errorCode, getUnitAvailability,
  type AvailabilitySlot, type BookingInput, type HealthUnit, type RequestRow
} from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { cityIsoDate, fmtHourMinute, parseCityLocal } from "../../lib/format";
import { AVAILABILITY_DAYS, addDaysIso, confirmationWarning, dayLabel, daysBetween, fmtDueOn, slotsByDay } from "../../lib/scheduling";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

interface Props { row: RequestRow; unit: HealthUnit; onCancel(): void; onDone(): void }

export const availabilityKey = (unitId: string) => [ "unitAvailability", unitId ] as const;

function takenCount(err: unknown): number {
  const body = (err instanceof ApiError ? err.body : null) as { taken?: number } | null;
  return typeof body?.taken === "number" && body.taken > 0 ? body.taken : 1;
}

const sameSlot = (a: AvailabilitySlot | null, b: AvailabilitySlot) =>
  !!a && a.professional_id === b.professional_id && a.starts_at === b.starts_at;

export function BookPanel({ row, unit, onCancel, onDone }: Props) {
  const queryClient = useQueryClient();
  const today = cityIsoDate();
  const [ from, setFrom ] = useState(today);
  const to = addDaysIso(from, AVAILABILITY_DAYS - 1);
  const query = useQuery({
    queryKey: [ ...availabilityKey(unit.id), row.appointment_type_key, from ],
    queryFn: () => getUnitAvailability(unit.id, row.appointment_type_key, from, to)
  });
  const [ day, setDay ] = useState<string | null>(null);
  const [ professionalId, setProfessionalId ] = useState("");
  const [ picked, setPicked ] = useState<AvailabilitySlot | null>(null);
  const [ legacyTime, setLegacyTime ] = useState("");
  const [ taken, setTaken ] = useState<number | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  // P5: pedido `scheduled` (needs_reschedule) não aceita marcação livre.
  const legacyAllowed = row.appointment === null;
  const byDay = slotsByDay(query.data?.slots ?? []);
  const legacyDays = new Set(query.data?.legacy_days ?? []);
  const daySlots = day ? (byDay.get(day) ?? []) : [];
  const professionals = [ ...new Map(daySlots.map((s) => [ s.professional_id, s.professional_name ])).entries() ]
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const visible = professionalId ? daySlots.filter((s) => s.professional_id === professionalId) : daySlots;
  const isLegacy = day !== null && legacyDays.has(day);
  const legacyAt = isLegacy && legacyAllowed && /^\d{2}:\d{2}$/.test(legacyTime) ? parseCityLocal(`${day}T${legacyTime}`) : null;
  const start = picked ? new Date(picked.starts_at) : legacyAt;
  const warning = start ? confirmationWarning(start, new Date()) : null;

  function dayOption(d: string): string {
    if (legacyDays.has(d)) return `${dayLabel(d)} · ${legacyAllowed ? "sem turno (marcação livre)" : "sem turno"}`;
    const n = byDay.get(d)?.length ?? 0;
    return `${dayLabel(d)} · ${n === 0 ? "sem vaga" : n === 1 ? "1 vaga" : `${n} vagas`}`;
  }

  function changePeriod(next: string) {
    setFrom(next < today ? today : next);
    setDay(null); setPicked(null); setProfessionalId(""); setLegacyTime(""); setTaken(null); setNotice(null);
  }

  function reloadSlots(message: string) {
    setPicked(null); setNotice(message);
    void queryClient.invalidateQueries({ queryKey: availabilityKey(unit.id) });
  }

  async function submit(allowOverlap = false) {
    if (busy) return;
    let input: BookingInput | null = null;
    if (picked) {
      input = { kind: "slot", professional_id: picked.professional_id, starts_at: picked.starts_at, appointment_type_key: row.appointment_type_key };
    } else if (legacyAt) {
      input = allowOverlap
        ? { kind: "legacy", scheduled_at: legacyAt.toISOString(), allow_overlap: true }
        : { kind: "legacy", scheduled_at: legacyAt.toISOString() };
    }
    if (!input) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await bookAppointment(row.id, unit.id, input);
      onDone();
    } catch (err) {
      const code = errorCode(err);
      if (code === "request_not_open") { onDone(); return; }
      if (input.kind === "slot" && code === "slot_taken") {
        reloadSlots("Essa vaga acabou de ser ocupada. As vagas foram recarregadas — escolha outra.");
        return;
      }
      if (input.kind === "slot" && code === "invalid_time") {
        reloadSlots("Essa vaga já começou. As vagas foram recarregadas — escolha outra.");
        return;
      }
      if (code === "slot_taken") { setTaken(takenCount(err)); return; }
      if (code === "slot_unavailable") { reloadSlots(attendanceError(err)); return; }
      if (code === "use_slots") { setLegacyTime(""); reloadSlots(attendanceError(err)); return; }
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = !!picked || !!legacyAt;

  return (
    <section aria-label="Marcar horário" style={panel}>
      <strong>{`Marcar horário — ${row.appointment_type_name} · prazo ${fmtDueOn(row.due_on)}`}</strong>
      {error && <p role="alert" style={alert}>{error}</p>}
      {notice && <p role="status" style={{ ...alert, color: "var(--warn)", fontWeight: 600 }}>{notice}</p>}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" disabled={from <= today} style={from <= today ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => changePeriod(addDaysIso(from, -AVAILABILITY_DAYS))}>← 14 dias</button>
        <span style={{ fontSize: 12.5 }}>{`${dayLabel(from)} a ${dayLabel(to)}`}</span>
        <button type="button" style={secondaryButtonStyle} onClick={() => changePeriod(addDaysIso(from, AVAILABILITY_DAYS))}>
          14 dias →
        </button>
      </div>
      {query.isError ? <p role="alert" style={alert}>{attendanceError(query.error)}</p>
        : query.isPending ? <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando vagas…</p>
        : (
          <label style={{ ...label, maxWidth: 320 }}>Dia
            <select value={day ?? ""} style={inputStyle} onChange={(e) => {
              setDay(e.target.value || null); setPicked(null); setProfessionalId(""); setLegacyTime(""); setTaken(null);
            }}>
              <option value="">escolha…</option>
              {daysBetween(from, to).map((d) => <option key={d} value={d}>{dayOption(d)}</option>)}
            </select>
          </label>
        )}

      {day && !isLegacy && (
        <>
          {professionals.length > 1 && (
            <label style={{ ...label, maxWidth: 320 }}>Profissional
              <select value={professionalId} style={inputStyle}
                onChange={(e) => { setProfessionalId(e.target.value); setPicked(null); }}>
                <option value="">todos</option>
                {professionals.map(([ id, name ]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          )}
          {visible.length === 0 ? <p style={hint}>nenhuma vaga neste dia</p> : (
            <div role="radiogroup" aria-label="Vagas" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {visible.map((s) => (
                <label key={`${s.professional_id}-${s.starts_at}`} style={{ display: "flex", gap: 6, fontSize: 13 }}>
                  <input type="radio" name="slot" checked={sameSlot(picked, s)}
                    onChange={() => { setPicked(s); setNotice(null); setError(null); }} />
                  {`${fmtHourMinute(s.starts_at)} · ${s.professional_name}`}
                </label>
              ))}
            </div>
          )}
        </>
      )}

      {day && isLegacy && !legacyAllowed && (
        <p style={hint}>Sem turno neste dia. Este pedido já tem horário: remarque numa vaga de outro dia.</p>
      )}

      {day && isLegacy && legacyAllowed && (
        <>
          <p style={hint}>Sem turno neste dia: marcação livre, sem profissional.</p>
          <label style={{ ...label, maxWidth: 240 }}>Horário (marcação livre)
            <input type="time" value={legacyTime} style={inputStyle}
              onChange={(e) => { setLegacyTime(e.target.value); setTaken(null); }} />
          </label>
          {taken !== null && (
            <p role="alert" style={{ ...alert, fontWeight: 600, color: "var(--warn)" }}>
              {taken === 1
                ? `Já há 1 horário marcado na ${unit.name} nesse horário.`
                : `Já há ${taken} horários marcados na ${unit.name} nesse horário.`} Marcar mesmo assim deixa os dois no mesmo horário.
            </p>
          )}
        </>
      )}

      {warning && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{warning}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        {taken === null ? (
          <button type="button" disabled={!ready || busy} onClick={() => void submit()}
            style={!ready || busy ? disabledButtonStyle : buttonStyle}>Confirmar horário</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void submit(true)}
            style={busy ? disabledButtonStyle : buttonStyle}>Marcar mesmo assim</button>
        )}
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
