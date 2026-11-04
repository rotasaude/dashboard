// Trechos do processo de TFD (módulo 30, F-30.6). Sem segundo fator (o api não pede). A distância vem do cadastro do destino e
// a tela só a mostra. Frota: o trecho aponta para o passageiro da viagem (`trip_passengers`) e a data é a da viagem (ida) ou a do
// retorno (volta) — o api confere; ele se cumpre pelo embarque marcado pelo motorista, sem baixa aqui. Passagem: valor e empresa,
// baixa própria a partir do dia. Trecho anulado (passageiro retirado, viagem cancelada, falta) aparece e não conta.
import { useId, useRef, useState, type FormEvent } from "react";
import { addTfdLeg, markTfdLegDone, type TfdCase, type TfdLeg } from "../../lib/api";
import { directionLabel, legBody, legModeLabel, legProblems, tfdRefusals, type LegDraft } from "../../lib/tfd";
import { fmtCents, fmtIsoDay } from "../../lib/transport";
import { fmtHourMinute } from "../../lib/format";
import type { Problem } from "../../lib/pharmacy";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { ConfirmButton } from "../../components/ConfirmButton";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, form, muted, row } from "../exams/styles";

const NEW_LEG_STATUSES = [ "authorized", "scheduled", "travelling" ];
const DONE_STATUSES = [ "scheduled", "travelling" ];
const MODES = [ "fleet", "bus_ticket", "air", "river" ];
export const FLEET_LEG_NOTE = "o trecho da frota se cumpre com o embarque marcado pelo motorista";
export const NO_FLEET_TRIP = "o paciente ainda não está numa viagem da frota — peça à central";
const FUTURE_LEG = "o trecho é de data futura — dê baixa a partir do dia";

const textsOf = (err: unknown): string[] => [ ...new Set(tfdRefusals(err).map((r) => r.text)) ];

function emptyDraft(c: TfdCase): LegDraft {
  const hasOutbound = c.legs.some((l) => l.direction === "outbound" && !l.voided);
  const mode = MODES.includes(c.report.transport_mode) ? c.report.transport_mode : "fleet";
  return { direction: hasOutbound ? "return" : "outbound", mode, date: "", tripPassengerId: "", amount: "", carrier: "", companion: false };
}

function legSituation(l: TfdLeg) {
  if (l.voided) return <Tag tone="neutral">anulado</Tag>;
  return <Tag tone={l.done ? "ok" : "info"}>{l.done ? "realizado" : "a realizar"}</Tag>;
}

export function LegsPanel({ tfdCase: c, today, onChanged }: { tfdCase: TfdCase; today: string; onChanged(c: TfdCase, text: string): void }) {
  const [ adding, setAdding ] = useState(false);
  const [ doneError, setDoneError ] = useState<string[]>([]);
  const canAdd = NEW_LEG_STATUSES.includes(c.status);
  const canMarkDone = DONE_STATUSES.includes(c.status);
  const passengerOf = (id: string | null) => c.trip_passengers.find((p) => p.id === id);

  async function markDone(l: TfdLeg) {
    setDoneError([]);
    try {
      onChanged(await markTfdLegDone(l.id), "Trecho dado como realizado.");
    } catch (err) {
      setDoneError(textsOf(err));
    }
  }

  const cols: Column<TfdLeg>[] = [
    { label: "Sentido", w: "0.6fr", card: "title", render: (l) => `${directionLabel(l.direction)} · ${fmtIsoDay(l.date)}` },
    { label: "Modal", w: "1fr", render: (l) => legModeLabel(l.mode) },
    { label: "Distância", w: "0.6fr", render: (l) => `${l.distance_km} km` },
    {
      label: "Frota ou passagem", w: "1.2fr", render: (l) => {
        if (l.ticket) return `${fmtCents(l.ticket.amount_cents)} · ${l.ticket.carrier}${l.companion ? " · com acompanhante" : ""}`;
        const p = passengerOf(l.trip_passenger_id);
        return p ? `viagem de ${fmtIsoDay(p.date)} saída ${fmtHourMinute(p.departure_at)}` : "viagem da frota";
      }
    },
    { label: "Situação", w: "0.8fr", render: legSituation },
    {
      label: "Ações", w: "1.4fr", card: "actions", render: (l) => {
        if (l.voided) return <span style={muted}>não conta para a ajuda nem para a prestação de contas</span>;
        if (l.done) return null;
        if (l.mode === "fleet") return <span style={muted}>{FLEET_LEG_NOTE}</span>;
        if (!canMarkDone) return null;
        return (
          <ConfirmButton label={`Marcar ${directionLabel(l.direction)} de ${fmtIsoDay(l.date)} como realizada`}
            question="Dar baixa neste trecho? A baixa não se desfaz."
            disabledReason={l.date > today ? FUTURE_LEG : null}
            onConfirm={() => markDone(l)} />
        );
      }
    }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {doneError.length > 0 && <p role="alert" style={alert}>{doneError.join("; ")}</p>}
      <DataTable<TfdLeg> cols={cols} rows={c.legs} rowKey={(l) => l.id} empty="nenhum trecho registrado" />
      {canAdd && !adding && (
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => setAdding(true)}>Novo trecho</button></div>
      )}
      {canAdd && adding && (
        <LegForm tfdCase={c} onCancel={() => setAdding(false)}
          onSaved={(next) => { setAdding(false); onChanged(next, "Trecho registrado."); }} />
      )}
    </div>
  );
}

function LegForm({ tfdCase: c, onSaved, onCancel }: { tfdCase: TfdCase; onSaved(c: TfdCase): void; onCancel(): void }) {
  const ids = useId();
  const [ d, setD ] = useState<LegDraft>(() => emptyDraft(c));
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ refused, setRefused ] = useState<string[]>([]);
  const [ busy, setBusy ] = useState(false);
  const running = useRef(false);
  const fleet = d.mode === "fleet";
  const set = (patch: Partial<LegDraft>) => setD((prev) => ({ ...prev, ...patch }));

  function pickPassenger(id: string) {
    const p = c.trip_passengers.find((x) => x.id === id);
    // Na ida, a data é a da viagem; na volta é a do retorno, que o processo não traz.
    set({ tripPassengerId: id, ...(p && d.direction === "outbound" ? { date: p.date } : {}) });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (running.current) return;
    const found = legProblems(d, c);
    setProblems(found);
    setRefused([]);
    if (found.length > 0) return;
    running.current = true;
    setBusy(true);
    try {
      onSaved(await addTfdLeg(c.id, legBody(d)));
    } catch (err) {
      setRefused(textsOf(err));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const problemAt = (path: string) => problems.filter((p) => p.path === path).map((p) => p.text);
  const shown = (path: string) => problemAt(path).map((t) => <p key={t} role="alert" style={alert}>{t}</p>);

  return (
    <form aria-label="Trecho" onSubmit={submit} style={form} noValidate>
      <p style={muted}>{`${c.destination.distance_km} km (do cadastro do destino)`}</p>
      <label style={fieldLabel} htmlFor={`${ids}-dir`}>Sentido</label>
      <select id={`${ids}-dir`} value={d.direction} disabled={busy} style={inputStyle} onChange={(e) => set({ direction: e.target.value })}>
        <option value="outbound">ida</option>
        <option value="return">volta</option>
      </select>
      {shown("direction")}
      <label style={fieldLabel} htmlFor={`${ids}-mode`}>Modal</label>
      <select id={`${ids}-mode`} value={d.mode} disabled={busy} style={inputStyle}
        onChange={(e) => set({ mode: e.target.value, tripPassengerId: "", amount: "", carrier: "", companion: false })}>
        {MODES.map((m) => <option key={m} value={m}>{legModeLabel(m)}</option>)}
      </select>
      <label style={fieldLabel} htmlFor={`${ids}-date`}>Data</label>
      <input id={`${ids}-date`} type="date" value={d.date} disabled={busy} style={inputStyle}
        aria-invalid={problemAt("date").length > 0 || undefined} onChange={(e) => set({ date: e.target.value })} />
      {shown("date")}
      {fleet && (c.trip_passengers.length === 0 ? <p style={muted}>{NO_FLEET_TRIP}</p> : (
        <>
          <label style={fieldLabel} htmlFor={`${ids}-trip`}>Viagem da frota</label>
          <select id={`${ids}-trip`} value={d.tripPassengerId} disabled={busy} style={inputStyle}
            aria-invalid={problemAt("trip_passenger_id").length > 0 || undefined} onChange={(e) => pickPassenger(e.target.value)}>
            <option value="">escolha a viagem</option>
            {c.trip_passengers.map((p) => <option key={p.id} value={p.id}>{`${fmtIsoDay(p.date)} saída ${fmtHourMinute(p.departure_at)}`}</option>)}
          </select>
          {d.direction === "return" && <p style={muted}>na volta pela frota, a data é a do retorno da viagem</p>}
        </>
      ))}
      {fleet && shown("trip_passenger_id")}
      {!fleet && (
        <>
          <label style={fieldLabel} htmlFor={`${ids}-amount`}>Valor da passagem</label>
          <input id={`${ids}-amount`} inputMode="decimal" value={d.amount} disabled={busy} style={inputStyle} placeholder="0,00"
            aria-invalid={problemAt("ticket.amount_cents").length > 0 || undefined} onChange={(e) => set({ amount: e.target.value })} />
          {shown("ticket.amount_cents")}
          <label style={fieldLabel} htmlFor={`${ids}-carrier`}>Empresa</label>
          <input id={`${ids}-carrier`} value={d.carrier} maxLength={120} disabled={busy} style={inputStyle}
            aria-invalid={problemAt("ticket.carrier").length > 0 || undefined} onChange={(e) => set({ carrier: e.target.value })} />
          {shown("ticket.carrier")}
          {c.report.companion_indicated && (
            <label style={checkLabel}>
              <input type="checkbox" checked={d.companion} disabled={busy} onChange={(e) => set({ companion: e.target.checked })} />
              Acompanhante viaja junto
            </label>
          )}
        </>
      )}
      {shown("companion")}
      {refused.length > 0 && <p role="alert" style={alert}>{refused.join("; ")}</p>}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>{busy ? "salvando…" : "Salvar trecho"}</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Fechar</button>
      </div>
    </form>
  );
}
