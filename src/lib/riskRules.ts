// src/lib/riskRules.ts
// Protocolo de acolhimento (módulo 18; schema protocols-v1.6.0, contratos §1):
// `kind: "screening"` com `risk_rules: [{ when, color }]` (1 a 50). Mesmo padrão
// de schedulingRules.ts: o JSON do editor é a fonte; estas funções leem a
// definição e devolvem uma nova sem tocar no resto.
import type { ConditionTree, ScreeningColor } from "./api";
import { COLORS } from "./screening";

export interface RiskRuleDraft { when: ConditionTree | null; color: ScreeningColor }
export type RiskRead = { ok: true; rules: RiskRuleDraft[] } | { ok: false; reason: string };

export const RISK_RULES_MAX = 50;
export const SCREENING_NAME = "acolhimento";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export function isScreeningDefinition(definition: unknown): boolean {
  return isObj(definition) && definition.kind === "screening";
}

export function readRiskRules(definition: unknown): RiskRead {
  if (!isObj(definition)) return { ok: false, reason: "a definição precisa ser um objeto JSON" };
  const list = definition.risk_rules;
  if (list === undefined) return { ok: true, rules: [] };
  if (!Array.isArray(list)) return { ok: false, reason: "“risk_rules” não é uma lista: corrija no JSON" };
  const malformed = list.some((r) => !isObj(r) || (r.when !== undefined && !isObj(r.when)) ||
    !COLORS.includes(r.color as ScreeningColor));
  if (malformed) return { ok: false, reason: "uma regra de cor está fora do formato { when, color }: corrija no JSON" };
  return { ok: true, rules: (list as Obj[]).map((r) => ({ when: (r.when as ConditionTree | undefined) ?? null, color: r.color as ScreeningColor })) };
}

// `risk_rules` é obrigatório na variante: a lista vazia fica no JSON e o gate
// aponta o mínimo de 1. Condição incompleta sai ausente (o gate aponta).
export function writeRiskRules(definition: unknown, rules: RiskRuleDraft[]): unknown {
  return { ...(definition as Obj), risk_rules: rules.map((r) => (r.when === null ? { color: r.color } : { when: r.when, color: r.color })) };
}

export function riskRuleProblem(rule: RiskRuleDraft): string | null {
  return rule.when === null ? "defina quando sugerir esta cor" : null;
}

// Rascunho inicial (spec §3.3 e §10): ponto de partida que a cidade revisa e assina.
export const SCREENING_TEMPLATE = JSON.stringify(
  {
    name: SCREENING_NAME,
    version: 1,
    kind: "screening",
    risk_rules: [
      { when: { gte: [ "vitals.systolic", 180 ] }, color: "red" },
      { when: { lte: [ "vitals.spo2", 89 ] }, color: "red" },
      { when: { gte: [ "vitals.temperature_c", 39 ] }, color: "yellow" },
      { when: { gte: [ "vitals.capillary_glucose", 300 ] }, color: "yellow" }
    ]
  },
  null,
  2
);
