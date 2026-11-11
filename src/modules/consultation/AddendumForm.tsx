// src/modules/consultation/AddendumForm.tsx
// Adendo (módulo 19; spec §4; ADR 0031): só acréscimo, com motivo, podendo
// mudar problemas, condutas e exames. Só a autora faz adendo.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addAddendum, errorCode, type Addendum, type Consultation, type ConsultationOptions, type EvaluatedProblem, type ExamRequest, type PatientProblem
} from "../../lib/api";
import { addendumChanges, addendumProblem, consultationError, examsProblem, problemsWithConsultationAdds } from "../../lib/consultation";
import { dentalApiProblems, dentalError } from "../../lib/dental";
import { urgencyError } from "../../lib/urgency";
import { todayInCity } from "../../lib/campaigns";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ProblemsEditor } from "./ProblemsEditor";
import { ConductsField } from "./ConductsField";
import { ExamRequestsField } from "./ExamRequestsField";
import { DentalAddendumFields, type DentalAddendumValue } from "../dental/DentalAddendumFields";

interface Props {
  consultation: Consultation;
  options: ConsultationOptions | null;
  patientProblems: PatientProblem[];
  // "Minhas consultas" (dashboard#12): a lista completa do paciente, buscada ao abrir o adendo.
  loadPatientProblems?: () => Promise<PatientProblem[]>;
  searchDelayMs?: number;
  unitId?: string;
  // Módulo 21a: prioridade dos exames novos (exam_tracking); os já pedidos ficam só para leitura (A33).
  examPriority?: boolean;
  // Módulo 32b (Q8/Q13): quem evolve não é a autora; a recusa do api diz que o encontro fechou, não "só quem escreveu".
  evolving?: boolean;
  onDone(addendum: Addendum): void;
  onCancel(): void;
}

export function AddendumForm({ consultation, options, patientProblems, loadPatientProblems, searchDelayMs, unitId, examPriority, evolving, onDone, onCancel }: Props) {
  const full = useQuery({
    queryKey: [ "consultationProblems", consultation.id ], queryFn: () => loadPatientProblems!(),
    enabled: !!loadPatientProblems, gcTime: 0, staleTime: 0, retry: false
  });
  const baseProblems = full.data ?? patientProblems;
  const [ reason, setReason ] = useState("");
  const [ text, setText ] = useState("");
  const [ withChanges, setWithChanges ] = useState(false);
  const [ problems, setProblems ] = useState<EvaluatedProblem[]>([]);
  const [ conducts, setConducts ] = useState<string[]>(consultation.conducts);
  const [ exams, setExams ] = useState<ExamRequest[]>(consultation.exam_requests);
  // A33: o api compara só código e CID-10 no adendo; um código da consulta mantém a prioridade
  // da ordem existente (mesmo removido e pedido de novo aqui), então ela volta ao valor de base.
  const baseCodes = consultation.exam_requests.map((e) => e.sigtap_code);
  const changeExams = (next: ExamRequest[]) => setExams(next.map((e) => {
    const base = consultation.exam_requests.find((b) => b.sigtap_code === e.sigtap_code);
    return base ? { ...e, priority: base.priority } : e;
  }));
  const isDental = consultation.kind === "dental";
  const [ dental, setDental ] = useState<DentalAddendumValue>({ findings: [], cancel: [] });
  const [ planKey, setPlanKey ] = useState(0);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const touched = reason !== "" || text !== "";
  const problem = addendumProblem(reason, text) ?? (withChanges && !isDental ? examsProblem(exams) : null);
  const disabled = busy || problem !== null;

  async function submit() {
    if (disabled) return;
    setBusy(true); setError(null);
    try {
      // O14: o adendo odontológico leva só achados e cancelamentos de item do plano.
      const dentalChanges = dental.findings.length > 0 || dental.cancel.length > 0
        ? { dental: { findings: dental.findings, plan_changes: { cancel: dental.cancel } } } : undefined;
      const changes = !withChanges ? undefined
        : isDental ? dentalChanges : addendumChanges(consultation, { problems, conducts, exams });
      const addendum = await addAddendum(consultation.id, {
        reason: reason.trim(), text,
        ...(changes ? { changes } : {})
      });
      onDone(addendum);
    } catch (err) {
      if (isDental) {
        // plan_item_not_open: o item já saiu do plano; tira o cancelamento dele e relê o plano.
        const all = dentalApiProblems(err);
        const stale = all.filter((p) => p.code === "plan_item_not_open")
          .map((p) => Number(p.path?.match(/cancel\[(\d+)\]/)?.[1])).filter((n) => !Number.isNaN(n));
        if (stale.length > 0) {
          setDental((d) => ({ ...d, cancel: d.cancel.filter((_, i) => !stale.includes(i)) }));
          setPlanKey((k) => k + 1);
        }
        setError(all.length > 1 || stale.length > 0 ? all.map((p) => p.text).join("; ") : dentalError(err));
      } else if (evolving && (errorCode(err) === "not_author" || errorCode(err) === "out_of_context")) {
        setError(urgencyError(err));
      } else setError(consultationError(err));
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
        {isDental ? "Mudar o odontograma ou o plano" : "Mudar problemas, condutas ou exames"}
      </label>
      {withChanges && isDental && (
        <DentalAddendumFields consultation={consultation} value={dental} situations={options?.dental?.situations} unitId={unitId}
          refreshKey={planKey} onChange={setDental} />
      )}
      {withChanges && !isDental && (
        <>
          {full.isError && <p role="status" style={muted}>não foi possível carregar a lista completa de problemas; seguem os desta consulta</p>}
          <ProblemsEditor patientProblems={problemsWithConsultationAdds(baseProblems, consultation)} items={problems} onChange={setProblems}
            cid10Allowed={options?.cid10_allowed_for_cbo ?? false} today={todayInCity()} searchDelayMs={searchDelayMs} />
          <ConductsField options={options?.conducts ?? []} value={conducts} onChange={setConducts} />
          <ExamRequestsField value={exams} onChange={changeExams} cid10Allowed={options?.cid10_allowed_for_cbo ?? false}
            searchDelayMs={searchDelayMs} priorityOn={examPriority}
            fixedPriorityCodes={baseCodes} />
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
