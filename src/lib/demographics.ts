// src/lib/demographics.ts
// Dados do paciente para o BPA-I (módulo 22; contrato §12, D-U1; layout do
// BPA Magnético 05.00): raça/cor sem "sem informação", etnia só para indígena
// e endereço. Tudo opcional e incentivado: a recepção pergunta, a pessoa pode
// não querer informar; o que faltar vira pendência do faturista no fechamento.
// Larguras do layout recusadas, nunca cortadas.
import { ApiError, errorCode, type PatientDemographicsInput } from "./api";

export const RACE_COLORS = [
  { code: "01", label: "Branca" }, { code: "02", label: "Preta" }, { code: "03", label: "Parda" },
  { code: "04", label: "Amarela" }, { code: "05", label: "Indígena" }
] as const;
export const INDIGENOUS = "05";
export const STREET_MAX = 30;
export const NUMBER_MAX = 5;
export const COMPLEMENT_MAX = 10;
export const DISTRICT_MAX = 30;
export const DEMOGRAPHICS_INCENTIVE =
  "Raça/cor e endereço completam o cadastro e evitam pendência no faturamento. Não é obrigatório: pergunte à pessoa.";

export interface DemographicsDraft {
  raceColor: string; ethnicity: string; zip: string; street: string; number: string; complement: string; district: string;
}
export const EMPTY_DEMOGRAPHICS: DemographicsDraft = { raceColor: "", ethnicity: "", zip: "", street: "", number: "", complement: "", district: "" };

const digits = (s: string) => s.replace(/\D/g, "");
const ETHNICITY_TEXT = "para indígena, informe a etnia: código de 4 dígitos da tabela do DATASUS";

function addressStarted(d: DemographicsDraft): boolean {
  return [ d.zip, d.street, d.number, d.complement, d.district ].some((v) => v.trim() !== "");
}

export function demographicsFilled(d: DemographicsDraft): boolean {
  return d.raceColor !== "" || addressStarted(d);
}

export function demographicsProblem(d: DemographicsDraft): string | null {
  if (d.raceColor && !RACE_COLORS.some((r) => r.code === d.raceColor)) return "raça/cor inválida";
  if (d.raceColor === INDIGENOUS && !/^\d{4}$/.test(d.ethnicity.trim())) return ETHNICITY_TEXT;
  if (addressStarted(d)) {
    if (digits(d.zip).length !== 8) return "CEP com 8 dígitos";
    if (!d.street.trim()) return "informe o logradouro";
    if (!d.district.trim()) return "informe o bairro";
  }
  if (d.street.trim().length > STREET_MAX) return `logradouro com até ${STREET_MAX} caracteres (largura do arquivo BPA) — abrevie`;
  if (d.number.trim().length > NUMBER_MAX) return `número com até ${NUMBER_MAX} caracteres`;
  if (d.complement.trim().length > COMPLEMENT_MAX) return `complemento com até ${COMPLEMENT_MAX} caracteres — abrevie`;
  if (d.district.trim().length > DISTRICT_MAX) return `bairro com até ${DISTRICT_MAX} caracteres (largura do arquivo BPA) — abrevie`;
  return null;
}

// Só o preenchido vai no corpo; o que não foi perguntado não apaga o que o cadastro já tem.
export function demographicsBody(d: DemographicsDraft): PatientDemographicsInput {
  const body: PatientDemographicsInput = {};
  if (d.raceColor) {
    body.race_color = d.raceColor;
    // O api recusa etnia fora de 05.
    if (d.raceColor === INDIGENOUS) body.ethnicity = d.ethnicity.trim();
  }
  if (addressStarted(d)) {
    body.address_zip = digits(d.zip);
    body.address_street = d.street.trim();
    // Sem número, "SN" (padrão do campo prd_num_pcnte do layout).
    body.address_number = d.number.trim() || "SN";
    if (d.complement.trim()) body.address_complement = d.complement.trim();
    body.address_district = d.district.trim();
  }
  return body;
}

const MISSING_TEXT: Record<string, string> = { race_color: "raça/cor", address: "CEP e endereço" };
export function missingText(codes: string[]): string {
  return codes.map((c) => MISSING_TEXT[c] ?? c).join("; ");
}

const ERRORS: Record<string, string> = {
  invalid_race_color: "raça/cor inválida",
  ethnicity_required: ETHNICITY_TEXT,
  invalid_ethnicity: ETHNICITY_TEXT,
  invalid_zip: "CEP inválido — confira os 8 dígitos",
  too_long: "texto maior que a largura do arquivo BPA — abrevie",
  missing_role: "seu papel não permite alterar os dados do paciente",
  feature_disabled: "o faturamento de procedimentos está desligado nesta cidade",
  not_found: "paciente ou atendimento não encontrado — atualize a tela"
};

const FIELD_TEXT: Record<string, string> = {
  address_street: "logradouro", address_number: "número", address_complement: "complemento", address_district: "bairro"
};

export function demographicsError(err: unknown): string {
  const code = errorCode(err);
  if (code === "too_long" && err instanceof ApiError) {
    const field = (err.body as { field?: unknown } | null)?.field;
    if (typeof field === "string" && FIELD_TEXT[field]) return `${FIELD_TEXT[field]} maior que a largura do arquivo BPA — abrevie`;
  }
  if (code && ERRORS[code]) return ERRORS[code];
  if (err instanceof ApiError) return `não foi possível salvar (${err.status}) — tente de novo`;
  return "sem conexão com o servidor — tente de novo";
}
