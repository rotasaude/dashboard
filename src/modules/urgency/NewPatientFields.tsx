// O paciente novo (o NewPatient do 24a) e a conferência de duplicado (Q23), comuns à chegada (ArrivalForm, Task 5) e à
// identificação do provisório (IdentifyPatient, Task 10): os campos, os `path` do api, a máscara do documento e os candidatos do
// 409 duplicate_suspected. Nada daqui vai para URL, storage ou log.
import { isValidCpf, maskCpf, onlyDigits } from "../../lib/attendance";
import { ApiError, type NewPatient, type PatientSex, type UrgencyDuplicateCandidate } from "../../lib/api";
import { CNS_TEXT, CPF_TEXT, DOMAINS } from "../../lib/territoryDictionaries";
import { fmtDay } from "../../lib/territoryRegistry";
import { isValidCns } from "../../lib/professionals";
import type { Problem } from "../../lib/pharmacy";
import { inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, legend, row } from "../exams/styles";

export const DOC_TEXT = "digite o CPF (11 dígitos) ou o CNS (15 dígitos)";
// Ninguém pelo documento: na chegada há também o registro sem identificação; na identificação, só o paciente novo.
export const NOT_FOUND_TEXT = "Ninguém com este documento. Cadastre como paciente novo ou registre sem identificação.";
export const IDENTIFY_NOT_FOUND_TEXT = "Ninguém com este documento. Cadastre como paciente novo.";
// A8: `invalid_request` em `patient_id` = o escolhido é um provisório (ou já fundido); o 404 é patient_not_found.
export const PROVISIONAL_TEXT = "este cadastro é provisório (sem identificação) — escolha outro paciente ou cadastre como paciente novo";

export type NewDraft = { fullName: string; birthDate: string; sex: string; cpf: string; reason: string; cns: string };
export const EMPTY_NEW: NewDraft = { fullName: "", birthDate: "", sex: "", cpf: "", reason: "", cns: "" };
const DRAFT_PATH: Record<keyof NewDraft, string> = {
  fullName: "full_name", birthDate: "birth_date", sex: "sex", cpf: "cpf", reason: "no_cpf_reason", cns: "cns"
};
// Os `path` do api para os campos do paciente novo (recusa de outro caminho vai ao topo).
export const NEW_PATIENT_PATHS = Object.values(DRAFT_PATH).map((f) => `new_patient.${f}`);
export const draftPath = (key: keyof NewDraft): string => `new_patient.${DRAFT_PATH[key]}`;

const fieldBox = { display: "flex", flexDirection: "column" as const, gap: 4 };
const SEX_OPTIONS: { code: PatientSex; label: string }[] = [ { code: "female", label: "Feminino" }, { code: "male", label: "Masculino" } ];

const squish = (v: string) => v.replace(/\s+/g, " ").trim();
// O campo único aceita os dois documentos: até 11 dígitos, a máscara do CPF; acima, o CNS em blocos.
export const maskCns = (input: string) => {
  const d = onlyDigits(input).slice(0, 15);
  return [ d.slice(0, 3), d.slice(3, 7), d.slice(7, 11), d.slice(11) ].filter(Boolean).join(" ");
};
export const docMask = (digits: string) => (digits.length <= 11 ? maskCpf(digits) : maskCns(digits));

// A busca por CPF (11) ou CNS (15): a consulta, ou a frase do que está errado.
export function docQuery(digits: string): { query: { cpf: string } | { cns: string } } | { problem: string } {
  if (digits.length === 11) return isValidCpf(digits) ? { query: { cpf: digits } } : { problem: CPF_TEXT };
  if (digits.length === 15) return isValidCns(digits) ? { query: { cns: digits } } : { problem: CNS_TEXT };
  return { problem: DOC_TEXT };
}

// Sem ninguém pelo documento, o paciente novo já começa com ele.
export function withDoc(draft: NewDraft, digits: string): NewDraft {
  return digits.length === 11 ? { ...draft, cpf: maskCpf(digits) } : digits.length === 15 ? { ...draft, cns: maskCns(digits) } : draft;
}

export function toNewPatient(d: NewDraft): NewPatient {
  const np: NewPatient = { full_name: squish(d.fullName), birth_date: d.birthDate, sex: d.sex as PatientSex };
  const cpf = onlyDigits(d.cpf);
  if (cpf) np.cpf = cpf;
  else if (d.reason) np.no_cpf_reason = d.reason;
  const cns = onlyDigits(d.cns);
  if (cns) np.cns = cns;
  return np;
}

export function candidatesOf(err: unknown): UrgencyDuplicateCandidate[] {
  const list = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as { candidates?: unknown }).candidates : null;
  return Array.isArray(list)
    ? list.filter((c): c is UrgencyDuplicateCandidate => !!c && typeof c === "object" && typeof (c as UrgencyDuplicateCandidate).patient_id === "string")
    : [];
}
export const candidateLine = (c: UrgencyDuplicateCandidate) =>
  `${c.display_name} · nasc. ${fmtDay(c.birth_date)} · ${c.has_cpf ? "com CPF" : "sem CPF"}`;

export interface NewPatientFieldsProps {
  draft: NewDraft;
  problems: Problem[];
  // Prefixo dos ids das mensagens de erro (useId de quem monta).
  idBase: string;
  onEdit(key: keyof NewDraft, value: string): void;
}

// O fieldset "Paciente novo": nome, nascimento, sexo, CPF ou o motivo de não ter, CNS. Cada recusa no próprio campo.
export function NewPatientFields({ draft, problems, idBase, onEdit }: NewPatientFieldsProps) {
  const problemAt = (path: string) => problems.find((p) => p.path === path)?.text ?? null;
  const errId = (name: string) => `${idBase}-${name}-err`;
  const fieldError = (name: string, text: string | null) => text && <p id={errId(name)} role="alert" style={alert}>{text}</p>;

  const textField = (label: string, key: keyof NewDraft, opts: { type?: string; inputMode?: "numeric"; mask?(v: string): string } = {}) => {
    const path = DRAFT_PATH[key];
    const err = problemAt(`new_patient.${path}`);
    return (
      <div style={fieldBox}>
        <label style={fieldLabel}>
          {label}
          <input type={opts.type ?? "text"} value={draft[key]} style={inputStyle} autoComplete="off" inputMode={opts.inputMode}
            aria-invalid={err ? true : undefined} aria-describedby={err ? errId(path) : undefined}
            onChange={(e) => onEdit(key, opts.mask ? opts.mask(e.target.value) : e.target.value)} />
        </label>
        {fieldError(path, err)}
      </div>
    );
  };

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Paciente novo</legend>
      <div style={row}>
        {textField("Nome completo", "fullName")}
        {textField("Data de nascimento", "birthDate", { type: "date" })}
        <div style={fieldBox}>
          <label style={fieldLabel}>
            Sexo
            <select value={draft.sex} style={inputStyle} aria-describedby={problemAt("new_patient.sex") ? errId("sex") : undefined}
              onChange={(e) => onEdit("sex", e.target.value)}>
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
                onChange={(e) => onEdit("reason", e.target.value)}>
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
  );
}
