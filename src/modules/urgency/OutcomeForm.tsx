// Desfecho da urgência (módulo 32a, F-32.4; contrato §7, §14 Q10/Q13/Q25/Q30): `POST /urgency/encounters/:id/outcome`.
// - Quem registra o quê: o médico, qualquer tipo; a recepção e a enfermagem, só os de balcão (DESK_OUTCOMES). Com a consulta de
//   urgência finalizada, "Registrado por engano" some (Q30). Para o médico, os tipos que esperam a consulta finalizada e os que
//   exigem o paciente identificado (Q10) aparecem desligados, com a frase.
// - Os campos são só os do tipo escolhido (o api recusa campo de outro desfecho): transferência → destino e pedido de vaga;
//   alta com retorno → prazo e motivo; registrado por engano → motivo. Óbito, "contra orientação" e "registrado por engano" pedem a
//   confirmação; os limites e as frases são os do api (outcomeProblems/outcomeBody, Task 2).
// - O aviso do sucesso só diz o tipo (nada de destino, motivo nem prazo): quem monta o mostra depois de fechar o painel.
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { errorCode } from "../../lib/api";
import { recordUrgencyOutcome, type UrgencyEncounter, type UrgencyOutcomeKind } from "../../lib/api";
import {
  DESK_OUTCOMES, IDENTIFIED_OUTCOMES, OUTCOME_KIND_LABEL, URGENCY_ERRORS, consultationContext, outcomeBody, outcomeKindsFor,
  outcomeProblems, urgencyRefusals, type OutcomeDraft
} from "../../lib/urgency";
import { ActionButton } from "../../components/ActionButton";
import { ConfirmButton } from "../../components/ConfirmButton";
import { inputStyle } from "../../components/formStyles";

// O que o formulário lê do encontro: a fila manda o bastante (id, paciente, estado da consulta) — a saída pela fila não lê o detalhe.
export type OutcomeTarget = Pick<UrgencyEncounter, "id" | "patient" | "consultation_status">;

export interface OutcomeFormProps {
  encounter: OutcomeTarget;
  doctor: boolean;
  onRecorded(e: UrgencyEncounter, notice: string): void;
  // O api recusou por estado que a tela pode ter lido velho (consulta em rascunho, não finalizada): quem tem o detalhe relê.
  onStale?(): void;
  // 409 encounter_closed: outra pessoa encerrou; quem monta fecha o painel e relê a fila.
  onEncounterClosed?(): void;
}

// As recusas de estado que pedem reler o detalhe (nunca em foco nem ao abrir: cada leitura grava trilha).
const STALE_CODES = new Set([ "consultation_in_progress", "consultation_not_finalized", "consultation_finalized", "patient_unidentified" ]);

const EMPTY: OutcomeDraft = { kind: null, destination: "", vacancyRequest: "", returnDays: "", returnReason: "", reason: "" };
// Irreversíveis sem nenhum campo que os segure: pedem a confirmação.
const CONFIRM_KINDS: UrgencyOutcomeKind[] = [ "death", "left_against_advice", "registered_in_error" ];
export const CONFIRM_QUESTION = "O desfecho não pode ser alterado. Confirmar?";
export const NEEDS_FINALIZED = "Alta, transferência, óbito e saída contra orientação esperam a consulta de urgência finalizada.";
export const RETURN_NOTE = "O motivo fica para a equipe (linha do tempo profissional). O cidadão e a lista da UBS veem só o prazo.";
// Q20: a contrarreferência só nasce quando o paciente tem equipe de referência.
const RETURN_NOTICE = "A UBS de referência do paciente vê o retorno na lista dela, se o paciente tiver equipe.";

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export function outcomeNotice(kind: UrgencyOutcomeKind): string {
  const base = `Atendimento encerrado: ${lowerFirst(OUTCOME_KIND_LABEL[kind])}.`;
  return kind === "discharged_to_primary_care" ? `${base} ${RETURN_NOTICE}` : base;
}

type Shown = { path: string; text: string };
const FIELD_PATHS = [ "destination", "vacancy_request", "return_guidance.days", "return_guidance.reason", "reason" ];

export function OutcomeForm({ encounter, doctor, onRecorded, onStale, onEncounterClosed }: OutcomeFormProps) {
  const ids = useId();
  const [ draft, setDraft ] = useState<OutcomeDraft>(EMPTY);
  // Os problemas aparecem depois da primeira tentativa (a do motivo do engano, sob o botão de confirmar, desde o começo).
  const [ shown, setShown ] = useState<Shown[]>([]);
  const ctx = { doctor, ...consultationContext(encounter.consultation_status), unidentified: !!encounter.patient.unidentified };
  const kinds = outcomeKindsFor(ctx);
  // Desligado para o médico: espera a consulta finalizada, ou o paciente identificado (Q10).
  const waitsConsultation = (k: UrgencyOutcomeKind) => !DESK_OUTCOMES.includes(k) && !ctx.consultationFinalized;
  const waitsIdentity = (k: UrgencyOutcomeKind) => IDENTIFIED_OUTCOMES.includes(k) && ctx.unidentified;
  const off = (k: UrgencyOutcomeKind) => waitsConsultation(k) || waitsIdentity(k);
  // O tipo escolhido que deixou de valer (ex.: "registrado por engano" depois da finalização, Q30) sai da escolha.
  const kind = draft.kind !== null && kinds.includes(draft.kind) ? draft.kind : null;
  const kindsKey = kinds.join(",");
  useEffect(() => {
    setDraft((d) => (d.kind !== null && !kindsKey.split(",").includes(d.kind) ? { ...d, kind: null } : d));
  }, [ kindsKey ]);
  const problems = outcomeProblems({ ...draft, kind }, ctx);
  const set = (patch: Partial<OutcomeDraft>) => { setDraft((d) => ({ ...d, ...patch })); setShown([]); };
  const fieldText = (path: string) => shown.find((p) => p.path === path)?.text ?? null;
  const general = shown.filter((p) => !FIELD_PATHS.includes(p.path));

  async function submit() {
    if (!kind) { setShown(problems); return; }
    if (problems.length > 0) { setShown(problems); return; }
    setShown([]);
    try {
      const result = await recordUrgencyOutcome(encounter.id, outcomeBody({ ...draft, kind }));
      onRecorded(result.encounter, outcomeNotice(kind));
    } catch (err) {
      const code = errorCode(err);
      if (code === "encounter_closed" && onEncounterClosed) { onEncounterClosed(); return; }
      setShown(urgencyRefusals(err).map((r) => ({ path: r.path, text: r.text })));
      if (code && STALE_CODES.has(code)) onStale?.();
    }
  }

  // O erro do campo fica sob ele e o descreve (aria-describedby).
  const errId = (path: string) => `${ids}-${path.replace(/\W/g, "-")}-err`;
  const aria = (path: string) => (fieldText(path) ? { "aria-invalid": true, "aria-describedby": errId(path) } : {});
  const field = (path: string, label: string, input: ReactNode) => {
    const text = fieldText(path);
    // O erro fica fora do <label>: o nome do campo continua só o rótulo.
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={labelStyle}>
          {label}
          {input}
        </label>
        {text && <small id={errId(path)} role="alert" style={alert}>{text}</small>}
      </div>
    );
  };

  return (
    <fieldset aria-label="Desfecho da urgência" style={fieldset}>
      <legend style={legend}>Desfecho da urgência</legend>
      <div role="radiogroup" aria-label="Tipo de desfecho" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {kinds.map((k) => (
          <span key={k} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <input id={`${ids}-${k}`} type="radio" name={`${ids}-kind`} value={k} checked={kind === k} disabled={off(k)}
              onChange={() => set({ kind: k })} />
            <label htmlFor={`${ids}-${k}`} style={{ fontSize: 12.5, color: off(k) ? "var(--ink3)" : "var(--ink)" }}>{OUTCOME_KIND_LABEL[k]}</label>
          </span>
        ))}
      </div>
      {doctor && !ctx.consultationFinalized && <p style={muted}>{NEEDS_FINALIZED}</p>}
      {doctor && ctx.unidentified && <p style={muted}>{URGENCY_ERRORS.patient_unidentified}</p>}

      {kind === "transferred" && (
        <>
          {field("destination", "Destino",
            <input value={draft.destination} maxLength={200} style={inputStyle} {...aria("destination")} onChange={(e) => set({ destination: e.target.value })} />)}
          {field("vacancy_request", "Pedido de vaga (opcional)",
            <textarea value={draft.vacancyRequest} rows={2} maxLength={500} style={inputStyle} {...aria("vacancy_request")} onChange={(e) => set({ vacancyRequest: e.target.value })} />)}
        </>
      )}
      {kind === "discharged_to_primary_care" && (
        <>
          {field("return_guidance.days", "Procurar a UBS em até (dias)",
            <input value={draft.returnDays} inputMode="numeric" style={{ ...inputStyle, maxWidth: 120 }} {...aria("return_guidance.days")} onChange={(e) => set({ returnDays: e.target.value })} />)}
          {field("return_guidance.reason", "Motivo do retorno",
            <textarea value={draft.returnReason} rows={2} maxLength={300} style={inputStyle} {...aria("return_guidance.reason")} onChange={(e) => set({ returnReason: e.target.value })} />)}
          <p style={muted}>{RETURN_NOTE}</p>
        </>
      )}
      {kind === "registered_in_error" && field("reason", "Motivo do registro por engano",
        <textarea value={draft.reason} rows={2} maxLength={500} style={inputStyle} {...aria("reason")} onChange={(e) => set({ reason: e.target.value })} />)}

      {general.length > 0 && (
        <ul aria-label="o que impede o desfecho" style={{ margin: 0, paddingLeft: 18 }}>
          {general.map((p) => <li key={`${p.path}-${p.text}`} role="alert" style={alert}>{p.text}</li>)}
        </ul>
      )}
      <div>
        {kind && CONFIRM_KINDS.includes(kind) ? (
          <ConfirmButton label="Registrar desfecho" question={CONFIRM_QUESTION} variant="danger"
            disabledReason={problems[0]?.text ?? null} onConfirm={submit} />
        ) : (
          <ActionButton onClick={submit}>Registrar desfecho</ActionButton>
        )}
      </div>
    </fieldset>
  );
}

const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule2)", borderRadius: 8, margin: 0, minWidth: 0 };
const legend: CSSProperties = { padding: "0 4px", fontSize: 13, fontWeight: 600, color: "var(--ink)" };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
