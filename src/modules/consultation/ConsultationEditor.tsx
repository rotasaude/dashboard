// src/modules/consultation/ConsultationEditor.tsx
// Rascunho da consulta (módulo 19; spec §4 e §7; contratos §4): S, O, A, P em
// texto, sinais vitais (o componente do acolhimento), tipo de atendimento,
// problemas, condutas e exames estruturados. O rascunho se salva sozinho e só
// a autora o vê. "Finalizar" pede o desfecho com a mesma tela do "Encerrar",
// espera o salvamento em curso e manda; a consulta finalizada não muda mais.
import { useState, type CSSProperties } from "react";
import {
  errorCode, finalizeConsultation, saveConsultationDraft,
  type ClinicalRecord, type Consultation, type ConsultationOptions, type HealthUnit
} from "../../lib/api";
import {
  SOAP_FIELDS, TEXT_MAX_LABEL, blockedReason, checkDraft, consultationError, draftFrom, finalizeProblems, type ConsultationDraft
} from "../../lib/consultation";
import { EMPTY_OUTCOME, outcomeBody, outcomeProblem, outcomeView, type OutcomeDraft } from "../../lib/outcome";
import { bmiOf } from "../../lib/screening";
import { todayInCity } from "../../lib/campaigns";
import { saveStatusLabel, useAutosave } from "../../lib/useAutosave";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { VitalSignsFields } from "../attendance/VitalSignsFields";
import { OutcomeFields } from "../attendance/OutcomeFields";
import { ProblemsEditor } from "./ProblemsEditor";
import { ConductsField } from "./ConductsField";
import { ExamRequestsField } from "./ExamRequestsField";

export interface ConsultationEditorProps {
  consultation: Consultation;
  record: ClinicalRecord;
  options: ConsultationOptions;
  referenceUnitIds?: string[];
  unit: HealthUnit;
  units: HealthUnit[];
  autosaveDelayMs?: number;
  searchDelayMs?: number;
  onFinalized(c: Consultation): void;
  onLocked(message: string): void;
}

// A consulta mudou de dono ou de estado fora desta tela: o editor para.
const LOCKING = new Set([ "not_draft", "not_author" ]);

export function ConsultationEditor(props: ConsultationEditorProps) {
  const { consultation, record, options, unit, units } = props;
  const [ draft, setDraft ] = useState<ConsultationDraft>(() => draftFrom(consultation));
  // Mesma forma (e ordem de chaves) do `value` do autosave: abrir o rascunho não dispara PATCH.
  const [ initialKey ] = useState(() => JSON.stringify(checkDraft(draftFrom(consultation)).input));
  const [ locked, setLocked ] = useState(false);
  const [ finalizing, setFinalizing ] = useState(false);
  const [ outcome, setOutcome ] = useState<OutcomeDraft>(EMPTY_OUTCOME);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  function lock(err: unknown): boolean {
    const code = errorCode(err);
    if (!code || !LOCKING.has(code)) return false;
    setLocked(true);
    props.onLocked(consultationError(err));
    return true;
  }

  const check = checkDraft(draft);
  const blocked = blockedReason(check);
  const autosave = useAutosave({
    value: check.input, initialKey, blockedReason: blocked, enabled: !locked, delayMs: props.autosaveDelayMs ?? 1500,
    save: (input) => saveConsultationDraft(consultation.id, input),
    describe: consultationError,
    onError: (err) => { lock(err); }
  });

  const today = todayInCity();
  const { referralUnitId } = outcomeView(outcome, props.referenceUnitIds, unit, units);
  const outcomeIssue = outcomeProblem(outcome, referralUnitId);
  const missing = [ ...finalizeProblems(check), ...(outcomeIssue ? [ outcomeIssue ] : []) ];
  const set = (patch: Partial<ConsultationDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function confirm() {
    if (busy || locked || missing.length > 0) return;
    setBusy(true); setError(null);
    try {
      if (!(await autosave.flush())) {
        setError("o rascunho não foi salvo — veja o aviso no topo da consulta e tente de novo");
        return;
      }
      props.onFinalized(await finalizeConsultation(consultation.id, outcomeBody(outcome, referralUnitId)));
    } catch (err) {
      if (!lock(err)) setError(consultationError(err));
    } finally {
      setBusy(false);
    }
  }

  const blockedFinal = busy || locked || missing.length > 0;

  return (
    <section aria-label="Consulta" style={panel}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong>Consulta — rascunho</strong>
        <span role="status" style={muted}>{saveStatusLabel(autosave.status, blocked)}</span>
      </div>
      <p style={muted}>
        O rascunho é salvo sozinho e só você o vê. Finalizada, a consulta não muda mais: correção é por adendo.
      </p>

      {SOAP_FIELDS.map((f) => (
        <label key={f.key} style={labelStyle}>
          {f.label}
          <textarea value={draft.soap[f.key]} rows={3} disabled={locked} style={inputStyle}
            onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, soap: { ...d.soap, [f.key]: v } })); }} />
          {check.tooLong.includes(f.key) && (
            <small style={alert}>{`${f.label} passa de ${TEXT_MAX_LABEL} caracteres`}</small>
          )}
        </label>
      ))}

      <VitalSignsFields form={draft.vitals} problems={check.vitalsProblems} alerts={[]}
        bmi={bmiOf(check.input.vitals.weight_kg, check.input.vitals.height_cm)} onChange={(vitals) => set({ vitals })} />

      <label style={{ ...labelStyle, maxWidth: 320 }}>
        Tipo de atendimento
        <select value={draft.careType} style={inputStyle} onChange={(e) => set({ careType: e.target.value })}>
          <option value="">—</option>
          {options.care_types.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </label>

      <ProblemsEditor patientProblems={record.problems} items={draft.problems} onChange={(problems) => set({ problems })}
        cid10Allowed={options.cid10_allowed_for_cbo} today={today} searchDelayMs={props.searchDelayMs} />
      <ConductsField options={options.conducts} value={draft.conducts} onChange={(conducts) => set({ conducts })} />
      <ExamRequestsField value={draft.exams} onChange={(exams) => set({ exams })} cid10Allowed={options.cid10_allowed_for_cbo}
        searchDelayMs={props.searchDelayMs} />

      {!finalizing ? (
        <div>
          <button type="button" disabled={locked} style={locked ? disabledButtonStyle : buttonStyle} onClick={() => setFinalizing(true)}>
            Finalizar consulta
          </button>
        </div>
      ) : (
        <section aria-label="Finalizar consulta" style={box}>
          <strong>Finalizar consulta</strong>
          <p style={muted}>
            Finalizar encerra o atendimento com o desfecho abaixo e gera a ficha do e-SUS. Encaminhamento e retorno geram o pedido de agendamento.
          </p>
          <OutcomeFields idPrefix="consultation-" value={outcome} onChange={setOutcome}
            referenceIds={props.referenceUnitIds} unit={unit} units={units} />
          {missing.length > 0 && (
            <ul aria-label="o que falta para finalizar" style={{ margin: 0, paddingLeft: 18 }}>
              {missing.map((m) => <li key={m} style={alert}>{m}</li>)}
            </ul>
          )}
          {error && <p role="alert" style={alert}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={blockedFinal} style={blockedFinal ? disabledButtonStyle : buttonStyle}
              onClick={() => void confirm()}>
              Confirmar finalização
            </button>
            <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={() => setFinalizing(false)}>
              Voltar ao rascunho
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule2)", borderRadius: 8 };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
