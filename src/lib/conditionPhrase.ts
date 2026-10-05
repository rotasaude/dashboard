// src/lib/conditionPhrase.ts
// Condição em frase em português (módulo 15; spec §7: "frase sempre
// visível"). Descreve qualquer árvore da linguagem do ADR 0009, não só o
// subconjunto do construtor: a mesma função serve à regra avançada e às
// colunas da aba do catálogo.
import { joinPt } from "./audiencePhrase";
import type { ConditionField } from "./condition";

export const UNKNOWN_RULE = "regra não reconhecida";

const OPERATORS = new Set([ "eq", "in", "gt", "lt", "gte", "lte", "all", "any", "not" ]);
const COMPARE: Record<string, string> = { gte: "a partir de", lte: "até", gt: "acima de", lt: "abaixo de" };
type Fields = Map<string, ConditionField>;

export function describeCondition(tree: unknown, fields: ConditionField[], emptyText: string): string {
  if (tree === null || tree === undefined) return emptyText;
  return phrase(tree, new Map(fields.map((f) => [ f.id, f ])));
}

function entries(node: unknown): Array<[ string, unknown ]> | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  return Object.entries(node as Record<string, unknown>);
}

function operand(arg: unknown): [ string, unknown ] | null {
  return Array.isArray(arg) && arg.length === 2 && typeof arg[0] === "string" ? [ arg[0], arg[1] ] : null;
}

function label(id: string, fields: Fields): string {
  return fields.get(id)?.label ?? id;
}

function withUnit(v: unknown, field?: ConditionField): string {
  if (typeof v !== "number") return String(v);
  const unit = v === 1 && field?.unitOne ? field.unitOne : field?.unit ?? "";
  return `${v}${unit}`;
}

function valueLabel(v: unknown, field?: ConditionField): string {
  const s = String(v);
  if (!field?.options) return s;
  return field.options.find((o) => o.value === s)?.label ?? `${s} (fora da lista)`;
}

function phrase(node: unknown, fields: Fields): string {
  const e = entries(node);
  if (!e || e.length === 0) return UNKNOWN_RULE;
  if (e.length !== 1 || !OPERATORS.has(e[0][0])) return legacy(e, fields);
  const [ op, arg ] = e[0];
  if (op in COMPARE) return compare(op, arg, fields);
  if (op === "eq") return equals(arg, fields);
  if (op === "in") return member(arg, fields);
  if (op === "not") return `não (${phrase(arg, fields)})`;
  if (op === "all") return rangePhrase(arg, fields) ?? list(arg, "e", fields);
  return list(arg, "ou", fields);
}

function compare(op: string, arg: unknown, fields: Fields): string {
  const o = operand(arg);
  if (!o) return UNKNOWN_RULE;
  return `${label(o[0], fields)} ${COMPARE[op]} ${withUnit(o[1], fields.get(o[0]))}`;
}

function equals(arg: unknown, fields: Fields): string {
  const o = operand(arg);
  if (!o) return UNKNOWN_RULE;
  const field = fields.get(o[0]);
  if (field?.kind === "number") return `${field.label} igual a ${withUnit(o[1], field)}`;
  return `${label(o[0], fields)}${field?.verb ?? " "}${valueLabel(o[1], field)}`;
}

function member(arg: unknown, fields: Fields): string {
  const o = operand(arg);
  if (!o || !Array.isArray(o[1]) || o[1].length === 0) return UNKNOWN_RULE;
  const field = fields.get(o[0]);
  return `${label(o[0], fields)}${field?.verb ?? " "}${joinPt(o[1].map((v) => valueLabel(v, field)), "ou")}`;
}

function rangePhrase(arg: unknown, fields: Fields): string | null {
  if (!Array.isArray(arg) || arg.length !== 2) return null;
  const lo = entries(arg[0]);
  const hi = entries(arg[1]);
  if (lo?.length !== 1 || hi?.length !== 1 || lo[0][0] !== "gte" || hi[0][0] !== "lte") return null;
  const a = operand(lo[0][1]);
  const b = operand(hi[0][1]);
  if (!a || !b || a[0] !== b[0] || typeof a[1] !== "number" || typeof b[1] !== "number") return null;
  const field = fields.get(a[0]);
  if (a[1] === b[1]) return `${label(a[0], fields)} igual a ${withUnit(a[1], field)}`;
  return `${label(a[0], fields)} entre ${a[1]} e ${withUnit(b[1], field)}`;
}

// Filho E/OU com mais de um item vai entre parênteses; o "entre" não.
function composite(node: unknown): boolean {
  const e = entries(node);
  if (!e || e.length !== 1) return false;
  const [ op, arg ] = e[0];
  if ((op !== "all" && op !== "any") || !Array.isArray(arg) || arg.length < 2) return false;
  return !(op === "all" && rangePhrase(arg, new Map()) !== null);
}

function list(arg: unknown, word: "e" | "ou", fields: Fields): string {
  if (!Array.isArray(arg) || arg.length === 0) return UNKNOWN_RULE;
  return arg.map((c) => (composite(c) ? `(${phrase(c, fields)})` : phrase(c, fields))).join(` ${word} `);
}

// Mapa legado {passo: valor} = E de igualdades (ADR 0009).
function legacy(e: Array<[ string, unknown ]>, fields: Fields): string {
  return e.map(([ id, v ]) => `${label(id, fields)}${fields.get(id)?.verb ?? " "}${valueLabel(v, fields.get(id))}`).join(" e ");
}
