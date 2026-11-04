// Atendimento no destino (módulo 30, F-30.5): data e hora de parede da cidade, futura e em até 365 dias, e o prestador (opcional:
// sem escolha, o api mantém o do laudo — por isso `provider_id` só vai quando escolhido). O api pede segundo fator: o formulário
// confere tudo e a confirmação passa pelo SensitiveAction. Só em `submitted`, `authorized` e `scheduled` (quem mostra decide).
import { useId, useState, type FormEvent } from "react";
import { setTfdAppointment, type TfdCase } from "../../lib/api";
import { appointmentProblems } from "../../lib/tfd";
import { cityLocalIso } from "../../lib/format";
import type { Problem } from "../../lib/pharmacy";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, row } from "../exams/styles";
import { useTfdRefusalText } from "./stepUpText";

type Body = { appointment_at: string; provider_id?: string };

export function AppointmentForm({ tfdCase, providers, now = new Date(), onSaved, onCancel, onGoToSecurity }: {
  tfdCase: TfdCase; providers: { id: string; name: string }[]; now?: Date; onSaved(c: TfdCase): void; onCancel?(): void; onGoToSecurity?(): void;
}) {
  const refusalText = useTfdRefusalText();
  const [ at, setAt ] = useState("");
  const [ providerId, setProviderId ] = useState("");
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ pending, setPending ] = useState<Body | null>(null);
  const providerField = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = appointmentProblems(at, now);
    setProblems(found);
    if (found.length > 0) { setPending(null); return; }
    setPending({ appointment_at: cityLocalIso(at) as string, ...(providerId ? { provider_id: providerId } : {}) });
  }

  const current = tfdCase.provider;
  const keepLabel = current ? `manter o do laudo (${current.name})` : "sem prestador";
  const atProblem = problems.find((p) => p.path === "appointment_at");

  return (
    <div style={form}>
    <form aria-label="Atendimento no destino" onSubmit={submit} style={form} noValidate>
      <label style={fieldLabel}>
        Data e hora do atendimento
        <input type="datetime-local" value={at} disabled={pending !== null} aria-invalid={atProblem ? true : undefined} style={inputStyle}
          onChange={(e) => { setAt(e.target.value); setPending(null); }} />
      </label>
      {atProblem && <p role="alert" style={alert}>{atProblem.text}</p>}
      <div style={fieldLabel}>
        <label htmlFor={providerField}>Prestador</label>
        <select id={providerField} value={providerId} disabled={pending !== null} style={inputStyle} onChange={(e) => { setProviderId(e.target.value); setPending(null); }}>
          <option value="">{keepLabel}</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {!pending && (
        <div style={row}>
          <button type="submit" style={buttonStyle}>Salvar atendimento</button>
          {onCancel && <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Fechar</button>}
        </div>
      )}
    </form>
    {/* A confirmação tem o próprio <form>: fica fora deste. */}
    {pending && (
      <SensitiveAction title="Confirmar atendimento" requiresStepUp onGoToSecurity={onGoToSecurity}
        description="O atendimento no destino fica marcado; a situação do processo não muda."
        translateError={refusalText}
        run={async () => { onSaved(await setTfdAppointment(tfdCase.id, pending)); }}
        onDone={() => setPending(null)} onCancel={() => setPending(null)} />
    )}
    </div>
  );
}
