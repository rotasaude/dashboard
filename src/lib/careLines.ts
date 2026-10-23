// src/lib/careLines.ts
// Regras de tela das linhas de cuidado (módulo 23; ADR 0040; contrato
// 2026-10-22). Elegibilidade, situação de cada boa prática, pior situação,
// quem confirma e a prévia são do api: aqui só se traduzem os códigos, se
// monta o corpo e se recusa o que o api recusaria por formato. Nada inscreve
// sem o clique de um profissional (invariante do ADR 0040).
import {
  ApiError, errorCode, type CareEligibility, type CareEnrollment, type CareIndicator, type CareLine, type CareLineInput, type CareLineTemplate, type CarePractice,
  type CarePracticeStatus, type CareSchedule, type CareStatus, type ContactChannel, type ContactOutcome, type DeclaredCondition,
  type EndReason
} from "./api";
import { describeActionError } from "./actionErrors";
import { featureDisabledKey, hasFeature } from "./features";

export const CARE_DISABLED = "as linhas de cuidado estão desligadas nesta cidade";
export const CARE_NO_ROLE = "seu papel não permite usar as linhas de cuidado";
export const ESTIMATE_NOTICE = "Estimativa — o valor oficial é calculado pelo SIAPS; visitas do ACS e vacinas não entram.";
export const UNTRACKED_TEXT = "não acompanhado pelo sistema";
export const NO_NAME = "cidadão sem nome no cadastro";
export const personName = (p: { display_name: string | null } | null | undefined): string => p?.display_name || NO_NAME;

export const CONTEXT_KEY = "careContext";
export const ENROLLMENTS_KEY = "careEnrollments";
export const ENROLLMENT_KEY = "careEnrollment";
export const SUGGESTIONS_KEY = "careSuggestions";
export const SUGGESTION_COUNT_KEY = "careSuggestionCount";
export const OVERDUE_COUNT_KEY = "careOverdueCount";
export const TEMPLATES_KEY = "careTemplates";
export const LINES_KEY = "careCityLines";
export const PREVIEW_KEY = "carePreview";

export const COUNT_REFRESH_MS = 60_000;
// Leitura nominal grava trilha (clinical_record.viewed, access: care_line): nunca relê sozinha.
export const NOMINAL_QUERY = {
  retry: false, staleTime: 0, gcTime: 0, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false
} as const;
// Contadores (/count) não gravam trilha: releem a cada minuto.
export const COUNT_QUERY = {
  retry: false, staleTime: 0, gcTime: 0, refetchInterval: COUNT_REFRESH_MS, refetchOnWindowFocus: false, refetchOnReconnect: false
} as const;
// Sem pessoa (catálogo, linhas, contexto): lê ao abrir e depois de uma ação.
export const STATIC_QUERY = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// P9: o interruptor `care_lines` exige o prontuário (`clinical_record`); a tela
// só existe com os dois na sessão, e nunca para o operador da plataforma.
export function canUseCareLines(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "care_lines") && hasFeature(user, "clinical_record");
}

export interface CareRoles { professional: boolean; admin: boolean; analyst: boolean }

export function careLineRoles(user: SessionLike): CareRoles {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  return { professional: roles.includes("health_professional"), admin: roles.includes("municipal_admin"), analyst: roles.includes("analyst") };
}

// ─── Rótulos (contrato §1). Código novo do api aparece cru. ────────────────
const STATUS_LABEL: Record<string, string> = { ok: "em dia", due_soon: "vence em até 30 dias", overdue: "vencida", untracked: UNTRACKED_TEXT };
export function statusLabel(code: string | null | undefined): string {
  return code ? STATUS_LABEL[code] ?? code : "sem boa prática acompanhada";
}
const STATUS_TONE: Record<string, string> = { ok: "ok", due_soon: "warn", overdue: "down", untracked: "neutral" };
export function statusTone(code: string | null | undefined): string {
  return (code && STATUS_TONE[code]) || "neutral";
}

const REASON_LABEL: Record<string, string> = {
  problem: "problema ativo na lista de problemas", age_sex: "idade e sexo", declared: "condição declarada pelo cidadão",
  resolved_problem: "problema resolvido — sugestão de encerrar"
};
export function reasonLabel(code: string): string { return REASON_LABEL[code] ?? code; }

export const END_REASONS: { key: EndReason; label: string }[] = [
  { key: "discharge", label: "alta da linha" }, { key: "death", label: "óbito" }, { key: "moved", label: "mudou de território" },
  { key: "pregnancy_ended", label: "fim da gestação" }, { key: "other", label: "outro motivo" }
];
export function endReasonLabel(code: string): string { return END_REASONS.find((r) => r.key === code)?.label ?? code; }

export const CHANNELS: { key: ContactChannel; label: string }[] = [
  { key: "phone", label: "telefone" }, { key: "home_visit", label: "visita domiciliar" },
  { key: "wpda_message", label: "mensagem pelo canal do cidadão" }, { key: "in_person", label: "presencial na unidade" }
];
export function channelLabel(code: string): string { return CHANNELS.find((c) => c.key === code)?.label ?? code; }

export const OUTCOMES: { key: ContactOutcome; label: string }[] = [
  { key: "reached", label: "conversou" }, { key: "no_answer", label: "não atendeu" }, { key: "scheduled", label: "agendou" },
  { key: "refused", label: "recusou" }
];
export function outcomeLabel(code: string): string { return OUTCOMES.find((o) => o.key === code)?.label ?? code; }

export const CONDITIONS: { key: Exclude<DeclaredCondition, "none">; label: string }[] = [
  { key: "diabetes", label: "diabetes" }, { key: "hypertension", label: "hipertensão" }, { key: "pregnancy", label: "gestação" },
  { key: "mental_health", label: "saúde mental" }
];
export function conditionLabel(code: string): string { return CONDITIONS.find((c) => c.key === code)?.label ?? code; }

export const INDICATORS: { key: CareIndicator; label: string }[] = [
  { key: "C2", label: "Cuidado da criança até 2 anos" }, { key: "C3", label: "Gestante e puérpera" },
  { key: "C4", label: "Pessoa com diabetes" }, { key: "C5", label: "Pessoa com hipertensão" },
  { key: "C6", label: "Pessoa idosa" }, { key: "C7", label: "Prevenção do câncer na mulher" }
];
export function indicatorLabel(code: string): string { return INDICATORS.find((i) => i.key === code)?.label ?? code; }

// L8: famílias de prática que a prévia deixa fora (o sistema não registra).
const EXCLUDED_LABEL: Record<string, string> = { acs_visit: "visita do ACS", vaccine: "vacina", oral_health: "saúde bucal" };
export function excludedLabel(code: string): string { return EXCLUDED_LABEL[code] ?? code; }

const CONCEPT_LABEL: Record<string, string> = { optimal: "ótimo", good: "bom", sufficient: "suficiente", regular: "regular" };
export function conceptLabel(code: string | null | undefined): string { return code ? CONCEPT_LABEL[code] ?? code : "—"; }

const SOURCE_LABEL: Record<string, string> = {
  consultation: "consulta finalizada", blood_pressure: "pressão arterial (escuta ou consulta)",
  weight_height: "peso e altura (escuta ou consulta)", acs_visit: `visita do ACS — ${UNTRACKED_TEXT}`,
  oral_health: `saúde bucal — ${UNTRACKED_TEXT}`
};
export function sourceLabel(source: string): string {
  if (SOURCE_LABEL[source]) return SOURCE_LABEL[source];
  const [ kind, code ] = source.split(":");
  if (kind === "exam" && code) return `exame SIGTAP ${code} (pedido ou resultado)`;
  if (kind === "procedure" && code) return `procedimento SIGTAP ${code}`;
  if (kind === "vaccine" && code) return `vacina ${code} — ${UNTRACKED_TEXT}`;
  return source;
}

const ANCHOR_LABEL: Record<string, string> = {
  enrollment: "desde a inscrição", birth: "desde o nascimento", lmp: "desde a DUM", rolling: "janela móvel"
};
export function anchorLabel(code: string): string { return ANCHOR_LABEL[code] ?? code; }

// O conjunto, não a existência do filtro: a linha da semente restringe a 2251, 2235 e 251510 (psicólogo).
export const isDoctorNurse = (cbo: string[]): boolean => cbo.length === DOCTOR_NURSE_CBO.length && DOCTOR_NURSE_CBO.every((c) => cbo.includes(c));

export function ruleText(p: CarePractice): string {
  const span = p.window_start_days ? `do dia ${p.window_start_days} ao ${p.window_days}` : `em ${p.window_days} dias`;
  const count = `${p.min_count}× ${span}${p.schedule === "proportional" ? ", proporcional ao tempo" : ""}`;
  const parts = [ count, anchorLabel(p.anchor) ];
  if (p.cbo_filter && p.cbo_filter.length > 0) parts.push(isDoctorNurse(p.cbo_filter) ? "só médico ou enfermeiro" : `só CBO ${p.cbo_filter.join(", ")}`);
  if (typeof p.points === "number") parts.push(`${p.points} pontos`);
  return parts.join(" · ");
}

export function originText(line: Pick<CareLine, "source" | "indicator" | "template_version">): string {
  return line.source === "custom" ? "própria da cidade" : `catálogo ${line.indicator ?? "—"} · versão ${line.template_version ?? "—"}`;
}

// Versão do catálogo mais nova que a adotada (D10); null se não há.
export function newerVersion(line: CareLine, templates: CareLineTemplate[]): number | null {
  if (line.source !== "template" || !line.template_key || line.template_version === null) return null;
  const latest = line.latest_template_version ?? templates.find((t) => t.key === line.template_key)?.version ?? null;
  return latest !== null && latest > line.template_version ? latest : null;
}

// ─── Datas, números e situação ────────────────────────────────────────────
// Dia de calendário sem new Date (nenhum fuso desloca a data).
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Vírgula decimal, uma casa (lição do contrato do 21a §15). A prévia manda
// texto com ponto (L8: "37.5"); a tela nunca mostra o ponto.
export function decimalBr(n: number | string | null | undefined): string {
  const v = typeof n === "string" && n.trim() !== "" ? Number(n) : n;
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return String(Math.round(v * 10) / 10).replace(".", ",");
}

export function practiceText(p: CarePracticeStatus): string {
  if (p.status === "untracked") return UNTRACKED_TEXT;
  const parts = [ statusLabel(p.status) ];
  if (p.count !== null && p.expected !== null) parts.push(`${p.count} de ${p.expected} esperadas até agora`);
  parts.push(p.done_at ? `última em ${fmtDay(p.done_at)}` : "nunca registrada");
  if (p.due_on) parts.push(`${p.status === "overdue" ? "venceu em" : "vence em"} ${fmtDay(p.due_on)}`);
  return parts.join(" · ");
}

// untracked (e código desconhecido) não piora a pessoa (ADR 0040).
const SEVERITY: Record<string, number> = { ok: 0, due_soon: 1, overdue: 2 };
export function worstStatus(practices: Pick<CarePracticeStatus, "status">[]): CareStatus | null {
  let worst: string | null = null;
  for (const p of practices) {
    if (!(p.status in SEVERITY)) continue;
    if (worst === null || SEVERITY[p.status] > SEVERITY[worst]) worst = p.status;
  }
  return worst as CareStatus | null;
}
// O api manda `worst_status`; a tela só calcula quando ele não vem.
export function personStatus(e: Pick<CareEnrollment, "worst_status" | "practices">): string | null {
  return e.worst_status ?? worstStatus(e.practices);
}

export const ENROLLMENT_FILTERS: { key: "overdue" | "due_soon" | "all"; label: string }[] = [
  { key: "overdue", label: "Busca ativa" }, { key: "due_soon", label: "Vencendo" }, { key: "all", label: "Todos" }
];

// ─── Formulários ─────────────────────────────────────────────────────────
// Limites do plano do api ("Valores fixados" 4).
export const REASON_MAX = 500;
export const NOTE_MAX = 500;
export const NAME_MAX = 120;
export const LABEL_MAX = 120;
export const CITIZEN_LABEL_MAX = 80;
export const PRACTICES_MAX = 20;
export const MAX_WINDOW_DAYS = 7300;
export const MAX_MIN_COUNT = 50;
export const MAX_AGE_YEARS = 130;
export const LMP_MAX_DAYS = 336; // gestação (294) + puerpério (42)
// Consulta que conta (notas C2–C7, item 24): médico 2231/2251/2252/2253, enfermeiro 2235.
export const DOCTOR_NURSE_CBO = [ "2231", "2251", "2252", "2253", "2235" ];

export function reasonProblem(text: string): string | null {
  const t = text.trim();
  if (t.length === 0) return "escreva o motivo";
  if (t.length > REASON_MAX) return `motivo com até ${REASON_MAX} caracteres — encurte`;
  return null;
}

export function noteProblem(text: string): string | null {
  return text.trim().length > NOTE_MAX ? `nota com até ${NOTE_MAX} caracteres — encurte` : null;
}

export interface ContactDraft { channel: ContactChannel | ""; outcome: ContactOutcome | ""; note: string }
export const EMPTY_CONTACT: ContactDraft = { channel: "", outcome: "", note: "" };
export function contactProblem(d: ContactDraft): string | null {
  if (!d.channel) return "escolha como foi o contato";
  if (!d.outcome) return "escolha o resultado do contato";
  return noteProblem(d.note);
}

export interface EndDraft { reason: EndReason | ""; note: string }
export const EMPTY_END: EndDraft = { reason: "", note: "" };
export function endProblem(d: EndDraft): string | null {
  if (!d.reason) return "escolha o motivo do encerramento";
  if (d.reason === "other" && d.note.trim() === "") return "descreva o motivo em “outro motivo”";
  return noteProblem(d.note);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false;
  const t = Date.parse(`${s}T12:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}
// DUM da linha da gestante (decisões do coordenador; L4 invalid_anchor): obrigatória, entre hoje − 336 e hoje.
export function anchorProblem(lmp: string, today: string): string | null {
  if (!lmp) return "informe a DUM (data da última menstruação)";
  if (!validDay(lmp)) return "DUM inválida — confira a data";
  if (lmp > today) return "a DUM não pode ser depois de hoje";
  if (daysBetween(lmp, today) > LMP_MAX_DAYS) return "DUM de mais de 48 semanas (gestação e puerpério) — confira a data";
  return null;
}

// ─── Linha própria (mesma forma das do catálogo; D1) ──────────────────────
// Espelha o CareLines::Rules do api: a tela recusa antes o que o api recusaria.
export type PracticeSourceKind = "consultation" | "blood_pressure" | "weight_height" | "exam" | "procedure";
export const SOURCE_KINDS: { key: PracticeSourceKind; label: string }[] = [
  { key: "consultation", label: "consulta" }, { key: "blood_pressure", label: "pressão arterial" },
  { key: "weight_height", label: "peso e altura" }, { key: "exam", label: "exame (código SIGTAP)" },
  { key: "procedure", label: "procedimento (código SIGTAP)" }
];
// Nascimento e DUM são das linhas federais; a própria conta da inscrição ou em janela móvel.
export const CUSTOM_ANCHORS: { key: "enrollment" | "rolling"; label: string }[] = [
  { key: "rolling", label: "janela móvel (últimos N dias)" }, { key: "enrollment", label: "desde a inscrição" }
];

// O que a tela não edita viaja no rascunho e volta igual no corpo (D-02):
// editar a linha da semente não pode apagar CBO, início de janela, filtros etc.
export type PracticeExtra = Pick<CarePractice, "window_start_days" | "code_filter" | "applies_to" | "all_of">;
export type EligibilityExtra = Pick<
  CareEligibility,
  "exclude_problems" | "age_min_days" | "age_max_days" | "gender_identities_included" | "gender_identities_excluded" | "requires_anchor"
>;

export interface PracticeDraft {
  key: string; label: string; citizenLabel: string; sourceKind: PracticeSourceKind | string; sigtap: string; windowDays: string;
  minCount: string; schedule: CareSchedule | string; anchor: string;
  // Caixa "só médico ou enfermeiro": marcada só se o original é o conjunto médico/enfermeiro; só troca o CBO quando mexem nela (`baseCbo` guarda o original).
  doctorOrNurse: boolean; baseCbo: string[] | null;
  points: string; // "" = sem pontos
  extra: Partial<PracticeExtra>;
}
export interface CustomLineDraft {
  name: string; declaredCondition: "" | DeclaredCondition; ciap: string; cid10: string; ageMinYears: string; ageMaxYears: string;
  sex: "" | "female" | "male"; practices: PracticeDraft[];
  declared: string[]; // lista original de eligibility.declared (a tela edita só a condição declarada)
  baseCondition: string; // declared_condition original: é a única entrada de `declared` que a tela troca
  extra: Partial<EligibilityExtra>;
}

export function emptyPractice(): PracticeDraft {
  return { key: "", label: "", citizenLabel: "", sourceKind: "consultation", sigtap: "", windowDays: "180", minCount: "1",
    schedule: "end_of_window", anchor: "rolling", doctorOrNurse: true, baseCbo: null, points: "", extra: {} };
}
export function emptyCustomLine(): CustomLineDraft {
  return { name: "", declaredCondition: "", ciap: "", cid10: "", ageMinYears: "", ageMaxYears: "", sex: "", practices: [ emptyPractice() ],
    declared: [], baseCondition: "", extra: {} };
}

function present<T extends object>(source: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (source[k] !== undefined && source[k] !== null) out[k] = source[k];
  return out;
}

function practiceDraftOf(p: CarePractice): PracticeDraft {
  const [ kind, code ] = p.source.split(":");
  return {
    key: p.key, label: p.label, citizenLabel: p.citizen_label ?? "", sourceKind: kind, sigtap: code ?? "", windowDays: String(p.window_days),
    minCount: String(p.min_count), schedule: p.schedule, anchor: p.anchor, doctorOrNurse: !!p.cbo_filter && isDoctorNurse(p.cbo_filter),
    baseCbo: p.cbo_filter ?? null, points: typeof p.points === "number" ? String(p.points) : "",
    extra: present(p, [ "window_start_days", "code_filter", "applies_to", "all_of" ])
  };
}

export function draftOfLine(line: CareLine): CustomLineDraft {
  const e = line.eligibility ?? {};
  return {
    name: line.name, declaredCondition: (line.declared_condition ?? "") as CustomLineDraft["declaredCondition"],
    ciap: (e.problems?.ciap2 ?? []).join(", "), cid10: (e.problems?.cid10 ?? []).join(", "),
    ageMinYears: e.age_min_years == null ? "" : String(e.age_min_years),
    ageMaxYears: e.age_max_years == null ? "" : String(e.age_max_years),
    sex: e.sex ?? "", practices: (line.practices ?? []).map(practiceDraftOf), declared: e.declared ?? [],
    baseCondition: line.declared_condition ?? "",
    extra: present(e, [ "exclude_problems", "age_min_days", "age_max_days", "gender_identities_included", "gender_identities_excluded",
      "requires_anchor" ])
  };
}

export function codeList(text: string): string[] {
  return [ ...new Set(text.toUpperCase().replace(/\./g, "").split(/[\s,;]+/).filter(Boolean)) ];
}

// Chave da boa prática (api: /^[a-z0-9_]{1,40}$/): sem acento, começa com letra,
// única; o prefixo e o sufixo "_2" entram dentro dos 40 caracteres.
const KEY_MAX = 40;
export function slugKey(label: string, taken: Set<string>): string {
  const raw = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const named = raw === "" ? "pratica" : /^[a-z]/.test(raw) ? raw : `p_${raw}`;
  const base = named.slice(0, KEY_MAX).replace(/_+$/, "");
  let key = base;
  for (let n = 2; taken.has(key); n += 1) {
    const suffix = `_${n}`;
    key = `${base.slice(0, KEY_MAX - suffix.length).replace(/_+$/, "")}${suffix}`;
  }
  return key;
}

const CIAP_RE = /^[A-Z]\d{2}$/;
const CID_RE = /^[A-Z]\d{2}[0-9X]?$/;
const SIGTAP_RE = /^\d{10}$/;
const EXAM_RE = /^02\d{8}$/;
const KEY_RE = /^[a-z0-9_]{1,40}$/;
const CBO_RE = /^\d{4,6}$/;
const VACCINE_RE = /^[a-z0-9_]{1,30}$/;
const KNOWN_KINDS = [ "consultation", "blood_pressure", "weight_height", "acs_visit", "oral_health", "exam", "procedure", "vaccine" ];
export const MAX_CODES = 300;
const isSigtapKind = (kind: string) => kind === "exam" || kind === "procedure";

function intOf(raw: string): number | null {
  const t = raw.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}
// "" = sem limite (null); inválido = undefined.
function yearsOf(raw: string): number | null | undefined {
  if (raw.trim() === "") return null;
  const n = intOf(raw);
  return n === null || n > MAX_AGE_YEARS ? undefined : n;
}

function sourceOf(p: PracticeDraft): string {
  const code = p.sigtap.trim();
  return isSigtapKind(p.sourceKind) || (p.sourceKind === "vaccine" && code) ? `${p.sourceKind}:${code}` : p.sourceKind;
}

// CBO que o corpo manda: o original, até mexerem na caixa; só em consulta. A caixa nasce marcada só quando
// o original é exatamente o conjunto médico/enfermeiro; com outro conjunto ela nasce desmarcada e o original fica.
function cboOf(p: PracticeDraft): string[] | null {
  if (p.sourceKind !== "consultation") return null;
  const base = p.baseCbo && p.baseCbo.length > 0 ? p.baseCbo : null;
  if (p.doctorOrNurse === (!!base && isDoctorNurse(base))) return base;
  return p.doctorOrNurse ? [ ...DOCTOR_NURSE_CBO ] : null;
}

// A tela troca só a condição que ela edita (a original); as outras entradas de `declared` e o
// critério de uma linha sem `declared_condition` ficam como vieram.
function declaredOf(d: CustomLineDraft): string[] {
  const rest = d.declared.filter((x) => x !== d.baseCondition);
  if (!d.declaredCondition) return rest;
  if (d.declared.includes(d.baseCondition)) return [ ...new Set(d.declared.map((x) => (x === d.baseCondition ? d.declaredCondition : x))) ];
  return rest.includes(d.declaredCondition) ? rest : [ ...rest, d.declaredCondition ];
}

function practiceProblem(p: PracticeDraft, n: string, seen: Set<string>): string | null {
  const label = p.label.trim();
  if (!label) return `${n}: escreva o que deve ser feito`;
  if (label.length > LABEL_MAX) return `${n}: até ${LABEL_MAX} caracteres — encurte`;
  if (p.citizenLabel.trim().length > CITIZEN_LABEL_MAX) return `${n}: texto para o cidadão até ${CITIZEN_LABEL_MAX} caracteres — encurte`;
  if (!KNOWN_KINDS.includes(p.sourceKind)) return `${n}: fonte do dado desconhecida`;
  const code = p.sigtap.trim();
  if (isSigtapKind(p.sourceKind) && !SIGTAP_RE.test(code)) return `${n}: código SIGTAP com 10 dígitos`;
  if (p.sourceKind === "exam" && !EXAM_RE.test(code)) return `${n}: exame começa por 02 (código SIGTAP de 10 dígitos)`;
  if (p.sourceKind === "vaccine" && !VACCINE_RE.test(code)) return `${n}: código da vacina com letras minúsculas, números ou _ (até 30)`;
  const w = intOf(p.windowDays);
  if (w === null || w < 1 || w > MAX_WINDOW_DAYS) return `${n}: janela de 1 a ${MAX_WINDOW_DAYS} dias`;
  const c = intOf(p.minCount);
  if (c === null || c < 1 || c > MAX_MIN_COUNT) return `${n}: quantidade de 1 a ${MAX_MIN_COUNT}`;
  if (p.points.trim() !== "") {
    const pts = intOf(p.points);
    if (pts === null || pts > 100) return `${n}: pontos inteiros de 0 a 100`;
  }
  if (!CUSTOM_ANCHORS.some((a) => a.key === p.anchor) && !["birth", "lmp"].includes(p.anchor)) return `${n}: referência de início desconhecida`;
  if (p.schedule !== "end_of_window" && p.schedule !== "proportional") return `${n}: cronograma desconhecido`;
  if (p.key) {
    if (!KEY_RE.test(p.key)) return `${n}: chave inválida`;
    if (seen.has(p.key)) return `${n}: chave repetida`;
    seen.add(p.key);
  }
  const start = p.extra.window_start_days ?? 0;
  if (start > 0 && p.anchor === "rolling") return `${n}: início da janela não vale com janela móvel`;
  if (start > 0 && start >= w) return `${n}: o início da janela vem antes do fim`;
  if (p.schedule === "proportional" && p.anchor === "rolling") return `${n}: cronograma proporcional não vale com janela móvel`;
  const groups = p.extra.all_of ?? null;
  const several = !!groups && groups.length > 1;
  if (several && c !== 1) return `${n}: com mais de um grupo em “todos de”, a quantidade é 1`;
  if (several && p.schedule === "proportional") return `${n}: cronograma proporcional não vale com mais de um grupo em “todos de”`;
  if (groups && p.anchor !== "rolling" && groups.some((g) => g.some((alt) => alt.window_days !== undefined))) {
    return `${n}: janela própria em “todos de” só vale com janela móvel`;
  }
  const cbo = cboOf(p);
  if (cbo && (cbo.length > 30 || !cbo.every((x) => CBO_RE.test(x)))) return `${n}: CBO de 4 a 6 dígitos`;
  if (p.extra.code_filter && p.sourceKind !== "consultation") return `${n}: filtro de código só vale em consulta`;
  return null;
}

export function customLineProblem(d: CustomLineDraft): string | null {
  const name = d.name.trim();
  if (!name) return "dê um nome à linha";
  if (name.length > NAME_MAX) return `nome com até ${NAME_MAX} caracteres — encurte`;
  const ciap = codeList(d.ciap);
  const cid = codeList(d.cid10);
  const badCiap = ciap.find((c) => !CIAP_RE.test(c));
  if (badCiap) return `código CIAP-2 inválido: ${badCiap}`;
  const badCid = cid.find((c) => !CID_RE.test(c));
  if (badCid) return `código CID-10 inválido: ${badCid}`;
  if (ciap.length > MAX_CODES) return `no máximo ${MAX_CODES} códigos CIAP-2`;
  if (cid.length > MAX_CODES) return `no máximo ${MAX_CODES} códigos CID-10`;
  const min = yearsOf(d.ageMinYears);
  const max = yearsOf(d.ageMaxYears);
  if (min === undefined || max === undefined) return `idade em anos inteiros, de 0 a ${MAX_AGE_YEARS}`;
  if (min !== null && max !== null && min > max) return "a idade mínima passa da máxima";
  const aged = min !== null || max !== null || d.extra.age_min_days != null || d.extra.age_max_days != null;
  if (ciap.length + cid.length === 0 && !aged && !d.sex && declaredOf(d).length === 0) {
    return "escolha ao menos um critério: problema, idade, sexo ou condição declarada";
  }
  if (d.practices.length === 0) return "inclua pelo menos uma boa prática";
  if (d.practices.length > PRACTICES_MAX) return `no máximo ${PRACTICES_MAX} boas práticas`;
  const seen = new Set<string>();
  for (const [ i, p ] of d.practices.entries()) {
    const problem = practiceProblem(p, `boa prática ${i + 1}`, seen);
    if (problem) return problem;
  }
  return null;
}

// Só depois de customLineProblem(d) === null. Forma L1/L2 do plano do api;
// nunca manda lista vazia (D-01): `problems` só com código, `declared` só com valor.
export function customLineBody(d: CustomLineDraft): CareLineInput {
  const taken = new Set(d.practices.map((p) => p.key).filter(Boolean));
  const practices: CarePractice[] = d.practices.map((p) => {
    const key = p.key || slugKey(p.label, taken);
    taken.add(key);
    const citizen = p.citizenLabel.trim();
    const points = p.points.trim();
    return {
      key, label: p.label.trim(), ...(citizen ? { citizen_label: citizen } : {}), source: sourceOf(p),
      ...p.extra,
      window_days: Number(p.windowDays.trim()), min_count: Number(p.minCount.trim()), schedule: p.schedule, anchor: p.anchor,
      cbo_filter: cboOf(p), ...(points ? { points: Number(points) } : {})
    };
  });
  const ciap2 = codeList(d.ciap);
  const cid10 = codeList(d.cid10);
  const declared = declaredOf(d);
  const eligibility: CareEligibility = {
    ...(ciap2.length + cid10.length > 0 ? { problems: { ...(ciap2.length ? { ciap2 } : {}), ...(cid10.length ? { cid10 } : {}) } } : {}),
    ...d.extra,
    age_min_years: yearsOf(d.ageMinYears) ?? null, age_max_years: yearsOf(d.ageMaxYears) ?? null, sex: d.sex || null,
    ...(declared.length > 0 ? { declared } : {}), requires_anchor: d.extra.requires_anchor ?? null
  };
  return {
    // Sempre manda a condição: ausente = "manter a antiga" no api (e limpar vira invalid_eligibility).
    name: d.name.trim(), eligibility, practices, declared_condition: d.declaredCondition || null
  };
}

// ─── Recusas do api ──────────────────────────────────────────────────────
// Códigos do contrato e do plano do api (L4).
const ERRORS: Record<string, string> = {
  missing_role: CARE_NO_ROLE,
  out_of_scope: "você não tem vínculo ativo na unidade desta equipe",
  cbo_not_allowed: "só médico ou enfermeiro confirma a inscrição",
  anchor_required: "informe a DUM para inscrever na linha da gestante",
  invalid_anchor: "DUM fora do prazo (até 48 semanas atrás) ou em linha que não pede DUM",
  invalid_transition: "isso já foi decidido ou encerrado por outra pessoa — a lista foi relida",
  immutable_rules: "as regras de uma linha do catálogo não mudam aqui — adote a versão nova",
  duplicate_declared_condition: "já existe uma linha da cidade para esta condição declarada",
  template_not_found: "versão do catálogo não encontrada — atualize a tela",
  invalid_name: "nome inválido — de 1 a 120 caracteres",
  invalid_declared_condition: "condição declarada desconhecida — atualize a tela",
  invalid_person: "pessoa inválida — busque de novo pelo CPF",
  invalid_care_line: "linha inválida — atualize a tela",
  invalid_filter: "filtro inválido — atualize a tela",
  invalid_indicator: "indicador inválido — use C2 a C7",
  already_enrolled: "a pessoa já está inscrita nesta linha",
  citizen_not_verified: "o cadastro desta pessoa ainda não foi validado no posto — valide na recepção",
  invalid_practices: "boas práticas inválidas — confira os campos",
  invalid_eligibility: "regras de elegibilidade inválidas — confira os códigos e as idades",
  duplicate_template: "esta linha do catálogo já foi adotada pela cidade",
  reason_required: "escreva o motivo",
  too_long: "texto maior que o permitido — encurte",
  invalid_reason: "motivo desconhecido — atualize a tela",
  invalid_channel: "canal de contato desconhecido — atualize a tela",
  invalid_outcome: "resultado de contato desconhecido — atualize a tela",
  invalid_condition: "condição declarada desconhecida — atualize a tela",
  line_inactive: "esta linha foi desativada pela administração",
  invalid_cpf: "CPF inválido",
  person_not_found: "nenhum cidadão com este CPF na cidade",
  too_many_requests: "muitas buscas seguidas — espere um minuto",
  already_scheduled: "já há horário marcado para esta pessoa",
  invalid_unit: "a unidade desta equipe não está ativa para agendar — fale com a recepção",
  catalog_not_loaded: "o catálogo de linhas ainda não foi carregado — fale com o suporte",
  mfa_required: "confirme sua identidade com o código do autenticador e tente de novo",
  invalid_cursor: "a lista mudou enquanto você rolava — recomeçando do início",
  not_found: "registro não encontrado — atualize a tela"
};

export function careLineError(err: unknown): string {
  if (featureDisabledKey(err) !== null) return CARE_DISABLED;
  const code = errorCode(err);
  if (code && ERRORS[code]) return ERRORS[code];
  // Código fora do mapa: o padrão do SensitiveAction (frase, nunca o código cru).
  if (code && err instanceof ApiError) {
    const described = describeActionError(err);
    return "message" in described ? described.message : `não foi possível concluir (${err.status}) — tente de novo`;
  }
  if (err instanceof ApiError && err.status === 404) return ERRORS.not_found;
  if (err instanceof ApiError) return `não foi possível concluir (${err.status}) — tente de novo`;
  return "sem conexão com o servidor — tente de novo";
}

// Só a frase de um código conhecido; os demais (unauthenticated, operator_read_only, json_required...) ficam
// para o padrão do SensitiveAction/describeActionError, que nunca mostra código cru.
export function knownCareLineError(err: unknown): string | null {
  if (featureDisabledKey(err) !== null) return CARE_DISABLED;
  const code = errorCode(err);
  return code && Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : null;
}

// A lista mudou por outra pessoa: quem chama relê.
export function isStaleCare(err: unknown): boolean {
  const code = errorCode(err);
  return code === "not_found" || code === "invalid_transition" || code === "invalid_cursor";
}
