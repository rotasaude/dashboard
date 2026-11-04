// Passageiros de uma viagem (módulo 30, F-30.2): a lista (só os campos de <passenger> — nunca CID, procedimento, especialidade ou
// justificativa; a origem pelo rótulo), a lista impressa em PDF e, com a viagem planejada ou confirmada, montar a viagem: atendimentos
// marcados na data ou passageiro sem atendimento (busca por CPF, com motivo), e retirar com motivo (10–500; o passageiro recebe o aviso).
// O api devolve a viagem ao retirar; a agenda relê (`onChanged`). Sem polling; o CPF só vai no corpo da busca.
import { useRef, useState } from "react";
import { errorCode, removePassenger, type ScheduledCareItem, type Trip, type TripPassenger } from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import { attendanceLabel, exceptionReasonLabel, originLabel, passengerDraftFrom, transportRefusals, type PassengerDraft } from "../../lib/transport";
import { NO_NAME } from "../../lib/territoryRegistry";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { DataTable, type Column } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { secondaryButtonStyle } from "../../components/formStyles";
import { box, muted, row, stack } from "../exams/styles";
import { PassengerForm, STALE_CODES } from "./PassengerForm";
import { ScheduledCare } from "./ScheduledCare";
import { TransportPersonPick } from "./TransportPersonPick";
import { openManifest } from "./openManifest";

const REASON_TEXT = "o motivo tem de 10 a 500 caracteres";
class LocalRefusal extends Error {}

type Step =
  | { kind: "list" }
  | { kind: "person" }
  | { kind: "form"; draft: PassengerDraft; name: string; round: number }
  | { kind: "remove"; passenger: TripPassenger };

const nameOf = (p: { display_name: string | null }) => p.display_name ?? NO_NAME;

// Destino da sugestão só quando é um destino desta viagem; sem ele, com um destino só, o da viagem; senão a central escolhe.
function tripDestination(t: Trip, suggested: string): string {
  const ids = t.stops.filter((s) => s.kind === "destination" && s.destination_id).map((s) => s.destination_id as string);
  if (suggested && ids.includes(suggested)) return suggested;
  return ids.length === 1 ? ids[0] : "";
}

function firstBoarding(t: Trip): string {
  return [ ...t.stops ].sort((a, b) => a.position - b.position).find((s) => s.kind === "boarding")?.id ?? "";
}

function exceptionDraft(t: Trip, patientId: string): PassengerDraft {
  return {
    patientId, origin: "exception", originId: "", exceptionReason: "", exceptionNote: "", stopId: firstBoarding(t), destinationId: tripDestination(t, ""),
    providerName: "", address: "", appointmentAt: "", takesSeat: true, wheelchair: false, companion: null
  };
}

// `onReload`: recusa que diz que a tela está velha (não encontrado, viagem fechada, cadastro anonimizado) — a agenda relê.
export function PassengerList({ trip, onChanged, onReload }: { trip: Trip; onChanged(text: string): void; onReload?(): void }) {
  const [ step, setStep ] = useState<Step>({ kind: "list" });
  const [ pdfBusy, setPdfBusy ] = useState(false);
  const msg = useActionMessage();
  const open = trip.status === "planned" || trip.status === "confirmed";
  const stopLabel = new Map(trip.stops.map((s) => [ s.id, s.label ]));
  const round = useRef(0);

  function fromCare(item: ScheduledCareItem) {
    msg.start();
    const base = passengerDraftFrom(item, firstBoarding(trip));
    setStep({ kind: "form", draft: { ...base, destinationId: tripDestination(trip, base.destinationId) }, name: nameOf(item.patient), round: ++round.current });
  }

  async function pdf() {
    if (pdfBusy) return;
    msg.start(); setPdfBusy(true);
    try {
      const out = await openManifest(trip.id);
      if (!out.ok) msg.fail(out.text);
    } finally { setPdfBusy(false); }
  }

  const cols: Column<TripPassenger>[] = [
    { label: "Passageiro", w: "1.6fr", card: "title", render: (p) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span>{nameOf(p.patient)}</span>
        {p.patient.cns_masked && <span style={muted}>{`CNS ${p.patient.cns_masked}`}</span>}
      </div>
    ) },
    { label: "Embarque", w: "1fr", render: (p) => stopLabel.get(p.stop_id) ?? "—" },
    { label: "Destino", w: "1.3fr", render: (p) => [ p.destination.name, p.destination.provider_name ].filter(Boolean).join(" · ") },
    { label: "Hora do atendimento", w: "0.8fr", render: (p) => fmtHourMinute(p.appointment_at) },
    { label: "Vaga/Cadeira", w: "0.9fr", render: (p) => [ p.takes_seat ? "ocupa lugar" : "sem lugar", p.wheelchair ? "cadeira de rodas" : null ].filter(Boolean).join(" · ") },
    { label: "Acompanhante", w: "1.1fr", render: (p) => (p.companion
      ? [ p.companion.name, p.companion.document_last4 ? `doc. final ${p.companion.document_last4}` : null ].filter(Boolean).join(" · ") : "—") },
    { label: "Origem", w: "1fr", render: (p) => (p.origin === "exception" && p.exception_reason
      ? `${originLabel(p.origin)} · ${exceptionReasonLabel(p.exception_reason)}` : originLabel(p.origin)) },
    { label: "Presença", w: "0.9fr", render: (p) => (p.companion_attendance
      ? `${attendanceLabel(p.attendance)} · acompanhante ${attendanceLabel(p.companion_attendance)}` : attendanceLabel(p.attendance)) }
  ];
  if (open) {
    cols.push({ label: "Ações", w: "1fr", card: "actions", render: (p) => (
      <button type="button" style={secondaryButtonStyle} onClick={() => { msg.start(); setStep({ kind: "remove", passenger: p }); }}>
        {`Retirar ${nameOf(p.patient)}`}
      </button>
    ) });
  }

  return (
    <section aria-label="Passageiros" style={stack}>
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} disabled={pdfBusy} onClick={() => { void pdf(); }}>Lista de passageiros (PDF)</button>
        {open && (
          <button type="button" style={secondaryButtonStyle} onClick={() => { msg.start(); setStep({ kind: "person" }); }}>
            Passageiro sem atendimento marcado
          </button>
        )}
      </div>
      {open && <ScheduledCare trip={trip} onPick={fromCare} />}

      {step.kind === "person" && (
        <div style={box}>
          <TransportPersonPick onCancel={() => setStep({ kind: "list" })}
            onPick={(patientId, name) => setStep({ kind: "form", draft: exceptionDraft(trip, patientId), name: name ?? NO_NAME, round: ++round.current })} />
        </div>
      )}
      {step.kind === "form" && (
        <div style={box}>
          <PassengerForm key={`${step.draft.patientId}:${step.draft.originId}:${step.round}`} trip={trip} initial={step.draft} patientName={step.name}
            onCancel={() => setStep({ kind: "list" })} onRefused={onReload}
            onSaved={() => { setStep({ kind: "list" }); msg.ok("Passageiro incluído."); onChanged("Passageiro incluído."); }} />
        </div>
      )}
      {step.kind === "remove" && (
        <SensitiveAction title={`Retirar ${nameOf(step.passenger.patient)}`} description="O passageiro sai da viagem e recebe o aviso." requiresStepUp={false}
          fields={[ { name: "reason", label: "Motivo", required: true, multiline: true } ]}
          translateError={(err) => (err instanceof LocalRefusal ? err.message : transportRefusals(err)[0].text)}
          run={async (values) => {
            const reason = (values.reason ?? "").trim();
            if (reason.length < 10 || reason.length > 500) throw new LocalRefusal(REASON_TEXT);
            try {
              await removePassenger(trip.id, step.passenger.id, reason);
            } catch (err) {
              if (STALE_CODES.includes(errorCode(err) ?? "")) onReload?.();
              throw err;
            }
            msg.ok("Passageiro retirado.");
            onChanged("Passageiro retirado.");
          }}
          onDone={() => setStep({ kind: "list" })} onCancel={() => setStep({ kind: "list" })} />
      )}
      <ActionMessage message={msg.message} />

      <DataTable<TripPassenger> cols={cols} rows={trip.passengers} rowKey={(p) => p.id} empty="nenhum passageiro nesta viagem" />
    </section>
  );
}
