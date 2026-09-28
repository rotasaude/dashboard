// Regras do módulo 10 sem React (spec 2026-09-27 §5): CNS igual ao api
// (Professionals::Cns), janela do turno e mensagens das recusas.
import { ApiError } from "./api";
import { fmtHourMinute } from "./format";

export const COUNCILS = [ "CRM", "COREN", "CRO", "CRF", "CRP", "CREFITO", "CRN", "CRFa", "CRESS", "CRBM", "CREF", "CRMV" ];
export const UFS = [ "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE",
  "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO" ];
export const STATUS_LABEL = { missing_profile: "sem perfil", missing_link: "sem vínculo" } as const;

const digits = (s: string) => s.replace(/\D/g, "");

// 15 dígitos, primeiro em 1, 2, 7, 8 ou 9, soma ponderada (15..1) múltipla de 11.
export function isValidCns(input: string): boolean {
  const d = digits(input);
  if (!/^[12789]\d{14}$/.test(d)) return false;
  return d.split("").reduce((acc, c, i) => acc + Number(c) * (15 - i), 0) % 11 === 0;
}

export function maskCns(cns: string): string {
  return `*** **** **** ${digits(cns).slice(-4)}`;
}

// Sem horário de verão em America/Sao_Paulo desde 2019: deslocamento fixo.
const OFFSET = "-03:00";

function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Data + horas da tela → instantes da API. Fim ≤ início = dia seguinte (D6);
// 24h exatas (07:00–07:00) são o máximo, então `tooLong` nunca vem daqui —
// fica para a API recusar o que a tela não consegue expressar.
export function shiftWindow(date: string, start: string, end: string):
  { startsAt: string; endsAt: string; nextDay: boolean; tooLong: boolean } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const nextDay = end <= start;
  const endDate = nextDay ? nextDate(date) : date;
  return { startsAt: `${date}T${start}:00${OFFSET}`, endsAt: `${endDate}T${end}:00${OFFSET}`, nextDay, tooLong: false };
}

const FIELD_LABEL: Record<string, string> = {
  professional_name: "nome profissional", council: "conselho", council_state: "UF do conselho",
  registration_number: "número do registro", cns: "CNS", phone: "telefone", contact_email: "e-mail de contato"
};

const MESSAGES: Record<string, string> = {
  user_missing_role: "este usuário não tem o papel de profissional de saúde",
  missing_role: "seu papel não permite esta ação",
  missing_link: "Você não tem vínculo com esta unidade",
  already_exists: "este usuário já tem perfil profissional",
  cns_taken: "este CNS já está em outro perfil",
  registration_taken: "este registro de conselho já está em outro perfil",
  invalid_unit: "unidade inválida ou desativada — escolha outra",
  invalid_cbo: "ocupação fora da lista vigente",
  council_mismatch: "a ocupação exige outro conselho profissional que o do perfil",
  council_in_use: "o conselho não pode mudar enquanto houver vínculo ativo com ocupação que exige o conselho atual — encerre o vínculo antes",
  already_linked: "já existe vínculo ativo com esta unidade e ocupação",
  already_ended: "este vínculo já foi encerrado",
  link_ended: "o vínculo foi encerrado — recarregue a ficha",
  invalid_shift: "turno inválido: confira data e horas (máximo de 24h, a partir do início do vínculo)",
  reason_required: "informe o motivo do cancelamento",
  reason_too_long: "motivo com mais de 200 caracteres",
  already_cancelled: "este turno já foi cancelado",
  invalid_range: "intervalo de datas inválido",
  forbidden: "seu papel não permite esta ação"
};
const GENERIC = "não foi possível concluir — tente de novo";

function fmtDayMonth(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

type ProfessionalErrorBody = {
  error?: string; fields?: string[]; conflict?: { unit_name?: string; starts_at: string; ends_at: string };
};

// Núcleo comum a professionalError e professionalErrorOrNull — a única
// diferença entre as duas é o que fazem quando nada aqui reconhece o erro
// (GENERIC vs. null, para o SensitiveAction usar sua própria tradução).
function translateProfessionalErrorBody(body: ProfessionalErrorBody): string | null {
  if (body.error === "invalid") {
    if (body.fields?.length) return `confira: ${body.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}`;
    return "dados inválidos — confira os campos";
  }
  if (body.error === "field_not_editable") return "há campos que só a administração da cidade pode mudar";
  if (body.error === "shift_overlap") {
    if (body.conflict?.unit_name) {
      const c = body.conflict;
      return `conflita com o turno em ${c.unit_name}, ${fmtDayMonth(c.starts_at)} ${fmtHourMinute(c.starts_at)}–${fmtHourMinute(c.ends_at)}`;
    }
    return "conflita com outro turno do profissional";
  }
  if (body.error === "not_found") return "registro não encontrado — recarregue a página";
  return (body.error && MESSAGES[body.error]) || null;
}

export function professionalError(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;
  const body = (err.body ?? {}) as ProfessionalErrorBody;
  return translateProfessionalErrorBody(body) ?? GENERIC;
}

// Variante para SensitiveAction.translateError (spec §5): quando o código não
// está mapeado aqui, `null` deixa a mensagem padrão do próprio SensitiveAction
// aparecer (rede, sessão expirada) em vez do genérico "não foi possível
// concluir" desta lib, que não sabe distinguir os dois casos.
export function professionalErrorOrNull(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status === 401) return null;
  const body = (err.body ?? {}) as ProfessionalErrorBody;
  return translateProfessionalErrorBody(body);
}
