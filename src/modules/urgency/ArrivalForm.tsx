// Chegada na recepção da UPA (módulo 32a, F-32.2; contrato §4, §14 Q4 e Q23). Três formas, uma por envio: paciente achado pelo CPF ou
// CNS (`patient_id`), paciente novo (`new_patient`, o NewPatient do 24a) ou pessoa sem identificação (`unidentified.description`).
// - A busca é uma mutação no clique (grava trilha), nunca ao digitar; o documento vai só no corpo (nada em URL, storage ou log).
// - Q23: o 409 duplicate_suspected do paciente novo é um passo, não um erro — mostra os candidatos; escolher um reenvia com
//   `patient_id`, "Nenhum destes" reenvia com `duplicates_reviewed: true`. O não identificado nunca passa por essa conferência.
// - Recusas do api pelo `path` (urgencyRefusals): no campo, quando ele está na tela; as outras no topo. Sucesso limpa tudo.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  createUrgencyArrival, errorCode, lookupUrgencyPerson, ApiError,
  type HealthUnit, type NewPatient, type PatientSex, type UrgencyArrival, type UrgencyArrivalInput, type UrgencyDuplicateCandidate,
  type UrgencyPatientRef
} from "../../lib/api";
import { isValidCpf, maskCpf, onlyDigits } from "../../lib/attendance";
import { todayInCity } from "../../lib/campaigns";
import { isValidCns } from "../../lib/professionals";
import { CNS_TEXT, CPF_TEXT, DOMAINS } from "../../lib/territoryDictionaries";
import { fmtDay } from "../../lib/territoryRegistry";
import { URGENCY_ERRORS, arrivalBody, arrivalProblems, urgencyError, urgencyRefusals, type ArrivalDraft } from "../../lib/urgency";
import type { Problem } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

export const DOC_TEXT = "digite o CPF (11 dígitos) ou o CNS (15 dígitos)";
export const NOT_FOUND_TEXT = "Ninguém com este documento. Cadastre como paciente novo ou registre sem identificação.";
export const UNIDENTIFIED_NOTICE =
  "Só para a pessoa em estado grave que não pode ser identificada agora (inconsciente, sem documento e sem acompanhante). " +
  "A recepção identifica depois, pela fila. A descrição fica só no atendimento: não vai para a fila nem para a TV.";
// A8: `invalid_request` em `patient_id` na chegada = o escolhido é um provisório (ou já fundido); o 404 é patient_not_found.
export const PROVISIONAL_TEXT = "este cadastro é provisório (sem identificação) — escolha outro paciente ou cadastre como paciente novo";
const DESCRIPTION_HINT = "sexo e idade aparentes, sinais, roupas, onde foi encontrada";
const DESCRIPTION_MAX = 500;

type Mode = "lookup" | "new" | "unidentified";
type NewDraft = { fullName: string; birthDate: string; sex: string; cpf: string; reason: string; cns: string };
const EMPTY_NEW: NewDraft = { fullName: "", birthDate: "", sex: "", cpf: "", reason: "", cns: "" };
const DRAFT_PATH: Record<keyof NewDraft, string> = {
  fullName: "full_name", birthDate: "birth_date", sex: "sex", cpf: "cpf", reason: "no_cpf_reason", cns: "cns"
};
const fieldBox = { display: "flex", flexDirection: "column" as const, gap: 4 };
const SEX_OPTIONS: { code: PatientSex; label: string }[] = [ { code: "female", label: "Feminino" }, { code: "male", label: "Masculino" } ];

const squish = (v: string) => v.replace(/\s+/g, " ").trim();
// O campo único aceita os dois documentos: até 11 dígitos, a máscara do CPF; acima, o CNS em blocos.
const maskCns = (input: string) => {
  const d = onlyDigits(input).slice(0, 15);
  return [ d.slice(0, 3), d.slice(3, 7), d.slice(7, 11), d.slice(11) ].filter(Boolean).join(" ");
};
const docMask = (digits: string) => (digits.length <= 11 ? maskCpf(digits) : maskCns(digits));

function toNewPatient(d: NewDraft): NewPatient {
  const np: NewPatient = { full_name: squish(d.fullName), birth_date: d.birthDate, sex: d.sex as PatientSex };
  const cpf = onlyDigits(d.cpf);
  if (cpf) np.cpf = cpf;
  else if (d.reason) np.no_cpf_reason = d.reason;
  const cns = onlyDigits(d.cns);
  if (cns) np.cns = cns;
  return np;
}

function candidatesOf(err: unknown): UrgencyDuplicateCandidate[] {
  const list = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as { candidates?: unknown }).candidates : null;
  return Array.isArray(list)
    ? list.filter((c): c is UrgencyDuplicateCandidate => !!c && typeof c === "object" && typeof (c as UrgencyDuplicateCandidate).patient_id === "string")
    : [];
}
const candidateLine = (c: UrgencyDuplicateCandidate) => `${c.display_name} · nasc. ${fmtDay(c.birth_date)} · ${c.has_cpf ? "com CPF" : "sem CPF"}`;

// Os campos de cada forma (os `path` do api); recusa de outro caminho vai ao topo.
const FIELD_PATHS: Record<Mode, string[]> = {
  lookup: [],
  new: [ "full_name", "birth_date", "sex", "cpf", "no_cpf_reason", "cns" ].map((f) => `new_patient.${f}`),
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
    if (next === "new" && found?.patient === null) {
      const d = onlyDigits(doc);
      setDraft((cur) => (d.length === 11 ? { ...cur, cpf: maskCpf(d) } : d.length === 15 ? { ...cur, cns: maskCns(d) } : cur));
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (searchingRef.current) return;
    const d = onlyDigits(doc);
    const q = d.length === 11 ? { cpf: d } : d.length === 15 ? { cns: d } : null;
    if (!q) { setDocProblem(DOC_TEXT); return; }
    if ("cpf" in q && !isValidCpf(d)) { setDocProblem(CPF_TEXT); return; }
    if ("cns" in q && !isValidCns(d)) { setDocProblem(CNS_TEXT); return; }
    searchingRef.current = true; setSearching(true); setDocProblem(null); clearMessages(); setFound(null);
    try {
      const result = await lookupUrgencyPerson(q);
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
  const edit = (key: keyof NewDraft) => (value: string) => {
    setDraft((cur) => ({ ...cur, [key]: value })); setDuplicates(null);
    setProblems((p) => p.filter((x) => x.path !== `new_patient.${DRAFT_PATH[key]}`));
  };

  const problemAt = (...paths: string[]) => problems.find((p) => paths.includes(p.path))?.text ?? null;
  const errId = (name: string) => `${ids}-${name}-err`;
  const fieldError = (name: string, text: string | null) => text && <p id={errId(name)} role="alert" style={alert}>{text}</p>;
  const submitButton = (label: string) => (
    <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>{label}</button>
  );

  const textField = (label: string, key: keyof NewDraft, opts: { type?: string; inputMode?: "numeric"; mask?(v: string): string } = {}) => {
    const path = DRAFT_PATH[key];
    const err = problemAt(`new_patient.${path}`);
    return (
      <div style={fieldBox}>
        <label style={fieldLabel}>
          {label}
          <input type={opts.type ?? "text"} value={draft[key]} style={inputStyle} autoComplete="off" inputMode={opts.inputMode}
            aria-invalid={err ? true : undefined} aria-describedby={err ? errId(path) : undefined}
            onChange={(e) => edit(key)(opts.mask ? opts.mask(e.target.value) : e.target.value)} />
        </label>
        {fieldError(path, err)}
      </div>
    );
  };

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
          <fieldset style={fieldset}>
            <legend style={legend}>Paciente novo</legend>
            <div style={row}>
              {textField("Nome completo", "fullName")}
              {textField("Data de nascimento", "birthDate", { type: "date" })}
              <div style={fieldBox}>
                <label style={fieldLabel}>
                  Sexo
                  <select value={draft.sex} style={inputStyle} aria-describedby={problemAt("new_patient.sex") ? errId("sex") : undefined}
                    onChange={(e) => edit("sex")(e.target.value)}>
                    <option value="">Escolha</option>
                    {SEX_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                </label>
                {fieldError("sex", problemAt("new_patient.sex"))}
              </div>
            </div>
            <div style={row}>
              {textField("CPF (se tiver)", "cpf", { inputMode: "numeric", mask: maskCpf })}
              {!onlyDigits(draft.cpf) && (
                <div style={fieldBox}>
                  <label style={fieldLabel}>
                    Motivo de não ter CPF
                    <select value={draft.reason} style={inputStyle}
                      aria-describedby={problemAt("new_patient.no_cpf_reason") ? errId("no_cpf_reason") : undefined}
                      onChange={(e) => edit("reason")(e.target.value)}>
                      <option value="">Escolha</option>
                      {DOMAINS.justificativa_nao_possui_cpf.map((o) => <option key={o.code} value={String(o.code)}>{o.label}</option>)}
                    </select>
                  </label>
                  {fieldError("no_cpf_reason", problemAt("new_patient.no_cpf_reason"))}
                </div>
              )}
              {textField("CNS (se tiver)", "cns", { inputMode: "numeric", mask: maskCns })}
            </div>
          </fieldset>

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
