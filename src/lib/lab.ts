// src/lib/lab.ts
// Laboratório municipal no painel da cidade (módulo 21b, ADR 0037; contrato
// 2026-10-15). Regras de tela, puras: rótulos, papéis, leitura do código de
// barras, número digitado, prévia da marca, validação e as frases das recusas.
// Quem pode de verdade, a faixa aplicável, a fórmula, a marca final e a
// situação são do api.
import type { QueryClient } from "@tanstack/react-query";
import {
  ApiError, errorCode,
  type BiologicalSex, type CriticalChannel, type LabAnalyteEntry, type LabCollectionPlace, type LabCriticalInput, type LabFlag,
  type LabRequisitionInput
} from "./api";
import { EXAMS_DISABLED } from "./exams";
import { featureDisabledKey, hasFeature } from "./features";
import { cityLocalIso } from "./format";
import { isValidCns } from "./professionals";
import type { Tone } from "../theme/tokens";

export const LAB_CONTEXT_KEY = "labContext";
export const LAB_REQUISITIONS_KEY = "labRequisitions";
export const LAB_REQUISITION_KEY = "labRequisition";
export const LAB_CANDIDATES_KEY = "labCandidates";
export const LAB_EXAMS_KEY = "labExams";
export const LAB_SHIPMENTS_KEY = "labShipments";
export const LAB_UNIT_PENDING_KEY = "labUnitPending";
export const LAB_WORKLIST_KEY = "labWorklist";
export const LAB_ENTRY_KEY = "labEntry";
export const LAB_RELEASES_KEY = "labReleases";
export const LAB_CRITICALS_KEY = "labCriticals";
export const LAB_CRITICAL_COUNT_KEY = "labCriticalCount";
export const LAB_REASONS_KEY = "labReasons";
export const LAB_ADMIN_EXAMS_KEY = "labAdminExams";
export const LAB_TEMPLATES_KEY = "labTemplates";
export const LAB_RELEASERS_KEY = "labReleasers";
export const LAB_REPORTS_KEY = "labReports";

// Toda chave do laboratório (menos o contexto, que só o admin muda): depois de uma ação, nenhuma tela fica com dado velho.
const MOVING_KEYS = [
  LAB_REQUISITIONS_KEY, LAB_REQUISITION_KEY, LAB_CANDIDATES_KEY, LAB_EXAMS_KEY, LAB_SHIPMENTS_KEY,
  LAB_UNIT_PENDING_KEY, LAB_WORKLIST_KEY, LAB_ENTRY_KEY, LAB_RELEASES_KEY, LAB_CRITICALS_KEY, LAB_CRITICAL_COUNT_KEY,
  LAB_REASONS_KEY, LAB_ADMIN_EXAMS_KEY, LAB_TEMPLATES_KEY, LAB_RELEASERS_KEY, LAB_REPORTS_KEY
];

export const LAB_DISABLED = "o laboratório municipal está desligado nesta cidade";
export const LAB_NO_ROLE = "seu papel não permite ver esta tela";
export const ORIGIN_UNIT_REQUIRED = "escolha a unidade de origem";
export const LAB_NO_LAB = "nenhum laboratório municipal para você — fale com o administrador";
export const BARCODE_INVALID = "código ilegível — leia a etiqueta de novo";
export const UNIT_DOES_NOT_COLLECT = "esta unidade não coleta amostras para o laboratório — o administrador marca isso no cadastro da unidade";

export interface LabRoles { staff: boolean; releaser: boolean; admin: boolean; professional: boolean }

export function labRoles(user: { operator: boolean; memberships?: { role: string }[] } | null): LabRoles {
  const roles = user && !user.operator ? (user.memberships ?? []).map((m) => m.role) : [];
  return {
    staff: roles.includes("lab_staff"),
    releaser: roles.includes("lab_releaser"),
    admin: roles.includes("municipal_admin"),
    professional: roles.includes("health_professional")
  };
}

export function canUseLab(user: { operator: boolean; features?: unknown } | null): boolean {
  return !!user && !user.operator && hasFeature(user, "municipal_lab");
}

const REQUISITION_STATUS: Record<string, string> = {
  open: "recebida", in_analysis: "em análise", typed: "digitada", released: "liberada", delivered: "entregue"
};
const REQUISITION_TONE: Record<string, Tone> = { in_analysis: "info", typed: "warn", released: "ok", delivered: "neutral" };

export function requisitionStatusLabel(s: string): string { return REQUISITION_STATUS[s] ?? s; }
export function requisitionStatusTone(s: string): Tone | undefined { return REQUISITION_TONE[s]; }

const ITEM_STATUS: Record<string, string> = { pending: "aguardando resultado", typed: "digitado", released: "liberado", cancelled: "cancelado" };
export function itemStatusLabel(s: string): string { return ITEM_STATUS[s] ?? s; }

const SAMPLE_STATUS: Record<string, string> = {
  in_transit: "em trânsito", received: "recebida", rejected: "rejeitada", accepted_with_restriction: "aceita com restrição",
  not_received: "não chegou"
};
const SAMPLE_TONE: Record<string, Tone> = { received: "ok", rejected: "down", accepted_with_restriction: "warn", not_received: "down", in_transit: "info" };

export function sampleStatusLabel(s: { status: string; collected_at: string | null }): string {
  if (s.status === "awaiting") return s.collected_at ? "coletada" : "aguardando coleta";
  return SAMPLE_STATUS[s.status] ?? s.status;
}
export function sampleStatusTone(status: string): Tone | undefined { return SAMPLE_TONE[status]; }

const SHIPMENT_STATUS: Record<string, string> = { open: "montando", sent: "enviada", received: "conferida" };
export function shipmentStatusLabel(s: string): string { return SHIPMENT_STATUS[s] ?? s; }

const REPORT_STATUS: Record<string, string> = {
  pending_signature: "aguardando assinatura ICP", released: "liberado", rectified: "retificado (substituído)", withdrawn: "devolvido — assinatura digital desligada; libere de novo"
};
// B13: `withdrawn` = o sistema devolveu o pedido ICP (digital_signature desligado); o laudo não vale.
const REPORT_TONE: Record<string, Tone> = { pending_signature: "warn", released: "ok", rectified: "neutral", withdrawn: "down" };
export function reportStatusLabel(s: string): string { return REPORT_STATUS[s] ?? s; }
export function reportStatusTone(s: string): Tone | undefined { return REPORT_TONE[s]; }

const FLAG: Record<string, string> = { normal: "", low: "baixo", high: "alto", critical_low: "crítico baixo", critical_high: "crítico alto" };
const FLAG_TONE: Record<string, Tone> = { low: "warn", high: "warn", critical_low: "down", critical_high: "down" };
export function flagLabel(f: string): string { return f in FLAG ? FLAG[f] : f; }
export function flagTone(f: string): Tone | undefined { return FLAG_TONE[f]; }
export function isCritical(flag: string): boolean { return flag === "critical_low" || flag === "critical_high"; }

const SIGNATURE: Record<string, string> = { icp: "ICP-Brasil", advanced: "assinatura eletrônica avançada" };
export function signatureLabel(k: string): string { return SIGNATURE[k] ?? k; }

export const SECTOR_LABEL: Record<string, string> = {
  biochemistry: "Bioquímica", hematology: "Hematologia", immunology: "Imunologia", urinalysis: "Urinálise",
  parasitology: "Parasitologia", microbiology: "Microbiologia"
};
export function sectorLabel(s: string): string { return SECTOR_LABEL[s] ?? s; }

export const COLLECTION_PLACE_LABEL: Record<LabCollectionPlace, string> = { ubs: "na UBS", lab: "no posto do laboratório" };
export const CHANNEL_OPTIONS: { value: CriticalChannel; label: string }[] = [
  { value: "telefone", label: "Telefone" }, { value: "presencial", label: "Presencial" }, { value: "sistema", label: "Pelo sistema" }
];
export const SEX_OPTIONS: { value: BiologicalSex; label: string }[] = [ { value: "female", label: "Feminino" }, { value: "male", label: "Masculino" } ];

// Leitor = teclado: o código chega com Enter (às vezes \r\n). B16: o código de
// barras da etiqueta tem 10 dígitos (número da requisição de 8 + 2 da amostra).
export function normalizeBarcode(raw: string): string | null {
  const code = raw.trim();
  return /^\d{10}$/.test(code) ? code : null;
}

// B16: o número da requisição tem 8 dígitos.
export function normalizeRequisitionNumber(raw: string): string | null {
  const num = raw.trim();
  return /^\d{8}$/.test(num) ? num : null;
}

// A busca única do balcão decide pelo tamanho: 10 = etiqueta, 8 = requisição.
export function lookupKind(raw: string): "barcode" | "number" | null {
  if (normalizeBarcode(raw)) return "barcode";
  if (normalizeRequisitionNumber(raw)) return "number";
  return null;
}

// "13,5" → "13.5". Separador de milhar não é aceito (ambíguo na bancada).
export function normalizeNumber(raw: string): string | null {
  const t = raw.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? t : null;
}

const fmtLimit = (n: number) => String(n).replace(".", ",");

export function entryProblem(a: LabAnalyteEntry, raw: string): string | null {
  if (raw.trim() === "") return null;
  if (a.value_type === "choice") return a.choices && a.choices.includes(raw) ? null : "escolha uma das opções";
  if (a.value_type !== "numeric") return null;
  const n = normalizeNumber(raw);
  if (n === null) return "valor numérico inválido — use dígitos e vírgula";
  // mais casas do que o exame tem: zeros à direita não contam ("98,0" vale 98)
  const frac = (n.split(".")[1] ?? "").replace(/0+$/, "");
  if (frac.length > a.decimals) {
    return a.decimals === 0 ? "este exame não usa casas decimais — confira o valor" : `este exame usa no máximo ${a.decimals} ${a.decimals === 1 ? "casa decimal" : "casas decimais"} — confira o valor`;
  }
  const v = Number(n);
  if ((a.entry_min !== null && v < a.entry_min) || (a.entry_max !== null && v > a.entry_max)) {
    const range = `${a.entry_min === null ? "—" : fmtLimit(a.entry_min)} a ${a.entry_max === null ? "—" : fmtLimit(a.entry_max)}`;
    return `fora do limite de digitação (${range}${a.unit ? ` ${a.unit}` : ""}) — confira o valor`;
  }
  return null;
}

// Só uma prévia para quem digita; a marca que vale é a que o api devolve.
export function previewFlag(a: LabAnalyteEntry, raw: string): LabFlag | null {
  if (a.value_type !== "numeric") return null;
  const n = normalizeNumber(raw);
  if (n === null) return null;
  const v = Number(n);
  // B27: o limite crítico é inclusivo; os limites da faixa pertencem a ela.
  if (a.critical_low !== null && v <= a.critical_low) return "critical_low";
  if (a.critical_high !== null && v >= a.critical_high) return "critical_high";
  if (!a.reference || (a.reference.low === null && a.reference.high === null)) return null;
  if (a.reference.low !== null && v < a.reference.low) return "low";
  if (a.reference.high !== null && v > a.reference.high) return "high";
  return "normal";
}

export interface PaperDraft { sigtapCode: string; mode: "linked" | "typed"; userId: string; name: string; cns: string }
export interface RequisitionDraft {
  patientId: string | null; biologicalSex: BiologicalSex | ""; motherName: string; urgent: boolean; clinicalInfo: string;
  orderIds: string[]; paper: PaperDraft[];
}
export const EMPTY_REQUISITION: RequisitionDraft = {
  patientId: null, biologicalSex: "", motherName: "", urgent: false, clinicalInfo: "", orderIds: [], paper: []
};
export const EMPTY_PAPER: PaperDraft = { sigtapCode: "", mode: "linked", userId: "", name: "", cns: "" };

export function requisitionProblem(d: RequisitionDraft): string | null {
  if (!d.patientId) return "busque o paciente pelo CPF";
  if (!d.biologicalSex) return "informe o sexo biológico (a referência depende dele)";
  if (!d.motherName.trim()) return "informe o nome da mãe (identificação da amostra)";
  if (d.orderIds.length === 0 && d.paper.length === 0) return "escolha ao menos um exame";
  for (const [ i, p ] of d.paper.entries()) {
    const n = `pedido em papel ${i + 1}`;
    if (!p.sigtapCode) return `${n}: escolha o exame`;
    if (p.mode === "linked" && !p.userId) return `${n}: escolha o profissional que pediu`;
    if (p.mode === "typed" && !p.name.trim()) return `${n}: informe o nome de quem pediu`;
    if (p.mode === "typed" && !isValidCns(p.cns)) return `${n}: CNS de quem pediu inválido`;
  }
  return null;
}

export function requisitionBody(
  d: RequisitionDraft, ctx: { providerId: string; originUnitId: string; place: LabCollectionPlace }
): LabRequisitionInput {
  const info = d.clinicalInfo.trim();
  return {
    patient_id: d.patientId as string, provider_id: ctx.providerId, origin_unit_id: ctx.originUnitId, collection_place: ctx.place,
    biological_sex: d.biologicalSex as BiologicalSex, mother_name: d.motherName.trim(), urgent: d.urgent,
    ...(info ? { clinical_info: info } : {}),
    exam_order_ids: d.orderIds,
    ...(d.paper.length > 0 ? {
      paper_orders: d.paper.map((p) => ({
        sigtap_code: p.sigtapCode,
        requester: p.mode === "linked" ? { user_id: p.userId } : { name: p.name.trim(), cns: p.cns.replace(/\D/g, "") }
      }))
    } : {})
  };
}

export function parseTemperature(raw: string): number | null {
  const n = normalizeNumber(raw);
  return n === null ? null : Number(n);
}

export function temperatureProblem(raw: string): string | null {
  if (raw.trim() === "") return "informe a temperatura da caixa em °C";
  const t = parseTemperature(raw);
  if (t === null) return "temperatura inválida — use dígitos e vírgula";
  if (t < -30 || t > 60) return "temperatura fora do esperado (-30 a 60 °C) — confira o termômetro";
  return null;
}

export interface CriticalDraft { person: string; role: string; channel: CriticalChannel | ""; at: string }
export const EMPTY_CRITICAL: CriticalDraft = { person: "", role: "", channel: "", at: "" };

export function criticalProblem(d: CriticalDraft, nowIso: string): string | null {
  if (!d.person.trim()) return "informe quem foi avisado";
  if (!d.role.trim()) return "informe a função de quem foi avisado";
  if (!d.channel) return "escolha como foi o aviso";
  const at = d.at ? cityLocalIso(d.at) : null;
  if (!at) return "informe a data e a hora do aviso";
  if (new Date(at).getTime() > new Date(nowIso).getTime()) return "a hora do aviso não pode ser no futuro";
  return null;
}

export function criticalBody(resultId: string, d: CriticalDraft): LabCriticalInput {
  return {
    result_id: resultId, notified_person: d.person.trim(), notified_role: d.role.trim(), channel: d.channel as CriticalChannel,
    notified_at: cityLocalIso(d.at) as string
  };
}

export interface ContactDraft { person: string; channel: CriticalChannel | ""; at: string }
export const RECTIFY_REASON_MIN = 10;

export function rectifyProblem(reason: string, contacts: ContactDraft[], nowIso: string): string | null {
  if (reason.trim().length < RECTIFY_REASON_MIN) return `escreva o motivo da retificação (ao menos ${RECTIFY_REASON_MIN} caracteres)`;
  if (contacts.length === 0) return "registre quem foi avisado da retificação";
  for (const [ i, c ] of contacts.entries()) {
    const n = `contato ${i + 1}`;
    if (!c.person.trim()) return `${n}: informe quem foi avisado`;
    if (!c.channel) return `${n}: escolha como foi o aviso`;
    const at = c.at ? cityLocalIso(c.at) : null;
    if (!at) return `${n}: informe a data e a hora`;
    if (new Date(at).getTime() > new Date(nowIso).getTime()) return `${n}: a hora não pode ser no futuro`;
  }
  return null;
}

export function contactsBody(contacts: ContactDraft[]): { person: string; channel: CriticalChannel; at: string }[] {
  return contacts.map((c) => ({ person: c.person.trim(), channel: c.channel as CriticalChannel, at: cityLocalIso(c.at) as string }));
}

export function totpProblem(code: string): string | null {
  return /^\d{6}$/.test(code) ? null : "digite os 6 dígitos do autenticador";
}

// CFM: médico só assina laudo com ICP. O api confere de novo (422 icp_required).
export function onlyIcp(council: string | null): boolean {
  return council === "CRM";
}

const ERRORS: Record<string, string> = {
  invalid_transition: "a situação mudou — a tela foi atualizada",
  not_found: "etiqueta ou requisição não encontrada — confira o código",
  order_not_eligible: "um dos exames não pode entrar na requisição (já está em outra ou mudou de situação)",
  exam_not_in_lab_catalog: "este exame não está no catálogo do laboratório",
  mother_name_required: "informe o nome da mãe (identificação da amostra)",
  biological_sex_required: "informe o sexo biológico (a referência depende dele)",
  out_of_entry_range: "valor fora do limite de digitação — confira",
  unknown_analyte: "componente que não existe na versão deste exame — atualize a tela",
  sample_not_received: "a amostra ainda não foi recebida no laboratório",
  icp_required: "médico libera só com ICP-Brasil — escolha ICP",
  no_active_certificate: "sem certificado ICP ativo — vincule o certificado em Assinatura digital ou use a assinatura avançada",
  mfa_required: "o código do autenticador não valeu — digite o código atual",
  invalid_analytes: "componentes inválidos — confira chave, nome, tipo e casas decimais",
  invalid_reference_ranges: "faixas de referência inválidas — confira sexo, idades e limites",
  invalid_formula: "fórmula inválida — use só as chaves dos componentes e + - * / ( )",
  duplicate_instrument_code: "este código do aparelho já está em outro exame do laboratório",
  council_missing: "o profissional não tem conselho, UF e registro no perfil — complete em Profissionais",
  lead_taken: "o laboratório já tem responsável técnico — primeiro encerre o atual com \"Tirar\", depois inclua o novo com a marca. Enquanto não houver responsável técnico, a liberação de laudos fica bloqueada (technical_lead_missing)",
  deputy_taken: "o laboratório já tem substituto do responsável técnico — primeiro encerre o atual com \"Tirar\", depois inclua o novo com a marca. Enquanto o laboratório estiver sem responsável técnico, a liberação de laudos fica bloqueada (technical_lead_missing)",
  invalid_marks: "a mesma pessoa não é RT e substituto ao mesmo tempo",
  already_assigned: "esta pessoa já é liberadora deste laboratório",
  user_missing_role: "a pessoa não tem o papel de liberador — dê o papel na Equipe antes",
  provider_uses_municipal_lab: "este prestador usa o laboratório municipal — o resultado sai pela liberação do laudo",
  item_frozen: "este exame está num laudo aguardando assinatura ICP — assine ou aguarde a devolução antes de alterar",
  rectify_items_mismatch: "a lista de exames não bate com o que mudou — desmarque os sem alteração e marque os alterados (veja as marcas na lista)",
  missing_role: "seu papel não permite esta ação",
  not_unit_staff: "você não atua nesta unidade",
  unit_does_not_collect: UNIT_DOES_NOT_COLLECT,
  reason_required: "escolha o motivo da rejeição",
  restriction_note_required: "escreva a restrição que vai ao laudo",
  invalid_temperature: "temperatura inválida",
  shipment_empty: "a remessa não tem amostras",
  sample_not_collected: "a amostra ainda não foi coletada",
  sample_in_other_shipment: "a amostra já está em outra remessa",
  wrong_origin_unit: "a amostra é de outra unidade",
  patient_not_found: "nenhum paciente com este CPF na cidade",
  citizen_not_verified: "este CPF ainda não tem cadastro validado — faça a validação presencial no balcão antes",
  invalid_month: "mês inválido",
  link_expired: "o link do laudo expirou — abra de novo",
  laboratory_incomplete: "o laboratório está sem endereço ou telefone — complete o cadastro do prestador antes de liberar",
  technical_lead_missing: "o laboratório não tem responsável técnico — marque um liberador como responsável técnico",
  signature_unavailable: "a assinatura ICP-Brasil não está disponível nesta cidade — peça ao administrador para ativá-la",
  invalid_signature: "tipo de assinatura inválido para este laudo",
  gal_already_registered: "este pedido já tem a requisição do GAL registrada",
  filter_required: "escolha a unidade de origem para listar as requisições",
  not_applicable: "esta ação não se aplica a este laudo",
  municipal_lab_disabled: LAB_DISABLED,
  sigtap_unknown: "código SIGTAP desconhecido",
  duplicate_sigtap: "já existe um exame com este código SIGTAP",
  invalid_sector: "setor inválido",
  blank: "preencha o campo obrigatório",
  duplicate_analyte_key: "já existe um componente com esta chave neste exame",
  invalid_analyte_key: "chave de componente inválida — use letras minúsculas, números e _",
  invalid_value_type: "tipo de valor inválido",
  choices_required: "opções inválidas — informe de 1 a 20 opções distintas, com até 60 caracteres",
  invalid_version: "versão do exame inválida — confira os dados e tente de novo",
  invalid_template: "modelo de exame inválido ou inexistente — atualize a tela",
  invalid_provider: "prestador inválido — escolha um laboratório municipal",
  invalid_loinc: "código LOINC inválido",
  invalid_decimals: "casas decimais inválidas (0 a 4)",
  invalid_name: "nome inválido — preencha o nome",
  invalid_active: "situação (ativo ou inativo) inválida",
  duplicate_name: "já existe um motivo com este nome",
  invalid_delivery_days: "prazo de entrega inválido — use de 1 a 90 dias",
  invalid_bench: "bancada inválida — use até 60 caracteres",
  invalid_cursor: "a lista de críticos mudou — recarregue a página para começar de novo",
  not_critical: "este valor não é crítico — não há aviso a registrar",
  invalid_notice: "aviso inválido — confira quem foi avisado (até 120 caracteres), a função (até 60), o canal e a hora (não pode ser no futuro)",
  invalid_samples: "nenhuma amostra para imprimir etiqueta",
  invalid_collected_at: "data e hora da coleta inválidas ou no futuro",
  invalid_values: "falta um valor que entra no cálculo de um componente calculado — digite os componentes da conta juntos",
  too_many_requests: "muitas tentativas seguidas — espere um minuto e tente de novo"
};

export function labError(err: unknown): string {
  const feature = featureDisabledKey(err);
  if (feature === "exam_tracking") return EXAMS_DISABLED;
  if (feature !== null) return LAB_DISABLED;
  const code = errorCode(err);
  if (code && ERRORS[code]) return ERRORS[code];
  if (err instanceof ApiError) return `não foi possível concluir (${err.status}${code ? `: ${code}` : ""}) — tente de novo`;
  return "sem conexão com o servidor — tente de novo";
}

export async function refreshLab(client: QueryClient): Promise<void> {
  await Promise.all(MOVING_KEYS.map((key) => client.invalidateQueries({ queryKey: [ key ] })));
}

// Releitura do exame que falhou: se o resultado já tinha sido salvo, a mensagem diz isso.
export function rereadError(saved: boolean, err: unknown): string {
  return saved ? `resultado salvo, mas não foi possível reler o exame — ${labError(err)}` : `não foi possível reler o exame — ${labError(err)}`;
}
