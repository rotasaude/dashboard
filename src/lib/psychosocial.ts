// Regras de tela do módulo 31 (CAPS; contrato 2026-11-04 §1–§11 e §15) sem React. Lotação, crítica do SIGTAP, CBO, mês
// fechado, leito, limite de noites, BPA-C, trilha e imutabilidade são do api; a tela só não envia o que já sabe que será recusado.
// Limites e códigos conferidos contra o api real (api-truth.md; `Psychosocial::Catalog`, `ActionRules`, `FAILURE_STATUS`): onde o
// plano diz outra coisa, vale o api. Nenhuma frase interpola nome, CPF, CNS, CID, substância ou texto do corpo.
import {
  ApiError, errorCode,
  type CareIntensity, type ClinicalDocument, type PsyAction, type PsyActionInput, type PsyCarePlanInput, type PsyCode, type PsyCount, type PsyEnrollment, type PsyEnrollmentInput,
  type PsyEnrollmentPatch, type PsyGroup, type PsyGroupInput, type PsyGroupKind, type PsyGroupPatch, type PsyOptions, type PsyPlace, type PsyProcedure, type PsyReceptionInput, type PsySettings, type ReceptionOutcome
} from "./api";
import { NOMINAL_QUERY, STATIC_QUERY, fmtDay } from "./careLines";
import { addDays } from "./campaigns";
import { documentError } from "./clinicalDocuments";
import { featureDisabledKey, featureLabel, hasFeature } from "./features";
import { cityLocalIso, parseCityLocal } from "./format";
import type { Problem, Refusal } from "./pharmacy";
import { cityLocalInput } from "./vaccination";

export { NOMINAL_QUERY, STATIC_QUERY };

// ─── Frases fixas ───────────────────────────────────────────────────────────
export const PSY_DISABLED = "a atenção psicossocial está desligada nesta cidade";
export const PSY_NO_ROLE = "seu papel não permite usar o CAPS";
export const NO_CAPS_UNIT = "você não está lotado em nenhum CAPS — a lotação vem do vínculo CNES ativo na unidade";
export const NO_CAPS_BEDS = "nenhum CAPS seu tem leitos — só CAPS III, AD III e AD IV";
export const NO_ACTIVE_CAPS = "nenhum CAPS ativo nesta cidade";
export const SMALL_COUNT = "menos de 5";
export const TRAIL_NOTE = "Abrir registra a leitura no prontuário do CAPS.";
export const NO_CLINICAL_IN_LIST = "A lista não mostra CID, substâncias, evolução, PTS nem o motivo do encaminhamento.";
// Reabertura do mês, reavaliação do limite noturno e saída do leito (P25).
export const REASON_TEXT = "o motivo tem de 10 a 500 caracteres";
// Cancelamento da ação e motivo do encaminhamento (P12, P49).
export const LONG_REASON_TEXT = "o motivo tem de 10 a 2000 caracteres";

// ─── Chaves de consulta ─────────────────────────────────────────────────────
export const PSY_UNITS_KEY = "psyUnits";
export const PSY_OPTIONS_KEY = "psyOptions";
export const PSY_REFERRALS_KEY = "psyReferrals";
export const PSY_ENROLLMENTS_KEY = "psyEnrollments";
// Raiz de todo detalhe nominal (matrícula, ação, encaminhamento, PTS, permanência, matriciamento): `NOMINAL_QUERY`, sem cache.
export const PSY_DETAIL_KEY = "psyDetail";
export const PSY_ACTIONS_KEY = "psyActions";
export const PSY_GROUPS_KEY = "psyGroups";
export const PSY_TODAY_KEY = "psyToday";
export const PSY_BEDS_KEY = "psyBeds";
export const PSY_MONTH_KEY = "psyMonth";
export const PSY_EXPORTS_KEY = "psyExports";
export const PSY_MATRIX_KEY = "psyMatrix";
export const PSY_SETTINGS_KEY = "psySettings";
export const PSY_DASHBOARD_KEY = "psyDashboard";

// ─── Portão e papéis ────────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// Decisão 24: `psychosocial_care` e `clinical_record` na sessão (sem cascata, P22), e nunca o operador da plataforma.
export function canUsePsychosocial(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "psychosocial_care") && hasFeature(user, "clinical_record");
}

export type PsyRoles = { staff: boolean; lead: boolean; admin: boolean; analyst: boolean; billing: boolean; professional: boolean };

// `psychosocial_lead` implica `psychosocial_staff`. A lotação no CAPS é do api (`not_on_caps_team`).
export function psychosocialRoles(user: SessionLike): PsyRoles {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  const lead = roles.includes("psychosocial_lead");
  return {
    staff: lead || roles.includes("psychosocial_staff"), lead, admin: roles.includes("municipal_admin"), analyst: roles.includes("analyst"),
    billing: roles.includes("billing_clerk"), professional: roles.includes("health_professional")
  };
}

// P50: documento do CAPS só por médico — CBO 2251, 2252 ou 2253.
export const isPrescriber = (cbo: string | null | undefined): boolean => !!cbo && /^225[123]/.test(cbo);

// ─── Rótulos. Código novo do api aparece cru. ───────────────────────────────
const pick = (map: Record<string, string>) => (code: string): string => (Object.prototype.hasOwnProperty.call(map, code) ? map[code] : code);

// Ordem do contrato §1.
export const CAPS_MODALITIES = [ "caps_i", "caps_ii", "caps_iii", "caps_i_child", "caps_ad", "caps_ad_iii", "caps_ad_iv" ] as const;
// Só essas têm leito (acolhimento noturno).
export const NIGHT_MODALITIES: readonly string[] = [ "caps_iii", "caps_ad_iii", "caps_ad_iv" ];
export const hasBeds = (modality: string | null | undefined): boolean => !!modality && NIGHT_MODALITIES.includes(modality);

export const modalityLabel = pick({
  caps_i: "CAPS I", caps_ii: "CAPS II", caps_iii: "CAPS III", caps_i_child: "CAPS i (infantojuvenil)", caps_ad: "CAPS AD",
  caps_ad_iii: "CAPS AD III", caps_ad_iv: "CAPS AD IV"
});
export const instrumentLabel = pick({ raas_psi: "RAAS-PSI", bpa_c: "BPA-C", bpa_i: "BPA-I" });
export const intensityLabel = pick({ intensive: "intensivo", semi_intensive: "semi-intensivo", non_intensive: "não intensivo" });
export const outcomeLabel = pick({ enrolled: "matricular no CAPS", referred_elsewhere: "encaminhar a outro serviço", no_follow_up: "sem seguimento" });
export const priorityLabel = pick({ routine: "rotina", priority: "prioritário" });
export const groupKindLabel = pick({ group: "grupo", workshop: "oficina", assembly: "assembleia" });
export const placeLabel = pick({ caps: "no CAPS", territory: "no território" });
export const monthStatusLabel = pick({ open: "aberto", closed: "fechado", exported: "remessa gerada" });
// ISO: 1 = segunda … 7 = domingo.
const weekday = pick({ 1: "segunda", 2: "terça", 3: "quarta", 4: "quinta", 5: "sexta", 6: "sábado", 7: "domingo" });
export const weekdayLabel = (n: number): string => weekday(String(n));
export const countLabel = (c: PsyCount): string => (c === "lt5" ? SMALL_COUNT : String(c));
// Rótulo de `options` (origem, destino, substância); código fora da lista aparece cru.
export const codeLabel = (list: PsyCode[] | null | undefined, code: string): string => list?.find((c) => c.code === code)?.label ?? code;
// R6: o painel (admin, analista) não lê `options`; os 8 destinos do `raas.yml`.
export const DESTINATION_LABEL: Record<string, string> = {
  "00": "Permanência", "01": "Alta", "02": "Transferência para outro CAPS", "03": "Encaminhamento para a atenção básica", "04": "Abandono",
  "05": "Óbito", "06": "Internação", "07": "Outros"
};
export const destinationLabel = pick(DESTINATION_LABEL);
// R5: o api manda o CID sem ponto ("F322"); a tela mostra "F32.2".
export function cidLabel(code: string): string {
  const c = code.trim().toUpperCase();
  return /^[A-Z]\d{2}[0-9A-Z]+$/.test(c) ? `${c.slice(0, 3)}.${c.slice(3)}` : c;
}

// ─── Pendências e avisos da RAAS do mês (P14, P24, P57) ─────────────────────
// Bloqueiam o fechamento.
export const MONTH_PROBLEM_TEXT: Record<string, string> = {
  patient_cns_missing: "CNS do usuário ausente", phone_missing: "telefone do usuário ausente",
  homeless_missing: "situação de rua do mês não informada", professional_cns_missing: "CNS do profissional ausente",
  professional_not_in_cnes: "profissional fora do CNES local", cid_missing: "CID ausente", action_out_of_rule: "ação fora da regra do SIGTAP",
  night_stay_open: "permanência noturna aberta no mês"
};
// Não bloqueiam. `phone_missing` é aviso para quem está em situação de rua num CAPS com telefone (P57).
export const MONTH_WARNING_TEXT: Record<string, string> = {
  no_actions: "nenhuma ação de RAAS no mês — fica fora da remessa e das fichas",
  // Neutra: o api rebaixa a pendência a aviso por situação de rua (P57) ou quando o registro não tem ação RAAS.
  phone_missing: "telefone do usuário ausente — não bloqueia o fechamento"
};
export const monthProblemLabel = pick(MONTH_PROBLEM_TEXT);
// Pendência que o api rebaixe a aviso usa a frase da pendência; código novo aparece cru.
export const monthWarningLabel = (code: string): string => MONTH_WARNING_TEXT[code] ?? monthProblemLabel(code);

// ─── Validações locais (os `path` são os do api) ────────────────────────────
const trimmedLength = (v: string): number => v.trim().length;

// `null` quando o texto cabe; mede sem os espaços das pontas, como o api.
export function textProblem(value: string, min: number, max: number, label: string): string | null {
  const n = trimmedLength(value);
  return n < min || n > max ? `${label}: de ${min} a ${max} caracteres` : null;
}
export function reasonProblem(reason: string, min = 10, max = 500): string | null {
  const n = trimmedLength(reason);
  return n < min || n > max ? `o motivo tem de ${min} a ${max} caracteres` : null;
}

export const PHONE_TEXT = "o telefone tem 10 ou 11 dígitos, com DDD";
// Toda unidade (P27): só dígitos, 10 ou 11; vazio vale (nulo).
export function phoneProblem(phone: string): string | null {
  const v = phone.trim();
  return v === "" || /^\d{10,11}$/.test(v) ? null : PHONE_TEXT;
}

// Só com `kind === "caps"`: modalidade obrigatória; classificação 115 opcional, com 3 dígitos quando preenchida.
export function unitCapsProblems(d: { kind: string; capsModality: string; serviceClassification: string }): Problem[] {
  if (d.kind !== "caps") return [];
  const out: Problem[] = [];
  if (!d.capsModality) out.push({ path: "caps_modality", text: "escolha a modalidade do CAPS" });
  const sc = d.serviceClassification.trim();
  if (sc !== "" && !/^\d{3}$/.test(sc)) out.push({ path: "service_classification", text: PSY_ERRORS.invalid_service_classification });
  return out;
}

// Matrícula retroativa: no máximo até o dia 1º do mês de 12 meses atrás (P42); o nascimento é do api.
export function enrollmentFloor(today: string): string {
  const [ y, m ] = today.split("-").map(Number);
  const back = y * 12 + (m - 1) - 12;
  return `${Math.floor(back / 12)}-${String((back % 12) + 1).padStart(2, "0")}-01`;
}

export type EnrollmentDraft = {
  startedOn: string; origin: string; cidMain: { code: string; label: string } | null; cidSecondary: { code: string; label: string }[];
  substances: string[]; esfCovered: boolean; esfCnes: string; referenceUserId: string;
};
// "99" = nenhuma, só sozinha (raas.yml).
export const NO_SUBSTANCE = "99";

export function emptyEnrollmentDraft(today: string, meId: string): EnrollmentDraft {
  return { startedOn: today, origin: "", cidMain: null, cidSecondary: [], substances: [], esfCovered: false, esfCnes: "", referenceUserId: meId };
}

export function enrollmentProblems(d: EnrollmentDraft, today: string): Problem[] {
  const out: Problem[] = [];
  const floor = enrollmentFloor(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startedOn) || d.startedOn > today || d.startedOn < floor) {
    out.push({ path: "started_on", text: `o início vai de ${fmtDay(floor)} até hoje — nunca futuro` });
  }
  if (!d.origin) out.push({ path: "origin", text: "escolha a origem do usuário" });
  if (!d.cidMain) out.push({ path: "cid_main", text: "informe o CID principal" });
  if (d.cidSecondary.length > 4) out.push({ path: "cid_secondary", text: "no máximo 4 CIDs secundários" });
  if (d.substances.length === 0) out.push({ path: "substances", text: "marque as substâncias ou nenhuma" });
  else if (d.substances.includes(NO_SUBSTANCE) && d.substances.length > 1) {
    out.push({ path: "substances", text: "nenhuma não combina com outra substância" });
  }
  if (d.esfCovered && !/^\d{7}$/.test(d.esfCnes.trim())) out.push({ path: "esf_cnes", text: PSY_ERRORS.esf_cnes_required });
  if (!d.referenceUserId) out.push({ path: "reference_user_id", text: "escolha o técnico de referência" });
  return out;
}

// Sem cobertura de ESF, `esf_cnes` não vai (o api recusa); sem secundários, a chave não vai.
export function enrollmentInput(d: EnrollmentDraft, unitId: string, patientId: string): PsyEnrollmentInput {
  return {
    health_unit_id: unitId, patient_id: patientId, started_on: d.startedOn, origin: d.origin, cid_main: d.cidMain?.code ?? "",
    ...(d.cidSecondary.length > 0 ? { cid_secondary: d.cidSecondary.map((c) => c.code) } : {}),
    substances: d.substances, esf_covered: d.esfCovered, ...(d.esfCovered ? { esf_cnes: d.esfCnes.trim() } : {}),
    reference_user_id: d.referenceUserId
  };
}

// ─── Acolhimento (F-31.2; §4, P7, P40) ──────────────────────────────────────
export const RECEPTION_DONE = "Acolhimento registrado.";
export const RECEPTION_ENROLLED = "Acolhimento registrado. Matrícula aberta.";
export const NO_RECEPTION_PROCEDURE = "nenhum procedimento de acolhimento do SIGTAP serve para o seu CBO neste CAPS";
export const NO_REGISTRATION_TEXT = "esta pessoa não tem cadastro — cadastre no balcão de atendimento antes do acolhimento";
export const ESF_CNES_MISSING = "a equipe de ESF que cobre o usuário não tem CNES cadastrado — digite o CNES da USF (7 dígitos)";
// A mesma frase do `enrollment_required` em `at` que o api devolve (P40).
export const RECEPTION_BEFORE_START = "o acolhimento é anterior ao início da matrícula";
export const DATE_TIME_TEXT = "confira a data e a hora";
export const FUTURE_DATE_TEXT = "a data não pode ser futura";
export const RECEPTION_NOTES_TEXT = "as anotações do acolhimento têm até 4000 caracteres";
export const RECEPTION_PROCEDURE_TEXT = "escolha o procedimento do acolhimento";
export const RECEPTION_OUTCOME_TEXT = "escolha o desfecho";
export const NO_PROCEDURE_OPTION = "nenhum procedimento";
export const NO_PENDING_REFERRALS = "nenhum encaminhamento aguardando acolhimento";
export const PERSON_PICK_FAILED = "não foi possível escolher esta pessoa — busque de novo";
export const CID_REPEATED_TEXT = "este CID já está na matrícula — escolha outro";
export const DISCARD_RECEPTION_TEXT = "há um acolhimento em andamento — descartar o que foi preenchido?";

// Código do acolhimento: nome com "ACOLHIMENTO" e instrumento RAAS-PSI (09) ou BPA-I (02); `options` já vem filtrado pelo CBO.
export const receptionProcedures = (o: PsyOptions): PsyProcedure[] =>
  o.procedures.filter((p) => /ACOLHIMENTO/i.test(p.name) && (p.instrument_codes.includes("09") || p.instrument_codes.includes("02")));

export type ReceptionDraft = {
  at: string /* "YYYY-MM-DDTHH:MM", hora de parede da cidade */; sigtapCode: string; notes: string; outcome: ReceptionOutcome | "";
  enrollment: EnrollmentDraft;
};

export function emptyReceptionDraft(now: Date, today: string, meId: string, procs: PsyProcedure[]): ReceptionDraft {
  return { at: cityLocalInput(now), sigtapCode: procs[0]?.code ?? "", notes: "", outcome: "", enrollment: emptyEnrollmentDraft(today, meId) };
}

// Tudo de uma vez; o bloco de matrícula só com `enrolled`, com os paths do api (`enrollment.<campo>`).
export function receptionProblems(d: ReceptionDraft, today: string, now: Date): Problem[] {
  const out: Problem[] = [];
  const at = parseCityLocal(d.at);
  if (!at) out.push({ path: "at", text: DATE_TIME_TEXT });
  else if (at.getTime() > now.getTime()) out.push({ path: "at", text: FUTURE_DATE_TEXT });
  else if (d.outcome === "enrolled" && d.at.slice(0, 10) < d.enrollment.startedOn) out.push({ path: "at", text: RECEPTION_BEFORE_START });
  if (!d.sigtapCode) out.push({ path: "sigtap_code", text: RECEPTION_PROCEDURE_TEXT });
  if (trimmedLength(d.notes) > 4000) out.push({ path: "notes", text: RECEPTION_NOTES_TEXT });
  if (!d.outcome) out.push({ path: "outcome", text: RECEPTION_OUTCOME_TEXT });
  if (d.outcome === "enrolled") {
    for (const p of enrollmentProblems(d.enrollment, today)) out.push({ path: `enrollment.${p.path}`, text: p.text });
  }
  return out;
}

// Opcionais vazios não vão (o api recusa `""`); a matrícula vai sem `health_unit_id`/`patient_id` (são os da recepção).
export function receptionInput(d: ReceptionDraft, unitId: string, patientId: string, referralId: string | null): PsyReceptionInput {
  const notes = d.notes.trim();
  const out: PsyReceptionInput = {
    health_unit_id: unitId, patient_id: patientId, ...(referralId ? { referral_id: referralId } : {}),
    at: cityLocalIso(d.at) ?? d.at, sigtap_code: d.sigtapCode, ...(notes ? { notes } : {}), outcome: d.outcome as ReceptionOutcome
  };
  if (d.outcome === "enrolled") {
    const { health_unit_id: _u, patient_id: _p, ...enrollment } = enrollmentInput(d.enrollment, unitId, patientId);
    out.enrollment = enrollment;
  }
  return out;
}

// `startedOn` da matrícula (quando a tela sabe): ação anterior a ele é recusada no participante (P40).
export type ParticipantDraft =
  | { kind: "enrollment"; enrollmentId: string; name: string; startedOn?: string }
  | { kind: "patient"; patientId: string; name: string }
  | { kind: "family"; name: string };
export type ActionDraft = {
  sigtapCode: string; performedAt: string /* "YYYY-MM-DDTHH:MM", hora de parede da cidade */; place: PsyPlace; quantity: string; notes: string;
  authorizationNumber: string; groupId: string | null; participants: ParticipantDraft[];
};

export function emptyActionDraft(now: Date): ActionDraft {
  return { sigtapCode: "", performedAt: cityLocalInput(now), place: "caps", quantity: "1", notes: "", authorizationNumber: "", groupId: null,
    participants: [] };
}

// Instrumento que o api vai decidir (P3), só para a crítica local: 09 com matriculado → RAAS; senão 02 → BPA-I; senão 01 → BPA-C.
export function procInstrument(proc: PsyProcedure, enrolled: boolean): "raas_psi" | "bpa_i" | "bpa_c" | "enrollment_required" | null {
  const codes = proc.instrument_codes;
  if (enrolled && codes.includes("09")) return "raas_psi";
  if (codes.includes("02")) return "bpa_i";
  if (codes.includes("01")) return "bpa_c";
  return codes.includes("09") ? "enrollment_required" : null;
}

export const AUTHORIZATION_TEXT = "o número de autorização tem 13 dígitos";
// Ações da matrícula (F-31.4).
export const ACTION_SAVED = "Ação registrada.";
export const ACTION_CANCELLED = "Ação cancelada.";
export const NO_ACTIONS = "nenhuma ação registrada nesta matrícula";
export const NO_OTHER_ENROLLMENTS = "nenhum outro usuário em acompanhamento neste CAPS";
// O api não diz se o mês da ação está fechado (só recusa com `lead_required`): a dica vai para quem não é coordenação.
export const CANCEL_LEAD_NOTE = "Com o mês fechado, só a coordenação do CAPS cancela.";
export const maxQuantityHint = (max: number): string => `máximo do SIGTAP: ${max}`;
// `enrollment_required` em `participants[i]` (P40): matrícula fechada, de outro CAPS ou iniciada depois da data da ação.
export const PARTICIPANT_NOT_ENROLLED = "este participante não tem matrícula aberta neste CAPS na data da ação";
const participantPath = (i: number) => `participants[${i}]`;
const MAX_PARTICIPANTS = 100;

// Crítica local (P23 na ordem do api, só o que a tela sabe): `proc` vem de `options.procedures` (já filtrado pelo CBO de quem lança);
// sem ele (ou com `max_quantity`, `requires_authorization` ou o início da matrícula ausentes), não restringe — o api critica na hora,
// todas de uma vez. Quantidade vazia vale 1 (o api usa 1 quando a chave falta). `competence` ("AAAAMM", de `options`): o máximo e a
// autorização são da SIGTAP daquela competência; ação de outro mês é criticada pelo api na competência dela.
export function actionProblems(d: ActionDraft, proc: PsyProcedure | undefined, now: Date, competence?: string): Problem[] {
  const out: Problem[] = [];
  const sigtap = !competence || d.performedAt.slice(0, 7).replace("-", "") === competence ? proc : undefined;
  if (!d.sigtapCode) out.push({ path: "sigtap_code", text: "escolha o procedimento" });
  const q = d.quantity.trim();
  const quantity = q === "" ? 1 : /^\d+$/.test(q) ? Number(q) : NaN;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    out.push({ path: "quantity", text: "a quantidade é um número inteiro de 1 a 999" });
  } else if (typeof sigtap?.max_quantity === "number" && quantity > sigtap.max_quantity) {
    out.push({ path: "quantity", text: `${PSY_ERRORS.quantity_exceeded} (máximo ${sigtap.max_quantity})` });
  }
  const at = parseCityLocal(d.performedAt);
  if (!at || at.getTime() > now.getTime()) out.push({ path: "performed_at", text: PSY_ERRORS.performed_in_future });
  // Como o api: a matrícula só conta se começou até o dia (local) da ação; a que começa depois é recusada na linha dela.
  const day = d.performedAt.slice(0, 10);
  const late = (p: ParticipantDraft) => p.kind === "enrollment" && !!p.startedOn && !!at && p.startedOn > day;
  const refused = d.participants.flatMap((p, i) => (late(p) ? [ i ] : []));
  refused.forEach((i) => out.push({ path: participantPath(i), text: PARTICIPANT_NOT_ENROLLED }));
  const enrolled = d.participants.some((p) => p.kind === "enrollment" && !late(p));
  if (proc && refused.length === 0 && procInstrument(proc, enrolled) === "enrollment_required") {
    out.push({ path: "participants", text: PSY_ERRORS.enrollment_required });
  }
  const auth = d.authorizationNumber.trim();
  if (auth !== "" && !/^\d{13}$/.test(auth)) out.push({ path: "authorization_number", text: AUTHORIZATION_TEXT });
  else if (auth === "" && sigtap?.requires_authorization === true) {
    out.push({ path: "authorization_number", text: PSY_ERRORS.authorization_required });
  }
  const seen = new Set<string>();
  d.participants.forEach((p, i) => {
    if (p.kind === "family") {
      if (proc && !proc.family_care) out.push({ path: `${participantPath(i)}.family_name`, text: PSY_ERRORS.family_only_for_family_care });
      else if (textProblem(p.name, 3, 120, "nome do familiar")) {
        out.push({ path: `${participantPath(i)}.family_name`, text: "nome do familiar: de 3 a 120 caracteres" });
      }
      return;
    }
    const key = p.kind === "enrollment" ? `e:${p.enrollmentId}` : `p:${p.patientId}`;
    if (seen.has(key)) out.push({ path: participantPath(i), text: "este participante está repetido" });
    seen.add(key);
  });
  if (d.participants.length > MAX_PARTICIPANTS) out.push({ path: "participants", text: `no máximo ${MAX_PARTICIPANTS} participantes por ação` });
  if (proc && procInstrument(proc, enrolled) === "bpa_i" && d.participants.filter((p) => p.kind !== "family").length !== 1) {
    out.push({ path: "participants", text: PSY_ERRORS.bpa_i_single_patient });
  }
  if (trimmedLength(d.notes) > 4000) out.push({ path: "notes", text: "a evolução tem até 4000 caracteres" });
  return out;
}


// Matriculado vai por `enrollment_id` (P40); opcionais vazios não vão (o api recusa `""`).
export function actionInput(d: ActionDraft, unitId: string): PsyActionInput {
  const notes = d.notes.trim();
  const auth = d.authorizationNumber.trim();
  return {
    health_unit_id: unitId, sigtap_code: d.sigtapCode, performed_at: cityLocalIso(d.performedAt) ?? d.performedAt, place: d.place,
    ...(d.quantity.trim() !== "" ? { quantity: Number(d.quantity.trim()) } : {}),
    ...(notes ? { notes } : {}), ...(auth ? { authorization_number: auth } : {}), ...(d.groupId ? { group_id: d.groupId } : {}),
    participants: d.participants.map((p) => (p.kind === "enrollment" ? { enrollment_id: p.enrollmentId }
      : p.kind === "patient" ? { patient_id: p.patientId } : { family_name: p.name.trim() }))
  };
}

// ─── Grupos e oficinas, presença e Hoje (F-31.4) ────────────────────────────
// Limites do api (`SaveGroup`): nome 1–120, dia ISO 1–7, "HH:MM" de parede da cidade com o fim depois do início, vagas 1–100, código
// SIGTAP de instrumento 09 ou 01. O api confere SIGTAP e responsável quando mudam ou na reativação (a tela não repete a conferência).
export const GROUP_NAME_TEXT = "o nome tem de 1 a 120 caracteres";
export const GROUP_TIME_TEXT = "confira o dia e o horário do grupo";
export const GROUP_ENDS_TEXT = "o fim precisa ser depois do início";
export const GROUP_CAPACITY_TEXT = "as vagas vão de 1 a 100";
export const GROUP_RESPONSIBLE_TEXT = "escolha um responsável lotado neste CAPS";
export const GROUP_PROCEDURE_TEXT = "escolha o procedimento do grupo";
export const GROUP_SAVED = "Grupo salvo.";
export const NO_GROUPS = "nenhum grupo ou oficina cadastrado neste CAPS";
export const NO_GROUP_PROCEDURES = "nenhum procedimento coletivo do SIGTAP serve para o seu CBO neste CAPS";
export const PRESENCE_NONE = "marque ao menos uma pessoa presente";
export const PRESENCE_SAVED = "Presença registrada.";
export const PRESENCE_DONE_TAG = "presença registrada";
export const PRESENCE_NOTE = "A presença vira uma ação do grupo, no horário dele, com um participante por pessoa marcada.";
export const TODAY_NO_NOTICE = "Nada daqui gera aviso ou SMS ao usuário.";
export const NO_GROUPS_TODAY = "nenhum grupo hoje";
export const NO_VISITS_TODAY = "nenhum atendimento marcado para hoje";

const HOUR_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;
const GROUP_INSTRUMENTS = [ "09", "01" ];
const GROUP_KINDS = [ "group", "workshop", "assembly" ];

export const groupSchedule = (g: { weekday: number; starts_at: string; ends_at: string }): string =>
  `${weekdayLabel(g.weekday)} · ${g.starts_at}–${g.ends_at}`;
export const presenceCount = (n: number, capacity: number): string =>
  `${n} ${n === 1 ? "presente" : "presentes"}${n > capacity ? ` · acima das ${capacity} vagas` : ""}`;
// Dia ISO (1 = segunda … 7 = domingo) de uma data "AAAA-MM-DD".
export const isoWeekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
// O último dia da semana do grupo até hoje (inclusive): a data padrão da presença na grade.
export const lastWeekday = (today: string, weekday: number): string => addDays(today, -((isoWeekday(today) - weekday + 7) % 7));
// Os procedimentos que o api aceita no grupo (instrumento 09 ou 01), coletivos primeiro.
export const groupProcedures = (o: PsyOptions): PsyProcedure[] => o.procedures
  .filter((p) => p.instrument_codes.some((c) => GROUP_INSTRUMENTS.includes(c)))
  .sort((a, b) => Number(b.collective) - Number(a.collective));

export type GroupDraft = {
  name: string; kind: string; weekday: string; startsAt: string; endsAt: string; responsibleUserId: string; capacity: string; sigtapCode: string;
  active: boolean;
};
export function emptyGroupDraft(today: string, meId: string, o: Pick<PsyOptions, "team">): GroupDraft {
  return { name: "", kind: "group", weekday: String(isoWeekday(today)), startsAt: "", endsAt: "",
    responsibleUserId: o.team.some((t) => t.user_id === meId) ? meId : "", capacity: "", sigtapCode: "", active: true };
}
export function groupDraftOf(g: PsyGroup): GroupDraft {
  return { name: g.name, kind: g.kind, weekday: String(g.weekday), startsAt: g.starts_at, endsAt: g.ends_at, responsibleUserId: g.responsible.user_id,
    capacity: String(g.capacity), sigtapCode: g.sigtap_code, active: g.active };
}
// Todas as recusas de uma vez, nos paths do api.
export function groupProblems(d: GroupDraft): Problem[] {
  const out: Problem[] = [];
  const n = trimmedLength(d.name);
  if (n < 1 || n > 120) out.push({ path: "name", text: GROUP_NAME_TEXT });
  if (!GROUP_KINDS.includes(d.kind)) out.push({ path: "kind", text: "escolha o tipo" });
  if (!/^[1-7]$/.test(d.weekday)) out.push({ path: "weekday", text: GROUP_TIME_TEXT });
  const starts = HOUR_FORMAT.test(d.startsAt);
  const ends = HOUR_FORMAT.test(d.endsAt);
  if (!starts) out.push({ path: "starts_at", text: GROUP_TIME_TEXT });
  if (!ends) out.push({ path: "ends_at", text: GROUP_TIME_TEXT });
  else if (starts && d.endsAt <= d.startsAt) out.push({ path: "ends_at", text: GROUP_ENDS_TEXT });
  if (!d.responsibleUserId) out.push({ path: "responsible_user_id", text: GROUP_RESPONSIBLE_TEXT });
  const cap = d.capacity.trim();
  if (!/^\d+$/.test(cap) || Number(cap) < 1 || Number(cap) > 100) out.push({ path: "capacity", text: GROUP_CAPACITY_TEXT });
  if (!d.sigtapCode) out.push({ path: "sigtap_code", text: GROUP_PROCEDURE_TEXT });
  return out;
}
export function groupInput(d: GroupDraft, unitId: string): PsyGroupInput {
  return { health_unit_id: unitId, name: d.name.trim(), kind: d.kind as PsyGroupKind, weekday: Number(d.weekday), starts_at: d.startsAt,
    ends_at: d.endsAt, responsible_user_id: d.responsibleUserId, capacity: Number(d.capacity.trim()), sigtap_code: d.sigtapCode };
}
// Só o que mudou (sem mudança, `{}`: o api devolve o grupo igual).
export function groupPatch(d: GroupDraft, g: PsyGroup): PsyGroupPatch {
  const full = groupInput(d, g.health_unit_id);
  const out: PsyGroupPatch = {};
  if (full.name !== g.name) out.name = full.name;
  if (full.kind !== g.kind) out.kind = full.kind;
  if (full.weekday !== g.weekday) out.weekday = full.weekday;
  if (full.starts_at !== g.starts_at) out.starts_at = full.starts_at;
  if (full.ends_at !== g.ends_at) out.ends_at = full.ends_at;
  if (full.responsible_user_id !== g.responsible.user_id) out.responsible_user_id = full.responsible_user_id;
  if (full.capacity !== g.capacity) out.capacity = full.capacity;
  if (full.sigtap_code !== g.sigtap_code) out.sigtap_code = full.sigtap_code;
  if (d.active !== g.active) out.active = d.active;
  return out;
}

export type CarePlanDraft = {
  needs: string; goals: { text: string; responsibleUserId: string; dueOn: string }[]; intensity: CareIntensity | ""; reviewOn: string;
};

// Limites do api (R14): necessidades 1–4000; 1 a 20 objetivos de 1–500 com responsável; revisão depois de hoje e até hoje + 365.
export function carePlanProblems(d: CarePlanDraft, today: string): Problem[] {
  const out: Problem[] = [];
  if (textProblem(d.needs, 1, 4000, "")) out.push({ path: "needs", text: "problemas e necessidades: de 1 a 4000 caracteres" });
  if (d.goals.length < 1 || d.goals.length > 20) out.push({ path: "goals", text: "o PTS tem de 1 a 20 objetivos" });
  d.goals.forEach((g, i) => {
    if (textProblem(g.text, 1, 500, "")) out.push({ path: `goals[${i}].text`, text: "objetivo: de 1 a 500 caracteres" });
    if (!g.responsibleUserId) out.push({ path: `goals[${i}].responsible_user_id`, text: "escolha o responsável pelo objetivo" });
  });
  if (!d.intensity) out.push({ path: "intensity", text: "escolha a frequência proposta" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.reviewOn) || d.reviewOn <= today || d.reviewOn > addDays(today, 365)) {
    out.push({ path: "review_on", text: "a revisão precisa ser depois de hoje e em até 365 dias" });
  }
  return out;
}

export function carePlanInput(d: CarePlanDraft): PsyCarePlanInput {
  return {
    needs: d.needs.trim(), intensity: d.intensity as CareIntensity, review_on: d.reviewOn,
    goals: d.goals.map((g) => ({ text: g.text.trim(), responsible_user_id: g.responsibleUserId, ...(g.dueOn ? { due_on: g.dueOn } : {}) }))
  };
}

// ─── Usuários do CAPS: lista, matrícula, encerramento e PTS (F-31.2, F-31.3) ───
// Prazo do PTS: `options.care_plan_review_days` (a equipe não lê `GET /settings`, P33); esta é a reserva quando o campo falta.
// O api confere a data da revisão (depois de hoje, até hoje + 365).
export const DEFAULT_CARE_PLAN_REVIEW_DAYS = 90;
export const reviewDaysOf = (o: { care_plan_review_days?: number | null } | null | undefined): number => {
  const d = o?.care_plan_review_days;
  return typeof d === "number" && Number.isInteger(d) && d > 0 ? d : DEFAULT_CARE_PLAN_REVIEW_DAYS;
};
// A matrícula aberta no acolhimento e o CAPS dela, levados a "Usuários do CAPS" (só no estado do shell, nunca na URL).
export type PsyEnrollmentHandoff = { enrollmentId: string; unitId: string };
export const ENROLLMENT_UPDATED = "Matrícula atualizada.";
export const ENROLLMENT_CLOSED = "Matrícula encerrada.";
export const CARE_PLAN_SAVED = "Nova versão do PTS salva.";
// P37: PATCH vazio é recusado (422 invalid_request); a tela não envia.
export const NOTHING_CHANGED = "nada mudou — altere algum campo antes de salvar";
export const CLOSE_NOTE = "Encerrar fecha a RAAS do mês com o destino.";
export const CLOSE_DESTINATION_TEXT = "escolha o destino do usuário";
export const CLOSE_DATE_TEXT = "confira a data de conclusão";
export const CLOSE_BEFORE_START = "o encerramento não pode ser antes do início";
export const NEXT_VISIT_TEXT = "confira a data e a hora do próximo atendimento";
export const CARE_PLAN_OVERDUE_TAG = "PTS vencido";
export const NO_CARE_PLAN = "sem PTS";
export const NO_CARE_PLAN_YET = "esta matrícula ainda não tem PTS";
export const NO_CARE_PLAN_DUE = "sem PTS — o prazo do primeiro PTS já passou";
export const RESPONSIBLE_OUT = "responsável fora da equipe";
export const NO_OPEN_ENROLLMENTS = "nenhum usuário em acompanhamento neste CAPS";
export const NO_CLOSED_ENROLLMENTS = "nenhuma matrícula encerrada neste CAPS";
export const NO_NAME_MATCH = "ninguém com este nome na lista";
export const ENROLLMENT_OTHER_CAPS = "esta matrícula é de outro CAPS — escolha o CAPS dela no seletor acima";
// `GET /care_plans/due` (P16): a coordenação vê o CAPS inteiro; os demais, só as matrículas em que são referência.
export const DUE_LEAD_NOTE = "Revisões vencidas de todo o CAPS.";
export const DUE_STAFF_NOTE = "Revisões vencidas das matrículas em que você é a referência.";

// R4: o api não manda `care_plan_overdue`; vencido = revisão antes de hoje.
export const carePlanOverdue = (reviewOn: string | null | undefined, today: string): boolean => !!reviewOn && reviewOn < today;
// Sem PTS, o primeiro vence quando a matrícula começou há mais do prazo (`care_plan_review.rb`: início < hoje − dias).
export const firstCarePlanLate = (startedOn: string, today: string, days: number): boolean => addDays(startedOn, days) < today;
export const dueText = (reviewOn: string | null): string => (reviewOn ? `revisão vencida em ${fmtDay(reviewOn)}` : NO_CARE_PLAN_DUE);
export const carePlanTitle = (version: number, reviewOn: string, overdue: boolean): string =>
  overdue ? `Versão ${version} · revisão vencida em ${fmtDay(reviewOn)}` : `Versão ${version}`;
// Nome por busca local: sem acento e sem caixa.
export const foldName = (v: string): string => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
// O mesmo CID com ou sem ponto ("F322" = "F32.2").
export const cidKey = (code: string): string => code.trim().toUpperCase().replace(/\./g, "");

// Rascunho da edição a partir do detalhe (o CID vem sem rótulo: a tela mostra o código com ponto, R5).
export function enrollmentDraftOf(e: PsyEnrollment): EnrollmentDraft {
  return {
    startedOn: e.started_on, origin: e.origin, cidMain: e.cid_main ? { code: e.cid_main, label: "" } : null,
    cidSecondary: e.cid_secondary.map((code) => ({ code, label: "" })), substances: [ ...e.substances ], esfCovered: e.esf_covered,
    esfCnes: e.esf_cnes ?? "", referenceUserId: e.reference.user_id
  };
}
export const nextVisitInput = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : cityLocalInput(d);
};

// As regras da matrícula, menos o piso do início quando ele não mudou: o api aceita o início reenviado igual sem conferir o piso.
export function enrollmentEditProblems(d: EnrollmentDraft, nextVisit: string, original: PsyEnrollment, today: string): Problem[] {
  const out = enrollmentProblems(d, today).filter((p) => !(p.path === "started_on" && d.startedOn === original.started_on));
  if (nextVisit !== "" && !parseCityLocal(nextVisit)) out.push({ path: "next_visit_at", text: NEXT_VISIT_TEXT });
  return out;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [ ...a ].sort().join("|") === [ ...b ].sort().join("|");
// Só o que mudou (P37). Sem cobertura de ESF, `esf_cnes` não vai (o api apaga o CNES).
export function enrollmentPatch(d: EnrollmentDraft, nextVisit: string, o: PsyEnrollment): PsyEnrollmentPatch {
  const out: PsyEnrollmentPatch = {};
  if (d.startedOn !== o.started_on) out.started_on = d.startedOn;
  if (d.origin !== o.origin) out.origin = d.origin;
  if (d.cidMain && cidKey(d.cidMain.code) !== cidKey(o.cid_main)) out.cid_main = d.cidMain.code;
  if (!sameSet(d.cidSecondary.map((c) => cidKey(c.code)), o.cid_secondary.map(cidKey))) out.cid_secondary = d.cidSecondary.map((c) => c.code);
  if (!sameSet(d.substances, o.substances)) out.substances = d.substances;
  if (d.esfCovered !== o.esf_covered) out.esf_covered = d.esfCovered;
  if (d.esfCovered && d.esfCnes.trim() !== (o.esf_cnes ?? "")) out.esf_cnes = d.esfCnes.trim();
  if (d.referenceUserId !== o.reference.user_id) out.reference_user_id = d.referenceUserId;
  if (nextVisit !== nextVisitInput(o.next_visit_at)) out.next_visit_at = nextVisit ? cityLocalIso(nextVisit) ?? nextVisit : null;
  return out;
}

// Encerramento: tudo de uma vez; o mês fechado é do api.
export function closeProblems(d: { destination: string; closedOn: string }, today: string, startedOn: string): Problem[] {
  const out: Problem[] = [];
  if (!d.destination) out.push({ path: "destination", text: CLOSE_DESTINATION_TEXT });
  else if (d.destination === "00") out.push({ path: "destination", text: PSY_ERRORS.destination_is_permanence });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.closedOn)) out.push({ path: "closed_on", text: CLOSE_DATE_TEXT });
  else if (d.closedOn > today) out.push({ path: "closed_on", text: PSY_ERRORS.closed_on_in_future });
  else if (d.closedOn < startedOn) out.push({ path: "closed_on", text: CLOSE_BEFORE_START });
  return out;
}

// Inteiros: janela 7–90 dias; noites 1–90; prazo do PTS 30–365 dias (api, R14).
export function settingsProblems(s: PsySettings): Problem[] {
  const out: Problem[] = [];
  const int = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
  for (const [ modality, limits ] of Object.entries(s.night_limits) as [ string, Record<string, number> ][]) {
    for (const [ key, value ] of Object.entries(limits)) {
      const path = `night_limits.${modality}.${key}`;
      if (key === "window_days") { if (!int(value, 7, 90)) out.push({ path, text: "a janela vai de 7 a 90 dias" }); }
      else if (!int(value, 1, 90)) out.push({ path, text: "o limite de noites vai de 1 a 90" });
    }
  }
  if (!int(s.care_plan_review_days, 30, 365)) out.push({ path: "care_plan_review_days", text: "o prazo de revisão do PTS vai de 30 a 365 dias" });
  return out;
}

// ─── Recusas do api ─────────────────────────────────────────────────────────
// Um código → uma frase. O que muda com o `path` fica em PATH_TEXT; `invalid_request`/`too_long` em FIELD_TEXT; `night_limit_reached` em
// `nightLimitText`. Código que o api não manda (ou que ainda não tem frase) aparece como "recusado pelo servidor (<código>)".
export const PSY_ERRORS: Record<string, string> = {
  // Portão, papel e lotação
  not_on_caps_team: "você não está lotado neste CAPS — o vínculo CNES ativo na unidade é que dá acesso",
  missing_role: "seu papel não permite esta ação",
  lead_required: "só a coordenação do CAPS pode fazer isso",
  not_author: "só quem registrou a ação emite documentos dela",
  out_of_context: "fora do atendimento, abra o prontuário com motivo para ver isto",
  unauthenticated: "sua sessão terminou — entre de novo",
  mfa_required: "confirme sua identidade com o código do autenticador e tente de novo",
  not_found: "não encontrado — a tela foi atualizada",
  // Cadastro de unidade (/attendance/units; P34, P53) e CAPS fora de outros módulos (P32, P51)
  caps_modality_mismatch: "a modalidade só vale para unidade do tipo CAPS, e todo CAPS precisa dela",
  invalid_service_classification: "a classificação do serviço 115 tem 3 dígitos",
  invalid_phone: PHONE_TEXT,
  unit_has_caps_records: "esta unidade já tem registros do CAPS — não pode deixar de ser CAPS",
  caps_has_beds: "este CAPS tem leitos ativos — desative os leitos antes de passar para uma modalidade sem acolhimento noturno",
  unit_has_attendances: "a unidade já tem histórico de atendimento, cobertura ou prestador",
  caps_unit_not_allowed: "esta unidade é um CAPS e não serve para esta operação — escolha outra unidade",
  // Leitos e acolhimento noturno
  caps_without_beds: "só CAPS III, CAPS AD III e CAPS AD IV têm leitos",
  bed_label_taken: "já existe um leito com este nome neste CAPS",
  bed_taken: "este leito já está ocupado nesse período",
  already_staying: "este usuário já está em outra permanência aberta",
  night_stay_open: "o usuário está num leito do acolhimento noturno — registre a saída antes de encerrar a matrícula",
  // Busca de pessoa (P30)
  person_not_found: "não encontramos ninguém com este CPF ou CNS",
  invalid_cpf: "CPF inválido — confira os 11 dígitos",
  invalid_cns: "CNS inválido — confira os 15 dígitos",
  citizen_not_verified: "o CPF ainda não foi conferido no cadastro nacional — tente de novo mais tarde",
  too_many_requests: "muitas buscas em pouco tempo — espere um minuto",
  // Encaminhamento, acolhimento e matrícula
  referral_not_pending: "este encaminhamento já foi acolhido — a fila foi atualizada",
  enrollment_open: "este usuário já tem matrícula aberta neste CAPS",
  esf_cnes_required: "informe o CNES da USF que cobre o usuário (7 dígitos)",
  origin_locked: "origem e início só mudam antes da primeira RAAS exportada",
  started_after_actions: "o início não pode passar da primeira ação registrada desta matrícula",
  closed_on_in_future: "a data de encerramento não pode ser futura",
  destination_is_permanence: "escolha o destino do usuário — permanência não encerra a matrícula",
  already_closed: "isto já foi encerrado — a tela foi atualizada",
  // Ação e crítica do SIGTAP (P23; `action_rejected` é o topo e vem com a lista)
  action_rejected: "a ação foi recusada na crítica do SIGTAP — confira os campos destacados",
  instrument_mismatch: "o instrumento deste procedimento no SIGTAP (RAAS-PSI, BPA-I ou BPA-C) não serve para este registro",
  cbo_incompatible: "o seu CBO neste CAPS não é compatível com este procedimento no SIGTAP",
  quantity_exceeded: "a quantidade passa do máximo do SIGTAP para este procedimento",
  performed_in_future: "a data da ação não pode ser futura",
  month_closed: "o mês desta ação está fechado — só a coordenação do CAPS corrige, reabrindo o mês",
  enrollment_required: "ação de RAAS precisa de ao menos um participante com matrícula aberta",
  authorization_required: "este procedimento exige o número de autorização (13 dígitos)",
  family_only_for_family_care: "familiar sem cadastro só entra no atendimento familiar",
  bpa_i_single_patient: "este procedimento vai na BPA-I: registre um usuário por ação",
  already_cancelled: "isto já estava cancelado — a tela foi atualizada",
  // Documentos pela ação (P8, P47, P50)
  prescriber_required: "o documento sai só de atendimento individual, com um usuário matriculado, por médico (CBO 2251, 2252 ou 2253)",
  invalid_content: "o conteúdo do documento está incompleto ou é de um tipo que o CAPS não emite",
  // RAAS do mês, remessa e fichas (P14, P15, P43)
  month_has_problems: "o mês tem pendências — resolva a lista antes de fechar",
  month_open: "o mês ainda está aberto — a remessa e as fichas do faturamento saem só depois do fechamento",
  record_not_open: "o registro deste mês não está mais aberto — a tela foi atualizada",
  already_exported: "a remessa deste mês já foi gerada — não dá mais para mudar",
  raas_layout_unavailable: "o layout oficial da remessa RAAS ainda não foi homologado — use as fichas espelho para digitar no aplicativo RAAS",
  nothing_to_export: "nenhum registro do mês tem ação de RAAS — não há remessa a gerar",
  integrity_mismatch: "o arquivo não confere com o gerado — avise a coordenação",
  // Leitura
  invalid_cursor: "a lista mudou enquanto você rolava — a tela foi atualizada",
  invalid_kinds: "filtro da linha do tempo inválido — recarregue a tela",
  // Forma (o texto por campo vem de FIELD_TEXT)
  invalid_request: "pedido inválido — recarregue a tela e tente de novo",
  too_long: "o texto passou do tamanho máximo"
};

// Frase que depende do `path` (o mesmo código em telas diferentes).
const PATH_TEXT: Record<string, [ RegExp, string ][]> = {
  month_closed: [
    [ /(^|\.)started_on$/, "o início da matrícula cai num mês já fechado — a coordenação do CAPS precisa reabrir o mês" ],
    [ /^closed_on$/, "o encerramento cai num mês já fechado — a coordenação do CAPS precisa reabrir o mês" ],
    [ /^started_at$/, "a entrada no leito cai num mês já fechado — a coordenação do CAPS precisa reabrir o mês" ],
    [ /^ended_at$/, "a permanência tem noite num mês já fechado — a coordenação do CAPS precisa reabrir o mês" ]
  ],
  enrollment_required: [
    [ /^participants\[\d+\]$/, PARTICIPANT_NOT_ENROLLED ],
    [ /^enrollment_id$/, "a matrícula não está aberta, ou começa depois da entrada no leito" ],
    [ /^at$/, RECEPTION_BEFORE_START ]
  ],
  performed_in_future: [ [ /^(at|held_on)$/, FUTURE_DATE_TEXT ] ]
};

// `invalid_request` e `too_long` por campo (o último segmento do path, sem índice; ou o path inteiro).
const FIELD_TEXT: [ RegExp, string ][] = [
  [ /^reassessment\.reason$/, REASON_TEXT ],
  // Motivo: 10–500 (reabrir, sair do leito) ou 10–2000 (cancelar ação, encaminhar) — a frase vale para os dois.
  [ /^reason$/, "o motivo tem pelo menos 10 caracteres e não pode passar do limite" ],
  [ /^notes$/, "a evolução tem até 4000 caracteres" ],
  [ /^needs$/, "problemas e necessidades: de 1 a 4000 caracteres" ],
  [ /^goals\[\d+\]\.text$/, "objetivo: de 1 a 500 caracteres" ],
  [ /^goals\[\d+\]\.responsible_user_id$/, "escolha um responsável lotado neste CAPS" ],
  [ /^goals\[\d+\]\.due_on$/, "o prazo do objetivo precisa ser uma data válida" ],
  [ /^goals$/, "o PTS tem de 1 a 20 objetivos" ],
  [ /^topic$/, "o tema tem de 1 a 200 caracteres" ],
  [ /^shared_text$/, "o texto compartilhado tem de 10 a 2000 caracteres" ],
  [ /^participants\[\d+\]\.family_name$/, "nome do familiar: de 3 a 120 caracteres" ],
  [ /^participants\[\d+\]$/, "este participante está repetido ou não existe" ],
  [ /^participants$/, `no máximo ${MAX_PARTICIPANTS} participantes por ação` ],
  [ /^participants_user_ids$/, "escolha de 1 a 20 participantes lotados neste CAPS" ],
  [ /^name$/, GROUP_NAME_TEXT ],
  [ /^label$/, "o nome do leito tem de 1 a 20 caracteres" ],
  [ /^capacity$/, GROUP_CAPACITY_TEXT ],
  [ /^quantity$/, "a quantidade é um número inteiro de 1 a 999" ],
  [ /^authorization_number$/, AUTHORIZATION_TEXT ],
  [ /^care_plan_review_days$/, "o prazo de revisão do PTS vai de 30 a 365 dias" ],
  [ /^night_limits\.[a-z_]+\.window_days$/, "a janela vai de 7 a 90 dias" ],
  [ /^night_limits(\.|$)/, "o limite de noites vai de 1 a 90" ],
  [ /(^|\.)started_on$/, "o início vai até 12 meses para trás, nunca futuro nem antes do nascimento" ],
  [ /^closed_on$/, CLOSE_BEFORE_START ],
  [ /^next_visit_at$/, NEXT_VISIT_TEXT ],
  [ /^destination$/, "escolha um destino da lista" ],
  [ /(^|\.)origin$/, "escolha uma origem da lista" ],
  [ /(^|\.)cid_main$/, "CID principal inválido — escolha um da lista" ],
  [ /(^|\.)cid_secondary$/, "no máximo 4 CIDs secundários, todos da lista" ],
  [ /(^|\.)substances$/, "marque as substâncias ou nenhuma (nenhuma não combina com outra)" ],
  [ /(^|\.)esf_cnes$/, "o CNES da USF tem 7 dígitos e só vai com cobertura de ESF" ],
  [ /(^|\.)reference_user_id$/, "escolha um técnico de referência lotado neste CAPS" ],
  [ /^responsible_user_id$/, GROUP_RESPONSIBLE_TEXT ],
  [ /^review_on$/, "a revisão precisa ser depois de hoje e em até 365 dias" ],
  [ /^intensity$/, "escolha a frequência proposta" ],
  [ /^ends_at$/, GROUP_ENDS_TEXT ],
  [ /^(starts_at|weekday)$/, GROUP_TIME_TEXT ],
  [ /^started_at$/, "a entrada vai até 12 horas a partir de agora" ],
  [ /^expected_end_at$/, "a saída prevista é depois da entrada, em até 30 dias" ],
  [ /^ended_at$/, "a saída é depois da entrada e nunca futura" ],
  [ /^bed_id$/, "escolha um leito ativo deste CAPS" ],
  [ /^held_on$/, "a data do matriciamento não pode ser futura" ],
  [ /^health_team_id$/, "escolha a equipe da atenção básica" ],
  [ /^(performed_at|at)$/, DATE_TIME_TEXT ],
  [ /^health_unit_id$/, "escolha um CAPS ativo" ],
  [ /^month$/, "mês inválido ou futuro" ],
  [ /^homeless$/, "marque se o usuário estava em situação de rua no mês" ],
  [ /^(cpf|cns)$/, "informe o CPF ou o CNS" ]
];

// Texto base do brief; R20 só acrescenta o tipo do CAPS III ("seguidas" ou "intercaladas"). Janela de `window_days` (30 sem ela).
export function nightLimitText(d: { used: number; limit: number; window_days?: number | null; rule?: string | null }): string {
  const kind = d.rule === "consecutive" ? "seguidas " : d.rule === "alternate" ? "intercaladas " : "";
  return `limite de noites atingido: ${d.used} de ${d.limit} ${kind}na janela de ${d.window_days ?? 30} dias — só a coordenação passa, com reavaliação`;
}

export type PsyRefusal = Refusal & { participantIndex: number | null };
const OFFLINE_TEXT = "não foi possível falar com o servidor — tente de novo";

function bodyOf(err: unknown): Record<string, unknown> | null {
  const b = err instanceof ApiError ? err.body : null;
  return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
// Só código e path no formato do api saem do corpo; qualquer outra coisa (nome, texto, mensagem) fica fora da tela.
const CODE_FORMAT = /^[a-z0-9_]{1,64}$/;
// Hífen: o `month_has_problems` manda `records.<uuid>`.
const PATH_FORMAT = /^[a-z0-9_.[\]-]{1,64}$/;
const safeCode = (v: unknown): string => (typeof v === "string" && CODE_FORMAT.test(v) ? v : "");
const safePath = (v: unknown): string => (typeof v === "string" && PATH_FORMAT.test(v) ? v : "");

// Frase de um código num path. `MONTH_PROBLEM_TEXT` cobre a lista do `month_has_problems` (path `records.<id>`).
function codeText(code: string, path: string, status: number): string {
  if (code === "invalid_request" || code === "too_long") return FIELD_TEXT.find(([ re ]) => re.test(path))?.[1] ?? PSY_ERRORS[code];
  // `night_stay_open` é pendência no mês e recusa no encerramento: no registro do mês, vale a frase da pendência.
  if (path.startsWith("records.") && Object.prototype.hasOwnProperty.call(MONTH_PROBLEM_TEXT, code)) return MONTH_PROBLEM_TEXT[code];
  const byPath = PATH_TEXT[code]?.find(([ re ]) => re.test(path));
  if (byPath) return byPath[1];
  if (Object.prototype.hasOwnProperty.call(PSY_ERRORS, code)) return PSY_ERRORS[code];
  if (code === "" && status === 404) return PSY_ERRORS.not_found;
  return `recusado pelo servidor (${code || status})`;
}

// A frase de um código num path (quem remapeia o path de uma recusa recalcula a frase).
export const psyCodeText = (code: string, path: string, status = 422): string => codeText(safeCode(code), safePath(path), status);

// "participants[2]" ou "participants[2].family_name" → 2.
export const indexFromPath = (path: string): number | null => {
  const m = /^participants\[(\d+)\]/.exec(path);
  return m ? Number(m[1]) : null;
};

// Todas as recusas, traduzidas: uma por `problems[]` (chave `error`, ou `code` por tolerância), com o índice do participante
// (`participant_index`, senão o de `participants[i]`); sem `problems` válidos, a do topo.
export function psyRefusals(err: unknown): PsyRefusal[] {
  const feature = featureDisabledKey(err);
  if (feature !== null) {
    const text = feature === "" || feature === "psychosocial_care" ? PSY_DISABLED : `${featureLabel(feature)} está desligado nesta cidade`;
    return [ { path: "", code: "feature_disabled", text, participantIndex: null } ];
  }
  if (!(err instanceof ApiError)) return [ { path: "", code: "", text: OFFLINE_TEXT, participantIndex: null } ];
  const body = bodyOf(err);
  const raw = errorCode(err);
  const code = safeCode(raw);
  // Código fora do formato: frase genérica, sem eco.
  if (raw && !code) return [ { path: "", code: "", text: "recusado pelo servidor", participantIndex: null } ];
  if (code === "night_limit_reached") {
    const used = num(body?.used);
    const limit = num(body?.limit);
    const text = used !== null && limit !== null
      ? nightLimitText({ used, limit, window_days: num(body?.window_days), rule: typeof body?.rule === "string" ? body.rule : null })
      : "limite de noites atingido — só a coordenação passa, com reavaliação";
    return [ { path: "", code, text, participantIndex: null } ];
  }
  const list = Array.isArray(body?.problems) ? body.problems : [];
  const mapped = list.flatMap((raw): PsyRefusal[] => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const given = typeof row.error === "string" ? row.error : typeof row.code === "string" ? row.code : "";
    if (!given) return [];
    const c = safeCode(given);
    const path = safePath(row.path);
    if (!c) return [ { path, code: "", text: "recusado pelo servidor", participantIndex: null } ];
    const index = num(row.participant_index);
    return [ { path, code: c, text: codeText(c, path, err.status), participantIndex: index !== null ? index : indexFromPath(path) } ];
  });
  if (mapped.length > 0) return mapped;
  const path = safePath(body?.path);
  return [ { path, code, text: codeText(code, path, err.status), participantIndex: indexFromPath(path) } ];
}

export function psyError(err: unknown): string {
  return psyRefusals(err)[0].text;
}

// A tela está velha (o item sumiu ou já foi acolhido): quem chama relê a lista e fecha o detalhe.
export const isStale = (err: unknown): boolean => [ "not_found", "referral_not_pending" ].includes(errorCode(err) ?? "");

// ─── Frases fixas das regras e dos leitos da cidade (Task 4) ────────────────
export const CAPS_III_NOTE = "Os limites do CAPS III estão a confirmar na norma (gate do go-live).";
export const SETTINGS_SAVED = "Regras salvas.";
export const BED_ADDED = "Leito adicionado.";
export const BED_DEACTIVATED = "Leito desativado.";
export const BED_REACTIVATED = "Leito reativado.";
export const NO_NIGHT_CAPS = "Nenhum CAPS ativo com acolhimento noturno cadastrado (só CAPS III, CAPS AD III e CAPS AD IV têm leitos).";

// ─── Documentos pela ação (Task 8; F-31.4, decisão 19; P8, P47, P50, P58) ──────
// Receita, registro da Notificação (sempre papel, sem SNCR) e atestado, pelo fluxo do 19/19d. Quem decide é o api (`not_author`,
// `prescriber_required`, `already_cancelled`); a tela só mostra o botão a quem ele aceitaria.
export const PSY_DOCUMENTS_NOTE = "Receita, notificação e atestado saem só do atendimento individual, com um usuário matriculado, por médico (quem registrou a ação).";
export const PSY_NOTIFICATION_RECORDED = "Notificação de papel registrada na ação. Guarde o talão; nada é impresso aqui.";
export const PSY_NO_DOCUMENTS = "nenhum documento emitido nesta ação";

type DocAction = Pick<PsyAction, "cancelled" | "professional" | "participants">;

// O próprio atendimento individual (um participante, matriculado), não cancelado, de médico (CBO 2251/2252/2253).
export function canIssuePsyDocument(a: DocAction, userId: string | null | undefined): boolean {
  if (!userId || a.cancelled || a.professional.user_id !== userId || !isPrescriber(a.professional.cbo_code)) return false;
  const [ only, ...rest ] = a.participants;
  return !!only && rest.length === 0 && "enrollment_id" in only && !!only.enrollment_id;
}

// A autora cancela o próprio; a coordenação lotada cancela o de outra profissional do CAPS (P47 E1).
export function canCancelPsyDocument(doc: Pick<ClinicalDocument, "status" | "author">, userId: string | null | undefined, roles: Pick<PsyRoles, "lead">): boolean {
  return !!userId && doc.status === "issued" && (doc.author.id === userId || roles.lead);
}

// Recusa da emissão: as do CAPS (rota /psychosocial, autoria, prescritor, ação cancelada, tipo) pela frase do CAPS; as do 19c/19d
// (conteúdo, item, SNCR, catálogo) pela frase do 19.
const PSY_DOCUMENT_CODES = [ "prescriber_required", "not_author", "already_cancelled", "not_found", "missing_role", "not_on_caps_team", "invalid_request" ];
export function psyDocumentError(err: unknown, opts: { controlled?: boolean } = {}): string {
  if (featureDisabledKey(err) === "psychosocial_care") return psyError(err);
  const code = errorCode(err) ?? "";
  const field = bodyOf(err)?.field ?? null;
  if (PSY_DOCUMENT_CODES.includes(code) || (code === "invalid_content" && field === "kind")) return psyError(err);
  return documentError(err, opts);
}
