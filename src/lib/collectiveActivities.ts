// src/lib/collectiveActivities.ts
// Regras de tela da atividade coletiva (módulo 24b; ADR 0052; contrato 2026-11-12 §4, §7).
// O que cada tipo exige, proíbe ou aceita vem de `options.domains.rules` (nunca escrito aqui); o api decide e
// recusa de novo (`collective_activities/rules.rb`). Aqui só se recusa antes o que ele recusaria, com o mesmo `path`.
// Nenhuma frase repete dado enviado (nome, documento, texto). Os rótulos de "ficha não gerada" ficam em `production.ts`.
import type {
  CodeLabel, CollectiveActivityInput, CollectiveDomains, CollectiveField, CollectiveOptions, CollectiveParticipantInput, FieldRule, QuickPatient, VisitShift
} from "./api";
import { EMPTY_MEASURES, measurementsProblems, parseMeasure, quickPatientProblems, textProblem } from "./homeVisits";
import type { Problem } from "./pharmacy";

type ListField = "meeting_topics" | "target_audience" | "health_topics" | "health_practices";
const LIST_FIELDS: ListField[] = [ "meeting_topics", "target_audience", "health_topics", "health_practices" ];
// O api nunca aceita o tema 18 (rules.rb `forbidden_health_topics`); a tela também não o oferece.
const FORBIDDEN_HEALTH_TOPICS = [ 18 ];
const PLACE_TEXT_MAX = 250;
const COUNT_MIN = 1;
const COUNT_MAX = 999;

export const IDENTIFIER_WARNING = "participante sem CPF e sem CNS entra na ficha sem identificação e não conta no acompanhamento dele";
// Q74: aviso, não bloqueio — a regra do api não muda; o que se perde é a ficha.
export const TYPE_5_6_NOT_GENERATED = "nos tipos 5 e 6, a ficha desta atividade não será gerada enquanto algum participante estiver sem CPF e sem CNS";
const FICHA_NEEDS_ID_TYPES = [ 5, 6 ];

// Frases da tela (Task 11).
export const NO_TEAM = "Você não está em nenhuma equipe";
export const CANNOT_REGISTER_ACTIVITY = "seu CBO não registra atividade coletiva nas suas equipes";
export const NO_CNS_PROFESSIONAL = "sem CNS no cadastro";
export const OTHER_TEAM_PROFESSIONAL = "fora da equipe";
export const LIST_MAX_TEXT = (max: number): string => `no máximo ${max} — desmarque um para escolher outro`;
export const ACTIVITY_SAVED = "Atividade registrada.";
export const REPLAYED_ACTIVITY = "Esta atividade já estava gravada.";
export const ACTIVITY_NETWORK_RETRY = "não foi possível confirmar a gravação — tente de novo: a mesma atividade não é gravada duas vezes";

export type ParticipantDraft = (
  | { kind: "patient"; patientId: string; displayName: string | null; hasCpf: boolean; hasCns: boolean }
  | { kind: "new"; patient: QuickPatient; duplicatesReviewed: boolean }
) & { altered: boolean; weight: string; height: string; smoking: { quit: boolean; dropped_out: boolean } | null };

export interface ActivityDraft {
  teamId: string | null; heldOn: string; shift: VisitShift | null; activityType: number | null;
  place: { kind: "unit"; unitId: string | null } | { kind: "text"; text: string };
  participantsCount: string;
  meetingTopics: number[]; targetAudience: number[]; healthTopics: number[]; healthPractices: number[];
  // Um dos códigos de `domains.procedures`, escolhido num select.
  procedureCode: string;
  professionals: string[]; participants: ParticipantDraft[];
}

export const emptyActivityDraft = (today: string): ActivityDraft => ({
  teamId: null, heldOn: today, shift: null, activityType: null, place: { kind: "unit", unitId: null }, participantsCount: "",
  meetingTopics: [], targetAudience: [], healthTopics: [], healthPractices: [], procedureCode: "", professionals: [], participants: []
});

// ── O que o tipo pede, lido do dado ──
// Tipo sem regra → "optional" (a tela mostra o tipo cru).
export function fieldRule(domains: CollectiveDomains, type: number | null, field: CollectiveField): FieldRule {
  if (type === null) return "optional";
  return domains.rules.by_type[String(type)]?.[field] ?? "optional";
}

type TypeAndMeeting = Pick<ActivityDraft, "activityType" | "meetingTopics">;
// `forbidden` nas reuniões, salvo com um tema de reunião da exceção.
export function healthTopicsAllowed(domains: CollectiveDomains, draft: TypeAndMeeting): FieldRule {
  const rule = fieldRule(domains, draft.activityType, "health_topics");
  if (rule === "forbidden" && draft.meetingTopics.some((t) => domains.rules.health_topics_with_meeting_topic.includes(t))) return "optional";
  return rule;
}

export function offeredHealthTopics(domains: CollectiveDomains, draft: TypeAndMeeting): CodeLabel[] {
  if (healthTopicsAllowed(domains, draft) === "forbidden") return [];
  return domains.health_topics.filter((t) => !FORBIDDEN_HEALTH_TOPICS.includes(t.code));
}

// Práticas exclusivas de um tipo ficam fora dos outros tipos.
export function offeredPractices(domains: CollectiveDomains, type: number | null): CodeLabel[] {
  const hidden = domains.rules.practices_only_in_type.filter((r) => r.type !== type).flatMap((r) => r.practices);
  return domains.health_practices.filter((p) => !hidden.includes(p.code));
}

export const needsProcedure = (domains: CollectiveDomains, practices: number[]): boolean =>
  practices.some((p) => domains.rules.procedure_practices.includes(p));
export const smokingAllowed = (domains: CollectiveDomains, practices: number[]): boolean =>
  practices.some((p) => domains.rules.smoking_practices.includes(p));

// Toda troca de tipo, tema de reunião ou prática passa por aqui: o que a regra deixou de permitir sai do rascunho,
// para a tela nunca guardar marcado o que não mostra (e o corpo levar só o que se vê).
export function pruneActivityDraft(domains: CollectiveDomains, draft: ActivityDraft): ActivityDraft {
  const type = draft.activityType;
  const keep = (field: CollectiveField, list: number[]): number[] => (fieldRule(domains, type, field) === "forbidden" ? [] : list);
  const meetingTopics = keep("meeting_topics", draft.meetingTopics);
  const topics = offeredHealthTopics(domains, { activityType: type, meetingTopics }).map((t) => t.code);
  const practices = offeredPractices(domains, type).map((p) => p.code);
  const healthPractices = keep("health_practices", draft.healthPractices).filter((c) => practices.includes(c));
  const smoking = smokingAllowed(domains, healthPractices);
  return {
    ...draft, meetingTopics, targetAudience: keep("target_audience", draft.targetAudience),
    healthTopics: draft.healthTopics.filter((c) => topics.includes(c)), healthPractices,
    procedureCode: needsProcedure(domains, healthPractices) ? draft.procedureCode : "",
    participants: fieldRule(domains, type, "participants") === "forbidden"
      ? [] : draft.participants.map((p) => (smoking || p.smoking === null ? p : { ...p, smoking: null }))
  };
}

// ── Participantes ──
export const participantWithoutId = (p: ParticipantDraft): boolean =>
  p.kind === "patient" ? !p.hasCpf && !p.hasCns : !digits(p.patient.cpf) && !digits(p.patient.cns);
export const alteredCount = (draft: Pick<ActivityDraft, "participants">): number => draft.participants.filter((p) => p.altered).length;

function digits(v: string | null | undefined): string { return (v ?? "").replace(/\D/g, ""); }

function participantKeys(p: ParticipantDraft): string[] {
  if (p.kind === "patient") return [ `patient:${p.patientId}` ];
  const cpf = digits(p.patient.cpf);
  const cns = digits(p.patient.cns);
  return [ ...(cpf ? [ `cpf:${cpf}` ] : []), ...(cns ? [ `cns:${cns}` ] : []) ];
}

// ── Recusas (todas de uma vez, com o `path` do api) ──
export function activityProblems(draft: ActivityDraft, ctx: { options: CollectiveOptions; today: string }): Problem[] {
  const { options, today } = ctx;
  const { domains } = options;
  const out: Problem[] = [];
  const add = (path: string, text: string) => out.push({ path, text });

  const team = options.teams.find((t) => t.id === draft.teamId);
  if (!team) add("team_id", "escolha a equipe");
  if (draft.shift === null) add("shift", "escolha o turno");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.heldOn) || draft.heldOn < options.min_date || draft.heldOn > ctx.today) {
    add("held_on", `a data deve estar entre ${options.min_date.split("-").reverse().join("/")} e ${today.split("-").reverse().join("/")}`);
  }
  const type = draft.activityType;
  if (type === null) add("activity_type", "escolha o tipo da atividade");

  if (draft.place.kind === "unit") {
    const unitId = draft.place.unitId;
    const unit = options.units.find((u) => u.id === unitId);
    if (!unit) add("place_health_unit_id", "escolha a unidade ou escreva o local");
    else if (!unit.has_cnes) add("place_health_unit_id", "a unidade escolhida não tem CNES — escolha outra ou escreva o local");
  } else {
    const p = textProblem(draft.place.text, { min: 1, max: PLACE_TEXT_MAX, path: "place_text" });
    if (p) out.push(p);
  }

  const count = /^\d+$/.test(draft.participantsCount.trim()) ? Number(draft.participantsCount.trim()) : null;
  if (count === null || count < COUNT_MIN || count > COUNT_MAX) add("participants_count", `informe o número de participantes, de ${COUNT_MIN} a ${COUNT_MAX}`);
  else if (count < draft.participants.length) add("participants_count", "o número de participantes não pode ser menor que a lista de participantes");

  // Listas: tamanho, domínio, repetição e a regra do tipo.
  const values: Record<ListField, number[]> = {
    meeting_topics: draft.meetingTopics, target_audience: draft.targetAudience, health_topics: draft.healthTopics, health_practices: draft.healthPractices
  };
  const label: Record<ListField, string> = {
    meeting_topics: "temas da reunião", target_audience: "público-alvo", health_topics: "temas para saúde", health_practices: "práticas em saúde"
  };
  const rule: Record<ListField, FieldRule> = {
    meeting_topics: fieldRule(domains, type, "meeting_topics"), target_audience: fieldRule(domains, type, "target_audience"),
    health_topics: healthTopicsAllowed(domains, draft), health_practices: fieldRule(domains, type, "health_practices")
  };
  for (const field of LIST_FIELDS) {
    const list = values[field];
    const max = domains.rules.list_max[field];
    if (max !== undefined && list.length > max) add(field, `${label[field]}: no máximo ${max}`);
    list.forEach((code, i) => {
      const known = domains[field].some((c) => c.code === code);
      if (!known || (field === "health_topics" && FORBIDDEN_HEALTH_TOPICS.includes(code))) add(`${field}[${i}]`, `${label[field]}: escolha da lista`);
      else if (list.indexOf(code) !== i) add(`${field}[${i}]`, `${label[field]}: item repetido`);
      else if (field === "health_practices" && !offeredPractices(domains, type).some((p) => p.code === code)) {
        add(`${field}[${i}]`, "esta prática só vale em outro tipo de atividade");
      }
    });
    if (type !== null) {
      if (rule[field] === "required" && list.length === 0) add(field, `${label[field]}: escolha ao menos um`);
      if (rule[field] === "forbidden" && list.length > 0) add(field, `${label[field]} não se aplicam a este tipo de atividade`);
    }
  }

  // Procedimento SIGTAP: só com a prática da regra, e da lista.
  const procedure = draft.procedureCode.trim();
  if (needsProcedure(domains, draft.healthPractices)) {
    if (!domains.procedures.some((p) => p.code === procedure)) add("procedure_code", "escolha o procedimento da lista");
  } else if (procedure !== "") add("procedure_code", "o procedimento só vale com a prática de outro procedimento coletivo");

  // Profissionais: com CNS, sem repetir.
  draft.professionals.forEach((id, i) => {
    const prof = team?.professionals.find((p) => p.id === id);
    if (!prof) add(`professionals[${i}]`, "escolha um profissional da equipe");
    else if (!prof.has_cns) add(`professionals[${i}]`, "este profissional não tem CNS no cadastro");
    else if (draft.professionals.indexOf(id) !== i) add(`professionals[${i}]`, "profissional repetido");
  });

  // Participantes.
  const participantsRule = fieldRule(domains, type, "participants");
  if (type !== null) {
    if (participantsRule === "required" && draft.participants.length === 0) add("participants", "inclua ao menos um participante");
    if (participantsRule === "forbidden" && draft.participants.length > 0) add("participants", "este tipo de atividade não tem lista de participantes");
  }
  const seen: string[][] = [];
  const meas = domains.rules.participant_measurements;
  // Só peso e altura têm faixa aqui; a checagem da visita ignora as chaves em branco.
  const ranges = { measurement_ranges: { weight_kg: meas.weight_kg, height_cm: meas.height_cm } };
  draft.participants.forEach((p, i) => {
    const at = `participants[${i}]`;
    const keys = participantKeys(p);
    if (seen.some((other) => other.some((k) => keys.includes(k)))) add(at, "participante repetido");
    seen.push(keys);
    if (p.kind === "new") for (const q of quickPatientProblems(p.patient, today)) add(`${at}.${q.path}`, q.text);
    // Medidas: a mesma checagem da visita (faixa e casas, vírgula ou ponto).
    for (const m of measurementsProblems(ranges, { ...EMPTY_MEASURES, weight_kg: p.weight, height_cm: p.height })) {
      add(`${at}.${m.path}`, m.text);
    }
    if (p.smoking && !smokingAllowed(domains, draft.healthPractices)) add(`${at}.smoking`, "tabagismo só com as práticas do Programa Nacional de Controle do Tabagismo");
  });
  return out;
}

// Avisos que não bloqueiam o envio.
export function activityWarnings(draft: ActivityDraft): Problem[] {
  const out: Problem[] = [];
  let any = false;
  draft.participants.forEach((p, i) => {
    if (participantWithoutId(p)) { out.push({ path: `participants[${i}]`, text: IDENTIFIER_WARNING }); any = true; }
  });
  if (any && draft.activityType !== null && FICHA_NEEDS_ID_TYPES.includes(draft.activityType)) out.push({ path: "participants", text: TYPE_5_6_NOT_GENERATED });
  return out;
}

// ── Corpo do POST: só o que a regra do tipo permite; `forbidden` vai como lista vazia; sem `altered_count` (o api o deriva, Q38) ──
// Chamar só com `activityProblems` vazio (equipe, turno e tipo escolhidos).
export function activityBody(draft: ActivityDraft, domains: CollectiveDomains): Omit<CollectiveActivityInput, "client_uuid"> {
  const type = draft.activityType as number;
  const keep = (rule: FieldRule, list: number[]): number[] => (rule === "forbidden" ? [] : list);
  const practices = keep(fieldRule(domains, type, "health_practices"), draft.healthPractices);
  const smoking = smokingAllowed(domains, practices);
  const measures = (p: ParticipantDraft): { weight_kg?: number; height_cm?: number } | undefined => {
    const out: { weight_kg?: number; height_cm?: number } = {};
    const w = parseMeasure(p.weight);
    const h = parseMeasure(p.height);
    if (typeof w === "number") out.weight_kg = w;
    if (typeof h === "number") out.height_cm = h;
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const participant = (p: ParticipantDraft): CollectiveParticipantInput => {
    const m = measures(p);
    return {
      ...(p.kind === "patient" ? { patient_id: p.patientId } : { new_patient: p.patient, ...(p.duplicatesReviewed ? { duplicates_reviewed: true } : {}) }),
      ...(p.altered ? { altered_evaluation: true } : {}),
      ...(m ? { measurements: m } : {}),
      ...(smoking && p.smoking ? { smoking: p.smoking } : {})
    } as CollectiveParticipantInput;
  };
  const procedure = needsProcedure(domains, practices) ? draft.procedureCode.trim() : "";
  return {
    team_id: draft.teamId as string, held_on: draft.heldOn, shift: draft.shift as VisitShift, activity_type: type,
    ...(draft.place.kind === "unit" ? { place_health_unit_id: draft.place.unitId as string } : { place_text: draft.place.text.trim() }),
    participants_count: Number(draft.participantsCount.trim()),
    meeting_topics: keep(fieldRule(domains, type, "meeting_topics"), draft.meetingTopics),
    target_audience: keep(fieldRule(domains, type, "target_audience"), draft.targetAudience),
    health_topics: keep(healthTopicsAllowed(domains, draft), draft.healthTopics),
    health_practices: practices,
    ...(procedure !== "" ? { procedure_code: procedure } : {}),
    professionals: draft.professionals.map((professional_id) => ({ professional_id })),
    participants: fieldRule(domains, type, "participants") === "forbidden" ? [] : draft.participants.map(participant)
  };
}
