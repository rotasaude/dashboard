// Formulário da versão do exame do laboratório (contrato §3, §14): componentes,
// faixas de referência por sexo e idade, limites de digitação, críticos e
// fórmula. Cada salvamento cria uma versão nova e imutável no api; aqui só
// se monta e confere o corpo, com os mesmos limites do api (decimais 0..4,
// opções B29, fórmula só com componentes digitados). Idade em anos, meses ou
// dias na tela; em dias no corpo (1 mês = 30 dias, 1 ano = 365 dias, como o
// catálogo-base). B3: idade obrigatória no corpo, 0..43800; campo mínimo em
// branco vale 0 e máximo em branco vale 43800 ("sem limite").
import type { ExamProvider, LabExamVersion, LabReferenceRange, LabTemplate, LabValueType, LabVersionInput } from "./api";
import { DOT_IN_NUMBER } from "./lab";

export type AgeUnit = "days" | "months" | "years";
const UNIT_DAYS: Record<AgeUnit, number> = { days: 1, months: 30, years: 365 };
export const AGE_MAX_DAYS = 43800;
export const MAX_CHOICES = 20;
export const MAX_CHOICE_LENGTH = 60;

export interface RangeDraft {
  sex: "male" | "female" | "any"; ageMin: string; ageMinUnit: AgeUnit; ageMax: string; ageMaxUnit: AgeUnit;
  low: string; high: string; text: string;
}
export interface AnalyteDraft {
  key: string; name: string; loinc: string; unit: string; valueType: LabValueType; choices: string; decimals: string;
  ranges: RangeDraft[]; entryMin: string; entryMax: string; criticalLow: string; criticalHigh: string; formula: string;
}
export interface VersionDraft { method: string; material: string; container: string; instrumentTestCode: string; analytes: AnalyteDraft[] }

export const EMPTY_RANGE: RangeDraft = { sex: "any", ageMin: "", ageMinUnit: "years", ageMax: "", ageMaxUnit: "years", low: "", high: "", text: "" };

export function ageToDays(value: string, unit: AgeUnit): number | null {
  const t = value.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t) * UNIT_DAYS[unit];
}

// `side` "max": 43800 ("sem limite") volta em branco; na idade mínima ele é um valor como outro.
export function daysToAge(days: number | null, side: "min" | "max" = "max"): { value: string; unit: AgeUnit } {
  if (days === null || (side === "max" && days >= AGE_MAX_DAYS)) return { value: "", unit: "years" };
  if (days % 365 === 0 && days > 0) return { value: String(days / 365), unit: "years" };
  if (days % 30 === 0 && days > 0) return { value: String(days / 30), unit: "months" };
  return { value: String(days), unit: "days" };
}

// Do api vem número (ponto); na tela é pt-BR (vírgula).
const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
const parse = (v: string): number | null => {
  const t = v.trim();
  return !/^-?\d+(,\d+)?$/.test(t) ? null : Number(t.replace(",", "."));
};

function rangeDraft(r: LabReferenceRange): RangeDraft {
  const min = daysToAge(r.age_min_days, "min");
  const max = daysToAge(r.age_max_days);
  return { sex: r.sex, ageMin: min.value, ageMinUnit: min.unit, ageMax: max.value, ageMaxUnit: max.unit, low: num(r.low), high: num(r.high), text: r.text ?? "" };
}

export function versionDraft(v: LabExamVersion | null, t?: LabTemplate): VersionDraft {
  const analytes = v?.analytes ?? (t?.analytes ?? []).map((a) => ({ ...a, entry_min: null, entry_max: null, critical_low: null, critical_high: null, formula: null }));
  return {
    method: v?.method ?? t?.suggested_method ?? "", material: v?.material ?? t?.material ?? "", container: v?.container ?? t?.container ?? "",
    instrumentTestCode: v?.instrument_test_code ?? "",
    analytes: analytes.map((a) => ({
      key: a.key, name: a.name, loinc: a.loinc ?? "", unit: a.unit ?? "", valueType: a.value_type, choices: (a.choices ?? []).join("; "),
      decimals: String(a.decimals), ranges: a.reference_ranges.map(rangeDraft), entryMin: num(a.entry_min), entryMax: num(a.entry_max),
      criticalLow: num(a.critical_low), criticalHigh: num(a.critical_high), formula: a.formula ?? ""
    }))
  };
}

export function formulaKeys(formula: string): string[] {
  return [ ...new Set(formula.match(/[a-z][a-z0-9_]*/g) ?? []) ];
}

const badNumber = (v: string) => v.trim() !== "" && parse(v) === null;
const numberMessage = (v: string, generic: string) => (v.includes(".") ? DOT_IN_NUMBER : generic);

// Limites do api (Lab::CreateVersion, Analytes, Ranges, Choices, Formula).
export const LIMITS = {
  method: 160, material: 60, container: 60, name: 120, unit: 30, rangeText: 120, formula: 200,
  analytes: 60, ranges: 20, instrumentCode: /^[A-Za-z0-9._-]{1,30}$/
} as const;

function choiceList(raw: string): string[] { return raw.split(";").map((c) => c.trim()); }

// Igual ao api (Lab::Choices): 1..20, cada uma de 1..60, sem repetir (caixa conta).
function choicesValid(raw: string): boolean {
  const list = choiceList(raw);
  return list.length >= 1 && list.length <= MAX_CHOICES && list.every((c) => c.length >= 1 && c.length <= MAX_CHOICE_LENGTH) && new Set(list).size === list.length;
}

// Igual ao api (Lab::Formula): números `\d+(\.\d+)?`, chaves, + - * / e parênteses;
// operando e operador alternados, parênteses equilibrados, sem sinal unário.
const FORMULA_TOKEN = /^\s*(?:(\d+(?:\.\d+)?)|([a-z][a-z0-9_]{0,39})|([-+*/()]))\s*/;

function formulaTokens(formula: string): { kind: "num" | "var" | "op" | "open" | "close"; v: string }[] | null {
  const text = formula.trim();
  if (text.length < 1 || text.length > LIMITS.formula) return null;
  const tokens: { kind: "num" | "var" | "op" | "open" | "close"; v: string }[] = [];
  let rest = text;
  while (rest !== "") {
    const m = FORMULA_TOKEN.exec(rest);
    if (!m) return null;
    if (m[1] !== undefined) tokens.push({ kind: "num", v: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: "var", v: m[2] });
    else if (m[3] === "(") tokens.push({ kind: "open", v: m[3] });
    else if (m[3] === ")") tokens.push({ kind: "close", v: m[3] });
    else tokens.push({ kind: "op", v: m[3] });
    rest = rest.slice(m[0].length);
  }
  return tokens;
}

export function formulaWellFormed(formula: string): boolean {
  const tokens = formulaTokens(formula);
  if (!tokens) return false;
  let expectOperand = true;
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === "open") { if (!expectOperand) return false; depth += 1; }
    else if (t.kind === "close") { if (expectOperand || depth === 0) return false; depth -= 1; }
    else if (t.kind === "op") { if (expectOperand) return false; expectOperand = true; }
    else { if (!expectOperand) return false; expectOperand = false; }
  }
  return !expectOperand && depth === 0;
}

export function versionProblem(d: VersionDraft): string | null {
  const method = d.method.trim(), material = d.material.trim(), container = d.container.trim();
  if (!method) return "informe o método";
  if (method.length > LIMITS.method) return `o método tem no máximo ${LIMITS.method} caracteres`;
  if (!material) return "informe o material";
  if (material.length > LIMITS.material) return `o material tem no máximo ${LIMITS.material} caracteres`;
  if (!container) return "informe o recipiente";
  if (container.length > LIMITS.container) return `o recipiente tem no máximo ${LIMITS.container} caracteres`;
  if (d.instrumentTestCode.trim() && !LIMITS.instrumentCode.test(d.instrumentTestCode.trim())) {
    return "o código do aparelho usa letras, números, ponto, hífen e _, até 30 caracteres";
  }
  if (d.analytes.length === 0) return "inclua ao menos um componente";
  if (d.analytes.length > LIMITS.analytes) return `no máximo ${LIMITS.analytes} componentes por exame`;
  const keys = new Set<string>();
  for (const [ i, a ] of d.analytes.entries()) {
    const n = `componente ${i + 1}`;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(a.key.trim())) return `${n}: a chave usa letras minúsculas, números e _`;
    if (keys.has(a.key.trim())) return `${n}: a chave ${a.key.trim()} repete`;
    keys.add(a.key.trim());
    if (!a.name.trim()) return `${n}: informe o nome`;
    if (a.name.trim().length > LIMITS.name) return `${n}: o nome tem no máximo ${LIMITS.name} caracteres`;
    if (a.loinc.trim() && !/^\d{1,7}-\d$/.test(a.loinc.trim())) return `${n}: LOINC no formato 2345-7`;
    if (a.unit.length > LIMITS.unit) return `${n}: a unidade tem no máximo ${LIMITS.unit} caracteres`;
    if (!/^[0-4]$/.test(a.decimals.trim())) return `${n}: casas decimais de 0 a 4`;
    if (a.valueType === "choice" && !choicesValid(a.choices)) return `${n}: informe de 1 a ${MAX_CHOICES} opções distintas, separadas por ;, com até ${MAX_CHOICE_LENGTH} caracteres`;
    for (const v of [ a.entryMin, a.entryMax, a.criticalLow, a.criticalHigh ]) if (badNumber(v)) return `${n}: ${numberMessage(v, "número inválido nos limites")}`;
    const [ emin, emax ] = [ parse(a.entryMin), parse(a.entryMax) ];
    if (a.valueType !== "numeric" && [ a.entryMin, a.entryMax, a.criticalLow, a.criticalHigh ].some((v) => v.trim() !== "")) {
      return `${n}: limites de digitação e críticos valem só para componente numérico`;
    }
    if (emin !== null && emax !== null && emin >= emax) return `${n}: o limite de digitação mínimo deve ser menor que o máximo`;
    if (a.ranges.length > LIMITS.ranges) return `${n}: no máximo ${LIMITS.ranges} faixas`;
    for (const [ j, r ] of a.ranges.entries()) {
      const rn = `${n}, faixa ${j + 1}`;
      for (const v of [ r.low, r.high ]) if (badNumber(v)) return `${rn}: ${numberMessage(v, "número inválido")}`;
      if (r.low.trim() === "" && r.high.trim() === "" && !r.text.trim()) return `${rn}: informe mínimo, máximo ou um texto`;
      if (r.text.trim().length > LIMITS.rangeText) return `${rn}: o texto tem no máximo ${LIMITS.rangeText} caracteres`;
      const [ lo, hi ] = [ parse(r.low), parse(r.high) ];
      if (lo !== null && hi !== null && lo > hi) return `${rn}: o mínimo passa do máximo`;
      const [ amin, amax ] = [ ageToDays(r.ageMin, r.ageMinUnit), ageToDays(r.ageMax, r.ageMaxUnit) ];
      if ((r.ageMin.trim() && amin === null) || (r.ageMax.trim() && amax === null)) return `${rn}: idade em número inteiro`;
      if ((amin !== null && amin > AGE_MAX_DAYS) || (amax !== null && amax > AGE_MAX_DAYS)) return `${rn}: a idade passa de ${AGE_MAX_DAYS} dias (120 anos)`;
      if ((amin ?? 0) > (amax ?? AGE_MAX_DAYS)) return `${rn}: a idade mínima passa da máxima`;
    }
  }
  // Fórmula só em componente numérico, sobre numéricos não calculados da mesma versão.
  const operands = new Set(d.analytes.filter((a) => a.valueType === "numeric" && !a.formula.trim()).map((a) => a.key.trim()));
  for (const [ i, a ] of d.analytes.entries()) {
    if (!a.formula.trim()) continue;
    const n = `componente ${i + 1}`;
    if (a.valueType !== "numeric") return `${n}: fórmula só em componente numérico`;
    if (!/^[a-z0-9_+\-*/().\s]+$/.test(a.formula)) return `${n}: a fórmula usa só chaves, números e + - * / ( )`;
    if (!formulaWellFormed(a.formula)) return `${n}: fórmula mal formada — alterne valores e operadores, feche os parênteses e não use sinal no início`;
    for (const k of formulaKeys(a.formula)) {
      if (!keys.has(k) || k === a.key.trim()) return `${n}: a fórmula usa ${k}, que não é componente deste exame`;
      if (!operands.has(k)) return `${n}: a fórmula usa ${k}, que é calculado ou não é numérico — use só componentes numéricos digitados`;
    }
  }
  return null;
}

export function versionBody(d: VersionDraft): LabVersionInput {
  return {
    method: d.method.trim(), material: d.material.trim(), container: d.container.trim(),
    instrument_test_code: d.instrumentTestCode.trim() || null,
    analytes: d.analytes.map((a) => ({
      key: a.key.trim(), name: a.name.trim(), loinc: a.loinc.trim() || null, unit: a.unit.trim() || null, value_type: a.valueType,
      choices: a.valueType === "choice" ? choiceList(a.choices) : [],
      decimals: Number(a.decimals.trim()),
      reference_ranges: a.ranges.map((r) => ({
        sex: r.sex, age_min_days: ageToDays(r.ageMin, r.ageMinUnit) ?? 0, age_max_days: ageToDays(r.ageMax, r.ageMaxUnit) ?? AGE_MAX_DAYS,
        low: parse(r.low), high: parse(r.high), text: r.text.trim() || null
      })),
      entry_min: parse(a.entryMin), entry_max: parse(a.entryMax), critical_low: parse(a.criticalLow), critical_high: parse(a.criticalHigh),
      formula: a.formula.trim() || null
    }))
  };
}

export function labProviders(list: ExamProvider[]): ExamProvider[] {
  return list.filter((p) => p.uses_municipal_lab === true);
}
