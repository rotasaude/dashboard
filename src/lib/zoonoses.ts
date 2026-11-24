// src/lib/zoonoses.ts
// Portões, papéis, chaves de cache, rótulos fixos e regras de tela do módulo 35b (centro de zoonoses; ADR 0054; contrato
// 2026-11-23 §1–§13). Puro: nenhuma leitura de rede. As frases dos códigos moram em zoonosesErrors.ts (o campo copia). O api decide;
// aqui só se recusa antes o que ele recusaria, com o mesmo `path`. Código desconhecido aparece cru. Onde o api e o plano
// divergem, vale o api (api-shapes.md, Q25).
import { ApiError, errorCode, type AnimalStatus, type BiteObservation, type Coded, type LeishTest, type MyProfessional, type RabiesCampaign, type ZoonosesDemand, type ZoonosesParameters } from "./api";
import { featureDisabledKey, hasFeature } from "./features";
import { HOME_VISIT_ERRORS, NOMINAL_QUERY, STATIC_QUERY, homeVisitRefusals, textProblem, type HomeVisitRefusal } from "./homeVisits";
import { canUseOmbudsman } from "./ombudsman";
import { canUseTerritory } from "./territoryRegistry";
import { ANIMAL_STAY_OPEN, ZOONOSES_DISABLED, ZOONOSES_ERRORS, ZOONOSES_OMBUDSMAN_DISABLED } from "./zoonosesErrors";

export { NOMINAL_QUERY, STATIC_QUERY };

// ─── Frases ─────────────────────────────────────────────────────────────────
export const ZOO_NO_ROLE = "seu papel não permite usar o centro de zoonoses";
// A mesma exigência da tabela (a que o campo copia): papel, CBO, CRMV e vínculo.
export const ZOO_NOT_VET = ZOONOSES_ERRORS.veterinarian_required;
// Linha do relatório semanal depois do fim previsto da campanha (`after_planned_end`).
export const AFTER_PLANNED_END = "após o fim previsto da campanha";
// Foco com menos cães que `leish_focus_min_dogs` (`below_focus_min`) e amostra abaixo do `min_population` da 1ª linha da tabela (Q32).
export const focusBelowMinText = (min: number): string => `O foco tem menos de ${min} cães cadastrados: amplie a área ou confira o cadastro.`;
export const sampleCensusText = (min: number): string => `Abaixo de ${min} cães, o manual não traz amostra: todos os cães entram no inquérito.`;

// ─── Portões ────────────────────────────────────────────────────────────────
type SessionLike = Parameters<typeof canUseTerritory>[0];

// Sem papel: não operador, `zoonoses` e o cadastro territorial utilizável (Q10). É o que a ouvidoria usa para o cadeado dos assuntos.
export function zoonosesUsable(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "zoonoses") && canUseTerritory(user);
}

export type ZoonosesRoles = { team: boolean; coordinator: boolean; admin: boolean; reader: boolean };
// `team` = zoonoses_team ou a coordenação (Q1); `reader` = team ou municipal_admin (que só lê relatórios).
export function zoonosesRoles(user: SessionLike): ZoonosesRoles {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  const coordinator = roles.includes("endemic_coordinator");
  const team = coordinator || roles.includes("zoonoses_team");
  const admin = roles.includes("municipal_admin");
  return { team, coordinator, admin, reader: team || admin };
}

export const canUseZoonoses = (user: SessionLike): boolean => zoonosesUsable(user) && zoonosesRoles(user).reader;
// Q35: as demandas exigem zoonoses e a ouvidoria (sem ela o api responde 403 feature_disabled "ombudsman").
export const canUseZooDemands = (user: SessionLike): boolean => canUseZoonoses(user) && canUseOmbudsman(user);

export const VET_CBO = "223305";
// Q12: a equipe do centro, com o perfil de GET /professionals/me: CRMV completo e vínculo ativo no CBO do veterinário.
export function isVeterinarian(me: MyProfessional | null | undefined, roles: ZoonosesRoles): boolean {
  if (!me || !roles.team) return false;
  const p = me.professional;
  const crmv = p.council === "CRMV" && !!p.council_state && !!p.registration_number;
  return crmv && me.links.some((l) => l.cbo_code === VET_CBO && l.ended_at === null);
}
// "<nome> · CRMV-<UF> <número>"; o formulário da eutanásia mostra o veterinário logado.
export const vetIdentity = (me: MyProfessional): string =>
  `${me.professional.professional_name} · CRMV-${me.professional.council_state ?? ""} ${me.professional.registration_number ?? ""}`.trimEnd();

// Nome do animal; sem nome: "Cão sem nome", "Gato sem nome" ou "Animal sem nome" (qualquer outra espécie).
export const animalDisplayName = (name: string | null, species: string): string =>
  name ?? `${species === "dog" ? "Cão" : species === "cat" ? "Gato" : "Animal"} sem nome`;

// ─── Chaves de cache ────────────────────────────────────────────────────────
export const ZOO_DOMAINS_KEY = "zooDomains";
export const ZOO_ANIMAL_KEY = "zooAnimal";
export const ZOO_CAMPAIGNS_KEY = "zooCampaigns";
export const ZOO_VACCINATIONS_KEY = "zooVaccinations";
export const ZOO_DEMANDS_KEY = "zooDemands";
export const ZOO_DEMAND_KEY = "zooDemand";
export const ZOO_OBSERVATIONS_KEY = "zooObservations";
export const ZOO_OBSERVATION_KEY = "zooObservation";
export const ZOO_SURVEYS_KEY = "zooSurveys";
export const ZOO_TESTS_KEY = "zooTests";
export const ZOO_COLLARS_KEY = "zooCollars";
export const ZOO_STAYS_KEY = "zooStays";
export const ZOO_PARAMS_KEY = "zooParams";
export const ZOO_REPORT_KEY = "zooReport";
export const ZOO_ME_KEY = "zooMe";

// ─── Rótulos (código desconhecido aparece cru) ──────────────────────────────
export const zooLabel = (list: Coded | undefined, code: string): string => list?.find((row) => row.code === code)?.label ?? code;

// Para quem não lê os domínios (a notificação do 25, a ouvidoria): os oito do §4, na ordem do domains.yml.
export const ZOONOSES_SUBTYPES: Coded = [
  { code: "scorpion", label: "Escorpião" }, { code: "bat", label: "Morcego" }, { code: "rodent", label: "Rato ou outro roedor" },
  { code: "tick", label: "Carrapato" }, { code: "aggressive_animal", label: "Animal que mordeu ou atacou" },
  { code: "neurological_animal", label: "Animal com comportamento estranho ou paralisia" },
  { code: "sporotrichosis", label: "Gato com feridas (esporotricose)" }, { code: "other", label: "Outro problema com animal" }
];

const pick = (map: Record<string, string>) => (code: string): string => (Object.prototype.hasOwnProperty.call(map, code) ? map[code] : code);
// Q16: a observação tem só aberta e encerrada (sem `cancelled`). Os desfechos seguem o domains.yml, em minúsculas.
export const observationStateLabel = pick({ open: "em observação", closed: "encerrada" });
export const observationOutcomeLabel = pick({
  healthy: "sadio", died: "morreu", missing: "desapareceu", rabies_signs: "sinais de raiva", sent_to_exam: "enviado a exame", euthanized: "eutanasiado"
});

// Condição do animal agressor (os rótulos da ficha do Sinan); código desconhecido aparece cru.
export const observationConditionLabel = pick({ healthy: "Sadio", suspect: "Suspeito", rabid: "Raivoso", dead_or_missing: "Morto ou desaparecido" });

// ─── Regras de tela ─────────────────────────────────────────────────────────
// `code`: o código do api quando ele tem um; null quando o api responderia `invalid_request` no `path`. `tutor_required` e
// `euthanasia_required` são só códigos internos da tela (o api manda invalid_request).
export type ZooProblem = { code: string | null; path: string; text: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86_400_000;
// AAAA-MM-DD que existe; senão null.
function isoDay(raw: string): number | null {
  const m = DATE.exec(raw);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === raw ? t : null;
}
const addDays = (iso: string, days: number): string => new Date((isoDay(iso) ?? 0) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number => Math.round(((isoDay(to) ?? 0) - (isoDay(from) ?? 0)) / DAY);

const local = (path: string, text: string): ZooProblem => ({ code: null, path, text });
const coded = (code: keyof typeof ZOONOSES_ERRORS, path: string): ZooProblem => ({ code, path, text: ZOONOSES_ERRORS[code] });
const internal = (code: string, path: string, text: string): ZooProblem => ({ code, path, text });
const text = (value: string, min: number, max: number, path: string): ZooProblem | null => {
  const p = textProblem(value, { min, max, path });
  return p ? local(p.path, p.text) : null;
};
const push = (out: ZooProblem[], p: ZooProblem | null): void => { if (p) out.push(p); };
const isDate = (raw: string | null | undefined): raw is string => !!raw && isoDay(raw) !== null;

// Animal (Q22): nome 1–60, pelagem 1–40, raça 1–60, registro 1–20 (vazio = ausente), microchip 15 dígitos; tutor e comunitário
// não convivem; sem tutor e sem comunitário vale ("tutor não identificado").
export type AnimalDraft = {
  species: string; name: string; sex: string; size: string; coat: string; breed: string; birthEstimateOn: string; microchip: string;
  registryNumber: string; householdId: string | null; tutorId: string | null; community: boolean;
};
const optionalText = (value: string, max: number, path: string): ZooProblem | null => (value.trim() === "" ? null : text(value, 1, max, path));
export function animalProblems(d: AnimalDraft): ZooProblem[] {
  const out: ZooProblem[] = [];
  if (!d.species) out.push(local("species", "escolha a espécie"));
  if (!d.sex) out.push(local("sex", "escolha o sexo"));
  push(out, optionalText(d.name, 60, "name"));
  push(out, optionalText(d.coat, 40, "coat"));
  push(out, optionalText(d.breed, 60, "breed"));
  push(out, optionalText(d.registryNumber, 20, "registry_number"));
  if (d.microchip.trim() !== "" && !/^\d{15}$/.test(d.microchip)) out.push(local("microchip", "microchip: 15 dígitos, sem espaço"));
  if (d.birthEstimateOn.trim() !== "" && !isDate(d.birthEstimateOn)) out.push(local("birth_estimate_on", "informe uma data válida"));
  if (d.tutorId && d.community) out.push(local("community", "animal comunitário não tem tutor — tire um dos dois"));
  return out;
}

// Q31: ativo → desaparecido, transferido ou óbito; desaparecido → ativo ou óbito; transferido e óbito são finais.
export function nextAnimalStatuses(status: AnimalStatus | string): AnimalStatus[] {
  if (status === "active") return [ "missing", "transferred", "deceased" ];
  if (status === "missing") return [ "active", "deceased" ];
  return [];
}

// Vacinação: casa a casa exige campanha aberta, animal, domicílio e a visita domiciliar utilizável (`fieldUsable`); posto fixo,
// campanha aberta e, sem animal, a espécie; rotina, sempre e com animal (nunca leva campanha). Data: do início da campanha (rotina: 30
// dias antes de hoje) até hoje. Nota do evento adverso 10–500, só com `adverse`.
export type VaccinationDraft = {
  modality: "house" | "fixed_post" | "routine"; animalId: string | null; species: "dog" | "cat" | null; vaccinatedOn: string;
  adverse: boolean; adverseNote: string; householdId: string | null;
};
export function vaccinationProblems(
  d: VaccinationDraft, c: { campaign: RabiesCampaign | null; fieldUsable: boolean }, today: string
): ZooProblem[] {
  const out: ZooProblem[] = [];
  const routine = d.modality === "routine";
  if (routine) {
    if (!d.animalId) out.push(local("animal_id", "escolha o animal"));
  } else {
    if (!c.campaign) out.push(coded("campaign_not_open", "campaign_id"));
    if (d.modality === "house") {
      if (!d.animalId) out.push(local("animal_id", "escolha o animal"));
      if (!d.householdId) out.push(local("household_id", "o animal precisa de domicílio para a vacinação casa a casa"));
      if (!c.fieldUsable) out.push(local("modality", "a visita domiciliar está desligada — use o posto fixo"));
    } else if (!d.animalId && d.species !== "dog" && d.species !== "cat") {
      out.push(local("species", "escolha a espécie: cão ou gato"));
    }
  }
  const from = routine ? addDays(today, -30) : c.campaign?.starts_on ?? null;
  if (!isDate(d.vaccinatedOn)) out.push(local("vaccinated_on", "informe a data da vacinação"));
  else if (d.vaccinatedOn > today || (from !== null && d.vaccinatedOn < from)) out.push(coded("date_out_of_range", "vaccinated_on"));
  if (d.adverse) push(out, text(d.adverseNote, 10, 500, "adverse_note"));
  else if (d.adverseNote.trim() !== "") out.push(local("adverse_note", "a nota só vale com evento adverso"));
  return out;
}

// Meta sugerida = round(estimativa × cobertura); sem estimativa, sem sugestão.
export const suggestedGoal = (estimate: number | null, target: number): number | null => (estimate === null ? null : Math.round(estimate * target));

// Fechamento da observação: desfecho; data entre a exposição e hoje (date_out_of_range); sadio só a partir de `ends_on` (o 10º dia
// vale); nota opcional 10–500.
export function closeObservationProblems(
  d: { outcome: string | null; outcomeOn: string; note: string }, o: Pick<BiteObservation, "exposure_on" | "ends_on">, today: string
): ZooProblem[] {
  const out: ZooProblem[] = [];
  if (!d.outcome) out.push(local("outcome", "escolha o desfecho"));
  if (!isDate(d.outcomeOn)) out.push(local("outcome_on", "informe a data do desfecho"));
  else if (d.outcomeOn < o.exposure_on || d.outcomeOn > today) out.push(coded("date_out_of_range", "outcome_on"));
  else if (d.outcome === "healthy" && d.outcomeOn < o.ends_on) out.push(coded("observation_not_finished", "outcome_on"));
  if (d.note.trim() !== "") push(out, text(d.note, 10, 500, "outcome_note"));
  return out;
}
// Dias corridos até o fim: 0 no último dia, negativo depois.
export const observationDaysLeft = (endsOn: string, today: string): number => daysBetween(today, endsOn);
// "faltam N dias" / "falta 1 dia" / "último dia" / "terminou há N dias" (aberta, mas já passou do fim).
export function observationDaysText(endsOn: string, today: string): string {
  const n = observationDaysLeft(endsOn, today);
  if (n === 0) return "último dia";
  if (n === 1) return "falta 1 dia";
  if (n > 1) return `faltam ${n} dias`;
  return n === -1 ? "terminou há 1 dia" : `terminou há ${-n} dias`;
}

// LV: o ELISA só depois de um TR-DPP reagente; cão reagente = os dois reagentes.
export const elisaAllowed = (t: Pick<LeishTest, "dpp_result">): boolean => t.dpp_result === "reactive";
export const isReactiveDog = (t: Pick<LeishTest, "dpp_result" | "elisa_result">): boolean => t.dpp_result === "reactive" && t.elisa_result === "reactive";

const NEEDS_TUTOR = internal("tutor_required", "", "o animal precisa de tutor para esta ação");
const NEEDS_EUTHANASIA = internal("euthanasia_required", "", "registre antes a eutanásia do animal");
// Q18: eutanásia exige `euthanasia_id`; tratamento e recusa exigem tutor.
export function leishOutcomeProblems(d: { decision: string | null; euthanasiaId: string | null }, a: { tutor: boolean }): ZooProblem[] {
  if (!d.decision) return [ local("decision", "escolha a decisão") ];
  if (d.decision === "euthanasia") return d.euthanasiaId ? [] : [ { ...NEEDS_EUTHANASIA, path: "euthanasia_id" } ];
  return (d.decision === "tutor_treatment" || d.decision === "refused") && !a.tutor ? [ { ...NEEDS_TUTOR, path: "decision" } ] : [];
}
// Saída do canil: devolução exige tutor; adoção, adotante (e só ela leva adotante); eutanásia, a eutanásia gravada.
export function stayExitProblems(d: { exitKind: string | null; adopterId: string | null }, a: { tutor: boolean; euthanized: boolean }): ZooProblem[] {
  if (!d.exitKind) return [ local("exit_kind", "escolha o tipo de saída") ];
  const out: ZooProblem[] = [];
  if (d.exitKind === "returned" && !a.tutor) out.push({ ...NEEDS_TUTOR, path: "exit_kind" });
  if (d.exitKind === "euthanasia" && !a.euthanized) out.push({ ...NEEDS_EUTHANASIA, path: "exit_kind" });
  if (d.exitKind === "adopted" && !d.adopterId) out.push(local("adopter_patient_id", "escolha o adotante"));
  if (d.exitKind !== "adopted" && d.adopterId) out.push(local("adopter_patient_id", "só a adoção leva adotante"));
  return out;
}
// Eutanásia: motivo; nota 10–1000 (`reason_note`); ao menos uma base legal; data até hoje.
export function euthanasiaProblems(d: { reason: string; note: string; legalBasis: string[]; performedOn: string }, today: string): ZooProblem[] {
  const out: ZooProblem[] = [];
  if (!d.reason) out.push(local("reason", "escolha o motivo"));
  push(out, text(d.note, 10, 1000, "reason_note"));
  if (d.legalBasis.length === 0) out.push(local("legal_basis", "marque ao menos uma base legal"));
  if (!isDate(d.performedOn)) out.push(local("performed_on", "informe a data da eutanásia"));
  else if (d.performedOn > today) out.push(coded("date_out_of_range", "performed_on"));
  return out;
}

// Demandas: agendar (data a partir de hoje), vistoriar (data até hoje, nota 10–2000), encerrar (desfecho, texto 20–4000), recusar e
// prorrogar (10–4000).
export type DemandAction = "schedule" | "inspect" | "close" | "decline" | "extend";
export function demandProblems(
  action: DemandAction, d: { date?: string; note?: string; outcome?: string; text?: string }, today: string
): ZooProblem[] {
  const out: ZooProblem[] = [];
  const date = d.date ?? "";
  if (action === "schedule") {
    if (!isDate(date)) out.push(local("scheduled_on", "informe a data da visita"));
    else if (date < today) out.push(coded("date_out_of_range", "scheduled_on"));
  } else if (action === "inspect") {
    if (!isDate(date)) out.push(local("inspected_on", "informe a data da vistoria"));
    else if (date > today) out.push(coded("date_out_of_range", "inspected_on"));
    push(out, text(d.note ?? "", 10, 2000, "inspection_note"));
  } else if (action === "close") {
    if (!d.outcome) out.push(local("outcome", "escolha o desfecho"));
    push(out, text(d.text ?? "", 20, 4000, "text"));
  } else {
    push(out, text(d.text ?? "", 10, 4000, "text"));
  }
  return out;
}
// O api não manda a prorrogação na fila: "prorrogar" fica oferecido e `422 already_extended` diz o resto. Sem encaminhamento pendente
// (respondido, recusado ou cancelado pelo 33), nenhuma ação.
export function demandActions(d: Pick<ZoonosesDemand, "state" | "forwarding_state">): DemandAction[] {
  if (d.forwarding_state !== "pending") return [];
  switch (d.state) {
    case "open": return [ "schedule", "inspect", "close", "decline", "extend" ];
    case "scheduled": return [ "inspect", "close", "decline", "extend" ];
    case "inspected": return [ "close", "decline", "extend" ];
    default: return [];
  }
}

// Parâmetros (§9, Q18): o api devolve o erro da tabela sem o índice da linha, no path `values.leish_sample_table`.
const PARAM_PATH = (key: string): string => `values.${key}`;
const tableProblem = (text: string): ZooProblem[] => [ coded("invalid_parameter", PARAM_PATH("leish_sample_table")) ].map((p) => ({ ...p, text }));
export function sampleTableProblems(rows: ZoonosesParameters["leish_sample_table"]): ZooProblem[] {
  if (rows.length === 0) return tableProblem("a tabela da amostra precisa de ao menos uma linha");
  let last = 0;
  for (const row of rows) {
    if (!Number.isInteger(row.population) || row.population <= 0 || !Number.isInteger(row.sample) || row.sample <= 0) {
      return tableProblem("população e amostra: números inteiros maiores que zero");
    }
    if (row.sample > row.population) return tableProblem("a amostra não passa da população da linha");
    if (row.population <= last) return tableProblem("as populações da tabela vão em ordem estritamente crescente");
    last = row.population;
  }
  const min = rows[0].min_population;
  if (min !== undefined && (!Number.isInteger(min) || min <= 0 || min > rows[0].population)) {
    return tableProblem("o mínimo da amostra é um inteiro maior que zero, até a população da 1ª linha");
  }
  return [];
}
export function parameterProblems(v: ZoonosesParameters): ZooProblem[] {
  const out: ZooProblem[] = [];
  const range = (key: keyof ZoonosesParameters, value: number, min: number, max: number, integer: boolean, label: string) => {
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      out.push({ ...coded("invalid_parameter", PARAM_PATH(key)), text: `${label}: ${integer ? "inteiro" : "número"} de ${min} a ${max}`.replace(".", ",") });
    }
  };
  range("observation_days", v.observation_days, 10, 30, true, "dias de observação");
  range("collar_months", v.collar_months, 1, 12, true, "meses da coleira");
  out.push(...sampleTableProblems(v.leish_sample_table));
  range("leish_focus_min_dogs", v.leish_focus_min_dogs, 10, 1000, true, "mínimo de cães do foco");
  range("dogs_per_block", v.dogs_per_block, 1, 100, true, "cães por quarteirão");
  range("rabies_coverage_target", v.rabies_coverage_target, 0.1, 1, false, "meta de cobertura da vacinação");
  for (const key of [ "dog_population_estimate", "cat_population_estimate" ] as const) {
    const n = v[key];
    if (n !== null && (!Number.isInteger(n) || n < 0)) {
      out.push({ ...coded("invalid_parameter", PARAM_PATH(key)), text: "estimativa: número inteiro, 0 ou mais (ou em branco)" });
    }
  }
  return out;
}

// ─── Recusas do api ─────────────────────────────────────────────────────────
// O parser do 24b com a tabela do 35b por cima. `context: "animal_status"`: o PATCH do animal com `status`, onde o 409
// invalid_transition (path status) é a estada aberta no canil (ruling T8) e não uma corrida.
const ZOO_TABLE: Record<string, string> = { ...HOME_VISIT_ERRORS, ...ZOONOSES_ERRORS };
export type ZoonosesContext = "animal_status";
const isOpenStay = (err: ApiError, context?: ZoonosesContext): boolean =>
  context === "animal_status" && err.status === 409 && errorCode(err) === "invalid_transition" && (err.body as { path?: unknown } | null)?.path === "status";

export function zoonosesRefusals(err: unknown, context?: ZoonosesContext): HomeVisitRefusal[] {
  if (err instanceof ApiError) {
    const key = featureDisabledKey(err);
    if (key === "zoonoses" || key === "ombudsman") {
      return [ { path: "", code: "feature_disabled", text: key === "zoonoses" ? ZOONOSES_DISABLED : ZOONOSES_OMBUDSMAN_DISABLED } ];
    }
    if (err.status === 401 && errorCode(err) === "mfa_required") return [ { path: "", code: "mfa_required", text: ZOO_TABLE.mfa_required } ];
    if (isOpenStay(err, context)) return [ { path: "status", code: "invalid_transition", text: ANIMAL_STAY_OPEN } ];
  }
  return homeVisitRefusals(err, ZOO_TABLE);
}
export const zoonosesError = (err: unknown, context?: ZoonosesContext): string => zoonosesRefusals(err, context)[0].text;

// A tela está velha (ou o estado do animal é final): quem chama relê UMA vez e não reenvia. `citizen_not_verified` (409) não é
// corrida, `reserved_subject` é da ouvidoria e as recusas 422 são do formulário.
const STALE = [
  "animal_changed", "animal_not_active", "campaign_changed", "campaign_already_open", "survey_changed", "collar_changed", "invalid_transition",
  "demand_changed", "forwarding_changed", "observation_changed", "test_changed", "stay_changed", "stay_already_open", "already_euthanized",
  "parameters_changed"
];
export function isZoonosesStale(err: unknown, context?: ZoonosesContext): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 404) return true;
  if (err.status !== 409 || isOpenStay(err, context)) return false;
  return STALE.includes(errorCode(err) ?? "");
}
