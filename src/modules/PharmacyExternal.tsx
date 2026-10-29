// PharmacyExternal — receita externa e controlado de fora da rede (módulo 27a; F-27.6; contrato §7, D4, H3, H6). Por local, farmacêutico
// ou auxiliar (controlado de fora da rede é só do farmacêutico, que também é o único que digita a notificação). Passos: a pessoa (PersonStart
// com a fonte da farmácia), os dados da receita (ExternalPrescriptionForm) e, criada a receita, a dispensação no mesmo fluxo
// (DispenseForm) com a receita que o api devolveu. "Cancelar" a dispensação deixa a receita registrada, para dispensar depois pela busca do
// paciente. 409 `duplicate_suspected` volta ao passo da pessoa com a busca já feita (L28 do 24a). Nada de pessoa nem receita em URL, log
// ou storage.
import { useState } from "react";
import type { PharmacyLocation, PrescriptionView } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { PRESCRIPTION_CHANGED } from "../lib/pharmacy";
import { alert, muted, okText, panel, stack, title } from "./exams/styles";
import { DISPENSED_TEXT } from "./PharmacyDispensing";
import { DispenseForm } from "./pharmacy/DispenseForm";
import { ExternalPrescriptionForm } from "./pharmacy/ExternalPrescriptionForm";
import { LocationPick } from "./pharmacy/LocationPick";
import { PharmacyGate } from "./pharmacy/PharmacyGate";
import { PHARMACY_PERSON_SOURCE } from "./pharmacy/PrescriptionLookup";
import { PersonStart, type PersonChoice, type PersonRestart } from "./territory/PersonStart";

export const REGISTERED_LATER_TEXT = "Receita externa registrada; dispense depois pela busca do paciente.";

export function PharmacyExternal({ today = todayInCity(), delayMs }: { today?: string; delayMs?: number } = {}) {
  return (
    <PharmacyGate title="Receita externa" sub="receita de fora da rede, com profissional e conselho" allow={(r) => r.pharmacist || r.assistant}>
      {() => (
        <LocationPick allow={(r) => r.pharmacist || r.assistant}>
          {(loc) => <Body location={loc} today={today} delayMs={delayMs} />}
        </LocationPick>
      )}
    </PharmacyGate>
  );
}

type Step =
  | { kind: "person"; restart?: PersonRestart; round: number }
  | { kind: "form"; choice: PersonChoice; round: number }
  | { kind: "dispense"; prescription: PrescriptionView; round: number };
type Notice = { text: string; tone: "ok" | "info" | "alert" };

function Body({ location, today, delayMs }: { location: PharmacyLocation; today: string; delayMs?: number }) {
  const [ step, setStep ] = useState<Step>({ kind: "person", round: 0 });
  const [ notice, setNotice ] = useState<Notice | null>(null);
  const restart = (round: number, text: Notice) => { setNotice(text); setStep({ kind: "person", round: round + 1 }); };

  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      {notice && (notice.tone === "alert"
        ? <p role="alert" style={alert}>{notice.text}</p>
        : <p role="status" style={notice.tone === "ok" ? okText : muted}>{notice.text}</p>)}
      <section style={panel} aria-label="Receita externa">
        <h3 style={title}>Receita externa</h3>
        {step.kind === "person" && (
          // A chave remonta a busca na volta do 409 (o PersonStart lê `initial` ao abrir).
          <PersonStart key={step.round} today={today} source={PHARMACY_PERSON_SOURCE} initial={step.restart}
            onCancel={() => setStep({ kind: "person", round: step.round + 1 })}
            onChoose={(choice) => { setNotice(null); setStep({ kind: "form", choice, round: step.round }); }} />
        )}
        {step.kind === "form" && (
          <ExternalPrescriptionForm choice={step.choice} location={location} today={today} delayMs={delayMs}
            onCreated={(prescription) => { setNotice(null); setStep({ kind: "dispense", prescription, round: step.round }); }}
            onRestart={(r) => setStep({ kind: "person", restart: r, round: step.round + 1 })}
            onChangePerson={() => setStep({ kind: "person", round: step.round + 1 })} />
        )}
        {step.kind === "dispense" && (
          <DispenseForm location={location} prescription={step.prescription} today={today}
            onDone={() => restart(step.round, { text: DISPENSED_TEXT, tone: "ok" })}
            onStale={() => restart(step.round, { text: PRESCRIPTION_CHANGED, tone: "alert" })}
            onCancel={() => restart(step.round, { text: REGISTERED_LATER_TEXT, tone: "info" })} />
        )}
      </section>
    </div>
  );
}
