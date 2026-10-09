// Balcão da UBS (spec 2026-09-24-citizen-presencial-verification §5, §6). Os
// erros daqui têm tradução própria: `invalid_code` no balcão é o código do
// CIDADÃO, não o TOTP do servidor que describeActionError traduz.
import { ApiError } from "./api";
import { fmtDateTime } from "./format";

// Fila, pedidos e agenda são vistos por papéis diferentes em máquinas
// diferentes e o foco da janela não recarrega (main.tsx) — relê a cada 20s.
export const ATTENDANCE_REFETCH_MS = 20_000;

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

// Módulo 11 (ADR 0023, D4): as unidades de referência do bairro da triagem
// sobem para o topo do destino do encaminhamento, por nome. Id que não está
// entre as ativas (unidade desativada depois da triagem) é ignorado: nunca se
// sugere unidade que a API recusaria (invalid_unit). A própria unidade do
// atendimento nunca é referência (decisão do usuário, 2026-09-28): o api já a
// exclui, e aqui ela sai de novo, por defesa.
export function splitReferenceUnits<T extends { id: string; name: string }>(
  units: T[], referenceIds: string[] | undefined, currentUnitId: string
): { referenceUnits: T[]; otherUnits: T[] } {
  const ids = new Set(referenceIds ?? []);
  ids.delete(currentUnitId);
  return {
    referenceUnits: units.filter((u) => ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    otherUnits: units.filter((u) => !ids.has(u.id))
  };
}

export function nivelLabel(level: "declared" | "verified"): string {
  return level === "verified" ? "verificado" : "declarado";
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
  consultation_in_progress: "há uma consulta em andamento neste atendimento — finalize-a pela Consulta para encerrar",
  unit_name_taken: "já existe uma unidade com este nome",
  // Vem da criação de unidade e do kind da marcação (módulo 17): texto neutro.
  invalid_kind: "tipo inválido — escolha uma das opções",
  invalid_outcome: "desfecho inválido",
  unit_has_open_attendances: "há atendimentos abertos nesta unidade — encerre-os antes de desativar",
  already_called: "este atendimento já foi chamado por outro profissional",
  queue_empty: "ninguém aguardando",
  wrong_unit: "atendimento de outra unidade",
  invalid_transition: "esse atendimento não pode receber este desfecho agora",
  request_not_open: "este pedido já foi encerrado",
  invalid_time: "escolha um horário entre agora e 180 dias",
  not_today: "o código só vale no dia do horário",
  appointment_not_eligible: "este agendamento não está confirmado para check-in",
  unit_has_open_requests: "há pedidos de agendamento nesta unidade — use Esvaziar para movê-los antes de desativar",
  invalid_target: "escolha outra unidade ativa como destino",
  missing_link: "Você não tem vínculo com esta unidade",
  missing_role: "seu papel não permite esta ação",
  invalid_zip: "CEP precisa ter 8 dígitos",
  citizen_not_found: "Nenhum cadastro com este CPF.",
  already_pending: "Já existe um pedido pendente para este CPF.",
  own_request: "Quem registrou o pedido não pode confirmá-lo.",
  not_pending: "Este pedido já foi decidido.",
  try_again: "Outra operação estava em andamento. Tente de novo.",
  invalid_neighborhood: "bairro inválido — escolha outro da lista",
  invalid_birth_date: "data de nascimento inválida — confira no documento",
  invalid_sex: "informe o sexo que consta no documento",
  invalid_gender_identity: "identidade de gênero inválida — escolha da lista",
  // Módulo 16 (contratos §5.4): o CADSUS nunca trava o balcão.
  cadsus_unavailable: "CADSUS indisponível agora — siga pela conferência do documento",
  feature_disabled: "a consulta ao CADSUS foi desligada para a cidade — siga pela conferência do documento",
  cadsus_lookup_missing: "a consulta ao CADSUS venceu — consulte de novo ou desmarque a gravação do CNS",
  // Módulo 17 (contratos §4.3 e §4.1). `slot_taken` fica fora: cada painel
  // trata o 409 antes de chamar attendanceError.
  slot_unavailable: "essa vaga não está mais disponível — as vagas foram recarregadas",
  citizen_busy: "o cidadão já tem outro horário nesse período",
  fit_in_limit: "o turno já chegou ao limite de encaixes",
  use_slots: "a unidade tem turno neste dia — marque numa vaga ou faça um encaixe",
  invalid_reason: "a justificativa do encaixe precisa de pelo menos 10 caracteres",
  type_not_served: "este profissional não atende este tipo de atendimento",
  outside_shift: "o encaixe precisa começar e terminar dentro do turno",
  already_assigned: "este pedido já foi atribuído a uma unidade",
  // Vagas da recepção e Minha agenda (appointment_requests_controller, professional_agenda_controller).
  invalid_range: "período inválido — confira as datas",
  // Módulo 18 (contratos §3 e §5). `implausible_vital` com `field` é traduzido em screeningError.
  already_screening: "outra pessoa já começou a escuta deste atendimento — a fila foi atualizada",
  not_waiting: "este atendimento não está mais aguardando — a fila foi atualizada",
  screening_not_required: "esta unidade não faz acolhimento para este atendimento — a fila foi atualizada",
  cbo_not_allowed: "sua ocupação (CBO) não faz acolhimento",
  not_in_progress: "esta escuta não está mais em andamento — a fila foi atualizada",
  invalid_ciap2: "escolha a queixa (CIAP-2) da lista",
  implausible_vital: "um sinal vital está fora do plausível — confira os valores",
  bp_incomplete: "informe a sistólica e a diastólica juntas",
  invalid_color: "escolha uma das quatro cores",
  color_change_reason_required: "explique por que a cor final é diferente da sugerida",
  invalid_destination: "escolha o destino",
  orientation_required: "escreva a orientação dada",
  invalid_schedule: "confira o tipo, a prioridade e o prazo do agendamento",
  attendance_not_waiting: "o atendimento não está mais aguardando — a escuta não foi concluída",
  not_reassessable: "esta escuta não pode mais ser reavaliada — a fila foi atualizada",
  invalid_screening_scope: "escolha uma das opções de acolhimento",
  note_too_long: "o texto passa de 500 caracteres",
  terminology_unavailable: "a CIAP-2 não está disponível agora — tente de novo em instantes"
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
