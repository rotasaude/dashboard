// Formulário da versão do exame do laboratório (contrato §3, §14): componentes,
// faixas de referência por sexo e idade, limites de digitação, críticos e
// fórmula. Cada salvamento cria uma versão nova e imutável no api; aqui só
// se monta e confere o corpo, com os mesmos limites do api (decimais 0..4,
// opções B29, fórmula só com componentes digitados). Idade em anos, meses ou
// dias na tela; em dias no corpo (1 mês = 30 dias, 1 ano = 365 dias, como o
// catálogo-base). B3: idade obrigatória no corpo, 0..43800; campo mínimo em
// branco vale 0 e máximo em branco vale 43800 ("sem limite").
import type { ExamProvider, LabExamVersion, LabReferenceRange, LabTemplate, LabValueType, LabVersionInput } from "./api";

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

export function daysToAge(days: number | null): { value: string; unit: AgeUnit } {
  if (days === null || days >= AGE_MAX_DAYS) return { value: "", unit: "years" };
  if (days % 365 === 0 && days > 0) return { value: String(days / 365), unit: "years" };
  if (days % 30 === 0 && days > 0) return { value: String(days / 30), unit: "months" };
  return { value: String(days), unit: "days" };
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const parse = (v: string): number | null => {
  const t = v.trim().replace(",", ".");
  return t === "" || !/^-?\d+(\.\d+)?$/.test(t) ? null : Number(t);
};

function rangeDraft(r: LabReferenceRange): RangeDraft {
  const min = daysToAge(r.age_min_days);
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

function choiceList(raw: string): string[] { return raw.split(";").map((c) => c.trim()); }

function choicesValid(raw: string): boolean {
  const list = choiceList(raw);
  const lower = list.map((c) => c.toLowerCase());
  return list.length >= 1 && list.length <= MAX_CHOICES && list.every((c) => c !== "" && c.length <= MAX_CHOICE_LENGTH) && new Set(lower).size === lower.length;
}

export function versionProblem(d: VersionDraft): string | null {
  if (!d.method.trim()) return "informe o método";
  if (!d.material.trim()) return "informe o material";
  if (!d.container.trim()) return "informe o recipiente";
  if (d.analytes.length === 0) return "inclua ao menos um componente";
  const keys = new Set<string>();
  for (const [ i, a ] of d.analytes.entries()) {
    const n = `componente ${i + 1}`;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(a.key.trim())) return `${n}: a chave usa letras minúsculas, números e _`;
    if (keys.has(a.key.trim())) return `${n}: a chave ${a.key.trim()} repete`;
    keys.add(a.key.trim());
    if (!a.name.trim()) return `${n}: informe o nome`;
    if (a.loinc.trim() && !/^\d{1,7}-\d$/.test(a.loinc.trim())) return `${n}: LOINC no formato 2345-7`;
    if (!/^[0-4]$/.test(a.decimals.trim())) return `${n}: casas decimais de 0 a 4`;
    if (a.valueType === "choice" && !choicesValid(a.choices)) return `${n}: informe de 1 a ${MAX_CHOICES} opções distintas, separadas por ;, com até ${MAX_CHOICE_LENGTH} caracteres`;
    for (const v of [ a.entryMin, a.entryMax, a.criticalLow, a.criticalHigh ]) if (badNumber(v)) return `${n}: número inválido nos limites`;
    const [ emin, emax ] = [ parse(a.entryMin), parse(a.entryMax) ];
    if (emin !== null && emax !== null && emin > emax) return `${n}: o limite de digitação mínimo passa do máximo`;
    const [ clow, chigh ] = [ parse(a.criticalLow), parse(a.criticalHigh) ];
    if (clow !== null && chigh !== null && clow > chigh) return `${n}: o crítico baixo passa do crítico alto`;
    for (const [ j, r ] of a.ranges.entries()) {
      const rn = `${n}, faixa ${j + 1}`;
      if (badNumber(r.low) || badNumber(r.high)) return `${rn}: número inválido`;
      if (r.low.trim() === "" && r.high.trim() === "" && !r.text.trim()) return `${rn}: informe mínimo, máximo ou um texto`;
      const [ lo, hi ] = [ parse(r.low), parse(r.high) ];
      if (lo !== null && hi !== null && lo > hi) return `${rn}: o mínimo passa do máximo`;
      const [ amin, amax ] = [ ageToDays(r.ageMin, r.ageMinUnit), ageToDays(r.ageMax, r.ageMaxUnit) ];
      if ((r.ageMin.trim() && amin === null) || (r.ageMax.trim() && amax === null)) return `${rn}: idade em número inteiro`;
      if ((amin !== null && amin > AGE_MAX_DAYS) || (amax !== null && amax > AGE_MAX_DAYS)) return `${rn}: a idade passa de ${AGE_MAX_DAYS} dias (120 anos)`;
      if ((amin ?? 0) > (amax ?? AGE_MAX_DAYS)) return `${rn}: a idade mínima passa da máxima`;
    }
  }
  const calculated = new Set(d.analytes.filter((a) => a.formula.trim()).map((a) => a.key.trim()));
  for (const [ i, a ] of d.analytes.entries()) {
    if (!a.formula.trim()) continue;
    const n = `componente ${i + 1}`;
    if (!/^[a-z0-9_+\-*/().\s]+$/.test(a.formula)) return `${n}: a fórmula usa só chaves, números e + - * / ( )`;
    for (const k of formulaKeys(a.formula)) {
      if (!keys.has(k) || k === a.key.trim()) return `${n}: a fórmula usa ${k}, que não é componente deste exame`;
      if (calculated.has(k)) return `${n}: a fórmula usa ${k}, que é calculado — use só componentes digitados`;
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
