// src/modules/territory/ExitForm.tsx
// Saída do cadastro individual: mudou de território ou óbito (contrato §5, L9;
// preflight A16, C20; errata 10). A saída é definitiva: a tela valida com a
// regra do api (exitProblem), mostra o efeito, pede a confirmação e só então
// envia. `on` é o dia da saída; com óbito a data do óbito é obrigatória e o
// número da DO (9 dígitos) é opcional; não há `version` no corpo. Sem
// rascunho: o que está na tela vive só aqui. Recusas do api: a frase;
// invalid_registration volta ao formulário e foca o campo do path; 409
// stale_version (saída concorrente) pede "Recarregar", que relê o cadastro e
// fecha.
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { exitRegistration, type ExitInput, type Registration } from "../../lib/api";
import { exitProblem } from "../../lib/territoryDictionaries";
import {
  EXIT_REASONS, REGISTRATION_KEY, REGISTRY_COUNT_KEY, REGISTRY_STATUS_KEY, RESIDENTS_KEY, STALE_TEXT, errorPath, exitReasonLabel, fmtDay,
  isStale, territoryError
} from "../../lib/territoryRegistry";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { useFieldFocus } from "./fieldFocus";

export const EXIT_EFFECT = {
  moved: "A pessoa sai da equipe pelo cadastro; consulta recente e bairro continuam valendo.",
  death: "A pessoa fica marcada como falecida nas linhas de cuidado e as inscrições são encerradas por óbito."
} as const;

type Reason = "moved" | "death";
// Separadores digitados na DO saem; letra fica para a regra recusar.
const digitsOnly = (value: string) => value.replace(/[\s.-]/g, "");

export function ExitForm({ registration, today, onDone, onCancel }: {
  registration: Registration; today: string; onDone(r: Registration): void; onCancel(): void;
}) {
  const client = useQueryClient();
  const focus = useFieldFocus();
  const [ reason, setReason ] = useState<Reason | "">("");
  const [ on, setOn ] = useState("");
  const [ deathOn, setDeathOn ] = useState("");
  const [ certificate, setCertificate ] = useState("");
  const [ step, setStep ] = useState<"edit" | "confirm">("edit");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ stale, setStale ] = useState(false);

  // Só o que vale para o motivo escolhido: o que sobrou do outro não vai.
  function input(): ExitInput {
    if (reason === "death") {
      const doc = digitsOnly(certificate);
      return { reason, on, death_on: deathOn, ...(doc ? { death_certificate: doc } : {}) };
    }
    return { reason: "moved", on };
  }

  const send = useMutation({
    mutationFn: (body: ExitInput) => exitRegistration(registration.id, body),
    onSuccess: (saved) => {
      for (const key of [ RESIDENTS_KEY, REGISTRY_STATUS_KEY, REGISTRY_COUNT_KEY ]) void client.invalidateQueries({ queryKey: [ key ] });
      client.setQueryData([ REGISTRATION_KEY, registration.id ], saved);
      onDone(saved);
    },
    onError: (err) => {
      if (isStale(err)) { setProblem(null); focus.mark(null); setStale(true); return; }
      setStep("edit");
      setProblem(territoryError(err));
      focus.mark(errorPath(err));
    }
  });

  function review(e: FormEvent) {
    e.preventDefault();
    // Sem motivo escolhido a regra recusa antes de tudo (reason vem primeiro).
    const found = exitProblem(reason ? input() : { reason: "" }, registration.patient.birth_date, today);
    if (found) { setProblem(found.message); focus.mark(found.path); return; }
    setProblem(null);
    focus.mark(null);
    setStep("confirm");
  }

  function reload() {
    void client.invalidateQueries({ queryKey: [ REGISTRATION_KEY, registration.id ] });
    onCancel();
  }

  if (step === "confirm" && reason) {
    const body = input();
    return (
      <div style={box} role="group" aria-label="Confirmar saída">
        <strong>Confirmar saída</strong>
        <p style={{ margin: 0, fontSize: 12.5 }}>{EXIT_EFFECT[reason]}</p>
        <p style={muted}>
          {`Motivo: ${exitReasonLabel(reason)} · saída em ${fmtDay(on)}`}
          {body.reason === "death" ? ` · óbito em ${fmtDay(body.death_on)}` : ""}
        </p>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>Esta ação não pode ser desfeita.</p>
        {stale ? (
          <div style={row}>
            <p role="alert" style={alert}>{STALE_TEXT}</p>
            <button type="button" style={secondaryButtonStyle} onClick={reload}>Recarregar</button>
          </div>
        ) : (
          <div style={row}>
            <button type="button" style={send.isPending ? disabledButtonStyle : buttonStyle} disabled={send.isPending}
              onClick={() => send.mutate(body)}>Confirmar saída</button>
            <button type="button" style={secondaryButtonStyle} disabled={send.isPending} onClick={() => setStep("edit")}>Voltar</button>
          </div>
        )}
      </div>
    );
  }

  const death = reason === "death";
  return (
    <form style={{ ...form, ...box }} onSubmit={review} noValidate aria-label="Saída do cadastro">
      <strong>Saída do cadastro</strong>
      <fieldset style={fieldset}>
        <legend style={legend}>Motivo da saída</legend>
        {EXIT_REASONS.map((r, i) => (
          <label key={r.key} style={checkLabel}>
            <input ref={i === 0 ? focus.reg("reason") : undefined} type="radio" name="exit-reason" checked={reason === r.key}
              aria-invalid={focus.invalid("reason")} onChange={() => { setReason(r.key); setProblem(null); }} />
            {r.label}
          </label>
        ))}
      </fieldset>
      {reason && <p style={muted}>{EXIT_EFFECT[reason]}</p>}
      <label style={fieldLabel}>
        Data da saída
        <input ref={focus.reg("on")} type="date" value={on} max={today} style={inputStyle} aria-invalid={focus.invalid("on")}
          onChange={(e) => setOn(e.target.value)} />
      </label>
      {death && (
        <>
          <label style={fieldLabel}>
            Data do óbito
            <input ref={focus.reg("death_on")} type="date" value={deathOn} max={today} style={inputStyle} aria-invalid={focus.invalid("death_on")}
              onChange={(e) => setDeathOn(e.target.value)} />
          </label>
          <label style={fieldLabel}>
            Número da DO (opcional)
            <input ref={focus.reg("death_certificate")} type="text" inputMode="numeric" autoComplete="off" value={certificate} style={inputStyle}
              aria-invalid={focus.invalid("death_certificate")} onChange={(e) => setCertificate(e.target.value)} />
          </label>
          <p style={muted}>A declaração de óbito tem 9 dígitos. Sem o número, a saída vale do mesmo jeito.</p>
        </>
      )}
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        <button type="submit" style={buttonStyle}>Registrar saída</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar saída</button>
      </div>
    </form>
  );
}
