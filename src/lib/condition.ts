// src/lib/condition.ts
// Construtor de condições (módulo 15; ADR 0027 sobre a linguagem do ADR 0009;
// spec §7). Converte a árvore JSON num modelo de tela — grupos E/OU, linhas
// campo · operador · valor, NÃO por linha ou grupo — e de volta. Tudo puro: o
// componente só desenha o modelo e a API é quem avalia.
//
// Subconjunto do construtor (o resto é "regra avançada", mostrada em frase):
// - linha numérica: {gte:[v,n]}, {lte:[v,n]}; "entre" = {all:[{gte:[v,a]},{lte:[v,b]}]}
//   com a < b; "igual a" = o mesmo par com a = b, para não depender de `eq`
//   comparar número com texto no servidor;
// - linha de escolha: {in:[v,[...]]} (aceita {eq:[v,"x"]} e o reescreve como in);
// - linha de sim/não (resposta boolean): {eq:[passo,"true"|"false"]};
// - {not: linha} e {not: grupo}, uma vez só;
// - grupo {all|any:[...]}: linhas e, só na raiz, subgrupos de linhas.
// Uma raiz E com uma linha só sai como a linha sozinha ({gte:["profile.age",60]}).
import type { ConditionTree, PanelNeighborhood } from "./api";
import { SEX_OPTIONS } from "./profile";

export type ConditionContext = "eligibility" | "suggestion" | "restriction";
export type FieldKind = "number" | "choice" | "boolean";
export interface FieldOption { value: string; label: string; inactive?: boolean }
export interface ConditionField {
  id: string;
  label: string;
  kind: FieldKind;
  group: string;
  unit?: string;
  unitOne?: string;
  min?: number;
  max?: number;
  options?: FieldOption[];
  // Entre o rótulo e o valor na frase: " " para "sexo feminino", " é " para respostas.
  verb?: string;
}

export type ConditionRow =
  | { kind: "row"; key: string; field: string; op: "gte" | "lte" | "eq"; value: number | null; negated: boolean }
  | { kind: "row"; key: string; field: string; op: "between"; value: [ number | null, number | null ]; negated: boolean }
  | { kind: "row"; key: string; field: string; op: "in"; value: string[]; negated: boolean }
  | { kind: "row"; key: string; field: string; op: "is"; value: string; negated: boolean };
export type RowOp = ConditionRow["op"];
export interface ConditionGroup {
  kind: "group";
  key: string;
  mode: "all" | "any";
  negated: boolean;
  children: ConditionNode[];
}
export type ConditionNode = ConditionRow | ConditionGroup;
export type ParsedCondition = { ok: true; root: ConditionGroup } | { ok: false };

export const RESERVED_PREFIXES = [ "profile.", "outcome.", "citizen." ];
export const BOOLEAN_OPTIONS: FieldOption[] = [ { value: "true", label: "sim" }, { value: "false", label: "não" } ];
export const OP_LABELS: Record<RowOp, string> = {
  gte: "a partir de", lte: "até", between: "entre", eq: "igual a", in: "é um de", is: "é"
};

// ─── Campos por contexto ────────────────────────────────────────────────────

const AGE: ConditionField = {
  id: "profile.age", label: "idade", kind: "number", group: "Perfil", unit: " anos", unitOne: " ano", min: 0, max: 130
};
const SEX: ConditionField = {
  id: "profile.sex", label: "sexo", kind: "choice", group: "Perfil",
  options: SEX_OPTIONS.map((o) => ({ value: o.value, label: o.label.toLowerCase() }))
};

export interface FieldSources { definition?: unknown; neighborhoods?: PanelNeighborhood[] }

export function fieldsFor(context: ConditionContext, sources: FieldSources = {}): ConditionField[] {
  if (context === "eligibility") return [ AGE, SEX ];
  if (context === "restriction") return [ AGE, SEX, neighborhoodField(sources.neighborhoods ?? []) ];
  return [ AGE, SEX, ...stepFields(sources.definition), ...outcomeFields(sources.definition) ];
}

function neighborhoodField(list: PanelNeighborhood[]): ConditionField {
  const sorted = [ ...list ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    id: "citizen.neighborhood_id", label: "bairro", kind: "choice", group: "Cidade",
    options: sorted.map((n) => (n.active
      ? { value: n.id, label: n.name }
      : { value: n.id, label: `${n.name} (bairro inativo)`, inactive: true }))
  };
}

type RawStep = { id?: unknown; prompt?: unknown; answer_type?: unknown; options?: unknown };

function rawSteps(definition: unknown): RawStep[] {
  const steps = definition && typeof definition === "object" ? (definition as { steps?: unknown }).steps : undefined;
  return Array.isArray(steps) ? steps.filter((s): s is RawStep => !!s && typeof s === "object") : [];
}

// Texto livre não entra: comparar texto digitado pelo cidadão não é regra clínica.
function stepFields(definition: unknown): ConditionField[] {
  return rawSteps(definition).flatMap((s): ConditionField[] => {
    const id = typeof s.id === "string" ? s.id : "";
    if (!id || RESERVED_PREFIXES.some((p) => id.startsWith(p))) return [];
    const label = `“${typeof s.prompt === "string" && s.prompt ? s.prompt : id}”`;
    if (s.answer_type === "boolean") {
      return [ { id, label, group: "Respostas", verb: " é ", kind: "boolean", options: BOOLEAN_OPTIONS } ];
    }
    if (s.answer_type === "enum") {
      const options = Array.isArray(s.options) ? s.options.filter((o): o is string => typeof o === "string") : [];
      return [ { id, label, group: "Respostas", verb: " é ", kind: "choice", options: options.map((o) => ({ value: o, label: o })) } ];
    }
    if (s.answer_type === "integer") return [ { id, label, group: "Respostas", kind: "number" } ];
    return [];
  });
}

export function tiersOf(definition: unknown): string[] {
  const scoring = definition && typeof definition === "object" ? (definition as { scoring?: unknown }).scoring : undefined;
  if (!scoring || typeof scoring !== "object") return [];
  const s = scoring as { thresholds?: unknown; rules?: unknown; fallback?: unknown };
  const out: string[] = [];
  if (s.thresholds && typeof s.thresholds === "object") out.push(...Object.keys(s.thresholds));
  if (Array.isArray(s.rules)) {
    for (const rule of s.rules) {
      const tier = rule && typeof rule === "object" ? (rule as { tier?: unknown }).tier : undefined;
      if (typeof tier === "string") out.push(tier);
    }
  }
  const fallback = s.fallback && typeof s.fallback === "object" ? (s.fallback as { tier?: unknown }).tier : undefined;
  if (typeof fallback === "string") out.push(fallback);
  return [ ...new Set(out) ];
}

function outcomeFields(definition: unknown): ConditionField[] {
  return [
    { id: "outcome.tier", label: "classificação", kind: "choice", group: "Resultado",
      options: tiersOf(definition).map((t) => ({ value: t, label: t })) },
    { id: "outcome.score", label: "pontuação", kind: "number", group: "Resultado" },
    { id: "outcome.priority", label: "prioridade", kind: "number", group: "Resultado", min: 1, max: 9 }
  ];
}

// ─── Modelo ─────────────────────────────────────────────────────────────────

let seq = 0;
export function nextKey(): string {
  seq += 1;
  return `k${seq}`;
}

export function newGroup(mode: "all" | "any"): ConditionGroup {
  return { kind: "group", key: nextKey(), mode, negated: false, children: [] };
}

export function emptyRoot(): ConditionGroup {
  return newGroup("all");
}

export function opsFor(kind: FieldKind): RowOp[] {
  if (kind === "number") return [ "gte", "lte", "between", "eq" ];
  if (kind === "choice") return [ "in" ];
  return [ "is" ];
}

export function newRow(field: ConditionField, op: RowOp = opsFor(field.kind)[0]): ConditionRow {
  const base = { kind: "row" as const, key: nextKey(), field: field.id, negated: false };
  switch (op) {
    case "between": return { ...base, op, value: [ null, null ] };
    case "in": return { ...base, op, value: [] };
    case "is": return { ...base, op, value: "true" };
    default: return { ...base, op, value: null };
  }
}

function firstNumber(row: ConditionRow): number | null {
  if (row.op === "between") return row.value[0];
  if (row.op === "gte" || row.op === "lte" || row.op === "eq") return row.value;
  return null;
}

export function withOp(row: ConditionRow, op: RowOp, field: ConditionField): ConditionRow {
  const next = { ...newRow(field, op), key: row.key, negated: row.negated };
  const n = firstNumber(row);
  if (next.op === "between") return { ...next, value: [ n, null ] };
  if (next.op === "gte" || next.op === "lte" || next.op === "eq") return { ...next, value: n };
  return next;
}

export function rowProblem(row: ConditionRow, field: ConditionField | undefined): string | null {
  if (!field) return "campo indisponível neste lugar";
  const numbers = row.op === "between" ? row.value
    : (row.op === "gte" || row.op === "lte" || row.op === "eq") ? [ row.value ] : [];
  if (numbers.some((n) => n === null)) return "informe o valor";
  const outOfRange = numbers.some((n) => n !== null &&
    ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)));
  if (outOfRange) return `use um valor entre ${field.min ?? "…"} e ${field.max ?? "…"}`;
  if (row.op === "between" && (row.value[0] as number) >= (row.value[1] as number)) return "o início precisa ser menor que o fim";
  if (row.op === "in" && row.value.length === 0) return "marque ao menos uma opção";
  return null;
}

// ─── Modelo → árvore ────────────────────────────────────────────────────────

function range(field: string, a: number, b: number): ConditionTree {
  return { all: [ { gte: [ field, a ] }, { lte: [ field, b ] } ] };
}

// Linha incompleta não emite nada: o JSON nunca recebe uma árvore inválida, e
// a linha continua no modelo da tela até ser completada ou removida.
function rowTree(row: ConditionRow): ConditionTree | null {
  let tree: ConditionTree | null = null;
  switch (row.op) {
    case "gte":
    case "lte":
      tree = row.value === null ? null : { [row.op]: [ row.field, row.value ] };
      break;
    case "eq":
      tree = row.value === null ? null : range(row.field, row.value, row.value);
      break;
    case "between": {
      const [ a, b ] = row.value;
      tree = a === null || b === null || a >= b ? null : range(row.field, a, b);
      break;
    }
    case "in":
      tree = row.value.length === 0 ? null : { in: [ row.field, [ ...row.value ] ] };
      break;
    case "is":
      tree = { eq: [ row.field, row.value ] };
      break;
  }
  return tree && row.negated ? { not: tree } : tree;
}

function groupTree(group: ConditionGroup, isRoot: boolean): ConditionTree | null {
  const parts = group.children
    .map((c) => (c.kind === "row" ? rowTree(c) : groupTree(c, false)))
    .filter((t): t is ConditionTree => t !== null);
  if (parts.length === 0) return null;
  const bare = isRoot && group.mode === "all" && parts.length === 1 && !group.negated;
  const tree = bare ? parts[0] : { [group.mode]: parts };
  return group.negated ? { not: tree } : tree;
}

export function toTree(root: ConditionGroup): ConditionTree | null {
  return groupTree(root, true);
}

// ─── Árvore → modelo ────────────────────────────────────────────────────────

type Fields = Map<string, ConditionField>;

function single(node: unknown): { op: string; arg: unknown } | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const keys = Object.keys(node);
  return keys.length === 1 ? { op: keys[0], arg: (node as Record<string, unknown>)[keys[0]] } : null;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function operand(arg: unknown): [ string, unknown ] | null {
  return Array.isArray(arg) && arg.length === 2 && typeof arg[0] === "string" ? [ arg[0], arg[1] ] : null;
}

function parseRange(arg: unknown, fields: Fields): ConditionRow | null {
  if (!Array.isArray(arg) || arg.length !== 2) return null;
  const lo = single(arg[0]);
  const hi = single(arg[1]);
  if (lo?.op !== "gte" || hi?.op !== "lte") return null;
  const a = operand(lo.arg);
  const b = operand(hi.arg);
  if (!a || !b || a[0] !== b[0] || fields.get(a[0])?.kind !== "number" || !isNumber(a[1]) || !isNumber(b[1])) return null;
  const base = { kind: "row" as const, key: nextKey(), field: a[0], negated: false };
  if (a[1] === b[1]) return { ...base, op: "eq", value: a[1] };
  return a[1] < b[1] ? { ...base, op: "between", value: [ a[1], b[1] ] } : null;
}

function parseRow(node: unknown, fields: Fields): ConditionRow | null {
  const n = single(node);
  if (!n) return null;
  if (n.op === "not") {
    const inner = parseRow(n.arg, fields);
    return inner && !inner.negated ? { ...inner, negated: true } : null;
  }
  if (n.op === "all") return parseRange(n.arg, fields);
  const o = operand(n.arg);
  const field = o ? fields.get(o[0]) : undefined;
  if (!o || !field) return null;
  const base = { kind: "row" as const, key: nextKey(), field: field.id, negated: false };
  const value = o[1];
  if ((n.op === "gte" || n.op === "lte") && field.kind === "number" && isNumber(value)) {
    return { ...base, op: n.op as "gte" | "lte", value };
  }
  if (n.op === "eq" && field.kind === "number" && isNumber(value)) return { ...base, op: "eq", value };
  if (n.op === "eq" && field.kind === "boolean" && (value === "true" || value === "false")) return { ...base, op: "is", value };
  if (n.op === "eq" && field.kind === "choice" && typeof value === "string") return { ...base, op: "in", value: [ value ] };
  if (n.op === "in" && field.kind === "choice" && Array.isArray(value) && value.length > 0 &&
      value.every((v) => typeof v === "string")) {
    return { ...base, op: "in", value: [ ...(value as string[]) ] };
  }
  return null;
}

function parseGroup(node: unknown, fields: Fields, depth: number): ConditionGroup | null {
  const n = single(node);
  if (!n) return null;
  if (n.op === "not") {
    const group = parseGroup(n.arg, fields, depth);
    return group && !group.negated ? { ...group, negated: true } : null;
  }
  if ((n.op !== "all" && n.op !== "any") || !Array.isArray(n.arg) || n.arg.length === 0) return null;
  const children: ConditionNode[] = [];
  for (const child of n.arg) {
    const row = parseRow(child, fields);
    if (row) { children.push(row); continue; }
    const group = depth === 0 ? parseGroup(child, fields, 1) : null;
    if (!group) return null;
    children.push(group);
  }
  return { kind: "group", key: nextKey(), mode: n.op as "all" | "any", negated: false, children };
}

export function fromTree(tree: unknown, fields: ConditionField[]): ParsedCondition {
  if (tree === null || tree === undefined) return { ok: true, root: emptyRoot() };
  const byId: Fields = new Map(fields.map((f) => [ f.id, f ]));
  const row = parseRow(tree, byId);
  if (row) return { ok: true, root: { ...emptyRoot(), children: [ row ] } };
  const root = parseGroup(tree, byId, 0);
  return root ? { ok: true, root } : { ok: false };
}

// ─── Edição ─────────────────────────────────────────────────────────────────

export function updateNode(root: ConditionGroup, key: string, fn: (node: ConditionNode) => ConditionNode): ConditionGroup {
  if (root.key === key) return fn(root) as ConditionGroup;
  return {
    ...root,
    children: root.children.map((c) => (c.key === key ? fn(c) : c.kind === "group" ? updateNode(c, key, fn) : c))
  };
}

export function removeNode(root: ConditionGroup, key: string): ConditionGroup {
  return {
    ...root,
    children: root.children.filter((c) => c.key !== key).map((c) => (c.kind === "group" ? removeNode(c, key) : c))
  };
}

export function appendTo(root: ConditionGroup, groupKey: string, child: ConditionNode): ConditionGroup {
  return updateNode(root, groupKey, (g) => (g.kind === "group" ? { ...g, children: [ ...g.children, child ] } : g));
}

// Comparação de árvores: nós de chave única e listas têm ordem estável.
export function treeKey(tree: unknown): string {
  return tree === null || tree === undefined ? "" : JSON.stringify(tree);
}
