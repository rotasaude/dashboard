// Consulta do prontuário da APS (módulo 19a; ADR 0031; contratos do módulo 19
// §1 e §4). Regras fora do React: rascunho ↔ corpo do PATCH, o que falta para
// finalizar (espelho dos 422 — quem garante é o api), lista de problemas,
// início com precisão, exames, adendo e as frases das recusas. Nenhuma frase
// repete texto clínico: só códigos e rótulos.
import {
  ApiError, type AddendumChanges, type CodedOption, type Consultation, type ConsultationDraftInput,
  type EvaluatedProblem, type ExamRequest, type OnsetPrecision, type PatientProblem, type ProblemAction, type Terminology
} from "./api";
import { fmtDay } from "./audiencePhrase";
import { parseVitals, screeningError, vitalsFormFrom, type VitalsForm, type VitalsProblems } from "./screening";

export const RECORD_KEY = "attendanceRecord";
export const CONSULTATION_KEY = "consultation";
export const OPTIONS_KEY = "consultationOptions";
export const JUSTIFIED_KEY = "justifiedRecord";

export const TEXT_MAX = 20_000;
export const TEXT_MAX_LABEL = "20.000";
export const ADDENDUM_REASON_MIN = 10;

export type SoapField = "subjective" | "objective" | "assessment" | "plan";
export const SOAP_FIELDS: { key: SoapField; label: string }[] = [
  { key: "subjective", label: "Subjetivo (S)" },
  { key: "objective", label: "Objetivo (O)" },
  { key: "assessment", label: "Avaliação (A)" },
  { key: "plan", label: "Plano (P)" }
];
const TEXT_LABEL: Record<string, string> = {
  subjective: "Subjetivo (S)", objective: "Objetivo (O)", assessment: "Avaliação (A)", plan: "Plano (P)",
  text: "Texto do adendo", reason: "Motivo do adendo"
};
export function textLabel(field: string): string {
  return TEXT_LABEL[field] ?? "O texto";
}

export const TERMINOLOGY_LABEL: Record<Terminology, string> = { ciap2: "CIAP-2", cid10: "CID-10" };
export const ACTION_LABEL: Record<ProblemAction, string> = {
  evaluate: "avaliado", add: "incluído", resolve: "resolvido", correct_onset: "início corrigido"
};
export const PRECISIONS: OnsetPrecision[] = [ "day", "month", "year" ];
export const PRECISION_LABEL: Record<OnsetPrecision, string> = { day: "dia", month: "mês", year: "ano" };

export interface Onset { onset_on: string; onset_precision: OnsetPrecision }

export interface ConsultationDraft {
  soap: Record<SoapField, string>;
  vitals: VitalsForm;
  careType: string;
  problems: EvaluatedProblem[];
  conducts: string[];
  exams: ExamRequest[];
}

export function draftFrom(c: Consultation): ConsultationDraft {
  return {
    soap: { subjective: c.subjective ?? "", objective: c.objective ?? "", assessment: c.assessment ?? "", plan: c.plan ?? "" },
    vitals: vitalsFormFrom(c.vitals ?? {}),
    careType: c.care_type ?? "",
    problems: c.evaluated_problems ?? [],
    conducts: c.conducts ?? [],
    exams: c.exam_requests ?? []
  };
}

export interface DraftCheck { input: ConsultationDraftInput; vitalsProblems: VitalsProblems; tooLong: SoapField[] }

// Sinal com problema fica fora do corpo (o api recusaria o PATCH inteiro).
export function checkDraft(d: ConsultationDraft): DraftCheck {
  const { vitals, problems } = parseVitals(d.vitals);
  return {
    input: {
      subjective: d.soap.subjective, objective: d.soap.objective, assessment: d.soap.assessment, plan: d.soap.plan,
      vitals, care_type: d.careType === "" ? null : d.careType,
      evaluated_problems: d.problems, conducts: d.conducts, exam_requests: d.exams.map(examPayload)
    },
    vitalsProblems: problems,
    tooLong: SOAP_FIELDS.map((f) => f.key).filter((k) => d.soap[k].length > TEXT_MAX)
  };
}

// Texto longo demais não vai para o api (422 text_too_long): o rascunho para de salvar e diz qual campo.
export function blockedReason(check: DraftCheck): string | null {
  return check.tooLong.length > 0 ? `${textLabel(check.tooLong[0])} passa de ${TEXT_MAX_LABEL} caracteres` : null;
}

export function finalizeProblems(check: DraftCheck): string[] {
  const out: string[] = [];
  if (Object.keys(check.vitalsProblems).length > 0) out.push("corrija os sinais vitais marcados");
  for (const field of check.tooLong) out.push(`${textLabel(field)} passa de ${TEXT_MAX_LABEL} caracteres`);
  if (check.input.evaluated_problems.length === 0) out.push("avalie, inclua ou resolva ao menos um problema");
  if (check.input.conducts.length === 0) out.push("marque ao menos uma conduta");
  if (check.input.assessment.trim() === "" && check.input.plan.trim() === "") out.push("escreva a avaliação (A) ou o plano (P)");
  const exam = examsProblem(check.input.exam_requests);
  if (exam) out.push(exam);
  return out;
}

export function ageLabel(age: number): string {
  return `${age} ${age === 1 ? "ano" : "anos"}`;
}

export function codedLabel(list: CodedOption[] | null | undefined, code: string | null | undefined): string {
  if (!code) return "—";
  return list?.find((o) => o.code === code)?.label ?? code;
}

// ─── Problemas ───────────────────────────────────────────────────────────────
// Um item por problema da lista (pelo id); incluído novo pela terminologia e código.

export function problemKey(p: Pick<EvaluatedProblem, "problem_id" | "terminology" | "code">): string {
  return p.problem_id ?? `${p.terminology}:${p.code}`;
}

function fromPatient(problem: PatientProblem, action: ProblemAction): EvaluatedProblem {
  return { problem_id: problem.id, terminology: problem.terminology, code: problem.code, label: problem.label, action };
}

export function markProblem(items: EvaluatedProblem[], problem: PatientProblem, action: "evaluate" | "resolve"): EvaluatedProblem[] {
  return [ ...items.filter((i) => i.problem_id !== problem.id), fromPatient(problem, action) ];
}

export function correctOnset(items: EvaluatedProblem[], problem: PatientProblem, onset: Onset): EvaluatedProblem[] {
  return [ ...items.filter((i) => i.problem_id !== problem.id), { ...fromPatient(problem, "correct_onset"), ...onset } ];
}

// O api tem um ativo por (paciente, terminologia, código): incluir o que já
// está ativo vira "avaliado" (nunca um add duplicado).
export function addProblem(
  items: EvaluatedProblem[], patientProblems: PatientProblem[], terminology: Terminology, ref: CodedOption
): { items: EvaluatedProblem[]; notice: string | null } {
  const active = patientProblems.find((p) => p.status === "active" && p.terminology === terminology && p.code === ref.code);
  if (active) {
    if (items.some((i) => i.problem_id === active.id)) {
      return { items, notice: `${ref.code} já está na lista do paciente e já foi marcado nesta consulta` };
    }
    return { items: markProblem(items, active, "evaluate"), notice: `${ref.code} já está na lista do paciente — marcado como avaliado` };
  }
  if (items.some((i) => i.problem_id === null && i.terminology === terminology && i.code === ref.code)) {
    return { items, notice: `${ref.code} já foi incluído nesta consulta` };
  }
  return { items: [ ...items, { problem_id: null, terminology, code: ref.code, label: ref.label, action: "add" } ], notice: null };
}

export function setItemOnset(items: EvaluatedProblem[], key: string, onset: Onset): EvaluatedProblem[] {
  return items.map((i) => (problemKey(i) === key ? { ...i, ...onset } : i));
}

export function removeItem(items: EvaluatedProblem[], key: string): EvaluatedProblem[] {
  return items.filter((i) => problemKey(i) !== key);
}

// ─── Início com precisão ─────────────────────────────────────────────────────
// Datas YYYY-MM-DD comparadas como texto (nenhum fuso desloca o dia); mês e
// ano viram o primeiro dia do período.

function validDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

export function parseOnset(precision: OnsetPrecision, text: string, today: string): Onset | { problem: string } {
  const t = text.trim();
  let on: string;
  if (precision === "year") {
    if (!/^\d{4}$/.test(t)) return { problem: "informe o ano com 4 dígitos" };
    on = `${t}-01-01`;
  } else if (precision === "month") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(t)) return { problem: "informe o mês e o ano" };
    on = `${t}-01`;
  } else {
    if (!validDay(t)) return { problem: "informe uma data válida" };
    on = t;
  }
  if (Number(on.slice(0, 4)) < 1900) return { problem: "use um ano a partir de 1900" };
  const limit = precision === "year" ? today.slice(0, 4) : precision === "month" ? today.slice(0, 7) : today;
  if (on.slice(0, limit.length) > limit) return { problem: "o início não pode ser no futuro" };
  return { onset_on: on, onset_precision: precision };
}

export function onsetLabel(on: string | null | undefined, precision: OnsetPrecision | null | undefined): string {
  if (!on || !precision) return "início não informado";
  if (precision === "year") return `desde ${on.slice(0, 4)}`;
  if (precision === "month") return `desde ${on.slice(5, 7)}/${on.slice(0, 4)}`;
  return `desde ${fmtDay(on)}`;
}

export function onsetInputValue(on: string, precision: OnsetPrecision): string {
  if (precision === "year") return on.slice(0, 4);
  if (precision === "month") return on.slice(0, 7);
  return on;
}

// ─── Exames (SIGTAP) ─────────────────────────────────────────────────────────

export function normalizeCid10(text: string): string {
  return text.toUpperCase().replace(/[.\s]/g, "");
}

export function cid10Problem(text: string | null | undefined): string | null {
  const n = normalizeCid10(text ?? "");
  if (n === "") return null;
  return /^[A-Z]\d{2}[0-9A-Z]?$/.test(n) ? null : "use um código CID-10, ex.: E11 ou E119";
}

function examPayload(e: ExamRequest): ExamRequest {
  const j = normalizeCid10(e.cid10_justification ?? "");
  return j === "" ? { sigtap_code: e.sigtap_code, label: e.label } : { sigtap_code: e.sigtap_code, label: e.label, cid10_justification: j };
}

export function addExam(exams: ExamRequest[], ref: CodedOption): ExamRequest[] {
  if (exams.some((e) => e.sigtap_code === ref.code)) return exams;
  return [ ...exams, { sigtap_code: ref.code, label: ref.label } ];
}

export function setJustification(exams: ExamRequest[], code: string, text: string): ExamRequest[] {
  return exams.map((e) => (e.sigtap_code === code ? { ...e, cid10_justification: text } : e));
}

export function examsProblem(exams: ExamRequest[]): string | null {
  const bad = exams.find((e) => cid10Problem(e.cid10_justification) !== null);
  return bad ? `confira o CID-10 da justificativa do exame ${bad.sigtap_code}` : null;
}

// ─── Adendo ──────────────────────────────────────────────────────────────────

export function addendumProblem(reason: string, text: string): string | null {
  if (reason.trim().length < ADDENDUM_REASON_MIN) return `o motivo do adendo precisa de pelo menos ${ADDENDUM_REASON_MIN} caracteres`;
  if (text.trim() === "") return "escreva o texto do adendo";
  if (text.length > TEXT_MAX) return `Texto do adendo passa de ${TEXT_MAX_LABEL} caracteres`;
  return null;
}

export interface AddendumEdit { problems: EvaluatedProblem[]; conducts: string[]; exams: ExamRequest[] }

// Divergência D4: problemas são eventos novos; condutas e exames, a lista final
// (só vão quando mudaram).
export function addendumChanges(base: Consultation, edit: AddendumEdit): AddendumChanges | undefined {
  const changes: AddendumChanges = {};
  if (edit.problems.length > 0) changes.evaluated_problems = edit.problems;
  const sameConducts = edit.conducts.length === base.conducts.length && edit.conducts.every((c) => base.conducts.includes(c));
  if (!sameConducts) changes.conducts = edit.conducts;
  const examKey = (list: ExamRequest[]) =>
    JSON.stringify(list.map((e) => `${e.sigtap_code}|${normalizeCid10(e.cid10_justification ?? "")}`).sort());
  if (examKey(edit.exams) !== examKey(base.exam_requests)) changes.exam_requests = edit.exams.map(examPayload);
  return Object.keys(changes).length > 0 ? changes : undefined;
}

export function changesLines(changes: AddendumChanges | null | undefined, conductLabel: (code: string) => string): string[] {
  if (!changes) return [];
  const lines: string[] = [];
  if (changes.evaluated_problems?.length) {
    lines.push(`Problemas: ${changes.evaluated_problems.map((p) => `${p.code} ${ACTION_LABEL[p.action]}`).join(", ")}`);
  }
  if (changes.conducts) lines.push(`Condutas: ${changes.conducts.map(conductLabel).join(" · ") || "nenhuma"}`);
  if (changes.exam_requests) lines.push(`Exames: ${changes.exam_requests.map((e) => e.sigtap_code).join(", ") || "nenhum"}`);
  return lines;
}

// ─── Recusas ─────────────────────────────────────────────────────────────────

const MESSAGES: Record<string, string> = {
  citizen_not_verified: "o cadastro desta pessoa não foi validado no balcão — a consulta exige a validação presencial; encerre o atendimento só com o desfecho",
  not_in_care: "este atendimento não está mais em atendimento — a fila foi atualizada",
  not_caller: "só quem chamou o atendimento registra a consulta",
  already_exists: "a consulta deste atendimento já foi iniciada, mas não foi possível retomá-la — recarregue a página",
  cbo_not_allowed: "sua ocupação (CBO) não registra consulta",
  feature_disabled: "o prontuário está desligado nesta cidade",
  out_of_context: "este atendimento não está com você — para ler o prontuário fora do atendimento, use Prontuário com o motivo",
  not_draft: "esta consulta já foi finalizada — a tela foi atualizada",
  not_author: "só quem escreveu a consulta pode editá-la",
  no_problem_evaluated: "avalie, inclua ou resolva ao menos um problema",
  no_conduct: "marque ao menos uma conduta",
  assessment_or_plan_required: "escreva a avaliação (A) ou o plano (P)",
  patient_name_missing: "falta o nome completo do paciente — peça à recepção para completar os nomes no check-in e tente de novo",
  cid10_not_allowed_for_cbo: "sua ocupação não pode usar CID-10 — troque o problema por um código CIAP-2",
  not_finalized: "a consulta ainda não foi finalizada",
  opening_required: "a abertura justificada terminou ou não existe — abra o prontuário de novo com o motivo",
  invalid_reason: `o motivo do adendo precisa de pelo menos ${ADDENDUM_REASON_MIN} caracteres`,
  ciap2_required_for_cbo: "Avalie ao menos um problema em CIAP-2 para finalizar: a ficha de quem não é médico não leva CID-10.",
  consultation_in_progress: "Há uma consulta em andamento neste atendimento: finalize-a pela Consulta para encerrar.",
  terminology_unavailable: "a terminologia não está disponível agora — tente de novo em instantes"
};

export function consultationError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = (err.body ?? {}) as { error?: string; field?: string };
    if (body.error === "text_too_long") return `${textLabel(body.field ?? "")} passa de ${TEXT_MAX_LABEL} caracteres`;
    if (body.error && MESSAGES[body.error]) return MESSAGES[body.error];
  }
  // implausible_vital (com field), os do close e o genérico.
  return screeningError(err);
}

// Divergência D1: o 409 already_exists traz o id do rascunho existente.
export function existingConsultationId(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = (err.body ?? {}) as { error?: unknown; consultation_id?: unknown };
  return body.error === "already_exists" && typeof body.consultation_id === "string" ? body.consultation_id : null;
}
