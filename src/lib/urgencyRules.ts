// src/lib/urgencyRules.ts
// Protocolo de classificação de risco (módulo 32a; ADR 0050; contracts
// protocols-v1.7.0; contrato §3 e §14 Q1/Q16/Q22): `kind:
// "urgency_classification"` com `levels` (as 5 cores, na ordem, com o tempo
// máximo de cada uma) e `classification_rules: [{ id, when, color, criterion }]`
// (1 a 100). Mesmo padrão de riskRules.ts: o JSON do editor é a fonte; estas
// funções leem a definição e devolvem uma nova sem tocar no resto.
import type { ConditionTree, UrgencyColor, UrgencyLevel } from "./api";
import { DEFAULT_LEVELS, URGENCY_COLORS, URGENCY_COLOR_LABEL } from "./urgency";

export interface UrgencyRuleDraft { id: string; when: ConditionTree | null; color: UrgencyColor; criterion: string }
export type LevelsRead = { ok: true; levels: UrgencyLevel[] } | { ok: false; reason: string };
export type UrgencyRulesRead = { ok: true; rules: UrgencyRuleDraft[] } | { ok: false; reason: string };

export const URGENCY_KIND = "urgency_classification";
// Preflight E2: o nome da semente (lib/urgency_crew.rb e o exemplo do
// contracts), para o modelo virar a próxima versão do protocolo da cidade.
// Nunca "acolhimento": é de outro kind e o gate recusa (Q16/Q22).
export const URGENCY_PROTOCOL_NAME = "classificacao-urgencia";
export const URGENCY_RULES_MAX = 100;
export const LEVEL_MAX_MINUTES = 1440;
export const CRITERION_MAX = 120;
const RULE_ID = /^[a-z][a-z0-9_-]{0,39}$/;

export const LEVEL_TIME_TEXT = `o tempo é um número inteiro de minutos, de 0 a ${LEVEL_MAX_MINUTES}`;
const LEVELS_REASON = "“levels” precisa das 5 cores, na ordem vermelho, laranja, amarelo, verde, azul: corrija no JSON";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export function isUrgencyDefinition(definition: unknown): boolean {
  return isObj(definition) && definition.kind === URGENCY_KIND;
}

// O tempo pode chegar fora do limite (o painel mostra o problema); fora do
// formato — cor trocada, faltando, tempo que não é número — só no JSON.
export function readLevels(definition: unknown): LevelsRead {
  const list = isObj(definition) ? definition.levels : undefined;
  if (!Array.isArray(list) || list.length !== URGENCY_COLORS.length) return { ok: false, reason: LEVELS_REASON };
  const wellFormed = list.every((l, i) => isObj(l) && l.color === URGENCY_COLORS[i] &&
    typeof l.max_wait_minutes === "number" && Number.isFinite(l.max_wait_minutes));
  if (!wellFormed) return { ok: false, reason: LEVELS_REASON };
  return { ok: true, levels: (list as Obj[]).map((l) => ({ color: l.color as UrgencyColor, max_wait_minutes: l.max_wait_minutes as number })) };
}

export function writeLevels(definition: unknown, levels: UrgencyLevel[]): unknown {
  return { ...(definition as Obj), levels: levels.map((l) => ({ color: l.color, max_wait_minutes: l.max_wait_minutes })) };
}

// `previous` é a cor mais grave logo acima: o gate recusa tempo menor que o
// dela (`levels_out_of_order`).
export function levelProblem(level: UrgencyLevel, previous?: UrgencyLevel): string | null {
  const m = level.max_wait_minutes;
  if (!Number.isInteger(m) || m < 0 || m > LEVEL_MAX_MINUTES) return LEVEL_TIME_TEXT;
  if (previous && Number.isInteger(previous.max_wait_minutes) && m < previous.max_wait_minutes) {
    return `o ${URGENCY_COLOR_LABEL[level.color]} não pode esperar menos que o ${URGENCY_COLOR_LABEL[previous.color]} (${previous.max_wait_minutes} min)`;
  }
  return null;
}

export function readUrgencyRules(definition: unknown): UrgencyRulesRead {
  if (!isObj(definition)) return { ok: false, reason: "a definição precisa ser um objeto JSON" };
  const list = definition.classification_rules;
  if (list === undefined) return { ok: true, rules: [] };
  if (!Array.isArray(list)) return { ok: false, reason: "“classification_rules” não é uma lista: corrija no JSON" };
  const malformed = list.some((r) => !isObj(r) || typeof r.id !== "string" || (r.when !== undefined && !isObj(r.when)) ||
    !URGENCY_COLORS.includes(r.color as UrgencyColor) || (r.criterion !== undefined && typeof r.criterion !== "string"));
  if (malformed) return { ok: false, reason: "uma regra de cor está fora do formato { id, when, color, criterion }: corrija no JSON" };
  return {
    ok: true,
    rules: (list as Obj[]).map((r) => ({
      id: r.id as string, when: (r.when as ConditionTree | undefined) ?? null, color: r.color as UrgencyColor,
      criterion: (r.criterion as string | undefined) ?? ""
    }))
  };
}

// Condição incompleta sai ausente (o gate aponta); a lista vazia fica no JSON
// e o gate aponta o mínimo de 1.
export function writeUrgencyRules(definition: unknown, rules: UrgencyRuleDraft[]): unknown {
  return {
    ...(definition as Obj),
    classification_rules: rules.map((r) => (r.when === null
      ? { id: r.id, color: r.color, criterion: r.criterion }
      : { id: r.id, when: r.when, color: r.color, criterion: r.criterion }))
  };
}

// `all` (a lista inteira) confere o id repetido, que o gate recusa com `rule_id`.
export function urgencyRuleProblems(rule: UrgencyRuleDraft, all: UrgencyRuleDraft[] = []): string[] {
  const out: string[] = [];
  if (rule.when === null) out.push("defina quando sugerir esta cor");
  if (rule.criterion.trim().length < 1 || rule.criterion.length > CRITERION_MAX) out.push(`o critério tem de 1 a ${CRITERION_MAX} caracteres`);
  if (!RULE_ID.test(rule.id)) out.push("o identificador começa por letra minúscula e usa só minúsculas, números, - e _ (até 40)");
  else if (all.filter((r) => r.id === rule.id).length > 1) out.push(`outra regra já usa o identificador “${rule.id}”`);
  return out;
}

export function nextRuleId(rules: UrgencyRuleDraft[]): string {
  const taken = rules.map((r) => /^r(\d+)$/.exec(r.id)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
  return `r${Math.max(0, ...taken) + 1}`;
}

// Rascunho inicial: só exemplo. A cidade revisa e assina antes de valer
// (gate de go-live: revisão clínica; Manchester depende de licença).
export const URGENCY_TEMPLATE = JSON.stringify(
  {
    name: URGENCY_PROTOCOL_NAME,
    version: 1,
    kind: URGENCY_KIND,
    levels: DEFAULT_LEVELS,
    classification_rules: [
      { id: "r1", when: { lte: [ "vitals.spo2", 89 ] }, color: "red", criterion: "saturação de oxigênio até 89%" },
      { id: "r2", when: { gte: [ "vitals.systolic", 180 ] }, color: "orange", criterion: "pressão sistólica a partir de 180 mmHg" },
      { id: "r3", when: { gte: [ "vitals.temperature_c", 39 ] }, color: "yellow", criterion: "febre a partir de 39 °C" },
      { id: "r4", when: { gte: [ "pain_scale", 8 ] }, color: "orange", criterion: "dor intensa (8 a 10)" },
      { id: "r5", when: { gte: [ "pain_scale", 4 ] }, color: "yellow", criterion: "dor moderada (4 a 7)" }
    ]
  },
  null,
  2
);
