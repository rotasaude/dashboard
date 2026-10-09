// src/modules/consultation/AddendumForm.tsx
// Adendo (módulo 19; spec §4; ADR 0031): só acréscimo, com motivo, podendo
// mudar problemas, condutas e exames. Quem não é a autora só chega aqui com
// uma abertura justificada (opening_id).
import { useState, type CSSProperties } from "react";
import {
  addAddendum, errorCode, type Addendum, type Consultation, type ConsultationOptions, type EvaluatedProblem, type ExamRequest, type PatientProblem
} from "../../lib/api";
import { addendumChanges, addendumProblem, consultationError, examsProblem, problemsWithConsultationAdds } from "../../lib/consultation";
import { todayInCity } from "../../lib/campaigns";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ProblemsEditor } from "./ProblemsEditor";
import { ConductsField } from "./ConductsField";
import { ExamRequestsField } from "./ExamRequestsField";

interface Props {
  consultation: Consultation;
  options: ConsultationOptions | null;
  patientProblems: PatientProblem[];
  openingId?: string;
  searchDelayMs?: number;
  onDone(addendum: Addendum): void;
  onCancel(): void;
  onOpeningRequired?(): void;
}

export function AddendumForm({ consultation, options, patientProblems, openingId, searchDelayMs, onDone, onCancel, onOpeningRequired }: Props) {
  const [ reason, setReason ] = useState("");
  const [ text, setText ] = useState("");
  const [ withChanges, setWithChanges ] = useState(false);
  const [ problems, setProblems ] = useState<EvaluatedProblem[]>([]);
  const [ conducts, setConducts ] = useState<string[]>(consultation.conducts);
  const [ exams, setExams ] = useState<ExamRequest[]>(consultation.exam_requests);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const touched = reason !== "" || text !== "";
  const problem = addendumProblem(reason, text) ?? (withChanges ? examsProblem(exams) : null);
  const disabled = busy || problem !== null;

  async function submit() {
    if (disabled) return;
    setBusy(true); setError(null);
    try {
      const changes = withChanges ? addendumChanges(consultation, { problems, conducts, exams }) : undefined;
      const addendum = await addAddendum(consultation.id, {
        reason: reason.trim(), text,
        ...(changes ? { changes } : {}),
        ...(openingId ? { opening_id: openingId } : {})
      });
      onDone(addendum);
    } catch (err) {
      if (errorCode(err) === "opening_required") onOpeningRequired?.();
      setError(consultationError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Adendo" style={panel}>
      <strong>Adendo</strong>
      <p style={muted}>O adendo não muda a consulta: fica junto dela, com seu nome e a hora, e também não muda depois.</p>
      <label style={labelStyle}>
        Motivo do adendo
        <input value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Texto do adendo
        <textarea value={text} rows={3} onChange={(e) => setText(e.target.value)} style={inputStyle} />
      </label>
      <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={withChanges} onChange={(e) => setWithChanges(e.target.checked)} />
        Mudar problemas, condutas ou exames
      </label>
      {withChanges && (
        <>
          <ProblemsEditor patientProblems={problemsWithConsultationAdds(patientProblems, consultation)} items={problems} onChange={setProblems}
            cid10Allowed={options?.cid10_allowed_for_cbo ?? false} today={todayInCity()} searchDelayMs={searchDelayMs} />
          <ConductsField options={options?.conducts ?? []} value={conducts} onChange={setConducts} />
          <ExamRequestsField value={exams} onChange={setExams} cid10Allowed={options?.cid10_allowed_for_cbo ?? false}
            searchDelayMs={searchDelayMs} />
        </>
      )}
      {touched && problem && <p role="alert" style={alert}>{problem}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={disabled} style={disabled ? disabledButtonStyle : buttonStyle} onClick={() => void submit()}>
          Registrar adendo
        </button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule2)", borderRadius: 8 };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
