// Chegada na recepção da UPA (módulo 32a, F-32.2; contrato §4, §14 Q4 e Q23). Três formas, uma por envio: paciente achado pelo CPF ou
// CNS (`patient_id`), paciente novo (`new_patient`, o NewPatient do 24a) ou pessoa sem identificação (`unidentified.description`).
// - A busca é uma mutação no clique (grava trilha), nunca ao digitar; o documento vai só no corpo (nada em URL, storage ou log).
// - Q23: o 409 duplicate_suspected do paciente novo é um passo, não um erro — mostra os candidatos; escolher um reenvia com
//   `patient_id`, "Nenhum destes" reenvia com `duplicates_reviewed: true`. O não identificado nunca passa por essa conferência.
// - Recusas do api pelo `path` (urgencyRefusals): no campo, quando ele está na tela; as outras no topo. Sucesso limpa tudo.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  createUrgencyArrival, errorCode, lookupUrgencyPerson,
  type HealthUnit, type UrgencyArrival, type UrgencyArrivalInput, type UrgencyDuplicateCandidate, type UrgencyPatientRef
} from "../../lib/api";
import { onlyDigits } from "../../lib/attendance";
import { todayInCity } from "../../lib/campaigns";
import { URGENCY_ERRORS, arrivalBody, arrivalProblems, urgencyError, urgencyRefusals, type ArrivalDraft } from "../../lib/urgency";
import type { Problem } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import {
  DOC_TEXT, EMPTY_NEW, NEW_PATIENT_PATHS, NOT_FOUND_TEXT, NewPatientFields, PROVISIONAL_TEXT, candidateLine, candidatesOf, docMask, docQuery, draftPath, toNewPatient,
  withDoc, type NewDraft
} from "./NewPatientFields";

export { DOC_TEXT, NOT_FOUND_TEXT, PROVISIONAL_TEXT };
export const UNIDENTIFIED_NOTICE =
  "Só para a pessoa em estado grave que não pode ser identificada agora (inconsciente, sem documento e sem acompanhante). " +
  "A recepção identifica depois, pela fila. A descrição fica só no atendimento: não vai para a fila nem para a TV.";
const DESCRIPTION_HINT = "sexo e idade aparentes, sinais, roupas, onde foi encontrada";
const DESCRIPTION_MAX = 500;

type Mode = "lookup" | "new" | "unidentified";

// Os campos de cada forma (os `path` do api); recusa de outro caminho vai ao topo.
const FIELD_PATHS: Record<Mode, string[]> = {
  lookup: [],
  new: NEW_PATIENT_PATHS,
  unidentified: [ "unidentified", "unidentified.description" ]
};

export function ArrivalForm({ unit, onArrived, autoFocus = false }: { unit: HealthUnit; onArrived(a: UrgencyArrival): void; autoFocus?: boolean }) {
  const ids = useId();
  const docRef = useRef<HTMLInputElement>(null);
  const [ mode, setMode ] = useState<Mode>("lookup");
  const [ doc, setDoc ] = useState("");
  const [ docProblem, setDocProblem ] = useState<string | null>(null);
  const [ searching, setSearching ] = useState(false);
  const [ found, setFound ] = useState<{ patient: UrgencyPatientRef | null } | null>(null);
  const [ draft, setDraft ] = useState<NewDraft>(EMPTY_NEW);
  const [ description, setDescription ] = useState("");
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ topErrors, setTopErrors ] = useState<string[]>([]);
  const [ duplicates, setDuplicates ] = useState<UrgencyDuplicateCandidate[] | null>(null);
  const [ busy, setBusy ] = useState(false);
  const busyRef = useRef(false);
  const searchingRef = useRef(false);

  useEffect(() => { if (autoFocus) docRef.current?.focus(); }, [ autoFocus ]);

  function clearMessages() { setProblems([]); setTopErrors([]); }

  function choose(next: Mode) {
    clearMessages(); setDuplicates(null); setMode(next);
    // Sem ninguém pelo documento, o paciente novo já começa com ele.
    if (next === "new" && found?.patient === null) setDraft((cur) => withDoc(cur, onlyDigits(doc)));
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (searchingRef.current) return;
    const q = docQuery(onlyDigits(doc));
    if ("problem" in q) { setDocProblem(q.problem); return; }
    searchingRef.current = true; setSearching(true); setDocProblem(null); clearMessages(); setFound(null);
    try {
      const result = await lookupUrgencyPerson(q.query);
      setFound({ patient: result.patient });
      setMode("lookup"); setDuplicates(null);
    } catch (err) {
      setDocProblem(urgencyError(err, { invalid_request: DOC_TEXT }));
    } finally {
      searchingRef.current = false; setSearching(false);
    }
  }

  function reset() {
    setMode("lookup"); setDoc(""); setDocProblem(null); setFound(null); setDraft(EMPTY_NEW); setDescription("");
    clearMessages(); setDuplicates(null);
  }

  async function submit(body: UrgencyArrivalInput) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); clearMessages();
    try {
      const arrival = await createUrgencyArrival(body);
      reset();
      onArrived(arrival);
    } catch (err) {
      if (errorCode(err) === "duplicate_suspected" && "new_patient" in body) {
        setDuplicates(candidatesOf(err));
        return;
      }
      const fields = FIELD_PATHS[mode];
      const refusals = urgencyRefusals(err)
        .map((r) => (r.code === "invalid_request" && r.path === "patient_id" ? { ...r, text: PROVISIONAL_TEXT } : r));
      setProblems(refusals.filter((r) => fields.includes(r.path)));
      setTopErrors(refusals.filter((r) => !fields.includes(r.path)).map((r) => r.text));
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  function submitDraft(d: ArrivalDraft) {
    if (busyRef.current) return;
    const local = arrivalProblems(d, todayInCity());
    if (local.length > 0) { setTopErrors([]); setProblems(local); return; }
    void submit(arrivalBody(unit.id, d));
  }

  function onNewSubmit(e: FormEvent) { e.preventDefault(); submitDraft({ mode: "new", patient: toNewPatient(draft) }); }
  function onUnidentifiedSubmit(e: FormEvent) { e.preventDefault(); submitDraft({ mode: "unidentified", description }); }

  // Mudou o paciente novo depois do aviso: a conferência vale para o que foi enviado, então some.
  const edit = (key: keyof NewDraft, value: string) => {
    setDraft((cur) => ({ ...cur, [key]: value })); setDuplicates(null);
    setProblems((p) => p.filter((x) => x.path !== draftPath(key)));
  };

  const problemAt = (...paths: string[]) => problems.find((p) => paths.includes(p.path))?.text ?? null;
  const errId = (name: string) => `${ids}-${name}-err`;
  const fieldError = (name: string, text: string | null) => text && <p id={errId(name)} role="alert" style={alert}>{text}</p>;
  const submitButton = (label: string) => (
    <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>{label}</button>
  );

  const descriptionErr = problemAt("unidentified.description", "unidentified");
  const descriptionCount = [ ...description ].length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {topErrors.map((t, i) => <p key={i} role="alert" style={alert}>{t}</p>)}

      <form onSubmit={search} noValidate style={{ ...row, alignItems: "flex-end" }}>
        <label style={{ ...fieldLabel, minWidth: 220 }}>
          CPF ou CNS
          <input ref={docRef} value={docMask(doc)} style={inputStyle} inputMode="numeric" autoComplete="off"
            aria-invalid={docProblem ? true : undefined} aria-describedby={docProblem ? errId("doc") : undefined}
            onChange={(e) => { setDoc(onlyDigits(e.target.value).slice(0, 15)); setDocProblem(null); setFound(null); }} />
        </label>
        <button type="submit" aria-disabled={searching || undefined} style={searching ? disabledButtonStyle : buttonStyle}>Buscar</button>
      </form>
      {fieldError("doc", docProblem)}

      {mode === "lookup" && found && (found.patient ? (
        <div style={box}>
          <strong>{found.patient.name}</strong>
          {found.patient.cns_masked && <span className="mono" style={muted}>CNS {found.patient.cns_masked}</span>}
          <div>
            <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}
              onClick={() => submitDraft({ mode: "existing", patient: found.patient })}>
              Registrar chegada de {found.patient.name}
            </button>
          </div>
        </div>
      ) : <p role="status" style={{ margin: 0, fontSize: 13 }}>{NOT_FOUND_TEXT}</p>)}

      <div style={row}>
        <button type="button" aria-pressed={mode === "new"} style={secondaryButtonStyle} onClick={() => choose("new")}>Paciente novo</button>
        <button type="button" aria-pressed={mode === "unidentified"} style={secondaryButtonStyle} onClick={() => choose("unidentified")}>
          Pessoa sem identificação
        </button>
      </div>

      {mode === "new" && (
        <form style={form} onSubmit={onNewSubmit} noValidate aria-label="Paciente novo">
          <NewPatientFields draft={draft} problems={problems} idBase={ids} onEdit={edit} />

          {duplicates && (
            <fieldset style={fieldset}>
              <legend style={legend}>Cadastros parecidos</legend>
              <p style={{ margin: 0, fontSize: 12.5 }}>{URGENCY_ERRORS.duplicate_suspected}</p>
              {duplicates.map((c) => (
                <div key={c.patient_id} style={{ ...row, justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12.5 }}>{candidateLine(c)}</span>
                  <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
                    onClick={() => void submit({ health_unit_id: unit.id, patient_id: c.patient_id })}>
                    Registrar chegada de {c.display_name}
                  </button>
                </div>
              ))}
              <div>
                <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}
                  onClick={() => submitDraft({ mode: "new", patient: toNewPatient(draft), duplicatesReviewed: true })}>
                  Nenhum destes — cadastrar como novo
                </button>
              </div>
            </fieldset>
          )}
          {!duplicates && <div>{submitButton("Registrar chegada")}</div>}
        </form>
      )}

      {mode === "unidentified" && (
        <form style={form} onSubmit={onUnidentifiedSubmit} noValidate aria-label="Pessoa sem identificação">
          <fieldset style={fieldset}>
            <legend style={legend}>Pessoa sem identificação</legend>
            <p style={{ margin: 0, fontSize: 12.5 }}>{UNIDENTIFIED_NOTICE}</p>
            <label style={fieldLabel}>
              Descrição
              <textarea value={description} style={{ ...inputStyle, minHeight: 72 }} autoComplete="off"
                aria-invalid={descriptionErr ? true : undefined}
                aria-describedby={[ `${ids}-desc-hint`, descriptionErr ? errId("description") : null ].filter(Boolean).join(" ")}
                onChange={(e) => { setDescription(e.target.value); setProblems([]); }} />
            </label>
            <span id={`${ids}-desc-hint`} style={muted}>
              {DESCRIPTION_HINT} · <span className="mono">{descriptionCount}/{DESCRIPTION_MAX}</span>
            </span>
            {fieldError("description", descriptionErr)}
          </fieldset>
          <div>{submitButton("Registrar chegada")}</div>
        </form>
      )}
    </div>
  );
}
