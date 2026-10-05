// Perfil do par (módulo 15; ADR 0027; contratos §2): rótulos e regras de data
// usados pelo balcão de validação, pelo simulador e pelo construtor de
// condições. A elegibilidade olha só o sexo, nunca a identidade de gênero.
// Datas são strings YYYY-MM-DD comparadas como texto: nenhum fuso desloca o dia.
import type { CitizenProfile, GenderIdentity, Sex } from "./api";
import { fmtDay } from "./audiencePhrase";

export const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: "female", label: "Feminino" },
  { value: "male", label: "Masculino" }
];

export const GENDER_IDENTITY_OPTIONS: { value: GenderIdentity; label: string }[] = [
  { value: "cis_woman", label: "Mulher cis" },
  { value: "cis_man", label: "Homem cis" },
  { value: "trans_woman", label: "Mulher trans" },
  { value: "trans_man", label: "Homem trans" },
  { value: "travesti", label: "Travesti" },
  { value: "non_binary", label: "Não binária" },
  { value: "other", label: "Outra" }
];

export const NO_GENDER_IDENTITY = "Prefiro não informar";
export const MAX_AGE = 130;

export function sexLabel(sex: string): string {
  return SEX_OPTIONS.find((o) => o.value === sex)?.label.toLowerCase() ?? sex;
}

export function genderIdentityLabel(value: string | null): string {
  if (value === null) return "não informada";
  return GENDER_IDENTITY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayParts(date: string): [ number, number, number ] | null {
  const m = ISO_DAY.exec(date);
  if (!m) return null;
  const [ y, mo, d ] = [ Number(m[1]), Number(m[2]), Number(m[3]) ];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return [ y, mo, d ];
}

export function ageOn(birthDate: string, today: string): number | null {
  const b = dayParts(birthDate);
  const t = dayParts(today);
  if (!b || !t) return null;
  const beforeBirthday = t[1] < b[1] || (t[1] === b[1] && t[2] < b[2]);
  return t[0] - b[0] - (beforeBirthday ? 1 : 0);
}

export function birthDateProblem(value: string, today: string): string | null {
  if (!value) return "informe a data de nascimento";
  if (!dayParts(value)) return "data de nascimento inválida";
  if (value > today) return "a data de nascimento não pode ser no futuro";
  const age = ageOn(value, today);
  if (age === null || age > MAX_AGE) return `idade acima de ${MAX_AGE} anos — confira a data`;
  return null;
}

export function describeProfile(profile: CitizenProfile | null, today: string): string {
  if (!profile) return "sem perfil declarado";
  const age = ageOn(profile.birth_date, today);
  const ageText = age === null ? "" : ` (${age} ${age === 1 ? "ano" : "anos"})`;
  return `nascimento ${fmtDay(profile.birth_date)}${ageText} · sexo ${sexLabel(profile.sex)}` +
    ` · identidade de gênero ${genderIdentityLabel(profile.gender_identity)}`;
}
