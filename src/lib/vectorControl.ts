// src/lib/vectorControl.ts
// Portões, papéis, chaves de cache, rótulos e as regras de tela do módulo 35a (vigilância ambiental de endemias; ADR 0054;
// contrato 2026-11-16 §1–§12, §17, §20). Puro: nenhuma leitura de rede. As regras do boletim moram em vectorInspection.ts e as
// frases em vectorErrors.ts. O api (apps/api, ab32775c) decide; aqui só se recusa antes o que ele recusaria, com o mesmo
// `path`, e a lista começa pelo erro que o api daria. Código desconhecido aparece cru.
import { ApiError, errorCode, type HomeVisitTeam, type SampleResult, type StratumMode, type VectorParameters, type VectorReportName } from "./api";
import { hasFeature } from "./features";
import {
  HOME_VISIT_ERRORS, NOMINAL_QUERY, STATIC_QUERY, canUseHomeVisits, homeVisitRefusals, textProblem, type HomeVisitRefusal
} from "./homeVisits";
import type { Problem } from "./pharmacy";
import { epiWeekOf } from "./surveillance";
import { VECTOR_ERRORS } from "./vectorErrors";
import { ENDEMIC_AGENT_CBO } from "./vectorInspection";

export { NOMINAL_QUERY, STATIC_QUERY };

// ─── Frases ─────────────────────────────────────────────────────────────────
export const VC_NO_ROLE = "seu papel não permite usar a vigilância ambiental";
export const VC_NOT_AGENT = "só o agente de combate às endemias (CBO 515140) usa esta tela";

// ─── Portões ────────────────────────────────────────────────────────────────
type SessionLike = Parameters<typeof canUseHomeVisits>[0];

// Q1 / VectorControl::Gate: `vector_control` ligado e a visita domiciliar utilizável; nunca o operador.
export function canUseVectorControl(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "vector_control") && canUseHomeVisits(user);
}

// VectorControl::Access: papéis ativos da cidade. `reader` = Access.reader? (coordenação, laboratório ou municipal_admin),
// que o api só usa nos domínios; as outras leituras têm o próprio conjunto (canReadVectorReport, vectorMapLayers, e o
// relatório da Task 3 lista as rotas).
export type VectorRoles = { coordinator: boolean; lab: boolean; reader: boolean; admin: boolean; professional: boolean; stockKeeper: boolean };
export function vectorRoles(user: SessionLike): VectorRoles {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  const coordinator = roles.includes("endemic_coordinator");
  const lab = roles.includes("vector_lab");
  const admin = roles.includes("municipal_admin");
  return {
    coordinator, lab, admin, reader: coordinator || lab || admin,
    professional: roles.includes("health_professional"), stockKeeper: roles.includes("stock_keeper")
  };
}

// A sessão não traz o CBO: o agente de endemias é a equipe do GET /home_visits/context com o 515140 e papel de campo
// (`can_register`, o :field do HomeVisits::Access).
export const isEndemicAgentTeam = (team: HomeVisitTeam): boolean => team.cbo === ENDEMIC_AGENT_CBO && team.can_register;

// Catalog::REPORTS, na ordem do api.
export const VC_REPORT_NAMES: readonly VectorReportName[] = [ "situations", "strategic_points", "production", "consumption", "ovitraps", "liraa", "blocks" ];
// ReportsController#readable?: coordenação e municipal_admin leem os sete; o laboratório só Reports::LAB_REPORTS (Q28).
export const VC_LAB_REPORTS: readonly VectorReportName[] = [ "ovitraps", "liraa" ];
export const canReadVectorReport = (roles: VectorRoles, name: VectorReportName): boolean =>
  roles.coordinator || roles.admin || (roles.lab && VC_LAB_REPORTS.includes(name));
// Lê algum dos relatórios: o item do menu e o portão da tela (Task 4).
export const canReadAnyVectorReport = (roles: VectorRoles): boolean => VC_REPORT_NAMES.some((name) => canReadVectorReport(roles, name));

// MapPointsController: a coordenação lê as três camadas; o laboratório só `ovitraps`; os outros nenhuma (403 missing_role).
export type VectorMapLayer = "risk" | "ovitraps" | "transmission";
export function vectorMapLayers(roles: VectorRoles): VectorMapLayer[] {
  if (roles.coordinator) return [ "risk", "ovitraps", "transmission" ];
  return roles.lab ? [ "ovitraps" ] : [];
}

// DiseasesController (Q38): só a coordenação e o municipal_admin leem os nomes das doenças; os outros recebem 403.
export const canReadVectorDiseases = (roles: VectorRoles): boolean => roles.coordinator || roles.admin;

// ─── Chaves de cache ────────────────────────────────────────────────────────
export const VC_DOMAINS_KEY = "vcDomains";
export const VC_BLOCKS_KEY = "vcBlocks";
export const VC_HOUSEHOLDS_KEY = "vcHouseholds";
export const VC_PROFILE_KEY = "vcProfile";
export const VC_DUE_KEY = "vcDue";
export const VC_CYCLES_KEY = "vcCycles";
export const VC_CYCLE_KEY = "vcCycle";
export const VC_CADENCES_KEY = "vcCadences";
export const VC_PARAMS_KEY = "vcParams";
export const VC_PRODUCTS_KEY = "vcProducts";
export const VC_SETTINGS_KEY = "vcSettings";
export const VC_OVITRAPS_KEY = "vcOvitraps";
export const VC_READINGS_KEY = "vcReadings";
export const VC_TASKS_KEY = "vcTasks";
export const VC_SURVEYS_KEY = "vcSurveys";
export const VC_ITEMS_KEY = "vcItems";
export const VC_BLOCKS_TB_KEY = "vcTransmissionBlocks";
export const VC_BLOCK_TB_KEY = "vcTransmissionBlock";
export const VC_SAMPLES_KEY = "vcSamples";
export const VC_SHORTFALLS_KEY = "vcShortfalls";
export const VC_REPORT_KEY = "vcReport";
export const VC_MAP_KEY = "vcMap";
export const VC_DISEASES_KEY = "vcDiseases";

// ─── Rótulos (código desconhecido aparece cru) ──────────────────────────────
const pick = (map: Record<string, string>, key: string): string => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key);

export const domainLabel = (list: readonly { code: string; label: string }[], code: string): string =>
  list.find((row) => row.code === code)?.label ?? code;

// Tons do tema (Tag): o roxo é o `accent`; sem classe ou classe nova, neutro.
export type RiskTone = "ok" | "warn" | "down" | "neutral" | "accent";
const RISK_TONE: Record<string, RiskTone> = { green: "ok", yellow: "warn", red: "down", gray: "neutral", purple: "accent" };
// As classes de risco do api (Catalog::RISK_CLASSES), na ordem dos domínios.
export const RISK_CLASSES = Object.keys(RISK_TONE) as readonly string[];
export const riskTone = (r: string | null | undefined): RiskTone => (r && Object.prototype.hasOwnProperty.call(RISK_TONE, r) ? RISK_TONE[r] : "neutral");

const DUE_REASON: Record<string, string> = { transmission_block: "bloqueio", liraa: "LIRAa", pending: "pendência", due: "vencido" };
const OVITRAP_STATUS: Record<string, string> = { active: "ativa", removed: "retirada", lost: "perdida" };
const CONDITION: Record<string, string> = { ok: "em bom estado", damaged: "avariada", lost: "perdida", dry: "seca" };
const TASK_KIND: Record<string, string> = {
  ovitrap_intensification: "Intensificar em torno da ovitrampa", case_resident_elsewhere: "Caso de residente de outro município",
  block_case_without_place: "Caso de bloqueio sem quarteirão"
};
const TASK_STATE: Record<string, string> = { open: "aberta", done: "concluída", dismissed: "descartada" };
const SURVEY_STATUS: Record<string, string> = { draft: "rascunho", drawn: "sorteado", closed: "fechado" };
const STRATUM_MODE: Record<string, string> = {
  standard: "Padrão (8.100 a 12.000 imóveis)", half: "Reduzido (2.000 a 8.099)", census: "Censitário (até 1.999)"
};
const BLOCK_STATUS: Record<string, string> = { proposed: "proposto", active: "ativo", closed: "fechado", dismissed: "descartado" };
const SHORTFALL_CAUSE: Record<string, string> = {
  no_location: "sem local de estoque configurado", insufficient_balance: "saldo insuficiente", no_lot: "sem lote do produto"
};
const ITEM_STATUS: Record<string, string> = { pending: "pendente", inspected: "inspecionado", substituted: "substituído" };

export const dueReasonLabel = (code: string): string => pick(DUE_REASON, code);
export const ovitrapStatusLabel = (code: string): string => pick(OVITRAP_STATUS, code);
export const conditionLabel = (code: string): string => pick(CONDITION, code);
export const taskKindLabel = (code: string): string => pick(TASK_KIND, code);
export const taskStateLabel = (code: string): string => pick(TASK_STATE, code);
export const surveyStatusLabel = (code: string): string => pick(SURVEY_STATUS, code);
// Com `p` (os parâmetros vigentes, GET /parameters), as faixas saem deles, como no Liraa::Sample.in_range?; sem `p`, o texto
// do padrão de fábrica (defaults.yml).
export type StratumRangeParams = Pick<VectorParameters, "liraa_standard_min" | "liraa_standard_max" | "liraa_half_min">;
export function stratumModeLabel(code: string, p?: StratumRangeParams): string {
  if (!p) return pick(STRATUM_MODE, code);
  const fmt = (v: number) => NUM.format(v);
  switch (code) {
    case "standard": return `Padrão (${fmt(p.liraa_standard_min)} a ${fmt(p.liraa_standard_max)} imóveis)`;
    case "half": return `Reduzido (${fmt(p.liraa_half_min)} a ${fmt(p.liraa_standard_min - 1)})`;
    case "census": return `Censitário (até ${fmt(p.liraa_half_min - 1)})`;
    default: return code;
  }
}
export const blockStatusLabel = (code: string): string => pick(BLOCK_STATUS, code);
// Q38: nome da doença e rótulo do grupo pelo GET /vector_control/diseases; sem a lista (carregando, falha, sem leitura) ou código
// desconhecido, o código cru.
export const diseaseName = (d: { items: readonly { code: string; name: string }[] } | null | undefined, code: string): string =>
  d?.items.find((x) => x.code === code)?.name ?? code;
export const diseaseGroupLabel = (d: { groups: readonly { code: string; label: string }[] } | null | undefined, code: string): string =>
  d?.groups.find((x) => x.code === code)?.label ?? code;
export const shortfallCauseLabel = (code: string): string => pick(SHORTFALL_CAUSE, code);
export const itemStatusLabel = (code: string): string => pick(ITEM_STATUS, code);
// §17: o caso do bloqueio é só "caso N" (sequência da cidade, Q13(6)), nunca o paciente.
export const caseLabel = (c: { number: number }): string => `caso ${c.number}`;

// ─── Regras de tela ─────────────────────────────────────────────────────────
// `code`: o código do api quando ele tem um (com a frase da tabela); null quando o api responderia `invalid_request`.
export type VectorProblem = Problem & { code: string | null };

const DAY = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// AAAA-MM-DD que existe (o Date.strptime do api recusa 30 de fevereiro); senão null.
function isoDay(raw: string): number | null {
  const m = DATE.exec(raw);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === raw ? t : null;
}
const daysBetween = (from: number, to: number): number => Math.round((to - from) / DAY);
const NUM = new Intl.NumberFormat("pt-BR");
const coded = (code: string, path: string): VectorProblem => ({ code, path, text: VECTOR_ERRORS[code as keyof typeof VECTOR_ERRORS] ?? code });
const local = (path: string, text: string): VectorProblem => ({ code: null, path, text });
const INTEGER = /^\d+$/;

// Catalog::NOTE (10–500 depois do strip), em code points como o api.
export const noteProblem = (text: string, path: string): Problem | null => textProblem(text, { min: 10, max: 500, path });
const noteVectorProblem = (text: string, path: string): VectorProblem | null => {
  const p = noteProblem(text, path);
  return p ? { ...p, code: null } : null;
};

// Catalog::BLOCK_NUMBER, sem cortar espaço (recusar em vez de cortar).
const BLOCK_NUMBER = /^[0-9A-Za-z-]{1,10}$/;
export const blockNumberProblem = (n: string): Problem | null =>
  BLOCK_NUMBER.test(n) ? null : { path: "number", text: "número do quarteirão: de 1 a 10 letras, dígitos ou hífen, sem espaço" };

// InstallOvitrap, na ordem do api: número (Q7(6)) e data (invalid_request), depois o quarteirão do perfil e o termo.
// `householdHasBlock: null` = perfil ainda não lido (não confere).
const OVITRAP_NUMBER = /^[0-9A-Za-z-]{1,12}$/;
export function installProblems(
  d: { number: string; consent: boolean; installedOn: string; householdHasBlock: boolean | null }, today: string
): VectorProblem[] {
  const out: VectorProblem[] = [];
  if (!OVITRAP_NUMBER.test(d.number)) out.push(local("number", "número da ovitrampa: de 1 a 12 letras, dígitos ou hífen, sem espaço"));
  const installed = isoDay(d.installedOn);
  if (installed === null || d.installedOn > today) out.push(local("installed_on", "informe a data de instalação, até hoje"));
  if (d.householdHasBlock === false) out.push(coded("household_without_block", "household_id"));
  if (!d.consent) out.push(coded("consent_required", "consent"));
  return out;
}

const CONDITIONS = [ "ok", "damaged", "lost", "dry" ];
// CollectOvitrap: data (até hoje) e condição (invalid_request), depois a janela da palheta em dias corridos
// (`collected_on − installed_on` em [min, max], Q9/D-11). `installedOn` é o da leitura aberta.
export function collectionProblems(
  d: { installedOn: string; collectedOn: string; condition: string | null },
  p: Pick<VectorParameters, "ovitrap_collection_days_min" | "ovitrap_collection_days_max">, today: string
): VectorProblem[] {
  const out: VectorProblem[] = [];
  const collected = isoDay(d.collectedOn);
  const dateOk = collected !== null && d.collectedOn <= today;
  if (!dateOk) out.push(local("collected_on", "informe a data da coleta, até hoje"));
  if (!CONDITIONS.includes(d.condition ?? "")) out.push(local("condition", "escolha a condição da palheta"));
  const installed = isoDay(d.installedOn);
  if (dateOk && installed !== null) {
    const days = daysBetween(installed, collected);
    if (days < p.ovitrap_collection_days_min || days > p.ovitrap_collection_days_max) out.push(coded("collection_out_of_range", "collected_on"));
  }
  return out;
}

// CountReading: ovos inteiros 0–9999; a nota só na correção (a primeira com nota → count_note) e então de 10 a 500;
// `previous` (a contagem que a palheta já tem): a correção que mantém a contagem recusa em egg_count (Q23).
export function countProblems(d: { eggs: string; note: string }, corrected: boolean, previous: number | null = null): VectorProblem[] {
  const out: VectorProblem[] = [];
  const eggs = d.eggs.trim();
  const valid = INTEGER.test(eggs) && Number(eggs) <= 9999;
  if (!valid) out.push(local("egg_count", "ovos: número inteiro de 0 a 9.999"));
  if (!corrected) {
    if (d.note.trim() !== "") out.push(local("count_note", "a nota só vale na correção de uma contagem"));
    return out;
  }
  const note = noteVectorProblem(d.note, "count_note");
  if (note) out.push(note);
  else if (valid && previous !== null && Number(eggs) === previous) out.push(local("egg_count", "a correção muda a contagem — a mesma contagem com outra nota não é correção"));
  return out;
}

// RecordSampleResult: os três números inteiros ≥ 0; examinadas ≤ coletadas (path examined_larvae) e aegypti + albopictus ≤
// examinadas (path aegypti_larvae); nota só na correção (10–500); a correção que repete os três números recusa em examined_larvae.
export const SAMPLE_SAME_NUMBERS = "a correção muda algum número — os mesmos números com outra nota não são correção";
export function sampleResultProblems(
  d: { examined: string; aegypti: string; albopictus: string; note: string },
  s: { larvae_collected: number; result?: SampleResult | null }, corrected: boolean
): VectorProblem[] {
  const out: VectorProblem[] = [];
  const fields = [ [ "examined_larvae", d.examined ], [ "aegypti_larvae", d.aegypti ], [ "albopictus_larvae", d.albopictus ] ] as const;
  const bad = fields.filter(([ , raw ]) => !INTEGER.test(raw.trim()));
  for (const [ path ] of bad) out.push(local(path, "número inteiro, 0 ou mais"));
  if (bad.length > 0) return out;
  const [ examined, aegypti, albopictus ] = fields.map(([ , raw ]) => Number(raw.trim()));
  if (examined > s.larvae_collected) out.push(coded("sample_result_invalid", "examined_larvae"));
  else if (aegypti + albopictus > examined) out.push(coded("sample_result_invalid", "aegypti_larvae"));
  if (!corrected) {
    if (d.note.trim() !== "") out.push(local("result_note", "a nota só vale na correção de um resultado"));
    return out;
  }
  const note = noteVectorProblem(d.note, "result_note");
  if (note) out.push(note);
  else if (out.length === 0 && s.result && s.result.examined_larvae === examined && s.result.aegypti_larvae === aegypti
    && s.result.albopictus_larvae === albopictus) {
    out.push(local("examined_larvae", SAMPLE_SAME_NUMBERS));
  }
  return out;
}

const UBV_CYCLES_CAP = 3; // Catalog::UBV_NUMBERS (o CHECK do banco)
// Blocks::AddCycle, na ordem do api: datas; já com o máximo de ciclos (path cycles); duração inclusiva fora de
// [min, max] (path ends_on); início antes do fim do anterior + intervalo (path starts_on). `prev` = os ciclos do bloqueio
// na ordem do número (o do api), o último é o anterior.
export function ubvCycleProblems(
  prev: readonly { ends_on: string }[], d: { starts_on: string; ends_on: string },
  p: Pick<VectorParameters, "ubv_cycles_max" | "ubv_cycle_days_min" | "ubv_cycle_days_max" | "ubv_cycle_interval_days">
): VectorProblem[] {
  const out: VectorProblem[] = [];
  const starts = isoDay(d.starts_on);
  const ends = isoDay(d.ends_on);
  if (starts === null) out.push(local("starts_on", "informe a data de início"));
  if (ends === null) out.push(local("ends_on", "informe a data de fim"));
  const max = Math.min(p.ubv_cycles_max, UBV_CYCLES_CAP);
  if (prev.length >= max) out.push({ code: "cycle_invalid", path: "cycles", text: `o bloqueio já tem ${max} ciclos de UBV, o máximo` });
  if (starts === null || ends === null) return out;
  const days = daysBetween(starts, ends) + 1;
  if (days < p.ubv_cycle_days_min || days > p.ubv_cycle_days_max) {
    out.push({ code: "cycle_invalid", path: "ends_on", text: `o ciclo dura de ${p.ubv_cycle_days_min} a ${p.ubv_cycle_days_max} dias, contando o primeiro e o último` });
  }
  const last = prev.length > 0 ? isoDay(prev[prev.length - 1].ends_on) : null;
  if (last !== null && daysBetween(last, starts) < p.ubv_cycle_interval_days) {
    out.push({ code: "cycle_invalid", path: "starts_on", text: `o ciclo começa ao menos ${p.ubv_cycle_interval_days} dias depois do fim do anterior` });
  }
  return out;
}

// SaveCycle: ano 2000–2100, número 1–12 (opcional: sem ele, o próximo do ano), datas; ano civil ou epidemiológico do início
// (Q22, Surveillance::EpiWeek) → cycle_invalid path year; fim antes do início → cycle_invalid path ends_on.
export function cycleProblems(d: { year: number; number?: number | null; starts_on: string; ends_on: string }): VectorProblem[] {
  const out: VectorProblem[] = [];
  if (!Number.isInteger(d.year) || d.year < 2000 || d.year > 2100) out.push(local("year", "ano de 2000 a 2100"));
  if (d.number !== undefined && d.number !== null && (!Number.isInteger(d.number) || d.number < 1 || d.number > 12)) {
    out.push(local("number", "número do ciclo de 1 a 12"));
  }
  const starts = isoDay(d.starts_on);
  const ends = isoDay(d.ends_on);
  if (starts === null) out.push(local("starts_on", "informe a data de início"));
  if (ends === null) out.push(local("ends_on", "informe a data de fim"));
  if (out.length > 0 || starts === null || ends === null) return out;
  const years = [ Number(d.starts_on.slice(0, 4)), Number(epiWeekOf(d.starts_on).slice(0, 4)) ];
  if (!years.includes(d.year)) out.push({ code: "cycle_invalid", path: "year", text: "o ano do ciclo é o ano civil ou o epidemiológico da data de início" });
  if (ends < starts) out.push({ code: "cycle_invalid", path: "ends_on", text: "o fim do ciclo vem depois do início" });
  return out;
}

// Liraa::Sample.in_range?: padrão de standard_min a standard_max; reduzido de half_min até antes de standard_min; censitário
// até antes de half_min. N zero só no censitário. `blocksCount` (opcional): estrato sem quarteirão recusa em qualquer tipo
// (sample.rb:29, `big_b.positive?`). Texto com a faixa dos parâmetros vigentes; null = dentro.
const STRATUM_NAME: Record<string, string> = { standard: "Padrão", half: "Reduzido", census: "Censitário" };
export function stratumRangeProblem(mode: StratumMode, n: number, p: StratumRangeParams, blocksCount?: number): string | null {
  const fmt = (v: number) => NUM.format(v);
  if (blocksCount === 0) return "escolha ao menos um quarteirão para o estrato";
  let inside: boolean;
  let range: string;
  switch (mode) {
    case "standard": inside = n >= p.liraa_standard_min && n <= p.liraa_standard_max; range = `de ${fmt(p.liraa_standard_min)} a ${fmt(p.liraa_standard_max)}`; break;
    case "half": inside = n >= p.liraa_half_min && n < p.liraa_standard_min; range = `de ${fmt(p.liraa_half_min)} a ${fmt(p.liraa_standard_min - 1)}`; break;
    case "census": inside = n >= 0 && n < p.liraa_half_min; range = `até ${fmt(p.liraa_half_min - 1)}`; break;
    default: return `${VECTOR_ERRORS.stratum_out_of_range} (tipo ${String(mode)})`;
  }
  if (inside && (n > 0 || mode === "census")) return null;
  return `${STRATUM_NAME[mode]} vale ${range} imóveis — este estrato tem ${fmt(n)}`;
}

// A nota da contagem e do resultado é só da correção, e o api recusa qualquer nota presente na primeira, até "" (count_reading.rb:47,
// record_sample_result.rb:56). O corpo leva a chave só com texto depois do trim; em branco, a chave não vai.
export function optionalNote<K extends "count_note" | "result_note">(key: K, text: string): { [P in K]?: string } {
  const clean = text.trim();
  return (clean === "" ? {} : { [key]: clean }) as { [P in K]?: string };
}

// ─── Recusas do api ─────────────────────────────────────────────────────────
// O parser do 24b com a tabela do 35a por cima (cbo_not_allowed é o do agente de endemias). O 401 mfa_required (step-up
// vencido entre a leitura e o clique) diz isso, não "sessão expirada".
const VECTOR_TABLE: Record<string, string> = { ...HOME_VISIT_ERRORS, ...VECTOR_ERRORS };
export function vectorRefusals(err: unknown): HomeVisitRefusal[] {
  if (err instanceof ApiError && err.status === 401 && errorCode(err) === "mfa_required") {
    return [ { path: "", code: "mfa_required", text: VECTOR_TABLE.mfa_required } ];
  }
  return homeVisitRefusals(err, VECTOR_TABLE);
}
export const vectorError = (err: unknown): string => vectorRefusals(err)[0].text;

// A tela está velha: quem chama relê UMA vez e não reenvia. Os 409 de estado, o not_found, a proposta do bloqueio que
// ganhou caso (409 proposal_changed), a lista de casos vistos recusada (422 path seen_case_ids; Q26(4)) e os parâmetros gravados
// por outra pessoa (409 parameters_changed; Q34), as cadências gravadas por outra pessoa (409 cadences_changed; Q35) e a
// contagem ou o resultado corrigidos por outra pessoa (409 reading_changed / sample_changed; Q36: a correção relê e mantém o digitado), e o rascunho do LIRAa gravado por
// outra pessoa (409 survey_changed; Q37(2): relê e mantém o digitado).
const STALE = [
  "invalid_transition", "survey_not_draft", "already_reconciled", "not_found", "proposal_changed", "block_in_use", "product_in_use", "parameters_changed",
  "cadences_changed", "reading_changed", "sample_changed", "survey_changed"
];
export function isVectorStale(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 404) return true;
  const refusal = vectorRefusals(err)[0];
  if (STALE.includes(refusal.code)) return true;
  return refusal.code === "invalid_request" && refusal.path === "seen_case_ids";
}
