// src/lib/territoryDictionaries.ts
// Dicionários das fichas de cadastro (LEDI 8.7.0; contrato §15) e o espelho,
// na tela, das recusas do api (mod24a: TerritoryRegistry::{Dictionary, Rules,
// Address}, SaveHousehold, SaveFamily, SaveRegistration, ExitRegistration,
// Patients::CreateTyped). Cada função devolve a PRIMEIRA recusa na mesma ordem
// do api, com o mesmo `path`, para a tela focar o campo — o de uma recusa 422
// também. É conveniência: nunca mais estrita que o api (o que depende de banco
// — bairro inexistente, CPF de outro, identidade validada — fica com ele, e
// fato do paciente desconhecido aqui não recusa). Nada daqui guarda ou loga a
// ficha; a frase nunca repete o valor.
import type { Family, HouseholdInput, NewPatient, PanelNeighborhood, PatientIdentity, PatientSex, Registration, RegistrationBody } from "./api";
import { isValidCpf } from "./attendance";
import { COMPLEMENT_MAX, DISTRICT_MAX, NUMBER_MAX, STREET_MAX } from "./demographics";
import { isValidCns } from "./professionals";
import {
  DOMAINS, SECTIONS, STRING_DOMAINS, type DomainKey, type FieldSpec, type SectionKey, type StringDomainKey
} from "./territoryDictionaries.generated";

export * from "./territoryDictionaries.generated";

export interface Problem { path: string; message: string }
const problem = (path: string, message: string): Problem => ({ path, message });

// ─── Rótulos ───────────────────────────────────────────────────────────────
const labels = new Map<string, Map<string, string>>();
function labelMap(domain: DomainKey | StringDomainKey): Map<string, string> {
  let map = labels.get(domain);
  if (!map) {
    const list: { code: number | string; label: string }[] =
      domain in DOMAINS ? DOMAINS[domain as DomainKey] : STRING_DOMAINS[domain as StringDomainKey];
    map = new Map(list.map((e) => [ String(e.code), e.label ]));
    labels.set(domain, map);
  }
  return map;
}

// Código em número ou texto ("3" da renda, "1" do tipo de imóvel, "081" do
// logradouro); desconhecido aparece cru, nunca some; ausente é "—".
export function dictLabel(domain: DomainKey | StringDomainKey, code: number | string | null | undefined): string {
  if (code === null || code === undefined || code === "") return "—";
  return labelMap(domain).get(String(code)) ?? String(code);
}

// ─── Apoio (as mesmas definições do Rules) ─────────────────────────────────
type Values = Record<string, unknown>;
const isObject = (value: unknown): value is Values => typeof value === "object" && value !== null && !Array.isArray(value);
// Rules#blank?: nil, "", [] e {}.
const blank = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0) || (isObject(value) && Object.keys(value).length === 0);
const present = (value: unknown) => !blank(value);
const squish = (value: string) => value.replace(/\s+/g, " ").trim();
const chars = (value: string) => [ ...value ].length;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [ y, m, d ] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Idade em anos completos na data (Rules#age).
function age(birth: string, on: string): number {
  const [ by, bm, bd ] = birth.split("-").map(Number);
  const [ y, m, d ] = on.split("-").map(Number);
  return y - by - (m > bm || (m === bm && d >= bd) ? 0 : 1);
}

// Date#prev_year(n): 29/02 vira 28/02 em ano não bissexto.
function yearsBefore(on: string, years: number): string {
  const [ y, m, d ] = on.split("-").map(Number);
  const year = y - years;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Validar nome (Dictionary.valid_name?) ─────────────────────────────────
// Letras romanas com agudo, circunflexo, til, trema e cedilha, e apóstrofo
// (reto ou tipográfico); ≥ 2 termos com um espaço só; não "A A …"; não dois
// termos de 2 letras. Quem chama faz o squish antes.
const NAME_MIN = 3;
const NAME_MAX = 70;
const NAME_TERM = /^(?:[A-Za-z'’][̧́̂̃̈]*)+$/;
export const NAME_MESSAGE = "nome de 3 a 70 letras, com nome e sobrenome, sem números nem símbolos";

export function isValidLediName(value: unknown, max = NAME_MAX): boolean {
  if (typeof value !== "string" || chars(value) < NAME_MIN || chars(value) > max) return false;
  const terms = value.split(" ");
  if (terms.length < 2 || terms.some((term) => term === "")) return false;
  if (!terms.every((term) => NAME_TERM.test(term.normalize("NFD")))) return false;
  const size = (term: string) => chars(term.normalize("NFC"));
  if (size(terms[0]) === 1 && size(terms[1]) === 1) return false;
  return !(terms.length === 2 && terms.every((term) => size(term) === 2));
}

// ─── Dictionary.parse: tipo, domínio e limites de cada campo ───────────────
const UNKNOWN_FIELD = "campo que a ficha não conhece — recarregue a tela";
const TEXT_MAX = 100;

const inDomain = (spec: FieldSpec, value: unknown) =>
  Number.isInteger(value) && labelMap(spec.domain as DomainKey).has(String(value));

function digitsMessage(spec: FieldSpec): string {
  const min = spec.min ?? 1;
  return spec.max === undefined ? "só números" : `só números, ${min === spec.max ? min : `de ${min} a ${spec.max}`} dígitos`;
}

type Converted = { value: unknown } | { problem: Problem };

// Valor convertido (undefined = ausente) ou a recusa (Dictionary#convert).
function convert(spec: FieldSpec, value: unknown, path: string): Converted {
  const ok = (v: unknown): Converted => ({ value: v });
  const no = (message: string): Converted => ({ problem: problem(path, message) });
  if (value === null || value === undefined) return ok(undefined);
  switch (spec.type) {
  case "bool":
    return typeof value === "boolean" ? ok(value) : no("escolha sim ou não");
  case "code":
    return inDomain(spec, value) ? ok(value) : no("escolha uma opção da lista");
  case "codes": {
    if (!Array.isArray(value)) return no("escolha opções da lista");
    if (value.length === 0) return ok(undefined);
    if (new Set(value).size !== value.length) return no("opção marcada duas vezes");
    if (spec.max_items !== undefined && value.length > spec.max_items) return no(`no máximo ${spec.max_items} opções`);
    return value.every((item) => inDomain(spec, item)) ? ok(value) : no("escolha opções da lista");
  }
  case "text": {
    if (typeof value !== "string") return no("texto inválido");
    const text = value.trim();
    if (!text) return ok(undefined);
    const max = spec.max ?? TEXT_MAX;
    if (chars(text) > max) return no(`texto com mais de ${max} caracteres`);
    return spec.min !== undefined && chars(text) < spec.min ? no(`texto com menos de ${spec.min} caracteres`) : ok(text);
  }
  case "name": {
    if (typeof value !== "string") return no(NAME_MESSAGE);
    const name = squish(value);
    if (!name) return ok(undefined);
    const max = spec.max ?? NAME_MAX;
    if (chars(name) > max) return no(`nome com mais de ${max} letras`);
    return isValidLediName(name, max) ? ok(name) : no(NAME_MESSAGE);
  }
  case "digits": {
    const fits = typeof value === "string" && /^\d+$/.test(value) && value.length >= (spec.min ?? 1) &&
      (spec.max === undefined || value.length <= spec.max);
    return fits ? ok(value) : no(digitsMessage(spec));
  }
  case "date":
    return isIsoDate(value) ? ok(value) : no("data inválida");
  case "date_month":
    return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? ok(value) : no("mês e ano no formato AAAA-MM");
  case "count":
    return Number.isInteger(value) && (value as number) > 0 ? ok(value) : no("informe um número inteiro maior que zero");
  case "object": {
    const parsed = walk(spec.fields ?? [], value, path, true);
    if ("problem" in parsed) return parsed;
    return ok(parsed.values && Object.keys(parsed.values).length > 0 ? parsed.values : undefined);
  }
  }
}

function walk(fields: FieldSpec[], raw: unknown, prefix: string, nested: boolean): { values: Values | null } | { problem: Problem } {
  if (raw === null || raw === undefined) return { values: null };
  if (!isObject(raw)) return { problem: problem(prefix, "parte da ficha inválida — recarregue a tela") };
  const values: Values = {};
  for (const [ key, value ] of Object.entries(raw)) {
    if (value === undefined) continue; // o JSON não leva a chave
    const spec = fields.find((field) => field.key === key);
    if (!spec) return { problem: problem(`${prefix}.${key}`, UNKNOWN_FIELD) };
    const converted = convert(spec, value, `${prefix}.${key}`);
    if ("problem" in converted) return converted;
    if (converted.value !== undefined) values[key] = converted.value;
  }
  if (nested) {
    const missing = fields.find((field) => field.required && !(field.key in values));
    if (missing) return { problem: problem(`${prefix}.${missing.key}`, "obrigatório") };
  }
  return { values };
}

function parseSection(section: SectionKey, raw: unknown): { values: Values } | { problem: Problem } {
  const parsed = walk(SECTIONS[section], raw, section, false);
  return "problem" in parsed ? parsed : { values: parsed.values ?? {} };
}

// A recusa do dicionário para uma seção (null = passa no tipo e nos limites).
export function sectionProblem(section: SectionKey, raw: unknown): Problem | null {
  const parsed = parseSection(section, raw);
  return "problem" in parsed ? parsed.problem : null;
}

// ─── Endereço (TerritoryRegistry::Address) ─────────────────────────────────
const ADDRESS_KEYS = [ "zip", "street_type", "street", "number", "no_number", "complement", "neighborhood_id", "district", "reference" ];
// Larguras do endereço: as mesmas do BPA (lib/demographics, fonte única); o
// ponto de referência só existe na ficha domiciliar.
export { COMPLEMENT_MAX, DISTRICT_MAX, NUMBER_MAX, STREET_MAX };
export const REFERENCE_MAX = 40;
const NUMBER = new RegExp(`^[A-Za-z0-9]{1,${NUMBER_MAX}}$`);
const NUMBER_FORMAT = `número de 1 a ${NUMBER_MAX} letras ou dígitos`;
const ADDRESS_INVALID: Record<string, string> = {
  zip: "CEP com 8 dígitos", street_type: "escolha o tipo de logradouro", street: "informe o logradouro", number: NUMBER_FORMAT,
  complement: "complemento inválido", neighborhood_id: "escolha o bairro da lista", district: "informe o bairro",
  reference: "ponto de referência inválido"
};

// Bairro do cadastro de bairros (módulo 11) que cabe na ficha e no BPA.
export const usableNeighborhood = (n: PanelNeighborhood) => n.active && chars(n.name) <= DISTRICT_MAX;

// Sem acento nem caixa (Address#fold).
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function repeatsType(street: string, streetType: string): string | null {
  const type = labelMap("tipo_logradouro").get(streetType);
  if (!type) return null;
  return new RegExp(`^${escapeRegExp(fold(type))}(?![\\p{L}\\p{N}])`, "u").test(fold(street)) ? type : null;
}

// `neighborhoods`: a lista do módulo 11, se a tela tiver; bairro fora dela fica com o api.
export function addressProblem(raw: unknown, neighborhoods?: PanelNeighborhood[]): Problem | null {
  if (!isObject(raw)) return problem("address", "informe o endereço");
  const unknown = Object.keys(raw).find((key) => raw[key] !== undefined && !ADDRESS_KEYS.includes(key));
  if (unknown) return problem(`address.${unknown}`, UNKNOWN_FIELD);
  if (![ true, false, null, undefined ].includes(raw.no_number as boolean | null | undefined)) {
    return problem("address.no_number", "marque ou desmarque sem número");
  }
  const text: Record<string, string | null> = {};
  for (const key of ADDRESS_KEYS.filter((k) => k !== "no_number")) {
    const value = raw[key];
    if (value !== null && value !== undefined && typeof value !== "string") return problem(`address.${key}`, ADDRESS_INVALID[key]);
    text[key] = typeof value === "string" ? squish(value) || null : null;
  }
  const noNumber = raw.no_number === true;
  const { zip, street_type: streetType, street, number, complement, reference, neighborhood_id: neighborhoodId, district } = text;
  if (!zip || !/^\d{8}$/.test(zip)) return problem("address.zip", "CEP com 8 dígitos");
  if (!streetType || !labelMap("tipo_logradouro").has(streetType)) return problem("address.street_type", "escolha o tipo de logradouro");
  if (!street) return problem("address.street", "informe o logradouro");
  if (chars(street) > STREET_MAX) return problem("address.street", `logradouro com mais de ${STREET_MAX} caracteres`);
  const repeated = repeatsType(street, streetType);
  if (repeated) return problem("address.street", `o nome do logradouro não repete o tipo (${repeated})`);
  if (noNumber && number) return problem("address.number", "sem número: deixe o número em branco");
  if (!noNumber && !number) return problem("address.number", "informe o número ou marque sem número");
  if (!noNumber && !NUMBER.test(number as string)) return problem("address.number", NUMBER_FORMAT);
  if (complement && chars(complement) > COMPLEMENT_MAX) return problem("address.complement", `complemento com mais de ${COMPLEMENT_MAX} caracteres`);
  if (reference && chars(reference) > REFERENCE_MAX) return problem("address.reference", `ponto de referência com mais de ${REFERENCE_MAX} caracteres`);
  const listed = neighborhoodId ? neighborhoods?.find((n) => n.id === neighborhoodId) : undefined;
  if (listed && !usableNeighborhood(listed)) {
    return problem("address.neighborhood_id",
      `este bairro não serve para a ficha (inativo ou com nome maior que ${DISTRICT_MAX} letras) — escreva o bairro no campo de texto`);
  }
  if (!neighborhoodId && !district) return problem("address.district", "informe o bairro");
  if (district && chars(district) > DISTRICT_MAX) return problem("address.district", `bairro com mais de ${DISTRICT_MAX} caracteres`);
  return null;
}

// ─── Domicílio (TerritoryRegistry::Rules.household) ────────────────────────
const HOME = "1";
const INSTITUTION_TYPES = [ "7", "8", "9", "10", "11" ];
const NO_LIVING_CONDITIONS_TYPES = [ "2", "3", "4", "5", "6", "12", "13", "99" ];
const PROPERTY_TYPES = DOMAINS.tipo_de_imovel.map((e) => String(e.code));
const FORBIDDEN_BY_TYPE: [ string, string[] ][] = [
  [ "area_producao_rural", [ "7", "8", "9", "10", "11", "13" ] ],
  [ "material_predominante_paredes_ext_domicilio", [ "7", "8", "9", "10", "11", "13" ] ],
  [ "nu_comodos", [ "7", "8", "9", "10", "11", "13" ] ],
  [ "tipo_acesso_domicilio", [ "7", "8", "9", "10", "11", "13" ] ],
  [ "tipo_domicilio", [ "7", "8", "9", "10", "11", "13" ] ],
  [ "situacao_moradia_posse_terra", [ "7", "8", "9", "10", "11" ] ]
];
const ANIMAL_FIELDS = [ "st_animais_no_domicilio", "animais_no_domicilio", "quantos_animais_no_domicilio" ];
const URBAN_LOCATIONS = [ 83, 205 ];
const PHONE = /^\d{10,11}$/;

export const allowsLivingConditions = (propertyType: string) =>
  PROPERTY_TYPES.includes(propertyType) && !NO_LIVING_CONDITIONS_TYPES.includes(propertyType);
export const allowsFamilies = (propertyType: string) => propertyType === HOME;
export const requiresInstitution = (propertyType: string) => INSTITUTION_TYPES.includes(propertyType);

// O campo de condições de moradia cabe neste tipo de imóvel (a tela esconde o que não cabe).
export function livingFieldAllowed(propertyType: string, key: string): boolean {
  if (!allowsLivingConditions(propertyType)) return false;
  if (key === "instituicao_permanencia") return requiresInstitution(propertyType);
  if (ANIMAL_FIELDS.includes(key)) return propertyType === HOME;
  return !FORBIDDEN_BY_TYPE.some(([ field, types ]) => field === key && types.includes(propertyType));
}

export interface FamilyFacts { members_count: number | null; responsible_patient_id?: string | null }
export interface HouseholdRulesInput { property_type: string; living_conditions: Values | null | undefined; refused: boolean; contact_phone: string | null | undefined }

// Famílias que contam para o domicílio: as que não se mudaram.
export function activeFamilyFacts(families: (Pick<Family, "members_count"> & { moved_out?: boolean; responsible?: { patient_id: string } | null })[]): FamilyFacts[] {
  return families.filter((f) => !f.moved_out).map((f) => ({ members_count: f.members_count, responsible_patient_id: f.responsible?.patient_id ?? null }));
}

function bothWays(values: Values, key: string, status: unknown, whenMissing: string, whenForbidden: string): string | null {
  if (status === true && blank(values[key])) return whenMissing;
  if (status === false && present(values[key])) return whenForbidden;
  return null;
}
const forbiddenWhenFalse = (values: Values, key: string, statusKey: string) => values[statusKey] === false && present(values[key]);

function livingConditionsProblem(l: Values, type: string, families: FamilyFacts[]): Problem | null {
  const at = (key: string, message: string) => problem(`living_conditions.${key}`, message);
  if (blank(l.localizacao)) return at("localizacao", "informe a localização (urbana, rural ou periurbana)");
  if (!INSTITUTION_TYPES.includes(type) && blank(l.situacao_moradia_posse_terra)) return at("situacao_moradia_posse_terra", "informe a situação de moradia");
  const forbidden = FORBIDDEN_BY_TYPE.find(([ key, types ]) => types.includes(type) && present(l[key]));
  if (forbidden) return at(forbidden[0], "não se aplica a este tipo de imóvel");
  const animal = type !== HOME ? ANIMAL_FIELDS.find((key) => present(l[key])) : undefined;
  if (animal) return at(animal, "animais só em domicílio (tipo 01)");
  if (forbiddenWhenFalse(l, "animais_no_domicilio", "st_animais_no_domicilio")) return at("animais_no_domicilio", "sem animais: deixe a lista em branco");
  if (forbiddenWhenFalse(l, "quantos_animais_no_domicilio", "st_animais_no_domicilio")) {
    return at("quantos_animais_no_domicilio", "sem animais: deixe a quantidade em branco");
  }
  const animals = Array.isArray(l.animais_no_domicilio) ? l.animais_no_domicilio.length : 0;
  if (present(l.quantos_animais_no_domicilio) && (l.quantos_animais_no_domicilio as number) < animals) {
    return at("quantos_animais_no_domicilio", "quantidade de animais menor que as espécies marcadas");
  }
  if (present(l.area_producao_rural) && URBAN_LOCATIONS.includes(l.localizacao as number)) {
    return at("area_producao_rural", "área de produção rural não vale para localização urbana ou periurbana");
  }
  if (forbiddenWhenFalse(l, "tipo_origem_energia_eletrica", "st_disponibilidade_energia_eletrica")) {
    return at("tipo_origem_energia_eletrica", "sem energia elétrica: deixe a origem em branco");
  }
  const residents = Math.max(families.length, families.reduce((sum, f) => sum + (f.members_count ?? 1), 0));
  if (present(l.nu_moradores) && (l.nu_moradores as number) < residents) {
    return at("nu_moradores", `moradores menos que a soma das famílias (${residents})`);
  }
  return null;
}

// Rules.household: as condições de moradia já convertidas; as famílias ativas.
export function householdRulesProblem(input: HouseholdRulesInput, families: FamilyFacts[]): Problem | null {
  const type = input.property_type;
  const refused = input.refused === true;
  const living = isObject(input.living_conditions) ? input.living_conditions : {};
  const hasLiving = Object.keys(living).length > 0;
  const responsibles = families.map((f) => f.responsible_patient_id).filter((id): id is string => !!id);
  const phone = input.contact_phone;
  if (!PROPERTY_TYPES.includes(type)) return problem("property_type", "escolha o tipo de imóvel");
  if (refused && hasLiving) return problem("living_conditions", "com recusa, o domicílio leva só o endereço");
  if (refused && families.length > 0) return problem("families", "com recusa, o domicílio não tem famílias");
  if (type !== HOME && families.length > 0) return problem("families", "só domicílio (tipo 01) tem famílias");
  if (new Set(responsibles).size !== responsibles.length) return problem("families", "duas famílias com o mesmo responsável");
  if (NO_LIVING_CONDITIONS_TYPES.includes(type) && hasLiving) return problem("living_conditions", "este tipo de imóvel não leva condições de moradia");
  if (phone !== null && phone !== undefined && !PHONE.test(phone)) return problem("contact_phone", "telefone com DDD: 10 ou 11 dígitos");
  if (INSTITUTION_TYPES.includes(type) && !refused && blank(living.instituicao_permanencia)) {
    return problem("living_conditions.instituicao_permanencia", "abrigo e instituição (tipos 07 a 11) pedem a instituição de permanência e o responsável técnico");
  }
  if (!INSTITUTION_TYPES.includes(type) && present(living.instituicao_permanencia)) {
    return problem("living_conditions.instituicao_permanencia", "instituição de permanência só para os tipos 07 a 11");
  }
  return hasLiving ? livingConditionsProblem(living, type, families) : null;
}

// SaveHousehold: endereço (obrigatório sem recusa) → dicionário da moradia →
// regras. `families`: as do domicílio (as mudadas não contam); na gravação de
// família, com a nova/alterada já no lugar.
export function householdProblem(
  input: HouseholdInput,
  families: Parameters<typeof activeFamilyFacts>[0] = [],
  options: { neighborhoods?: PanelNeighborhood[] } = {}
): Problem | null {
  if ((input.address !== null && input.address !== undefined) || !input.refused) {
    const address = addressProblem(input.address, options.neighborhoods);
    if (address) return address;
  }
  const living = walk(SECTIONS.living_conditions, input.living_conditions, "living_conditions", false);
  if ("problem" in living) return living.problem;
  return householdRulesProblem({ property_type: input.property_type, living_conditions: living.values, refused: input.refused,
    contact_phone: input.contact_phone?.trim() ? input.contact_phone : null }, activeFamilyFacts(families));
}

// ─── Família (SaveFamily + Rules.family) ───────────────────────────────────
const INCOME_BANDS = DOMAINS.renda_familiar.map((e) => String(e.code));
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function familyRulesProblem(input: { members_count?: unknown; income_band?: unknown; living_since?: unknown }, propertyType: string, today: string): Problem | null {
  const { members_count: count, income_band: income, living_since: since } = input;
  if (propertyType !== HOME) return problem("property_type", "só domicílio (tipo 01) tem famílias");
  if (count !== null && count !== undefined && !(Number.isInteger(count) && (count as number) >= 1 && (count as number) <= 999)) {
    return problem("members_count", "número de membros de 1 a 999");
  }
  if (income !== null && income !== undefined && !INCOME_BANDS.includes(income as string)) return problem("income_band", "escolha a renda da lista");
  if (since !== null && since !== undefined) {
    if (typeof since !== "string" || !MONTH.test(since)) return problem("living_since", "mês e ano no formato AAAA-MM");
    if (since > today.slice(0, 7)) return problem("living_since", "reside desde depois deste mês");
  }
  return null;
}

// isNew: família nova (o responsável é obrigatório e nunca muda depois).
export function familyProblem(
  input: { responsible?: { patient_id: string } | null; income_band: string | null; members_count: number | null; living_since: string | null; moved_out?: boolean },
  ctx: { propertyType: string; today: string; isNew: boolean }
): Problem | null {
  if (ctx.isNew && !input.responsible?.patient_id) return problem("responsible.patient_id", "escolha o responsável");
  if (ctx.isNew && input.moved_out === true) return problem("moved_out", "a família nasce morando no domicílio");
  return familyRulesProblem(input, ctx.propertyType, ctx.today);
}

// ─── Cadastro individual (Rules.individual) ────────────────────────────────
// O que mora no paciente. undefined = a tela não sabe (o api confere); null = sabido ausente.
export interface PersonFacts {
  sex: PatientSex | null | undefined; birth_date: string | null | undefined; race_color: string | null | undefined;
  ethnicity: string | null | undefined; mother_name_present: boolean | undefined;
}
export interface IndividualRulesInput {
  identification?: Values | null; sociodemographic?: Values | null; health_conditions?: Values | null; street_situation?: Values | null;
  refused: boolean; is_responsible: boolean;
}

export function patientFacts(registration: Pick<Registration, "patient" | "patient_demographics">): PersonFacts {
  const { patient, patient_demographics: demographics } = registration;
  return { sex: patient.sex, birth_date: patient.birth_date, race_color: demographics.race_color, ethnicity: demographics.ethnicity,
    mother_name_present: !!patient.mother_name };
}

const RACE_COLORS = [ "01", "02", "03", "04", "05" ];
const INDIGENOUS = "05";
const BRAZIL = 31;
const MAX_AGE_YEARS = 130;
const EMAIL = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const CBO = /^[0-9A-Z]{6}$/;
const NO_CPF_REASONS = DOMAINS.justificativa_nao_possui_cpf.map((e) => String(e.code));
const SEXES: string[] = [ "male", "female" ];
const STREET_FIELDS = SECTIONS.street_situation.map((f) => f.key).filter((key) => key !== "status_situacao_rua");
const ETHNICITY_EXCEPTIONS: Record<string, number> = { "0304": 406, "0315": 407 };

// Catalog.ethnicity_to_ledi: null = etnia sem código LEDI.
function ethnicityToLedi(code: unknown): number | null {
  if (typeof code !== "string") return null;
  if (code in ETHNICITY_EXCEPTIONS) return ETHNICITY_EXCEPTIONS[code];
  const number = /^\d{4}$/.test(code) ? Number(code) : null;
  return number !== null && number >= 1 && number <= 264 ? number : null;
}

const bornAfter = (birth: string | null | undefined, day: unknown) => isIsoDate(day) && isIsoDate(birth) && day < birth;

function identificationProblem(id: Values, person: PersonFacts, refused: boolean, today: string): Problem | null {
  const required = !refused;
  const nat = id.nacionalidade_cidadao;
  const at = (key: string, message: string) => problem(`identification.${key}`, message);
  // Só com a condição, e então obrigatório (quando a identificação é exigida).
  const onlyAndAlways = (key: string, condition: boolean, onlyFor: string, missing: string) => {
    if (condition) return required && blank(id[key]) ? at(key, missing) : null;
    return present(id[key]) ? at(key, onlyFor) : null;
  };
  const outside = (key: string, label: string) => {
    const day = id[key];
    if (!isIsoDate(day)) return null;
    if (day > today) return at(key, `${label} depois de hoje`);
    return bornAfter(person.birth_date, day) ? at(key, `${label} antes do nascimento`) : null;
  };
  if (required && blank(nat)) return at("nacionalidade_cidadao", "informe a nacionalidade");
  return onlyAndAlways("codigo_ibge_municipio_nascimento", nat === 1, "município de nascimento só para brasileiros",
    "informe o município de nascimento (código IBGE de 7 dígitos)") ??
    (present(id.pais_nascimento) && !(nat === 3 || (nat === 1 && id.pais_nascimento === BRAZIL))
      ? at("pais_nascimento", nat === 1 ? "para brasileiros, o país de nascimento é o Brasil" : "país de nascimento só para estrangeiros") : null) ??
    (required && nat === 3 && blank(id.pais_nascimento) ? at("pais_nascimento", "informe o país de nascimento") : null) ??
    onlyAndAlways("dt_naturalizacao", nat === 2, "data de naturalização só para naturalizados", "informe a data de naturalização") ??
    outside("dt_naturalizacao", "naturalização") ??
    onlyAndAlways("portaria_naturalizacao", nat === 2, "portaria de naturalização só para naturalizados", "informe a portaria de naturalização") ??
    onlyAndAlways("dt_entrada_brasil", nat === 3, "data de entrada no Brasil só para estrangeiros", "informe a data de entrada no Brasil") ??
    outside("dt_entrada_brasil", "entrada no Brasil") ??
    (required && (nat === 1 || nat === 2) && blank(id.telefone_celular) ? at("telefone_celular", "informe o celular (DDD + número)") : null) ??
    (id.desconhece_nome_pai === true && present(id.nome_pai_cidadao)
      ? at("nome_pai_cidadao", "marcou que não sabe o nome do pai: deixe o nome em branco") : null) ??
    (required && id.desconhece_nome_pai !== true && blank(id.nome_pai_cidadao) ? at("nome_pai_cidadao", "informe o nome do pai ou marque que não sabe") : null) ??
    (id.desconhece_nome_mae === true && person.mother_name_present === true
      ? at("desconhece_nome_mae", "marcou que não sabe o nome da mãe, mas o nome dela está preenchido") : null) ??
    (required && id.desconhece_nome_mae !== true && person.mother_name_present === false
      ? problem("mother_name", "informe o nome da mãe ou marque que não sabe") : null) ??
    (present(id.email_cidadao) && !EMAIL.test(String(id.email_cidadao)) ? at("email_cidadao", "e-mail no formato nome@dominio.com") : null);
}

function sociodemographicProblem(s: Values, isResponsible: boolean, person: PersonFacts, today: string): Problem | null {
  const years = isIsoDate(person.birth_date) ? age(person.birth_date, today) : null;
  const at = (key: string, message: string | null) => (message ? problem(`sociodemographic.${key}`, message) : null);
  return at("status_deseja_informar_orientacao_sexual",
    blank(s.status_deseja_informar_orientacao_sexual) ? "diga se a pessoa quer informar a orientação sexual" : null) ??
    at("status_deseja_informar_identidade_genero",
      blank(s.status_deseja_informar_identidade_genero) ? "diga se a pessoa quer informar a identidade de gênero" : null) ??
    at("deficiencias_cidadao", bothWays(s, "deficiencias_cidadao", s.status_tem_alguma_deficiencia, "marque ao menos uma deficiência",
      "sem deficiência: deixe a lista em branco")) ??
    at("orientacao_sexual_cidadao", bothWays(s, "orientacao_sexual_cidadao", s.status_deseja_informar_orientacao_sexual, "escolha a orientação sexual",
      "não quer informar: deixe a orientação sexual em branco")) ??
    at("identidade_genero_cidadao", bothWays(s, "identidade_genero_cidadao", s.status_deseja_informar_identidade_genero, "escolha a identidade de gênero",
      "não quer informar: deixe a identidade de gênero em branco")) ??
    at("ocupacao_codigo_cbo2002", present(s.ocupacao_codigo_cbo2002) && !CBO.test(String(s.ocupacao_codigo_cbo2002))
      ? "ocupação: código CBO de 6 caracteres (dígitos ou letras maiúsculas)" : null) ??
    at("relacao_parentesco_cidadao", present(s.relacao_parentesco_cidadao) && isResponsible !== false
      ? "parentesco só para quem não é o responsável da família" : null) ??
    at("responsavel_por_crianca", present(s.responsavel_por_crianca) && years !== null && years >= 10
      ? "com quem a criança fica: só para menores de 10 anos" : null) ??
    at("co_povo_comunidade_tradicional", forbiddenWhenFalse(s, "co_povo_comunidade_tradicional", "status_membro_povo_comunidade_tradicional")
      ? "não é de povo ou comunidade tradicional: deixe em branco" : null) ??
    at("alimentos_acabaram_antes_ter_dinheiro_comprar_mais", present(s.comeu_alguns_alimentos_que_tinha_dinheiro_acabou) &&
      blank(s.alimentos_acabaram_antes_ter_dinheiro_comprar_mais) ? "responda as duas perguntas sobre alimentação, ou nenhuma" : null) ??
    at("comeu_alguns_alimentos_que_tinha_dinheiro_acabou", present(s.alimentos_acabaram_antes_ter_dinheiro_comprar_mais) &&
      blank(s.comeu_alguns_alimentos_que_tinha_dinheiro_acabou) ? "responda as duas perguntas sobre alimentação, ou nenhuma" : null);
}

// Rules: proibido para sexo masculino e fora de 9–60 anos (nascimento
// desconhecido do api também recusa; desconhecido DA TELA não).
function pregnancyForbidden(person: PersonFacts, today: string): boolean {
  if (person.sex === "male") return true;
  if (person.birth_date === undefined) return false;
  const years = isIsoDate(person.birth_date) ? age(person.birth_date, today) : null;
  return years === null || years < 9 || years > 60;
}

// Gestante pode ser marcado (errata 5.1: fora disto o campo nem vai no corpo).
export function canBePregnant(sex: PatientSex | null | undefined, birthDate: string | null | undefined, today: string): boolean {
  return isIsoDate(birthDate) && !pregnancyForbidden({ sex, birth_date: birthDate, race_color: undefined, ethnicity: undefined,
    mother_name_present: undefined }, today);
}

function healthConditionsProblem(h: Values, person: PersonFacts, today: string): Problem | null {
  const at = (key: string, message: string | null) => (message ? problem(`health_conditions.${key}`, message) : null);
  return at("status_eh_gestante", present(h.status_eh_gestante) && pregnancyForbidden(person, today)
    ? "gestante só para sexo feminino entre 9 e 60 anos" : null) ??
    at("maternidade_de_referencia", forbiddenWhenFalse(h, "maternidade_de_referencia", "status_eh_gestante")
      ? "maternidade de referência só para gestante" : null) ??
    at("doenca_cardiaca", bothWays(h, "doenca_cardiaca", h.status_teve_doenca_cardiaca, "marque ao menos uma doença do coração",
      "sem doença do coração: deixe a lista em branco")) ??
    at("doenca_respiratoria", bothWays(h, "doenca_respiratoria", h.status_tem_doenca_respiratoria, "marque ao menos uma doença respiratória",
      "sem doença respiratória: deixe a lista em branco")) ??
    at("doenca_rins", bothWays(h, "doenca_rins", h.status_tem_teve_doencas_rins, "marque ao menos um problema nos rins",
      "sem problema nos rins: deixe a lista em branco")) ??
    at("descricao_causa_internacao_em12_meses", forbiddenWhenFalse(h, "descricao_causa_internacao_em12_meses", "status_teve_internado_em12_meses")
      ? "sem internação: deixe a causa em branco" : null) ??
    at("descricao_plantas_medicinais_usadas", forbiddenWhenFalse(h, "descricao_plantas_medicinais_usadas", "status_usa_planta_medicinais")
      ? "não usa plantas medicinais: deixe em branco" : null);
}

function streetSituationProblem(r: Values): Problem | null {
  const at = (key: string, message: string) => problem(`street_situation.${key}`, message);
  if (blank(r.status_situacao_rua)) return at("status_situacao_rua", "diga se está em situação de rua");
  const offStreet = r.status_situacao_rua === false ? STREET_FIELDS.find((key) => present(r[key])) : undefined;
  if (offStreet) return at(offStreet, "só para quem está em situação de rua");
  if (forbiddenWhenFalse(r, "grau_parentesco_familiar_frequentado", "status_visita_familiar_frequentemente")) {
    return at("grau_parentesco_familiar_frequentado", "não visita a família: deixe o parente em branco");
  }
  if (r.status_tem_acesso_higiene_pessoal_situacao_rua === true && blank(r.higiene_pessoal_situacao_rua)) {
    return at("higiene_pessoal_situacao_rua", "marque ao menos um acesso à higiene");
  }
  if (forbiddenWhenFalse(r, "outra_instituicao_que_acompanha", "status_acompanhado_por_outra_instituicao")) {
    return at("outra_instituicao_que_acompanha", "não é acompanhado por outra instituição: deixe em branco");
  }
  return null;
}

const REFUSED_SECTION = "com recusa, esta parte da ficha não vai";

// Rules.individual: seções já convertidas. Nascimento e mãe sem prefixo (moram
// no paciente) — registrationProblem põe new_patient./patient. como o api.
export function individualRulesProblem(input: IndividualRulesInput, person: PersonFacts, today: string): Problem | null {
  const refused = input.refused === true;
  const values = (section: Values | null | undefined): Values => (isObject(section) ? section : {});
  const race = person.race_color;
  if (race === INDIGENOUS && ethnicityToLedi(person.ethnicity) === null) {
    return problem("patient_demographics.ethnicity", "raça/cor indígena pede a etnia da lista");
  }
  const birth = person.birth_date;
  if (birth !== undefined) {
    if (birth === null && !refused) return problem("birth_date", "informe a data de nascimento");
    if (isIsoDate(birth) && birth > today) return problem("birth_date", "nascimento depois de hoje");
    if (isIsoDate(birth) && birth < yearsBefore(today, MAX_AGE_YEARS)) return problem("birth_date", `nascimento há mais de ${MAX_AGE_YEARS} anos`);
  }
  if (race !== undefined && ((race === null && !refused) || (race !== null && !RACE_COLORS.includes(race)))) {
    return problem("patient_demographics.race_color", "informe a raça/cor");
  }
  const id = identificationProblem(values(input.identification), person, refused, today);
  if (id) return id;
  if (refused) {
    const section = ([ "sociodemographic", "health_conditions", "street_situation" ] as const).find((key) => present(values(input[key])));
    return section ? problem(section, REFUSED_SECTION) : null;
  }
  return sociodemographicProblem(values(input.sociodemographic), input.is_responsible, person, today) ??
    healthConditionsProblem(values(input.health_conditions), person, today) ??
    streetSituationProblem(values(input.street_situation));
}

// ─── Cadastro individual (SaveRegistration + CreateTyped) ──────────────────
// O corpo real do POST/PATCH (RegistrationInput | RegistrationUpdate) é um rascunho.
export type RegistrationDraft = RegistrationBody & { new_patient?: NewPatient | null; patient_id?: string; citizen_id?: string };

const CPF_TEXT = "CPF inválido: confira os 11 dígitos";
const CNS_TEXT = "CNS inválido: confira os 15 dígitos";
const SOCIAL_NAME_MAX = 70;
const text = (value: unknown): string | null => (typeof value === "string" ? squish(value) || null : null);
const validCns = (value: string) => /^\d{15}$/.test(value) && isValidCns(value);

// Patients::CreateTyped (o paciente digitado), com o caminho new_patient.*
// (também o new_patient da notificação manual, módulo 25).
export function newPatientProblem(raw: NewPatient, today: string): Problem | null {
  const at = (key: string, message: string) => problem(`new_patient.${key}`, message);
  const v = Object.fromEntries((Object.keys(raw) as (keyof NewPatient)[]).map((key) => [ key, text(raw[key]) ])) as Record<keyof NewPatient, string | null>;
  if (!isValidLediName(v.full_name)) return at("full_name", NAME_MESSAGE);
  if (v.social_name && chars(v.social_name) > SOCIAL_NAME_MAX) return at("social_name", `nome social com mais de ${SOCIAL_NAME_MAX} caracteres`);
  if (!isIsoDate(v.birth_date)) return at("birth_date", "informe a data de nascimento");
  if (v.birth_date > today) return at("birth_date", "nascimento depois de hoje");
  if (!SEXES.includes(v.sex ?? "")) return at("sex", "informe o sexo");
  if (v.mother_name && !isValidLediName(v.mother_name)) return at("mother_name", NAME_MESSAGE);
  // cpf_or_reason_required vem sem caminho do api; aqui, o motivo.
  if (!v.cpf && !v.no_cpf_reason) return at("no_cpf_reason", "sem CPF, informe o motivo");
  if (v.cpf && v.no_cpf_reason) return at("no_cpf_reason", "com CPF, não informe o motivo de não ter CPF");
  if (v.no_cpf_reason && !NO_CPF_REASONS.includes(v.no_cpf_reason)) return at("no_cpf_reason", "escolha o motivo da lista");
  if (v.cpf && !isValidCpf(v.cpf)) return at("cpf", CPF_TEXT);
  const cns = v.cns?.replace(/ /g, "");
  return cns && !validCns(cns) ? at("cns", CNS_TEXT) : null;
}

// SaveRegistration#check_identity + cpf/cns da raiz (paciente existente).
function identityProblem(draft: RegistrationDraft, today: string): Problem | null {
  const typed: Partial<Record<keyof PatientIdentity, unknown>> = isObject(draft.patient) ? draft.patient : {};
  const has = (key: keyof PatientIdentity) => key in typed && typed[key] !== undefined;
  const at = (key: string, message: string) => problem(`patient.${key}`, message);
  if (has("full_name") && !isValidLediName(text(typed.full_name))) return at("full_name", NAME_MESSAGE);
  const social = text(typed.social_name);
  if (social && chars(social) > SOCIAL_NAME_MAX) return at("social_name", `nome social com mais de ${SOCIAL_NAME_MAX} caracteres`);
  if (has("birth_date")) {
    const birth = text(typed.birth_date);
    if (!isIsoDate(birth)) return at("birth_date", "informe a data de nascimento");
    if (birth > today) return at("birth_date", "nascimento depois de hoje");
  }
  if (has("sex") && !SEXES.includes(text(typed.sex) ?? "")) return at("sex", "informe o sexo");
  const mother = text(typed.mother_name);
  if (mother && !isValidLediName(mother)) return at("mother_name", NAME_MESSAGE);
  if (typeof draft.cpf === "string" && draft.cpf.trim() && !isValidCpf(draft.cpf)) return problem("cpf", CPF_TEXT);
  const cns = typeof draft.cns === "string" ? draft.cns.replace(/ /g, "") : "";
  return cns && !validCns(cns) ? problem("cns", CNS_TEXT) : null;
}

// Patients::Demographics.parse (só as chaves presentes; "" apaga).
function demographicsProblem(draft: RegistrationDraft): Problem | null {
  const given = isObject(draft.patient_demographics) ? draft.patient_demographics : {};
  const race = text(given.race_color);
  if (race && !RACE_COLORS.includes(race)) return problem("patient_demographics.race_color", "informe a raça/cor");
  const ethnicity = text(given.ethnicity);
  return ethnicity && !/^\d{4}$/.test(ethnicity) ? problem("patient_demographics.ethnicity", "etnia: código de 4 dígitos da lista") : null;
}

// Os fatos que o Rules verá: os do paciente (current) com o que o corpo muda.
function factsFor(draft: RegistrationDraft, current: PersonFacts | null | undefined): PersonFacts {
  let facts: PersonFacts;
  if (draft.new_patient) {
    const np = draft.new_patient;
    facts = { sex: (text(np.sex) as PatientSex | null), birth_date: text(np.birth_date), race_color: null, ethnicity: null,
      mother_name_present: !!text(np.mother_name) };
  } else {
    facts = current ? { ...current } : { sex: undefined, birth_date: undefined, race_color: undefined, ethnicity: undefined, mother_name_present: undefined };
    const typed: Partial<Record<keyof PatientIdentity, unknown>> = isObject(draft.patient) ? draft.patient : {};
    if ("sex" in typed && typed.sex !== undefined) facts.sex = text(typed.sex) as PatientSex | null;
    if ("birth_date" in typed && typed.birth_date !== undefined) facts.birth_date = text(typed.birth_date);
    if ("mother_name" in typed && typed.mother_name !== undefined) facts.mother_name_present = !!text(typed.mother_name);
  }
  // final_demographics: o gravado com o enviado; etnia só fica com 05.
  const given: Values = isObject(draft.patient_demographics) ? draft.patient_demographics : {};
  if (Object.keys(given).some((key) => given[key] !== undefined)) {
    if ("race_color" in given && given.race_color !== undefined) facts.race_color = text(given.race_color);
    if ("ethnicity" in given && given.ethnicity !== undefined) facts.ethnicity = text(given.ethnicity);
    if (facts.race_color !== undefined && facts.race_color !== INDIGENOUS) facts.ethnicity = null;
  }
  return facts;
}

const SECTION_ORDER = [ "identification", "sociodemographic", "health_conditions", "street_situation" ] as const;

// A primeira recusa do cadastro, na ordem do SaveRegistration: seções (tipo e
// limites) → identidade digitada e CPF/CNS da raiz → raça/cor → paciente novo
// → regras da ficha. `current`: fatos do paciente existente (patientFacts do
// cadastro aberto); sem ele, o que depende do paciente fica com o api.
export function registrationProblem(draft: RegistrationDraft, today: string, current?: PersonFacts | null): Problem | null {
  const sections: Partial<Record<(typeof SECTION_ORDER)[number], Values>> = {};
  for (const name of SECTION_ORDER) {
    const parsed = parseSection(name, draft[name]);
    if ("problem" in parsed) return parsed.problem;
    sections[name] = parsed.values;
  }
  const isNew = !!draft.new_patient;
  const identity = isNew ? null : identityProblem(draft, today);
  if (identity) return identity;
  const demographics = demographicsProblem(draft);
  if (demographics) return demographics;
  if (draft.new_patient) {
    const typed = newPatientProblem(draft.new_patient, today);
    if (typed) return typed;
  }
  const ruled = individualRulesProblem({ ...sections, refused: draft.refused === true, is_responsible: draft.is_responsible === true },
    factsFor(draft, current), today);
  if (ruled && (ruled.path === "birth_date" || ruled.path === "mother_name")) {
    return { ...ruled, path: `${isNew ? "new_patient" : "patient"}.${ruled.path}` };
  }
  return ruled;
}

// ─── Saída (ExitRegistration) ──────────────────────────────────────────────
const CERTIFICATE = /^\d{9}$/;

export function exitProblem(
  input: { reason: string; on?: string | null; death_on?: string | null; death_certificate?: string | null },
  birthDate: string | null | undefined,
  today: string
): Problem | null {
  if (input.reason !== "moved" && input.reason !== "death") return problem("reason", "escolha o motivo da saída");
  const within = (key: "on" | "death_on", label: string, missing: string) => {
    const day = input[key];
    if (!isIsoDate(day)) return problem(key, missing);
    if (day > today) return problem(key, `${label} depois de hoje`);
    return bornAfter(birthDate, day) ? problem(key, `${label} antes do nascimento`) : null;
  };
  const on = within("on", "data", "informe a data da saída");
  if (on) return on;
  const death = input.reason === "death";
  if (death) {
    const deathOn = within("death_on", "data do óbito", "informe a data do óbito");
    if (deathOn) return deathOn;
  } else if (input.death_on !== null && input.death_on !== undefined) {
    return problem("death_on", "data do óbito só no óbito");
  }
  const certificate = input.death_certificate;
  if (certificate !== null && certificate !== undefined && !(death && CERTIFICATE.test(certificate))) {
    return problem("death_certificate", death ? "declaração de óbito com 9 dígitos" : "declaração de óbito só no óbito");
  }
  return null;
}

