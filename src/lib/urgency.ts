// Regras de tela da urgência na UPA (módulo 32a; ADR 0050; contrato 2026-11-05 §1–§11 e §14 Q1–Q30) sem React. Quem decide é o
// api (Urgency::Catalog, Access, Classify, RecordOutcome; WaitingRoom::*): a tela só não envia o que já sabe que será recusado, com os
// mesmos limites e os mesmos `path`. Nenhuma frase interpola nome, CPF, CNS, queixa, CID ou a descrição de quem não foi identificado.
import {
  ApiError, errorCode,
  type NewPatient, type ProfessionalLink, type UrgencyArrivalInput, type UrgencyClassificationInput, type UrgencyColor,
  type UrgencyConsultationStatus, type UrgencyCount, type UrgencyLevel, type UrgencyOutcomeInput, type UrgencyOutcomeKind,
  type UrgencyPatientRef, type UrgencyTime, type VitalSigns
} from "./api";
import { attendanceError } from "./attendance";
import { NOMINAL_QUERY } from "./careLines";
import { featureDisabledKey, hasFeature } from "./features";
import type { Problem, Refusal } from "./pharmacy";
import { SCREENING_NOT_IN_UPA, VITALS, parseVitals, screeningError, type VitalsForm } from "./screening";
import { CNS_TEXT, CPF_TEXT, newPatientProblem } from "./territoryDictionaries";
import type { Tone } from "../theme/tokens";

export { NOMINAL_QUERY };

// ─── Frases fixas ───────────────────────────────────────────────────────────
export const URGENCY_DISABLED = "a urgência está desligada nesta cidade";
export const WAITING_ROOM_DISABLED = "o painel da sala de espera está desligado nesta cidade";
export const NO_CLINICAL_IN_LIST = "A fila não mostra queixa, sinais, CID nem a descrição de quem não foi identificado.";
export const PRIORITY_PHRASE = "Quem corre mais risco é atendido primeiro, mesmo que tenha chegado depois.";
export const SMALL_COUNT = "menos de 5";
const OFFLINE_TEXT = "sem conexão com o servidor — tente de novo";

// ─── Chaves de consulta e intervalos ────────────────────────────────────────
export const URGENCY_QUEUE_KEY = "urgencyQueue";
export const URGENCY_DETAIL_KEY = "urgencyDetail";
export const CALL_LOCATIONS_KEY = "callLocations";
export const DISPLAYS_KEY = "waitingRoomDisplays";
export const URGENCY_DASHBOARD_KEY = "urgencyDashboard";
export const COUNTER_REFERRALS_KEY = "counterReferrals";
export const URGENCY_QUEUE_POLL_MS = 10_000;
export const WAITING_ROOM_POLL_MS = 5_000;

// ─── Portões e papéis ───────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// §1: `urgency_care` exige `clinical_record` (sem cascata: a sessão traz as duas); nunca o operador da plataforma.
export function canUseUrgency(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "urgency_care") && hasFeature(user, "clinical_record");
}
// `waiting_room_display` é independente (vale também na UBS).
export function canUseWaitingRoom(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "waiting_room_display");
}
export const isUpa = (unit: { kind: string }): boolean => unit.kind === "upa";

// Q2: só o enfermeiro (2235*) classifica; o técnico (3222) recebe cbo_not_allowed. O médico é 225*.
const NURSE_CBO = /^2235/;
const DOCTOR_CBO = /^225/;

export type UrgencyRoles = {
  reception: boolean; nurse: boolean; doctor: boolean;
  // A8: só a recepção identifica o provisório.
  identify: boolean;
  // Q10/Q25: quem registra ao menos os desfechos de balcão (DESK_OUTCOMES).
  outcomeDesk: boolean;
};

// O vínculo conta só ativo (sem `ended_at`), na unidade e com o papel `health_professional`.
export function urgencyRoles(user: SessionLike, links: ProfessionalLink[], unitId: string): UrgencyRoles {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  const professional = roles.includes("health_professional");
  const active = professional ? links.filter((l) => l.health_unit_id === unitId && !l.ended_at) : [];
  const reception = roles.includes("citizen_verifier");
  const nurse = active.some((l) => NURSE_CBO.test(l.cbo_code));
  const doctor = active.some((l) => DOCTOR_CBO.test(l.cbo_code));
  return { reception, nurse, doctor, identify: reception, outcomeDesk: reception || nurse || doctor };
}

// ─── Cores ──────────────────────────────────────────────────────────────────
const pick = (map: Record<string, string>) => (code: string): string => (Object.prototype.hasOwnProperty.call(map, code) ? map[code] : code);

// §1: ordem de prioridade.
export const URGENCY_COLORS: UrgencyColor[] = [ "red", "orange", "yellow", "green", "blue" ];
export const URGENCY_COLOR_LABEL: Record<UrgencyColor, string> = { red: "vermelho", orange: "laranja", yellow: "amarelo", green: "verde", blue: "azul" };
// Q15/D22: o tema não tem laranja; o tom de urgente vai sempre com o texto "laranja".
export const URGENCY_COLOR_TONE: Record<UrgencyColor, Tone> = { red: "down", orange: "urgent", yellow: "warn", green: "ok", blue: "info" };
export const DEFAULT_LEVELS: UrgencyLevel[] = [
  { color: "red", max_wait_minutes: 0 }, { color: "orange", max_wait_minutes: 10 }, { color: "yellow", max_wait_minutes: 60 },
  { color: "green", max_wait_minutes: 120 }, { color: "blue", max_wait_minutes: 240 }
];
export const colorLabel = pick(URGENCY_COLOR_LABEL);
export const maxWaitLabel = (min: number): string => (min === 0 ? "imediato" : `até ${min} min`);

// ─── Desfechos ──────────────────────────────────────────────────────────────
// §7 + Q25, na ordem do api (Urgency::Catalog::OUTCOMES).
export const OUTCOME_KINDS: UrgencyOutcomeKind[] = [
  "discharged", "discharged_to_primary_care", "transferred", "left_without_care", "left_against_advice", "death", "registered_in_error"
];
// Os mesmos textos do profissional no api (Timeline::Sources::Labels::URGENCY_OUTCOMES).
export const OUTCOME_KIND_LABEL: Record<UrgencyOutcomeKind, string> = {
  discharged: "Alta", discharged_to_primary_care: "Alta com retorno na UBS", transferred: "Transferência",
  left_without_care: "Saiu sem atendimento", left_against_advice: "Saiu contra orientação médica", death: "Óbito",
  registered_in_error: "Registrado por engano"
};
export const outcomeLabel = pick(OUTCOME_KIND_LABEL);
// Q10/Q25: os que a recepção e a enfermagem também registram; os demais, só o médico.
export const DESK_OUTCOMES: UrgencyOutcomeKind[] = [ "left_without_care", "registered_in_error" ];
// Q10: alta e transferência exigem o paciente identificado; óbito e evasão não.
export const IDENTIFIED_OUTCOMES: UrgencyOutcomeKind[] = [ "discharged", "discharged_to_primary_care", "transferred" ];

// Task 1 carry: a consulta descartada conta como nenhuma (não é rascunho nem finalizada).
export function consultationContext(status: UrgencyConsultationStatus | null | undefined): { consultationFinalized: boolean; consultationDraft: boolean } {
  return { consultationFinalized: status === "finalized", consultationDraft: status === "draft" };
}

export type OutcomeContext = { doctor: boolean; consultationFinalized: boolean; consultationDraft: boolean; unidentified: boolean };

// Os tipos que a tela oferece. Q30: com a consulta de urgência finalizada, o "registrado por engano" some para todos.
export function outcomeKindsFor(ctx: Pick<OutcomeContext, "doctor" | "consultationFinalized">): UrgencyOutcomeKind[] {
  const kinds = ctx.doctor ? OUTCOME_KINDS : DESK_OUTCOMES;
  return ctx.consultationFinalized ? kinds.filter((k) => k !== "registered_in_error") : kinds;
}

// ─── Recusas do api ─────────────────────────────────────────────────────────
export const TICKET_PREFIX_TEXT = "o prefixo tem de 1 a 3 letras maiúsculas, sem acento";
export const DESCRIPTION_TEXT = "descreva a pessoa (de 10 a 500 caracteres): sexo e idade aparentes, sinais, onde foi encontrada";
export const COMPLAINT_TEXT = "a queixa tem de 3 a 500 caracteres";
export const PAIN_TEXT = "informe a dor (0 a 10)";
export const JUSTIFICATION_TEXT = "a justificativa tem de 10 a 500 caracteres";
export const DESTINATION_TEXT = "o destino tem de 3 a 200 caracteres";
export const VACANCY_TEXT = "o pedido de vaga tem até 500 caracteres";
export const RETURN_DAYS_TEXT = "o retorno vai de 1 a 90 dias";
export const RETURN_REASON_TEXT = "o motivo do retorno tem de 3 a 300 caracteres";
export const REASON_TEXT = "o motivo tem de 10 a 500 caracteres";
const DISPLAY_REVOKED = "esta TV foi desligada pela administração — peça um código novo";
// Q25: o encounter_open da identificação (o paciente real já tem um walk_in aberto na UPA). Quem identifica passa como override.
export const ENCOUNTER_OPEN_ON_IDENTIFY =
  "o paciente escolhido já tem um atendimento aberto nesta UPA — encerre um dos dois (registrado por engano) antes de ligar";

// Um código → uma frase. `invalid_request` vai pelo campo (FIELD_TEXT); código sem frase aparece como "recusado pelo servidor (<código>)".
export const URGENCY_ERRORS: Record<string, string> = {
  // Interruptor, papel, vínculo e unidade
  feature_disabled: URGENCY_DISABLED,
  missing_role: "seu papel não permite esta ação",
  missing_link: "você não tem vínculo com esta unidade",
  cbo_not_allowed: "seu CBO não permite esta etapa na UPA",
  not_an_upa: "esta unidade não é uma UPA",
  caps_unit_not_allowed: "o CAPS não recebe atendimento de urgência",
  invalid_unit: "unidade inativa ou inexistente",
  screening_not_in_upa: SCREENING_NOT_IN_UPA,
  urgency_outcome_required: "numa UPA, o atendimento termina pelo desfecho da urgência",
  // Chegada, busca e identificação
  patient_not_found: "nenhum paciente com este documento",
  citizen_not_verified: "documento só declarado — confirme no balcão ou cadastre como paciente novo",
  too_many_requests: "muitas tentativas — aguarde um minuto",
  encounter_open: "esta pessoa já tem um atendimento aberto nesta UPA",
  duplicate_suspected: "há cadastro parecido — confira os candidatos antes de criar",
  cpf_taken: "já existe paciente com este CPF — busque por ele e ligue ao existente",
  cns_taken: "já existe paciente com este CNS — busque por ele e ligue ao existente",
  invalid_cpf: CPF_TEXT,
  invalid_cns: CNS_TEXT,
  // Patients::CreateTyped recusa `new_patient.<campo>` (Task 5 carry).
  invalid_patient: "confira os dados do paciente novo",
  cpf_or_reason_required: "sem CPF, informe o motivo",
  already_identified: "este paciente já foi identificado por outra pessoa",
  not_unidentified: "só o paciente não identificado pode ser identificado",
  merge_blocked: "não foi possível ligar os registros agora — avise o suporte",
  // Classificação
  pain_scale_required: PAIN_TEXT,
  justification_required: "explique a cor escolhida (pelo menos 10 caracteres)",
  // Fila e chamada
  not_classified: "classifique a pessoa antes de chamar para o atendimento",
  call_location_required: "escolha o local da chamada — a unidade tem TV na sala de espera",
  invalid_call_location: "o local escolhido não está ativo nesta unidade — escolha outro",
  already_called: "outra pessoa chamou primeiro",
  queue_empty: "ninguém aguardando",
  not_called: "esta pessoa ainda não foi chamada",
  // Atendimento médico (19a) e desfecho
  not_in_care: "este atendimento não está mais em atendimento — a fila foi atualizada",
  not_caller: "só quem chamou o atendimento registra a consulta",
  consultation_not_finalized: "finalize a consulta antes deste desfecho",
  consultation_in_progress: "há uma consulta em rascunho neste atendimento — finalize-a antes",
  // Q30: o "registrado por engano" não vale depois da consulta finalizada.
  consultation_finalized: "a consulta desta urgência já foi finalizada — o médico registra outro desfecho",
  patient_unidentified: "identifique o paciente antes da alta ou da transferência",
  destination_required: "informe o destino da transferência",
  return_guidance_required: "informe o prazo e o motivo do retorno na UBS",
  encounter_closed: "este atendimento já foi encerrado",
  already_closed: "este atendimento já foi encerrado",
  // Locais, TVs e unidade
  call_location_name_taken: "já existe um local com este nome nesta unidade",
  invalid_ticket_prefix: TICKET_PREFIX_TEXT,
  invalid_show_wait_times: "valor inválido para mostrar os tempos de espera",
  display_inactive: "a TV está desativada — ative antes de gerar o código",
  invalid_pairing_code: "código inválido ou vencido — peça um código novo à administração",
  display_revoked: DISPLAY_REVOKED,
  // E7: token trocado duas vezes ou desconhecido — a TV pareia de novo.
  invalid_token: DISPLAY_REVOKED,
  not_found: "não encontrado — atualize a tela",
  invalid_request: "confira os campos destacados"
};

// `invalid_request` pelo `path` do api (preflight §B).
const VITAL_TEXT = new Map(VITALS.map((v) => [ v.key as string, `${v.label}: valor fora do plausível — confira` ]));
const FIELD_TEXT: [ RegExp, string ][] = [
  [ /^(patient|patient_id)$/, "escolha o paciente" ],
  [ /^health_unit_id$/, "escolha a unidade" ],
  [ /^new_patient(\.|$)/, "confira os dados do paciente novo" ],
  [ /^unidentified(\.description)?$/, DESCRIPTION_TEXT ],
  [ /^complaint$/, COMPLAINT_TEXT ],
  [ /^pain_scale$/, PAIN_TEXT ],
  [ /^color$/, "escolha uma das cinco cores" ],
  [ /^justification$/, JUSTIFICATION_TEXT ],
  [ /^kind$/, "escolha o desfecho" ],
  [ /^destination$/, DESTINATION_TEXT ],
  [ /^vacancy_request$/, VACANCY_TEXT ],
  [ /^return_guidance\.days$/, RETURN_DAYS_TEXT ],
  [ /^return_guidance\.reason$/, RETURN_REASON_TEXT ],
  [ /^return_guidance$/, URGENCY_ERRORS.return_guidance_required ],
  [ /^reason$/, REASON_TEXT ],
  [ /^name$/, "confira o nome" ],
  [ /^show_wait_times$/, URGENCY_ERRORS.invalid_show_wait_times ],
  [ /^month$/, "escolha o mês" ]
];

const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const has = (map: Record<string, string>, key: string) => Object.prototype.hasOwnProperty.call(map, key);

function codeText(code: string, path: string, status: number, overrides: Record<string, string>): string {
  if (has(overrides, code)) return overrides[code];
  if (code === "invalid_request") {
    const vital = /^vital_signs\.(.+)$/.exec(path);
    if (vital) return VITAL_TEXT.get(vital[1]) ?? "confira os sinais vitais";
    return FIELD_TEXT.find(([ re ]) => re.test(path))?.[1] ?? URGENCY_ERRORS.invalid_request;
  }
  if (has(URGENCY_ERRORS, code)) return URGENCY_ERRORS[code];
  if (code === "") return `recusado pelo servidor (${status})`;
  // Código fora do formato: sem eco.
  return SAFE_CODE.test(code) ? `recusado pelo servidor (${code})` : "recusado pelo servidor";
}

const bodyOf = (err: ApiError): Record<string, unknown> =>
  (err.body && typeof err.body === "object" ? err.body : {}) as Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// A frase da recusa do topo do corpo. `overrides` troca a frase de um código num contexto (ex.: identificação, Q25).
export function urgencyError(err: unknown, overrides: Record<string, string> = {}): string {
  const feature = featureDisabledKey(err);
  if (feature !== null) return feature === "waiting_room_display" ? WAITING_ROOM_DISABLED : URGENCY_DISABLED;
  if (!(err instanceof ApiError)) return OFFLINE_TEXT;
  const code = errorCode(err) ?? "";
  if (code === "implausible_vital") return screeningError(err);
  // A TV recebe 401 display_revoked/invalid_token: a frase é a da TV, não a da sessão.
  if (err.status === 401 && code !== "display_revoked" && code !== "invalid_token") return attendanceError(err);
  return codeText(str(code), str(bodyOf(err).path), err.status, overrides);
}

// Todas as recusas, uma por `problems[]` (chave `error`, ou `code` por tolerância, D12), cada uma com o `path`; sem `problems`
// válidos, a do topo.
export function urgencyRefusals(err: unknown, overrides: Record<string, string> = {}): Refusal[] {
  const top = (): Refusal[] => [ {
    path: err instanceof ApiError ? str(bodyOf(err).path) : "",
    code: featureDisabledKey(err) !== null ? "feature_disabled" : str(errorCode(err)), text: urgencyError(err, overrides)
  } ];
  if (!(err instanceof ApiError) || featureDisabledKey(err) !== null) return top();
  const list = bodyOf(err).problems;
  const mapped = Array.isArray(list)
    ? list.flatMap((raw): Refusal[] => {
      if (!raw || typeof raw !== "object") return [];
      const row = raw as Record<string, unknown>;
      const code = str(row.error) || str(row.code);
      if (!code) return [];
      const path = str(row.path);
      return [ { path, code, text: codeText(code, path, err.status, overrides) } ];
    })
    : [];
  return mapped.length > 0 ? mapped : top();
}

// ─── Validações locais (os `path` e os limites são os do api; mede sem os espaços das pontas) ──────────────────
export const chars = (v: string): number => [ ...v.trim() ].length;
const within = (v: string, min: number, max: number): boolean => { const n = chars(v); return n >= min && n <= max; };

export type ArrivalDraft =
  | { mode: "existing"; patient: UrgencyPatientRef | null }
  // Q23: reenvio depois de conferir os candidatos do 409 duplicate_suspected.
  | { mode: "new"; patient: NewPatient; duplicatesReviewed?: boolean }
  | { mode: "unidentified"; description: string };

export function arrivalProblems(d: ArrivalDraft, today: string): Problem[] {
  if (d.mode === "existing") return d.patient ? [] : [ { path: "patient", text: "busque e escolha o paciente" } ];
  if (d.mode === "new") {
    const p = newPatientProblem(d.patient, today);
    return p ? [ { path: p.path, text: p.message } ] : [];
  }
  return within(d.description, 10, 500) ? [] : [ { path: "unidentified.description", text: DESCRIPTION_TEXT } ];
}

export function arrivalBody(unitId: string, d: ArrivalDraft): UrgencyArrivalInput {
  if (d.mode === "existing") {
    if (!d.patient) throw new Error("arrivalBody: paciente não escolhido");
    return { health_unit_id: unitId, patient_id: d.patient.patient_id };
  }
  if (d.mode === "new") {
    return { health_unit_id: unitId, new_patient: d.patient, ...(d.duplicatesReviewed ? { duplicates_reviewed: true as const } : {}) };
  }
  return { health_unit_id: unitId, unidentified: { description: d.description.trim() } };
}

// Q22: a dor fica fora do formulário de sinais (`pain`, não `vitals.pain_score`).
export type ClassificationDraft = { complaint: string; vitals: VitalsForm; pain: string; color: UrgencyColor | null; justification: string };

// §5: sem sugestão, sempre; com sugestão, só quando a cor escolhida é outra (sem cor escolhida, ainda não).
export function justificationNeeded(suggested: UrgencyColor | null, final: UrgencyColor | null): boolean {
  return suggested === null || (final !== null && final !== suggested);
}

// A dor do formulário: inteiro de 0 a 10, ou null.
export const painValue = (raw: string): number | null => {
  const t = raw.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n <= 10 ? n : null;
};

// Na ordem do formulário: queixa, sinais (`vital_signs.<campo>`, como o api), dor, cor, justificativa.
export function classificationProblems(d: ClassificationDraft, suggested: UrgencyColor | null): Problem[] {
  const out: Problem[] = [];
  if (!within(d.complaint, 3, 500)) out.push({ path: "complaint", text: COMPLAINT_TEXT });
  const { problems } = parseVitals({ ...d.vitals, pain_score: "" });
  for (const [ key, text ] of Object.entries(problems)) {
    if (!text) continue;
    // Pressão incompleta: o lado que falta, como o api.
    const field = key === "bp" ? (d.vitals.systolic.trim() ? "diastolic" : "systolic") : key;
    out.push({ path: `vital_signs.${field}`, text });
  }
  if (painValue(d.pain) === null) out.push({ path: "pain_scale", text: PAIN_TEXT });
  if (!d.color) out.push({ path: "color", text: "escolha a cor" });
  if (justificationNeeded(suggested, d.color) && !within(d.justification, 10, 500)) {
    out.push({ path: "justification", text: URGENCY_ERRORS.justification_required });
  }
  return out;
}

// Q3/D11: a dor vai em `pain_scale`, nunca em `vital_signs.pain_score`. E11: `justification` só quando exigida (o api recusa a
// justificativa inválida mesmo onde ela não é exigida).
export function classificationBody(
  d: ClassificationDraft & { color: UrgencyColor }, parsedVitals: VitalSigns, suggested: UrgencyColor | null
): UrgencyClassificationInput {
  const { pain_score: _pain, bmi: _bmi, ...vital_signs } = parsedVitals;
  return {
    complaint: d.complaint.trim(), vital_signs, pain_scale: Number(d.pain.trim()), color: d.color,
    ...(justificationNeeded(suggested, d.color) ? { justification: d.justification.trim() } : {})
  };
}

export type OutcomeDraft = {
  kind: UrgencyOutcomeKind | null; destination: string; vacancyRequest: string; returnDays: string; returnReason: string;
  // Q25: só no registered_in_error.
  reason: string;
};

const LEFT_KINDS: UrgencyOutcomeKind[] = [ ...DESK_OUTCOMES, "left_against_advice" ];

// Todas de uma vez: primeiro quem pode e em que estado (Urgency::RecordOutcome#authorize e #state_refusal), depois os campos do tipo.
export function outcomeProblems(d: OutcomeDraft, ctx: OutcomeContext): Problem[] {
  const kind = d.kind;
  if (!kind) return [ { path: "kind", text: "escolha o desfecho" } ];
  const desk = DESK_OUTCOMES.includes(kind);
  if (!ctx.doctor && !desk) return [ { path: "kind", text: "só o médico registra este desfecho — a recepção e a enfermagem registram a saída sem atendimento ou o registro por engano" } ];
  const out: Problem[] = [];
  if (IDENTIFIED_OUTCOMES.includes(kind) && ctx.unidentified) out.push({ path: "patient", text: URGENCY_ERRORS.patient_unidentified });
  if (LEFT_KINDS.includes(kind) && ctx.consultationDraft) out.push({ path: "kind", text: URGENCY_ERRORS.consultation_in_progress });
  if (kind === "registered_in_error" && ctx.consultationFinalized) out.push({ path: "kind", text: URGENCY_ERRORS.consultation_finalized });
  if (!desk && !ctx.consultationFinalized && !(kind === "left_against_advice" && ctx.consultationDraft)) {
    out.push({ path: "kind", text: URGENCY_ERRORS.consultation_not_finalized });
  }
  if (kind === "transferred") {
    if (d.destination.trim() === "") out.push({ path: "destination", text: URGENCY_ERRORS.destination_required });
    else if (!within(d.destination, 3, 200)) out.push({ path: "destination", text: DESTINATION_TEXT });
    if (chars(d.vacancyRequest) > 500) out.push({ path: "vacancy_request", text: VACANCY_TEXT });
  }
  if (kind === "discharged_to_primary_care") {
    const days = d.returnDays.trim();
    if (!/^\d{1,2}$/.test(days) || Number(days) < 1 || Number(days) > 90) out.push({ path: "return_guidance.days", text: RETURN_DAYS_TEXT });
    if (!within(d.returnReason, 3, 300)) out.push({ path: "return_guidance.reason", text: RETURN_REASON_TEXT });
  }
  if (kind === "registered_in_error" && !within(d.reason, 10, 500)) out.push({ path: "reason", text: REASON_TEXT });
  return out;
}

// Só os campos do tipo escolhido (o api recusa campo de outro desfecho); o pedido de vaga vazio não vai.
export function outcomeBody(d: OutcomeDraft & { kind: UrgencyOutcomeKind }): UrgencyOutcomeInput {
  switch (d.kind) {
  case "transferred": {
    const vacancy = d.vacancyRequest.trim();
    return { kind: d.kind, destination: d.destination.trim(), ...(vacancy ? { vacancy_request: vacancy } : {}) };
  }
  case "discharged_to_primary_care":
    return { kind: d.kind, return_guidance: { days: Number(d.returnDays.trim()), reason: d.returnReason.trim() } };
  case "registered_in_error":
    return { kind: d.kind, reason: d.reason.trim() };
  default:
    return { kind: d.kind };
  }
}

// Limites do api (Q15): local 1–40 (WaitingRoom::SaveCallLocation), TV 1–60 (SaveDisplay, passe `max = 60`).
export function locationNameProblem(name: string, max = 40): string | null {
  return within(name, 1, max) ? null : `o nome tem de 1 a ${max} caracteres`;
}
// HealthUnit::TICKET_PREFIX.
export function ticketPrefixProblem(p: string): string | null {
  return /^[A-Z]{1,3}$/.test(p) ? null : TICKET_PREFIX_TEXT;
}
// WaitingRoom::Pair::CODE: texto de 6 dígitos (o zero da frente conta).
export function pairingCodeProblem(code: string): string | null {
  return /^\d{6}$/.test(code) ? null : "o código tem 6 dígitos";
}

// ─── Local da chamada lembrado na sessão do navegador ───────────────────────
export const callLocationKey = (userId: string, unitId: string): string => `callLocation.${userId}.${unitId}`;

export function readCallLocation(userId: string, unitId: string): string | null {
  try {
    return sessionStorage.getItem(callLocationKey(userId, unitId));
  } catch {
    return null;
  }
}

export function writeCallLocation(userId: string, unitId: string, id: string | null): void {
  try {
    if (id === null) sessionStorage.removeItem(callLocationKey(userId, unitId));
    else sessionStorage.setItem(callLocationKey(userId, unitId), id);
  } catch {
    // Storage bloqueado: a escolha vale só nesta tela.
  }
}

// ─── Contagens do painel (contagens de 1 a 4 chegam "lt5"; tempos sem contagem, null) ─────────────────────────
export const countLabel = (c: UrgencyCount): string => (c === "lt5" ? SMALL_COUNT : String(c));

export function timesLabel(t: { median_minutes: UrgencyTime; p90_minutes: UrgencyTime }): string {
  if (t.median_minutes === "lt5" || t.p90_minutes === "lt5") return SMALL_COUNT;
  if (t.median_minutes === null || t.p90_minutes === null) return "—";
  return `mediana ${t.median_minutes} min · p90 ${t.p90_minutes} min`;
}
