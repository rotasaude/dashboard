// src/modules/attendance/ScreeningForm.tsx
// Escuta inicial (módulo 18; spec §3–§4; contratos §3). Um formulário para
// concluir (com destino) e para reavaliar (só queixa, sinais e cor). A cor
// sugerida é pedida ao api (`suggest`, não grava) a cada mudança de queixa ou
// sinais, com espera curta; resposta velha é descartada. Enquanto a sugestão
// está sendo calculada, não se conclui.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  abandonScreening, completeScreening, errorCode, reassessScreening, suggestScreening,
  type AppointmentType, type Ciap2Ref, type HealthUnit, type Screening, type ScreeningColor, type ScreeningDestination,
  type SchedulingPriority
} from "../../lib/api";
import {
  DESTINATIONS, DESTINATION_LABEL, EMPTY_VITALS_FORM, NOTE_MAX, REASON_MIN, bmiOf, colorProblem, defaultDueDays, destinationPayload,
  destinationProblem, emptyDestination, needsColorReason, parseVitals, screeningError, vitalsFormFrom,
  type DestinationDraft, type VitalsForm
} from "../../lib/screening";
import { PRIORITY_LABEL } from "../../lib/scheduling";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { Ciap2Search } from "./Ciap2Search";
import { VitalSignsFields } from "./VitalSignsFields";
import { ColorDecision, type SuggestionState } from "./ColorDecision";

// Recusas que encerram o formulário: quem chamou recarrega a fila e mostra a frase.
const CLOSING = new Set([ "not_in_progress", "attendance_not_waiting", "not_reassessable" ]);

export interface ScreeningFormProps {
  mode: "complete" | "reassess";
  screening: Screening;
  citizenLabel: string;
  unit: HealthUnit;
  units: HealthUnit[];
  types: AppointmentType[] | null;
  suggestDelayMs?: number;
  onDone(result: Screening): void;
  onClosed(message: string): void;
  onCancel(): void;
}

export function ScreeningForm(props: ScreeningFormProps) {
  const { mode, screening, citizenLabel, unit, units, types, suggestDelayMs = 400, onDone, onClosed, onCancel } = props;
  const current = mode === "reassess" ? screening.current_revision : null;
  const [ ciap, setCiap ] = useState<Ciap2Ref | null>(current?.ciap2 ?? null);
  const [ note, setNote ] = useState(current?.complaint_note ?? "");
  const [ vitalsForm, setVitalsForm ] = useState<VitalsForm>(current ? vitalsFormFrom(current.vitals) : EMPTY_VITALS_FORM);
  const [ finalChoice, setFinalChoice ] = useState<ScreeningColor | null>(null);
  const [ reason, setReason ] = useState("");
  const [ forceReason, setForceReason ] = useState(false);
  const [ dest, setDest ] = useState<DestinationDraft>(() => emptyDestination(null));
  const [ dueTouched, setDueTouched ] = useState(false);
  const [ state, setState ] = useState<SuggestionState>({ kind: "idle" });
  const [ refresh, setRefresh ] = useState(0);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const seq = useRef(0);

  const { vitals, problems } = parseVitals(vitalsForm);
  const inputKey = JSON.stringify({ code: ciap?.code ?? null, vitals, refresh });
  const settledKey = useDebouncedValue(inputKey, suggestDelayMs);

  useEffect(() => {
    const { code, vitals: v } = JSON.parse(settledKey) as { code: string | null; vitals: typeof vitals };
    if (!code) { seq.current += 1; setState({ kind: "idle" }); return; }
    const mine = ++seq.current;
    setState({ kind: "loading" });
    suggestScreening({ ciap2_code: code, vitals: v, attendance_id: screening.attendance_id })
      .then((suggestion) => { if (mine === seq.current) setState({ kind: "ready", suggestion }); })
      .catch((err) => { if (mine === seq.current) setState({ kind: "error", message: screeningError(err) }); });
  }, [ settledKey, screening.attendance_id ]);

  const suggested = state.kind === "ready" ? state.suggestion.suggested_color : null;
  const final = finalChoice ?? suggested;
  const stale = ciap !== null && (inputKey !== settledKey || state.kind === "loading");

  // Prazo padrão segue a cor final até a pessoa mexer nele.
  useEffect(() => {
    if (dueTouched) return;
    const due = defaultDueDays(final);
    setDest((d) => ({ ...d, dueDays: due === null ? "" : String(due) }));
  }, [ final, dueTouched ]);

  const sendReason = forceReason || needsColorReason(suggested, final);
  const problem =
    (ciap === null ? "escolha a queixa (CIAP-2)" : null) ??
    (Object.keys(problems).length > 0 ? "corrija os sinais vitais" : null) ??
    (note.length > NOTE_MAX ? `a queixa em texto passa de ${NOTE_MAX} caracteres` : null) ??
    (forceReason && reason.trim().length < REASON_MIN
      ? `explique por que a cor final é diferente da sugerida (pelo menos ${REASON_MIN} caracteres)` : null) ??
    colorProblem(suggested, final, reason) ??
    (sendReason && reason.length > NOTE_MAX ? `a justificativa passa de ${NOTE_MAX} caracteres` : null) ??
    (mode === "complete" ? destinationProblem(dest) : null);
  const blocked = busy || stale || problem !== null;

  function revisionBody() {
    return {
      ciap2_code: (ciap as Ciap2Ref).code,
      ...(note.trim() ? { complaint_note: note.trim() } : {}),
      vitals,
      final_color: final as ScreeningColor,
      ...(sendReason ? { color_change_reason: reason.trim() } : {})
    };
  }

  async function submit() {
    if (blocked) return;
    setBusy(true); setError(null);
    try {
      const result = mode === "complete"
        ? await completeScreening(screening.id, { ...revisionBody(), ...destinationPayload(dest) })
        : await reassessScreening(screening.id, revisionBody());
      onDone(result);
    } catch (err) {
      const code = errorCode(err);
      if (code && CLOSING.has(code)) { onClosed(screeningError(err)); return; }
      if (code === "color_change_reason_required") { setFinalChoice(final); setForceReason(true); setRefresh((n) => n + 1); }
      setError(screeningError(err));
    } finally {
      setBusy(false);
    }
  }

  async function abandon() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await abandonScreening(screening.id);
      onClosed("Escuta abandonada: o atendimento voltou para a fila do acolhimento.");
    } catch (err) {
      if (errorCode(err) === "not_in_progress") { onClosed(screeningError(err)); return; }
      setError(screeningError(err));
    } finally {
      setBusy(false);
    }
  }

  const setD = (patch: Partial<DestinationDraft>) => setDest((d) => ({ ...d, ...patch }));
  const activeTypes = (types ?? []).filter((t) => t.active);
  const otherUnits = units.filter((u) => u.id !== unit.id);

  return (
    <section aria-label={mode === "complete" ? "Escuta inicial" : "Reavaliação"} style={panel}>
      <strong>{mode === "complete" ? "Escuta inicial" : "Reavaliar a escuta"}</strong>
      <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--ink3)" }}>{citizenLabel}</p>
      {error && <p role="alert" style={alertStyle}>{error}</p>}

      <Ciap2Search value={ciap} onChange={setCiap} />
      <label style={label}>
        Queixa em texto (opcional)
        <textarea value={note} style={{ ...inputStyle, minHeight: 48 }} aria-describedby="complaint-note-notice"
          onChange={(e) => setNote(e.target.value)} />
      </label>
      <FrozenTextNotice id="complaint-note-notice" />

      <VitalSignsFields form={vitalsForm} problems={problems} alerts={state.kind === "ready" ? state.suggestion.alerts : []}
        bmi={bmiOf(vitals.weight_kg, vitals.height_cm)} onChange={setVitalsForm} />

      <ColorDecision state={stale && state.kind !== "error" ? { kind: "loading" } : state} final={final} reason={reason}
        forceReason={forceReason} onFinal={setFinalChoice} onReason={setReason} />

      {mode === "complete" && (
        <fieldset aria-label="Destino do acolhimento" style={box}>
          <legend style={legend}>Destino</legend>
          <label style={label}>
            Destino
            <select value={dest.destination} style={inputStyle}
              onChange={(e) => setD({ destination: e.target.value as ScreeningDestination | "" })}>
              <option value="">escolha…</option>
              {DESTINATIONS.map((d) => <option key={d} value={d}>{DESTINATION_LABEL[d]}</option>)}
            </select>
          </label>

          {dest.destination === "schedule" && (
            <>
              {types ? (
                <label style={label}>
                  Tipo de atendimento
                  <select value={dest.typeKey} style={inputStyle} onChange={(e) => setD({ typeKey: e.target.value })}>
                    <option value="">escolha…</option>
                    {activeTypes.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                  </select>
                </label>
              ) : (
                <label style={label}>
                  Tipo de atendimento (chave)
                  <input value={dest.typeKey} style={inputStyle} placeholder="consulta_medica"
                    onChange={(e) => setD({ typeKey: e.target.value.trim() })} />
                </label>
              )}
              <label style={label}>
                Prioridade
                <select value={dest.priority} style={inputStyle} onChange={(e) => setD({ priority: e.target.value as SchedulingPriority })}>
                  <option value="routine">{PRIORITY_LABEL.routine}</option>
                  <option value="priority">{PRIORITY_LABEL.priority}</option>
                </select>
              </label>
              <label style={label}>
                Prazo (dias)
                <input value={dest.dueDays} inputMode="numeric" style={inputStyle}
                  onChange={(e) => { setDueTouched(true); setD({ dueDays: e.target.value }); }} />
              </label>
              <small style={hint}>Gera um pedido de agendamento nesta unidade e encerra o atendimento.</small>
            </>
          )}

          {dest.destination === "oriented" && (
            <>
              <label style={label}>
                Orientação dada
                <textarea value={dest.orientationNote} style={{ ...inputStyle, minHeight: 56 }} aria-describedby="orientation-note-notice"
                  onChange={(e) => setD({ orientationNote: e.target.value })} />
              </label>
              <FrozenTextNotice id="orientation-note-notice" />
            </>
          )}

          {dest.destination === "referred" && (
            <>
              <label style={label}>
                Unidade de destino
                <select value={dest.referralUnitId} style={inputStyle} onChange={(e) => setD({ referralUnitId: e.target.value })}>
                  <option value="">—</option>
                  {otherUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <label style={label}>
                Descrição do encaminhamento
                <input value={dest.referralNote} style={inputStyle} aria-describedby="screening-referral-notice"
                  onChange={(e) => setD({ referralNote: e.target.value })} />
              </label>
              <FrozenTextNotice id="screening-referral-notice" />
            </>
          )}
        </fieldset>
      )}

      {problem && !busy && <small style={hint}>{problem}</small>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={blocked} onClick={() => void submit()} style={blocked ? disabledButtonStyle : buttonStyle}>
          {mode === "complete" ? "Concluir escuta" : "Salvar reavaliação"}
        </button>
        {mode === "complete" ? (
          <button type="button" disabled={busy} onClick={() => void abandon()} style={secondaryButtonStyle}>Abandonar escuta</button>
        ) : (
          <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
        )}
      </div>
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const box: CSSProperties = { border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", margin: 0, display: "flex", flexDirection: "column", gap: 8 };
const legend: CSSProperties = { fontSize: 13, fontWeight: 600 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alertStyle: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
