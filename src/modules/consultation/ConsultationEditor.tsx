// src/modules/consultation/ConsultationEditor.tsx
// Rascunho da consulta (módulo 19; spec §4 e §7; contratos §4): S, O, A, P em
// texto, sinais vitais (o componente do acolhimento), tipo de atendimento,
// problemas, condutas e exames estruturados. O rascunho se salva sozinho e só
// a autora o vê. "Finalizar" pede o desfecho com a mesma tela do "Encerrar",
// espera o salvamento em curso e manda; a consulta finalizada não muda mais.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ApiError, errorCode, finalizeConsultation, saveConsultationDraft,
  type ClinicalRecord, type Consultation, type ConsultationOptions, type DentalRole, type HealthUnit, type Sex
} from "../../lib/api";
import {
  SOAP_FIELDS, TEXT_MAX_LABEL, blockedReason, checkDraft, consultationError, consultationMessage, draftFrom, finalizeProblems,
  type ConsultationDraft
} from "../../lib/consultation";
import { dentalApiProblems, dentalError, dentalFinalizeProblems, linkPlanItem, planItemPathIndex } from "../../lib/dental";
import { DentalEditor } from "../dental/DentalEditor";
import { EMPTY_OUTCOME, outcomeBody, outcomeProblem, outcomeView, type OutcomeDraft } from "../../lib/outcome";
import { bmiOf } from "../../lib/screening";
import { todayInCity } from "../../lib/campaigns";
import { saveStatusLabel, useAutosave } from "../../lib/useAutosave";
import { useLeaveGuard } from "../../lib/useLeaveGuard";
import { useReveal } from "../../lib/useReveal";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { VitalSignsFields } from "../attendance/VitalSignsFields";
import { OutcomeFields } from "../attendance/OutcomeFields";
import { ProblemsEditor } from "./ProblemsEditor";
import { ConductsField } from "./ConductsField";
import { ExamRequestsField } from "./ExamRequestsField";
import { NotificationSuggestions } from "./NotificationSuggestions";
import { RegulationRequestsField } from "./RegulationRequestsField";
import { regulationFinalizeError } from "../../lib/regulation";

export interface ConsultationEditorProps {
  // Módulo 21a: prioridade de cada exame (com exam_tracking ligado).
  examPriority?: boolean;
  // Módulo 25 (ADR 0043): a peça de notificação de doença ou agravo (médico/enfermeiro, vigilância ligada).
  notifications?: boolean;
  // Módulo 26a (F-26.2): a peça "Pedir regulação" (rascunhos que vão para a regulação ao finalizar). Nunca bloqueia.
  regulation?: boolean;
  consultation: Consultation;
  record: ClinicalRecord;
  options: ConsultationOptions;
  referenceUnitIds?: string[];
  unit: HealthUnit;
  units: HealthUnit[];
  autosaveDelayMs?: number;
  searchDelayMs?: number;
  // Módulo 28: consulta odontológica — some o tipo de atendimento do 19a e as condutas; entra o bloco odontológico.
  dental?: { role: DentalRole; baseline: boolean; sex: Sex };
  onFinalized(c: Consultation): void;
  onLocked(message: string): void;
}

// A consulta mudou de dono ou de estado fora desta tela: o editor para.
const LOCKING = new Set([ "not_draft", "not_author" ]);
// Módulo 28 (Ruling 8, Carry Task 7): o encaminhamento ao CEO sem pedido segue o caminho do `regulation_request_required` do 26a.
const REGULATION_REFUSALS = new Set([ "regulation_request_required", "dental_referral_request_required" ]);

interface Refusal { code: string; path: string | null; text: string }

// A recusa da finalização com `problems` (27a §13 H8): todas, traduzidas; código desconhecido aparece cru.
function finalizeRefusals(err: unknown): Refusal[] {
  const body = err instanceof ApiError ? ((err.body ?? {}) as { problems?: unknown }) : null;
  if (!body || !Array.isArray(body.problems) || body.problems.length === 0) return [];
  return dentalApiProblems(err).map((p) => (p.text !== p.code ? p : { ...p, text: consultationMessage(p.code) ?? regulationFinalizeError(new ApiError(422, { error: p.code }, "")) ?? p.code }));
}

export function ConsultationEditor(props: ConsultationEditorProps) {
  const { consultation, record, options, unit, units } = props;
  const [ draft, setDraft ] = useState<ConsultationDraft>(() => draftFrom(consultation));
  // Mesma forma (e ordem de chaves) do `value` do autosave: abrir o rascunho não dispara PATCH.
  const [ initialKey ] = useState(() => JSON.stringify(checkDraft(draftFrom(consultation)).input));
  const [ locked, setLocked ] = useState(false);
  const lockedRef = useRef(false);
  // Selado: o rascunho já foi salvo e a finalização está a caminho; nada mais se edita nem se salva.
  const [ sealing, setSealing ] = useState(false);
  const [ finalizing, setFinalizing ] = useState(false);
  const [ outcome, setOutcome ] = useState<OutcomeDraft>(EMPTY_OUTCOME);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  // Módulo 28: as recusas do api de uma vez e a releitura do plano depois de `plan_item_not_open`.
  const [ refusals, setRefusals ] = useState<Refusal[]>([]);
  const [ planRefreshKey, setPlanRefreshKey ] = useState(0);
  const dental = props.dental;
  const mode = !dental ? "general" : dental.baseline ? "baseline" : "dental";

  function lock(err: unknown): boolean {
    const code = errorCode(err);
    if (!code || !LOCKING.has(code)) return false;
    lockedRef.current = true;
    setLocked(true);
    props.onLocked(consultationError(err));
    return true;
  }

  const check = checkDraft(draft);
  const blocked = blockedReason(check);
  const autosave = useAutosave({
    value: check.input, initialKey, blockedReason: blocked, enabled: !locked && !sealing, delayMs: props.autosaveDelayMs ?? 1500,
    save: (input) => saveConsultationDraft(consultation.id, input),
    describe: consultationError,
    onError: (err) => { lock(err); }
  });

  // Módulo 25: o api lê o rascunho SALVO, então as sugestões só são relidas quando o autosave assenta.
  const addedKey = check.input.evaluated_problems.filter((p) => p.action === "add").map((p) => `${p.terminology}:${p.code}`).sort().join(",");
  const [ problemsKey, setProblemsKey ] = useState(addedKey);
  useEffect(() => {
    if (!autosave.pending && autosave.status.kind !== "saving") setProblemsKey(addedKey);
  }, [ addedKey, autosave.pending, autosave.status.kind ]);
  // Onde o aviso "notificação pendente" aparece ao finalizar: dentro da caixa de finalizar.
  const [ noteHost, setNoteHost ] = useState<HTMLElement | null>(null);
  // Módulo 26a: a finalização recusada pela regra da regulação pede que a peça releia a lista.
  const [ regulationKey, setRegulationKey ] = useState(0);
  // Quantos pedidos a peça leu (rascunho ou enviado): com algum, "encaminhado" não exige unidade nem descrição (G12 #4).
  const [ regulationCount, setRegulationCount ] = useState(0);

  // Sair com texto ainda não salvo pede confirmação do navegador (AT-04).
  useLeaveGuard(autosave.pending && !locked && !sealing);
  // Abre à vista, com o foco no título (AT-07).
  const revealRef = useReveal<HTMLElement>(true);

  const today = todayInCity();
  const { referralUnitId } = outcomeView(outcome, props.referenceUnitIds, unit, units);
  const outcomeIssue = outcomeProblem(outcome, referralUnitId, !!props.regulation && regulationCount > 0);
  // O problema da FAO (problem_required) já sai do finalizeProblems: uma frase só por falta.
  const dentalMissing = dental && draft.dental
    ? dentalFinalizeProblems(draft.dental, { ...dental, problemsCount: draft.problems.length })
      .filter((p) => p.code !== "problem_required").map((p) => p.text)
    : [];
  const missing = [ ...new Set([ ...finalizeProblems(check, mode), ...dentalMissing, ...(outcomeIssue ? [ outcomeIssue ] : []) ]) ];
  const set = (patch: Partial<ConsultationDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function confirm() {
    if (busy || locked || missing.length > 0) return;
    setBusy(true); setError(null); setRefusals([]);
    try {
      if (!(await autosave.flush())) {
        if (!lockedRef.current) setError("o rascunho não foi salvo — veja o aviso no topo da consulta e tente de novo");
        return;
      }
      setSealing(true);
      props.onFinalized(await finalizeConsultation(consultation.id, outcomeBody(outcome, referralUnitId)));
    } catch (err) {
      if (!lock(err)) {
        if (dental) dentalRefused(err);
        else {
          const regulationText = regulationFinalizeError(err);
          if (regulationText) setRegulationKey((k) => k + 1);
          setError(regulationText ?? consultationError(err));
        }
        setSealing(false);
      }
    } finally {
      setBusy(false);
    }
  }

  // Nada é reenviado sozinho: o vínculo desfeito vai no autosave e a finalização espera o próximo clique.
  function dentalRefused(err: unknown) {
    const list = finalizeRefusals(err);
    const codes = list.length > 0 ? list.map((p) => p.code) : [ errorCode(err) ?? "" ];
    if (codes.some((c) => REGULATION_REFUSALS.has(c))) setRegulationKey((k) => k + 1);
    if (list.length === 0) { setError(regulationFinalizeError(err) ?? dentalError(err)); return; }
    setRefusals(list);
    const stale = list.filter((p) => p.code === "plan_item_not_open").map((p) => planItemPathIndex(p.path)).filter((i): i is number => i !== null);
    if (stale.length > 0) {
      setDraft((d) => (d.dental ? { ...d, dental: stale.reduce((f, i) => linkPlanItem(f, i, null), d.dental) } : d));
      setPlanRefreshKey((k) => k + 1);
    }
  }

  const blockedFinal = busy || locked || sealing || missing.length > 0;

  return (
    <section ref={revealRef} aria-label="Consulta" style={panel}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Consulta — rascunho</h3>
        <span role="status" style={muted}>{saveStatusLabel(autosave.status, blocked, autosave.pending)}</span>
      </div>
      <p style={muted}>
        O rascunho é salvo sozinho e só você o vê. Finalizada, a consulta não muda mais: correção é por adendo.
      </p>

      <fieldset disabled={locked || sealing} style={fieldset} onBlur={() => void autosave.flush()}>
      {SOAP_FIELDS.map((f) => (
        <label key={f.key} style={labelStyle}>
          {f.label}
          <textarea value={draft.soap[f.key]} rows={3} disabled={locked || sealing} style={inputStyle}
            onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, soap: { ...d.soap, [f.key]: v } })); }} />
          {check.tooLong.includes(f.key) && (
            <small style={alert}>{`${f.label} passa de ${TEXT_MAX_LABEL} caracteres`}</small>
          )}
        </label>
      ))}

      <VitalSignsFields form={draft.vitals} problems={check.vitalsProblems} alerts={[]}
        bmi={bmiOf(check.input.vitals.weight_kg, check.input.vitals.height_cm)} onChange={(vitals) => set({ vitals })} />

      {!dental && (
        <label style={{ ...labelStyle, maxWidth: 320 }}>
          Tipo de atendimento
          <select value={draft.careType} style={inputStyle} onChange={(e) => set({ careType: e.target.value })}>
            <option value="">—</option>
            {options.care_types.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </label>
      )}

      {mode !== "baseline" && (
        <ProblemsEditor patientProblems={record.problems} items={draft.problems} onChange={(problems) => set({ problems })}
          cid10Allowed={options.cid10_allowed_for_cbo} today={today} searchDelayMs={props.searchDelayMs} />
      )}
      {dental && draft.dental && (
        <DentalEditor consultation={consultation} record={record} unit={unit} options={options} value={draft.dental}
          role={dental.role} baseline={dental.baseline} planRefreshKey={planRefreshKey} searchDelayMs={props.searchDelayMs}
          onChange={(f) => set({ dental: f })} />
      )}
      {!dental && <ConductsField options={options.conducts} value={draft.conducts} onChange={(conducts) => set({ conducts })} />}
      {mode !== "baseline" && (
        <ExamRequestsField value={draft.exams} onChange={(exams) => set({ exams })} cid10Allowed={options.cid10_allowed_for_cbo}
          searchDelayMs={props.searchDelayMs} priorityOn={props.examPriority} />
      )}
      {/* Módulo 25 (ADR 0043): a notificação nunca bloqueia a finalização — fora de `missing`, de
          `finalizeProblems` e de `blockedFinal`; a falha dela só aparece nela. */}
      {props.notifications && (
        <NotificationSuggestions consultationId={consultation.id} problemsKey={problemsKey} today={today} finalizing={finalizing}
          noteTarget={noteHost} />
      )}

      {/* Módulo 26a: o pedido de regulação nunca bloqueia a finalização — fora de `missing`, de `finalizeProblems`
          e de `blockedFinal`; rascunho que deixou de valer volta em `regulation_not_sent` e a consulta finaliza. */}
      {props.regulation && (
        <RegulationRequestsField consultationId={consultation.id} cbo={consultation.cbo_code} cid10Allowed={options.cid10_allowed_for_cbo}
          mode="draft" finalizing={finalizing} noteTarget={noteHost} searchDelayMs={props.searchDelayMs} refreshKey={regulationKey} onCountChange={setRegulationCount} />
      )}

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
            referenceIds={props.referenceUnitIds} unit={unit} units={units} regulationHint={props.regulation} />
          {missing.length > 0 && (
            <ul aria-label="o que falta para finalizar" style={{ margin: 0, paddingLeft: 18 }}>
              {missing.map((m) => <li key={m} style={alert}>{m}</li>)}
            </ul>
          )}
          {error && <p role="alert" style={alert}>{error}</p>}
          {refusals.length > 0 && (
            <ul aria-label="recusas do api" style={{ margin: 0, paddingLeft: 18 }}>
              {refusals.map((r, i) => <li key={`${r.code}-${r.path ?? ""}-${i}`} style={alert}>{r.text}</li>)}
            </ul>
          )}
          {/* Destino dos avisos de finalização das peças (portal): notificação pendente e pedidos de regulação. */}
          {(props.notifications || props.regulation) && <div ref={setNoteHost} style={{ display: "contents" }} />}
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
      </fieldset>
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, border: 0, padding: 0, margin: 0, minWidth: 0 };
const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule2)", borderRadius: 8 };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
