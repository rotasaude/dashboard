// Balcão da UBS (spec 2026-09-24-citizen-presencial-verification §5, §6). Os
// erros daqui têm tradução própria: `invalid_code` no balcão é o código do
// CIDADÃO, não o TOTP do servidor que describeActionError traduz.
import { ApiError } from "./api";
import { fmtDateTime } from "./format";

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function maskCpf(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  const head = [ d.slice(0, 3), d.slice(3, 6), d.slice(6, 9) ].filter(Boolean).join(".");
  return d.length > 9 ? `${head}-${d.slice(9)}` : head;
}

export function isValidCpf(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const n = d.split("").map(Number);
  const check = (len: number) => {
    const sum = n.slice(0, len).reduce((acc, x, i) => acc + x * (len + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === n[9] && check(10) === n[10];
}

export const UNIT_KINDS = [
  { value: "ubs", label: "UBS" },
  { value: "upa", label: "UPA" },
  { value: "hospital", label: "Hospital" },
  { value: "other", label: "Outra" }
];

export function currentUnitKey(userId: string): string {
  return `attendance.unit.${userId}`;
}

const GENERIC = "não foi possível concluir — tente de novo";
const MESSAGES: Record<string, string> = {
  invalid_cpf: "CPF inválido",
  invalid_code: "código não confere — confira com o cidadão",
  code_expired: "código vencido ou já usado — peça ao cidadão para gerar outro código",
  code_exhausted: "tentativas esgotadas — peça ao cidadão para gerar outro código",
  document_check_required: "marque que conferiu o documento com foto",
  already_revoked: "esta validação já foi desfeita",
  own_verification: "quem validou não pode desfazer a própria validação",
  reason_too_short: "o motivo precisa de pelo menos 10 caracteres",
  forbidden: "seu papel não permite esta ação",
  too_many_requests: "muitas tentativas — aguarde alguns minutos",
  triage_too_old: "triagem com mais de 3 dias — peça ao cidadão para gerar outro código",
  triage_not_eligible: "essa triagem não é elegível para atendimento",
  invalid_unit: "unidade inválida ou desativada — escolha outra",
  referral_required: "informe a unidade de destino ou a descrição do encaminhamento",
  already_closed: "este atendimento já foi encerrado",
  unit_name_taken: "já existe uma unidade com este nome",
  invalid_kind: "tipo de unidade inválido",
  invalid_outcome: "desfecho inválido"
};

export function attendanceError(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;
  const body = (err.body ?? {}) as { error?: string; verified_at?: string; unit_name?: string; checked_in_at?: string };
  if (body.error === "already_verified") {
    return body.verified_at ? `cadastro já verificado em ${fmtDateTime(body.verified_at)}` : "cadastro já verificado";
  }
  if (body.error === "already_checked_in") {
    if (body.unit_name && body.checked_in_at) {
      return `já está em atendimento em ${body.unit_name} desde ${fmtDateTime(body.checked_in_at)}`;
    }
    return "esta triagem já está em atendimento";
  }
  if (err.status === 401) return "sessão expirada — entre de novo";
  return (body.error && MESSAGES[body.error]) || GENERIC;
}
