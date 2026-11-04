// Uma viagem do motorista no celular (módulo 30, F-30.4): cabeçalho, iniciar (confirmada e do dia), passageiros por parada de
// embarque com o par "Embarcou"/"Faltou" (≥ 44 px, `aria-pressed`) e o fechamento. Só os campos da visão do motorista — sem CNS,
// sem CPF, sem dado clínico.
// Cada toque envia UM item (o api exige `attendance` em todo item: o toque no acompanhante leva a presença atual do paciente) e trava
// os botões daquele passageiro até a resposta; a tela mostra o valor otimista e, na falha, volta ao anterior com a frase na linha.
import { useRef, useState, type CSSProperties } from "react";
import { errorCode, recordAttendance, startMyTrip, type AttendanceItem, type Trip, type TripAttendance, type TripPassenger } from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import { attendanceLabel, expenseKindLabel, fmtCents, pendingAttendance, transportError, tripStatusLabel, tripStatusTone } from "../../lib/transport";
import { NO_NAME } from "../../lib/territoryRegistry";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, list, muted, panel, row, stack, title } from "../exams/styles";
import { CloseTripForm } from "./CloseTripForm";

// Recusas que dizem que a tela está velha: a lista relê.
const STALE = [ "not_found", "trip_not_open", "invalid_transition", "passenger_anonymized" ];
const TARGET: CSSProperties = { minHeight: 44, flex: "1 1 0", fontSize: 15 };
const nameOf = (p: TripPassenger) => p.patient.display_name ?? NO_NAME;

type Who = "patient" | "companion";
const rowKey = (p: TripPassenger, who: Who) => `${p.id}:${who}`;

export function DriverTrip({ trip, today, onChanged, onReload }: { trip: Trip; today: string; onChanged(t: Trip): void; onReload?(): void }) {
  // Valor otimista por linha (passageiro ou acompanhante) e erro por linha.
  const [ optimistic, setOptimistic ] = useState<Record<string, string>>({});
  const [ rowError, setRowError ] = useState<Record<string, string>>({});
  const [ busyPassengers, setBusyPassengers ] = useState<Set<string>>(() => new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const [ starting, setStarting ] = useState(false);
  const [ closing, setClosing ] = useState(false);
  const msg = useActionMessage();

  const open = trip.status === "in_progress";
  const stops = [ ...trip.stops ].sort((a, b) => a.position - b.position);
  const boardings = stops.filter((s) => s.kind === "boarding");
  const known = new Set(boardings.map((s) => s.id));
  const groups = boardings.map((s) => ({ id: s.id, label: s.label, passengers: trip.passengers.filter((p) => p.stop_id === s.id) }))
    .filter((g) => g.passengers.length > 0);
  const strays = trip.passengers.filter((p) => !known.has(p.stop_id));
  if (strays.length > 0) groups.push({ id: "_other", label: "outra parada", passengers: strays });

  const current = (p: TripPassenger, who: Who): string =>
    optimistic[rowKey(p, who)] ?? (who === "patient" ? p.attendance : p.companion_attendance ?? "pending");

  const setBusy = (id: string, on: boolean) => setBusyPassengers((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const dropKey = (setter: typeof setOptimistic, key: string) => setter((prev) => {
    const next = { ...prev };
    delete next[key];
    return next;
  });

  async function mark(p: TripPassenger, who: Who, value: TripAttendance) {
    if (!open || inFlight.current.has(p.id) || current(p, who) === value) return;
    inFlight.current.add(p.id);
    const key = rowKey(p, who);
    const item: AttendanceItem = who === "patient"
      ? { passenger_id: p.id, attendance: value }
      : { passenger_id: p.id, attendance: current(p, "patient") as TripAttendance, companion_attendance: value };
    setBusy(p.id, true);
    dropKey(setRowError, rowKey(p, "patient")); dropKey(setRowError, rowKey(p, "companion"));
    setOptimistic((prev) => ({ ...prev, [key]: value }));
    try {
      const t = await recordAttendance(trip.id, [ item ]);
      onChanged(t);
    } catch (err) {
      setRowError((prev) => ({ ...prev, [key]: transportError(err) }));
      if (STALE.includes(errorCode(err) ?? "")) onReload?.();
    } finally {
      dropKey(setOptimistic, key);
      inFlight.current.delete(p.id);
      setBusy(p.id, false);
    }
  }

  async function start() {
    if (starting) return;
    msg.start(); setStarting(true);
    try {
      const t = await startMyTrip(trip.id);
      msg.ok("Viagem iniciada.");
      onChanged(t);
    } catch (err) {
      msg.fail(transportError(err));
      if (STALE.includes(errorCode(err) ?? "")) onReload?.();
    } finally { setStarting(false); }
  }

  function pair(p: TripPassenger, who: Who) {
    const busy = busyPassengers.has(p.id);
    const value = current(p, who);
    const whom = who === "patient" ? nameOf(p) : `acompanhante de ${nameOf(p)}`;
    const button = (v: TripAttendance, text: string) => {
      const pressed = value === v;
      const style = busy ? disabledButtonStyle : pressed ? buttonStyle : secondaryButtonStyle;
      return (
        <button type="button" aria-pressed={pressed} aria-label={`${text} — ${whom}`} disabled={busy} style={{ ...style, ...TARGET }}
          onClick={() => { void mark(p, who, v); }}>{pressed ? `✓ ${text}` : text}</button>
      );
    };
    return (
      <div style={row}>
        {button("boarded", "Embarcou")}
        {button("no_show", "Faltou")}
      </div>
    );
  }

  function passengerCard(p: TripPassenger) {
    const name = nameOf(p);
    const errors = [ rowError[rowKey(p, "patient")], rowError[rowKey(p, "companion")] ].filter(Boolean);
    return (
      <section key={p.id} aria-label={name} style={box}>
        <strong style={{ fontSize: 15 }}>{name}</strong>
        <span style={{ fontSize: 13 }}>{[ p.destination.name, p.destination.provider_name ].filter(Boolean).join(" · ")}</span>
        {p.appointment_at && <span style={{ fontSize: 13 }}>{`atendimento às ${fmtHourMinute(p.appointment_at)}`}</span>}
        {p.patient.phone_masked && <span style={{ fontSize: 13 }}>{`telefone ${p.patient.phone_masked}`}</span>}
        {p.wheelchair && <span style={{ fontSize: 13 }}>cadeira de rodas</span>}
        <span style={muted}>{`presença: ${attendanceLabel(current(p, "patient"))}`}</span>
        {open && pair(p, "patient")}
        {p.companion && (
          <>
            <span style={{ fontSize: 13 }}>{`Acompanhante: ${p.companion.name}`}</span>
            <span style={muted}>{`presença do acompanhante: ${attendanceLabel(current(p, "companion"))}`}</span>
            {open && pair(p, "companion")}
          </>
        )}
        {errors.map((e) => <p key={e} role="alert" style={alert}>{e}</p>)}
      </section>
    );
  }

  const pending = pendingAttendance(trip);
  const titleId = `my-trip-${trip.id}`;

  return (
    <article aria-labelledby={titleId} style={{ ...panel, maxWidth: "100%" }}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <h2 id={titleId} style={{ ...title, fontSize: 16 }}>{`Saída ${fmtHourMinute(trip.departure_at)} · retorno ${fmtHourMinute(trip.return_at)}`}</h2>
        <Tag tone={tripStatusTone(trip.status)} mono={false}>{tripStatusLabel(trip.status)}</Tag>
      </div>
      <span style={{ fontSize: 13 }}>{trip.vehicle ? `${trip.vehicle.plate} · ${trip.vehicle.model}` : "sem veículo"}</span>

      {trip.status === "confirmed" && (trip.date === today
        ? <button type="button" disabled={starting} style={{ ...(starting ? disabledButtonStyle : buttonStyle), minHeight: 44 }}
          onClick={() => { void start(); }}>Iniciar viagem</button>
        : <p style={muted}>A viagem só começa no dia dela.</p>)}
      <ActionMessage message={msg.message} />

      {groups.length === 0 ? <p style={muted}>nenhum passageiro nesta viagem</p> : groups.map((g) => (
        <div key={g.id} style={stack}>
          <h3 style={title}>{`Embarque: ${g.label}`}</h3>
          {g.passengers.map(passengerCard)}
        </div>
      ))}

      {open && pending > 0 && <p style={muted}>{`${pending} ${pending === 1 ? "presença a marcar" : "presenças a marcar"} antes de fechar`}</p>}
      {open && !closing && (
        <button type="button" style={{ ...buttonStyle, minHeight: 44 }} onClick={() => { msg.start(); setClosing(true); }}>Fechar viagem</button>
      )}
      {open && closing && (
        <CloseTripForm trip={trip} onCancel={() => setClosing(false)}
          onClosed={(t) => { setClosing(false); msg.ok("Viagem fechada."); onChanged(t); }}
          onRefused={(err) => { if (STALE.includes(errorCode(err) ?? "")) onReload?.(); }} />
      )}

      {trip.status === "done" && trip.log && <TripLogSummary trip={trip} />}
    </article>
  );
}

function TripLogSummary({ trip }: { trip: Trip }) {
  const log = trip.log;
  if (!log) return null;
  const km = log.odometer_end - log.odometer_start;
  return (
    <section aria-label="Fechamento" style={box}>
      <strong>Fechamento</strong>
      <span style={{ fontSize: 13 }}>{`Odômetro ${log.odometer_start} → ${log.odometer_end} (${km} km)`}</span>
      {log.fuel.length > 0 && (
        <ul aria-label="Abastecimentos" style={list}>
          {log.fuel.map((f, i) => <li key={i}>{`${String(f.liters).replace(".", ",")} L · ${fmtCents(f.amount_cents)} · ${f.station}`}</li>)}
        </ul>
      )}
      {log.expenses.length > 0 && (
        <ul aria-label="Despesas" style={list}>
          {log.expenses.map((e, i) => <li key={i}>{[ expenseKindLabel(e.kind), fmtCents(e.amount_cents), e.note ].filter(Boolean).join(" · ")}</li>)}
        </ul>
      )}
      <span style={muted}>{`fechada às ${fmtHourMinute(log.closed_at)} por ${log.closed_by_name}`}</span>
    </section>
  );
}
