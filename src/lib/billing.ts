// src/lib/billing.ts
// Regras de tela do faturamento de procedimentos (módulo 22; ADR 0039;
// contrato 2026-10-21). A crítica SIGTAP, o instrumento, o estabelecimento
// faturante, as pendências e o arquivo são do api: aqui só se traduzem os
// códigos, se monta o corpo e se recusa o que o api recusaria por formato.
// A crítica nunca impede o registro (invariante do ADR 0039).
import {
  ApiError, errorCode, type BillingEstablishment, type BillingExport, type BillingPeriod, type BillingSettings, type BillingSettingsInput,
  type EstablishmentType, type PendingItem, type PerformedProcedure, type ProcedureCharacter, type ProcedureInput, type ProcedureQuery,
  type SigtapProcedure
} from "./api";
import { featureDisabledKey, hasFeature } from "./features";
import { cnpjDigits, isValidCnpj } from "./clinicalDocuments";
import { competenceLabel, competenceOf, recentCompetences } from "./competence";

export const BILLING_CLERK_ROLE = "billing_clerk";
export const BILLING_DISABLED = "o faturamento de procedimentos está desligado nesta cidade";
export const BILLING_NO_ROLE = "seu papel não permite usar o faturamento";
export const LATE_TEXT = "apresentação em atraso";

export const PROCEDURES_KEY = "billingProcedures";
export const CARE_PROCEDURES_KEY = "careProcedures";
export const PERIODS_KEY = "billingPeriods";
export const PENDING_KEY = "billingPending";
export const EXPORTS_KEY = "billingExports";
export const SETTINGS_KEY = "billingSettings";
export const ESTABLISHMENTS_KEY = "billingEstablishments";
export const PROFESSIONALS_KEY = "billingProfessionals";
export const SIGTAP_KEY = "billingSigtap";

type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

export function canUseBilling(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "procedure_billing");
}

export interface BillingRoles { clerk: boolean; admin: boolean; professional: boolean }

export function billingRoles(user: SessionLike): BillingRoles {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  return {
    clerk: roles.includes(BILLING_CLERK_ROLE), admin: roles.includes("municipal_admin"), professional: roles.includes("health_professional")
  };
}

// ADR 0039: unidade de atenção primária nunca gera BPA (a produção vai pelo
// e-SUS APS, sem duplicar). O dashboard não oferece o registro na UBS; o api,
// se receber, grava com establishment_is_aps.
export function unitBills(unit: { kind: string } | null | undefined): boolean {
  return !!unit && unit.kind !== "ubs";
}

export function showUnitProcedures(a: { user: SessionLike; canCare: boolean; unit: { kind: string } | null | undefined }): boolean {
  return canUseBilling(a.user) && a.canCare && unitBills(a.unit);
}

// Motivos de crítica (contrato §1). Código novo do api aparece cru.
const REASON_LABEL: Record<string, string> = {
  not_in_sigtap: "procedimento fora da SIGTAP da competência",
  cbo_not_allowed: "CBO do profissional não permitido para o procedimento",
  age_out_of_range: "idade do paciente fora da faixa do procedimento",
  sex_not_allowed: "sexo do paciente não permitido para o procedimento",
  cid_required: "o procedimento exige CID-10",
  cid_not_allowed: "CID-10 não compatível com o procedimento",
  not_bpa_instrument: "procedimento não é registrado por BPA",
  establishment_is_aps: "unidade de atenção primária — a produção vai pelo e-SUS APS",
  missing_professional_cns: "profissional sem CNS no cadastro",
  missing_professional_cbo: "profissional sem CBO no vínculo",
  missing_patient_id: "paciente sem CPF nem CNS",
  missing_required_patient_field: "falta dado obrigatório do paciente no cadastro",
  missing_establishment_cnes: "estabelecimento sem CNES",
  // Contrato §12, D-U1: dados do paciente que o BPA-I exige.
  missing_race_color: "paciente sem raça/cor",
  missing_address: "paciente sem CEP ou endereço"
};
export const REASON_CODES = Object.keys(REASON_LABEL);

export function reasonLabel(code: string): string {
  return REASON_LABEL[code] ?? code;
}

const SOURCE_LABEL: Record<string, string> = {
  attendance: "atendimento", consultation: "consulta", lab_report: "laboratório municipal", manual: "lançamento manual"
};
export function sourceLabel(code: string): string {
  return SOURCE_LABEL[code] ?? code;
}

const INSTRUMENT_LABEL: Record<string, string> = { bpa_i: "BPA-I", bpa_c: "BPA-C", not_bpa: "fora do BPA" };
export function instrumentLabel(code: string): string {
  return INSTRUMENT_LABEL[code] ?? code;
}

export const CHARACTER_OPTIONS: { key: ProcedureCharacter; label: string }[] = [
  { key: "elective", label: "eletivo" }, { key: "urgent", label: "urgência" }
];
export function characterLabel(code: string): string {
  return CHARACTER_OPTIONS.find((o) => o.key === code)?.label ?? code;
}

export type VerdictTone = "ok" | "warn" | "neutral";

export function verdict(p: Pick<PerformedProcedure, "status" | "billable" | "blocking_reasons" | "instrument">): { tone: VerdictTone; text: string } {
  if (p.status === "cancelled") return { tone: "neutral", text: "cancelado" };
  if (p.billable) return { tone: "ok", text: `faturável · ${instrumentLabel(p.instrument)}` };
  const reasons = p.blocking_reasons.map(reasonLabel);
  return { tone: "warn", text: reasons.length > 0 ? `não faturável — ${reasons.join("; ")}` : "não faturável" };
}

export function fallbackNotice(p: Pick<PerformedProcedure, "sigtap_fallback" | "sigtap_competence">): string | null {
  return p.sigtap_fallback
    ? `conferido com a SIGTAP de ${competenceLabel(p.sigtap_competence)}: a tabela da competência ainda não foi importada — o fechamento confere de novo`
    : null;
}

export function savedText(p: PerformedProcedure): string {
  if (p.billable) return "Procedimento registrado — faturável.";
  return `Procedimento registrado — ${verdict(p).text}. O registro vale; o faturamento confere de novo no fechamento.`;
}

// ─── Formulário do procedimento ────────────────────────────────────────────
export const QUANTITY_MAX = 999;

export interface ProcedureDraft {
  sigtap: SigtapProcedure | null; quantity: string; cid10: string; character: ProcedureCharacter; performedOn: string;
}

export function emptyProcedure(today: string): ProcedureDraft {
  return { sigtap: null, quantity: "1", cid10: "", character: "elective", performedOn: today };
}

export function normalizeCid(text: string): string {
  return text.toUpperCase().replace(/[\s.]/g, "");
}

const CID_RE = /^[A-Z]\d{2}[0-9X]?$/;

// Aviso, nunca bloqueio: sem CID, o api grava e marca cid_required.
export function cidHint(d: ProcedureDraft): string | null {
  return d.sigtap?.requires_cid && !normalizeCid(d.cid10)
    ? "a SIGTAP exige CID-10 para faturar este procedimento — sem ele, o registro vale, mas fica não faturável"
    : null;
}

export function procedureProblem(d: ProcedureDraft, today: string): string | null {
  if (!d.sigtap) return "escolha o procedimento pela busca";
  const q = d.quantity.trim();
  if (!/^\d+$/.test(q) || Number(q) < 1 || Number(q) > QUANTITY_MAX) return `quantidade de 1 a ${QUANTITY_MAX}, só números`;
  const cid = normalizeCid(d.cid10);
  if (cid && !CID_RE.test(cid)) return "CID-10 inválido — ex.: S61 ou S610";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.performedOn)) return "informe a data do procedimento";
  if (d.performedOn > today) return "a data do procedimento não pode ser no futuro";
  return null;
}

export interface ProcedureContext {
  establishment: { type: EstablishmentType; id: string };
  patientId?: string | null; attendanceId?: string | null; consultationId?: string | null;
  professionalUserId?: string | null; cboCode?: string | null;
}

export function procedureBody(d: ProcedureDraft, ctx: ProcedureContext): ProcedureInput {
  if (!d.sigtap) throw new Error("procedureBody sem procedimento");
  const body: ProcedureInput = {
    establishment: ctx.establishment, performed_on: d.performedOn, sigtap_code: d.sigtap.code,
    quantity: Number(d.quantity.trim()), character: d.character
  };
  const cid = normalizeCid(d.cid10);
  if (cid) body.cid10 = cid;
  if (ctx.patientId) body.patient_id = ctx.patientId;
  if (ctx.attendanceId) body.attendance_id = ctx.attendanceId;
  if (ctx.consultationId) body.consultation_id = ctx.consultationId;
  if (ctx.professionalUserId) body.professional_user_id = ctx.professionalUserId;
  if (ctx.cboCode) body.cbo_code = ctx.cboCode;
  return body;
}

// A SIGTAP da busca é a da competência da data do procedimento.
export function sigtapCompetence(d: ProcedureDraft): string {
  return competenceOf(d.performedOn);
}

// ─── Busca SIGTAP (E7: termo acima de 60 caracteres é recusado, nunca cortado) ─
export const SIGTAP_QUERY_MIN = 2;
export const SIGTAP_QUERY_MAX = 60;

export function sigtapQueryProblem(text: string): string | null {
  const t = text.trim();
  if (t.length < SIGTAP_QUERY_MIN) return `digite pelo menos ${SIGTAP_QUERY_MIN} caracteres para buscar`;
  if (t.length > SIGTAP_QUERY_MAX) return `busca com até ${SIGTAP_QUERY_MAX} caracteres — encurte o termo`;
  return null;
}

// ─── Motivos (cancelamento e reabertura; Divergência B8) ───────────────────
export const REASON_MIN = 10;
export const REASON_MAX = 500;

export function reasonProblem(text: string): string | null {
  const t = text.trim();
  if (t.length < REASON_MIN) return `motivo com pelo menos ${REASON_MIN} caracteres`;
  if (t.length > REASON_MAX) return `motivo com até ${REASON_MAX} caracteres — encurte o texto`;
  return null;
}

// ─── Lançamento manual (Divergência B5) ────────────────────────────────────
export interface ManualChoice { establishment: string; patientId: string | null; professionalId: string; cboOptions: string[]; cbo: string }

// Profissional sem CBO no vínculo segue: a crítica marca missing_professional_cbo.
export function manualProblem(m: ManualChoice): string | null {
  if (!parseEstablishmentKey(m.establishment)) return "escolha o estabelecimento";
  if (!m.patientId) return "busque o paciente pelo CPF";
  if (!m.professionalId) return "escolha o profissional";
  if (m.cboOptions.length > 1 && !m.cboOptions.includes(m.cbo)) return "escolha o CBO do profissional";
  return null;
}

// ─── Estabelecimentos e filtros ─────────────────────────────────────────────
export function establishmentLabel(e: BillingEstablishment): string {
  return e.cnes ? `${e.name} · CNES ${e.cnes}` : `${e.name} · sem CNES`;
}

export function establishmentKey(e: { type: string; id: string }): string {
  return `${e.type}:${e.id}`;
}

export function parseEstablishmentKey(key: string): { type: EstablishmentType; id: string } | null {
  const m = /^(health_unit|lab_provider):(.+)$/.exec(key);
  return m ? { type: m[1] as EstablishmentType, id: m[2] } : null;
}

export interface ProcedureFilters {
  establishment: string; competence: string; billable: "" | "true" | "false"; reason: string; patientId: string | null;
}

export function EMPTY_FILTERS(today: string): ProcedureFilters {
  return { establishment: "", competence: competenceOf(today), billable: "", reason: "", patientId: null };
}

export function procedureQuery(f: ProcedureFilters): ProcedureQuery {
  const q: ProcedureQuery = {};
  const est = parseEstablishmentKey(f.establishment);
  if (est) { q.establishmentType = est.type; q.establishmentId = est.id; }
  if (f.competence) q.competence = f.competence;
  if (f.billable) q.billable = f.billable === "true";
  if (f.billable === "false" && f.reason) q.reason = f.reason;
  if (f.patientId) q.patientId = f.patientId;
  return q;
}

// ─── Competência ────────────────────────────────────────────────────────────
// A tela abre na competência anterior: é a que o faturista fecha no começo do mês.
export function closingCompetence(today: string): string {
  return recentCompetences(today, 2)[1];
}

export function periodStatusText(p: Pick<BillingPeriod, "status" | "version">): string {
  if (p.status === "open") return p.version > 0 ? `aberta · reaberta depois da versão ${p.version}` : "aberta";
  if (p.status === "closed") return `fechada · versão ${p.version}`;
  return p.status;
}

export function notBillableText(summary: BillingPeriod["summary"]): string {
  const entries = Object.entries(summary.not_billable ?? {}).filter(([ , n ]) => n > 0);
  if (entries.length === 0) return "nenhum";
  const total = entries.reduce((sum, [ , n ]) => sum + n, 0);
  return `${total} — ${entries.map(([ code, n ]) => `${reasonLabel(code)}: ${n}`).join("; ")}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function closeDescription(p: BillingPeriod): string {
  const s = p.summary;
  const pendingText = s.pending === 0
    ? "nenhuma pendência fica fora"
    : `${plural(s.pending, "pendência fica", "pendências ficam")} fora do arquivo até ${s.pending === 1 ? "ser corrigida" : "serem corrigidas"}`;
  return "As críticas são conferidas de novo com o cadastro de agora. " +
    `Pela última conferência, entram ${plural(s.bpa_i_lines, "linha", "linhas")} de BPA-I e ${s.bpa_c_lines} de BPA-C; ${pendingText}. ` +
    "Depois de gerado, o arquivo não muda: reabrir gera uma nova versão.";
}

// ─── Pendências ─────────────────────────────────────────────────────────────
const FIX_INFO: Record<string, { title: string; hint: string }> = {
  professional: { title: "Cadastro do profissional", hint: "CNS ou CBO do profissional — a administração corrige em Equipe → Profissionais" },
  patient: { title: "Cadastro do paciente", hint: "CPF ou CNS na validação presencial do Atendimento; raça/cor e endereço o faturista completa aqui" },
  establishment: { title: "Cadastro do estabelecimento", hint: "CNES da unidade ou do laboratório — a administração corrige no cadastro da unidade ou do prestador" },
  procedure: { title: "Regra da SIGTAP", hint: "o procedimento não passa na SIGTAP — se foi registrado errado, cancele e registre de novo" }
};
export const FIX_ORDER = [ "professional", "patient", "establishment", "procedure" ];

export function fixInfo(fix: string): { title: string; hint: string } {
  return FIX_INFO[fix] ?? { title: fix, hint: "" };
}

// Motivos que o faturista corrige pela pendência (PATCH /billing/patients/:id/demographics).
export function demographicsMissingOf(reasons: string[]): string[] {
  const out: string[] = [];
  if (reasons.includes("missing_race_color")) out.push("race_color");
  if (reasons.includes("missing_address")) out.push("address");
  return out;
}

export function groupPending(items: PendingItem[]): { fix: string; items: PendingItem[] }[] {
  const groups = new Map<string, PendingItem[]>();
  for (const item of items) groups.set(item.fix, [ ...(groups.get(item.fix) ?? []), item ]);
  const rank = (fix: string) => { const i = FIX_ORDER.indexOf(fix); return i === -1 ? FIX_ORDER.length : i; };
  return [ ...groups.entries() ]
    .sort(([ a ], [ b ]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([ fix, list ]) => ({ fix, items: list }));
}

// ─── Arquivo ────────────────────────────────────────────────────────────────
// Nome de reserva (o do api vem pelo Content-Disposition seguro): sem dado pessoal.
export function exportFileName(period: Pick<BillingPeriod, "competence" | "establishment">, exp: Pick<BillingExport, "version">): string {
  return `bpa-${period.establishment.cnes ?? "sem-cnes"}-${period.competence}-v${exp.version}.txt`;
}

// ─── Configuração (contrato §6; Divergência B10) ───────────────────────────
// Larguras do cabeçalho do layout do DATASUS de 09/07/2026: cbc-rsp (30),
// cbc-sgl (6), cbc-dst (40). Mais longo é recusado, nunca cortado.
export const ORIGIN_NAME_MAX = 30;
export const ORIGIN_ACRONYM_MAX = 6;
export const DESTINATION_MAX = 40;

export interface SettingsDraft {
  originName: string; originAcronym: string; originCnpj: string; destinationBody: string; management: "" | "M" | "E";
}

export function settingsDraft(s: BillingSettings | null): SettingsDraft {
  return {
    originName: s?.origin_name ?? "", originAcronym: s?.origin_acronym ?? "", originCnpj: s?.origin_cnpj ?? "",
    destinationBody: s?.destination_body ?? "", management: s?.management ?? ""
  };
}

// E5: a sigla é opcional (o api exige origin_name e destination_body; a tela também CNPJ e gestão).
export function settingsComplete(s: BillingSettings | null): boolean {
  return !!s && !!s.origin_name && !!s.origin_cnpj && !!s.destination_body && !!s.management;
}

export function settingsProblem(d: SettingsDraft): string | null {
  const name = d.originName.trim();
  if (!name) return "informe o nome do órgão de origem";
  if (name.length > ORIGIN_NAME_MAX) return `nome do órgão de origem com até ${ORIGIN_NAME_MAX} caracteres (largura do arquivo BPA) — abrevie`;
  const acronym = d.originAcronym.trim();
  if (acronym.length > ORIGIN_ACRONYM_MAX) return `sigla do órgão de origem com até ${ORIGIN_ACRONYM_MAX} caracteres (largura do arquivo BPA)`;
  // O campo do arquivo é numérico: CNPJ alfanumérico é recusado além do DV.
  if (!isValidCnpj(d.originCnpj) || !/^\d{14}$/.test(cnpjDigits(d.originCnpj))) return "CNPJ de origem inválido";
  const destination = d.destinationBody.trim();
  if (!destination) return "informe o órgão de destino";
  if (destination.length > DESTINATION_MAX) return `órgão de destino com até ${DESTINATION_MAX} caracteres (largura do arquivo BPA) — abrevie`;
  if (d.management !== "M" && d.management !== "E") return "escolha a gestão: municipal (M) ou estadual (E)";
  return null;
}

export function settingsBody(d: SettingsDraft): BillingSettingsInput {
  return {
    origin_name: d.originName.trim(), origin_acronym: d.originAcronym.trim(), origin_cnpj: cnpjDigits(d.originCnpj),
    destination_body: d.destinationBody.trim(), management: d.management === "E" ? "E" : "M"
  };
}

// ─── Recusas ────────────────────────────────────────────────────────────────
const ERRORS: Record<string, string> = {
  missing_role: "seu papel não permite esta ação no faturamento",
  invalid_sigtap_code: "procedimento não encontrado na SIGTAP — escolha pela busca",
  invalid_quantity: "quantidade de 1 a 999, só números",
  invalid_date: "data inválida: fora da competência atual e das 3 anteriores (BPA Magnético 05.00)",
  invalid_cid10: "CID-10 inválido — ex.: S61 ou S610",
  invalid_establishment: "este estabelecimento não fatura BPA — escolha outro",
  invalid_professional: "este profissional não tem vínculo com o estabelecimento — escolha outro",
  // Contrato §12 (B1, B3, B10, D-L2).
  invalid_cpf: "CPF inválido",
  citizen_not_verified: "o cadastro desta pessoa ainda não foi validado na unidade — valide antes de registrar",
  invalid_demographics: "dados do paciente inválidos — confira os campos",
  field_required: "preencha todos os campos da configuração do faturamento",
  too_many_sheets: "a competência passou de 999 folhas no arquivo — fale com o suporte",
  patient_not_found: "paciente não encontrado — confira o CPF",
  nothing_to_export: "nada a exportar: nenhum procedimento faturável nesta competência e estabelecimento",
  settings_missing: "falta a configuração do faturamento (nome e CNPJ de origem, órgão de destino e gestão) — a administração municipal preenche em Faturamento → Configuração do faturamento",
  invalid_cnpj: "CNPJ de origem inválido",
  invalid_management: "escolha a gestão: municipal (M) ou estadual (E)",
  too_long: "texto maior que a largura do arquivo BPA — abrevie",
  invalid_patient: "paciente inválido — busque o paciente pelo CPF",
  invalid_character: "caráter do atendimento inválido — escolha eletivo ou urgência",
  invalid_query: `busca inválida — use de ${SIGTAP_QUERY_MIN} a ${SIGTAP_QUERY_MAX} caracteres`,
  terminology_unavailable: "a tabela SIGTAP está indisponível no momento — tente de novo em instantes",
  invalid_filter: "filtro inválido — a lista foi reiniciada",
  invalid_cursor: "a lista mudou enquanto você rolava — a tela foi atualizada",
  establishment_is_aps: "unidade de atenção primária — a produção vai pelo e-SUS APS, não pelo BPA",
  not_author: "só quem registrou o procedimento pode alterá-lo",
  missing_link: "falta o vínculo necessário para esta ação — confira o cadastro",
  already_revoked: "este registro já foi revogado — a tela foi atualizada",
  invalid_race_color: "raça/cor inválida — escolha uma das opções",
  invalid_ethnicity: "etnia inválida — escolha uma das opções",
  ethnicity_required: "informe a etnia para raça/cor indígena",
  invalid_zip: "CEP inválido — 8 dígitos",
  integrity_mismatch: "o arquivo não confere com o gerado; gere de novo reabrindo a competência",
  reason_required: `informe o motivo, de ${REASON_MIN} a ${REASON_MAX} caracteres`,
  already_exported: "este procedimento já está no arquivo de uma competência fechada — para cancelar, o faturista reabre a competência",
  invalid_transition: "a competência mudou de situação — a tela foi atualizada",
  not_found: "registro não encontrado — a tela foi atualizada"
};

// Campos do layout/cadastro que o api aponta em `field` (too_long, invalid_demographics).
const FIELD_LABEL: Record<string, string> = {
  origin_name: "nome do órgão de origem", origin_acronym: "sigla do órgão de origem", destination_body: "órgão de destino",
  address_zip: "CEP", address_street: "logradouro", address_number: "número", address_district: "bairro",
  address_complement: "complemento",
  race_color: "raça/cor", ethnicity: "etnia"
};

function errorField(err: unknown): string | undefined {
  return err instanceof ApiError ? (err.body as { field?: string } | undefined)?.field : undefined;
}

export function billingError(err: unknown): string {
  if (featureDisabledKey(err) !== null) return BILLING_DISABLED;
  const code = errorCode(err);
  const field = errorField(err);
  const fieldText = field ? (FIELD_LABEL[field] ?? field) : null;
  if (code === "field_required" && fieldText) return `preencha: ${fieldText}`;
  if (code === "too_long" && fieldText) return `${fieldText} maior que a largura do arquivo BPA — abrevie`;
  if (code === "invalid_demographics" && fieldText) return `dados do paciente inválidos: confira ${fieldText}`;
  if (code && ERRORS[code]) return ERRORS[code];
  if (code) return code; // código novo do api aparece cru
  if (err instanceof ApiError && err.status === 404) return ERRORS.not_found;
  if (err instanceof ApiError) return `não foi possível concluir (${err.status}) — tente de novo`;
  return "sem conexão com o servidor — tente de novo";
}

// A lista mudou por outra pessoa (sumiu, mudou de situação, entrou num arquivo): quem chama relê.
export function isStale(err: unknown): boolean {
  const code = errorCode(err);
  return code === "not_found" || code === "invalid_transition" || code === "already_exported";
}
