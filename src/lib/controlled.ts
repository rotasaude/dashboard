// src/lib/controlled.ts
// Regras de tela da receita de controle especial e de antimicrobiano e do SNCR
// (módulo 19d; spec §4–§7; ADR 0034; contrato 2026-10-10 §1–§7 e §12). Quem
// decide é o api (categoria, modo, número, limites, quem prescreve): aqui só se
// espelha para não oferecer o que ele recusaria e se traduz o que ele
// devolveu. Nenhuma frase leva CPF, endereço, número SNCR, state ou session_id —
// só rótulos, posições ("item 2") e o número quando a própria tela o mostra.
import {
  ApiError, errorCode,
  type ClinicalDocument, type MedicationRoute, type NotificationRecordInput, type NotificationType, type PaperReason,
  type PatientIdentification, type PatientIdentificationInput, type PrescriptionCategory, type PrescriptionContent, type SignerCertificate,
  type SncrAddress, type SncrCallbackResult, type SncrKind, type SncrNumberRef, type SncrOverview, type SncrOverviewProfessional,
  type SncrStock
} from "./api";
import { featureDisabledKey, hasFeature, sessionFeatures } from "./features";
import { fmtNumber } from "./format";
import { onlyDigits } from "./attendance";
import { maskCep } from "./unitAddress";
import {
  ADDRESS_FIELD_LABEL, CONTROLLED_DISABLED, MIXED_CATEGORIES, documentError, issuedNotice, kindLabel, professionalKind,
  type ItemDraft, type ItemMedication
} from "./clinicalDocuments";
import { readReturnParams, safeReturnTo } from "./oauthReturn";
import type { Tone } from "../theme/tokens";

// Frases divididas com a emissão: a fonte é clinicalDocuments.ts.
export { MIXED_CATEGORIES, PRESCRIBER_MISSING } from "./clinicalDocuments";

export const SNCR_STOCK_KEY = "sncrStock";
export const SNCR_OVERVIEW_KEY = "sncrOverview";
export const CONTACT_KEY = "professionalContact";
// Caminho do módulo "sncr" (return_to; Divergência D3 do 19b).
export const SNCR_RETURN_TO = "/sncr";

export const MONTHLY_REQUEST_LIMIT = 3;
export const SPECIAL_CONTROL_MAX_C1 = 3;
export const SPECIAL_CONTROL_MAX_DAYS = 60;
export const ANTICONVULSANT_MAX_DAYS = 180;
export const NOTIFICATION_MAX_DAYS: Record<NotificationType, number> = { A: 30, B: 60, B2: 60 };

export const SNCR_SIMULATED_NOTICE = "Numeração simulada — sem validade";
export const SNCR_NO_CANCEL_NOTE =
  "O número SNCR fica anulado e não volta ao seu estoque. O SNCR não tem cancelamento: a farmácia só vê que a receita foi cancelada na conferência do Rota Saúde.";
export const NOTIFICATION_NOTE =
  "Registro da Notificação de papel (talão da VISA): não gera PDF nem assinatura e não aparece na página de conferência; o medicamento entra na lista de medicamentos em uso.";
export const CATEGORY_NOTE: Record<"special_control" | "antimicrobial", string> = {
  special_control:
    "receita de controle especial: 2 vias (1ª via — farmácia, 2ª via — paciente), válida por 30 dias; digital com número SNCR quando você tem certificado e número no estoque; senão, papel",
  antimicrobial:
    "receita de antimicrobiano: 2 vias (1ª via — farmácia, 2ª via — paciente), válida por 10 dias; digital com número SNCR quando você tem certificado e número no estoque; senão, papel"
};
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR",
  "RS", "SC", "SE", "SP", "TO"
];

const positiveInt = (text: string): number | null => {
  const t = text.trim();
  return /^\d+$/.test(t) && Number(t) >= 1 ? Number(t) : null;
};

// Quantidade da Notificação como o api aceita: decimal positivo, até 2 casas, até 9999.
const quantityValue = (text: string): number | null => {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 9999 ? n : null;
};

// ─── Quem pode ────────────────────────────────────────────────────────────────

type SessionLike = { operator?: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;
const rolesOf = (user: SessionLike) => user?.memberships?.map((m) => m.role) ?? [];

export function controlledOn(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "clinical_documents") && hasFeature(user, "controlled_prescriptions");
}

export function canRequestSncr(user: SessionLike): boolean {
  return controlledOn(user) && rolesOf(user).includes("health_professional");
}

export function canSeeSncrOverview(user: SessionLike): boolean {
  return controlledOn(user) && rolesOf(user).includes("municipal_admin");
}

// Interruptor `sncr_mock` (maintenance) ligado sobre o controlado.
export function usesSimulatedSncr(user: SessionLike): boolean {
  const features = sessionFeatures(user);
  return features.includes("controlled_prescriptions") && features.includes("sncr_mock");
}

export function prescribesControlled(cbo: string | null | undefined): boolean {
  const who = professionalKind(cbo);
  return who === "physician" || who === "dentist";
}

// ─── Categoria e bloqueio por lista (Portaria 344) ────────────────────────────

export type ItemClass = "common" | "special_control" | "antimicrobial" | "notification" | "unsupported" | "unclassified";
type Classifiable = { antimicrobial?: boolean; controlled?: boolean; controlled_list?: string | null; anticonvulsant?: boolean };

const NOTIFICATION_LISTS = [ "A1", "A2", "A3", "B1", "B2" ];
// C4 (antirretrovirais) como C2/C3: plano do api, D8. Lista desconhecida também fica fora (o api falha fechado).
const UNSUPPORTED_LISTS = [ "C2", "C3", "C4" ];
const SPECIAL_LISTS = [ "C1", "C5" ];

// Item de documento emitido não traz as marcas da lista (o api grava o
// catalog_item sem elas): a chave fica ausente, não null. Na reemissão de uma
// receita de controle especial, esse item segue a categoria do documento.
const fromIssuedDocument = (m: Classifiable) => m.controlled_list === undefined;

export function itemClass(m: Classifiable | null | undefined, hint?: PrescriptionCategory): ItemClass {
  const list = m?.controlled_list;
  if (list) {
    if (NOTIFICATION_LISTS.includes(list)) return "notification";
    if (SPECIAL_LISTS.includes(list)) return "special_control";
    return "unsupported";
  }
  if (m?.controlled) return "unclassified";
  if (m && hint === "special_control" && fromIssuedDocument(m) && !m.antimicrobial) return "special_control";
  if (m?.antimicrobial) return "antimicrobial";
  return "common";
}

// Espelho do classify do api (Content::Controlled): a categoria é a dominante
// (controle especial se houver item do catálogo C1/C5; senão antimicrobiano se
// houver antimicrobiano do catálogo; senão comum) e todo item precisa servir a
// ela — controle especial só com C1/C5 do catálogo que não seja antimicrobiano;
// antimicrobiano só com antimicrobianos do catálogo. Texto livre antimicrobiano
// a tela não reconhece (o api reconhece e, sem item do catálogo, leva a receita
// ao papel com `free_text_items`): para a tela, só texto livre é comum.
const isSpecial = (it: ItemDraft, hint?: PrescriptionCategory) =>
  !!it.medication && itemClass(it.medication, hint) === "special_control";

function dominantCategory(items: ItemDraft[], hint?: PrescriptionCategory): PrescriptionCategory {
  if (items.some((it) => isSpecial(it, hint))) return "special_control";
  if (items.some((it) => !!it.medication?.antimicrobial)) return "antimicrobial";
  return "common";
}

function fits(category: PrescriptionCategory, it: ItemDraft, hint?: PrescriptionCategory): boolean {
  if (category === "special_control") return isSpecial(it, hint) && !it.medication?.antimicrobial;
  if (category === "antimicrobial") return !!it.medication && it.medication.antimicrobial === true;
  return true;
}

// Posição (0-based) do primeiro item que não serve à categoria dominante, como
// o `index` do 422 mixed_categories; null quando a receita não é misturada.
export function mixedIndex(items: ItemDraft[], hint?: PrescriptionCategory): number | null {
  const category = dominantCategory(items, hint);
  const index = items.findIndex((it) => !fits(category, it, hint));
  return index >= 0 ? index : null;
}

// `hint`: a categoria do documento reemitido ("cancelar e emitir outro").
export function prescriptionCategory(items: ItemDraft[], hint?: PrescriptionCategory): PrescriptionCategory | "mixed" {
  return mixedIndex(items, hint) !== null ? "mixed" : dominantCategory(items, hint);
}

export function controlledBlockReason(m: Classifiable): string | null {
  switch (itemClass(m)) {
    case "notification": return "Notificação de receita (listas A/B) — registre a de papel em “Notificação (papel)”";
    case "unsupported":
      return UNSUPPORTED_LISTS.includes(m.controlled_list ?? "")
        ? `lista ${m.controlled_list} (retinoide, talidomida ou antirretroviral) — fora do Rota Saúde`
        : `lista ${m.controlled_list} — fora do Rota Saúde`;
    case "unclassified": return "controlado sem a lista da Portaria 344 no catálogo — não entra na receita";
    default: return null;
  }
}

export function controlledTagLabel(m: Classifiable): string | null {
  if (!m.controlled_list) return null;
  return `lista ${m.controlled_list}${m.anticonvulsant ? " · anticonvulsivante" : ""}`;
}

export function maxDaysFor(m: Classifiable | null | undefined): number {
  return m?.anticonvulsant ? ANTICONVULSANT_MAX_DAYS : SPECIAL_CONTROL_MAX_DAYS;
}

const CATEGORY_LABEL: Record<string, string> = {
  common: "receita comum", special_control: "receita de controle especial", antimicrobial: "receita de antimicrobiano"
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

export function documentCategory(doc: ClinicalDocument): PrescriptionCategory | null {
  return doc.kind === "prescription" ? ((doc.content as PrescriptionContent).category ?? null) : null;
}

export function documentSncr(doc: ClinicalDocument): SncrNumberRef | null {
  return doc.kind === "prescription" ? ((doc.content as PrescriptionContent).sncr ?? null) : null;
}

export function documentTitle(doc: ClinicalDocument): string {
  const category = documentCategory(doc);
  if (category === "special_control") return "Receita de controle especial";
  if (category === "antimicrobial") return "Receita de antimicrobiano";
  return kindLabel(doc.kind);
}

export function sncrLabel(s: Pick<SncrNumberRef, "kind" | "number">): string {
  return `${s.kind.toUpperCase()} nº ${s.number}`;
}

// ─── Endereço, identificação do paciente e telefone ───────────────────────────

export interface AddressDraft { street: string; number: string; complement: string; district: string; city: string; uf: string; zip: string }
export const EMPTY_ADDRESS_DRAFT: AddressDraft = { street: "", number: "", complement: "", district: "", city: "", uf: "", zip: "" };

export function addressDraftFrom(a: SncrAddress | null | undefined): AddressDraft {
  if (!a) return EMPTY_ADDRESS_DRAFT;
  return { street: a.street, number: a.number, complement: a.complement ?? "", district: a.district, city: a.city, uf: a.uf, zip: maskCep(a.zip) };
}

// Limites do api (ClinicalDocuments::Address), contados como ele (`squish`).
const squished = (text: string) => text.trim().replace(/\s+/g, " ").length;

export function addressProblem(d: AddressDraft, who: string): string | null {
  if (!d.street.trim()) return `${who}: informe o logradouro`;
  if (squished(d.street) > 120) return `${who}: o logradouro tem até 120 caracteres`;
  if (!d.number.trim()) return `${who}: informe o número (ou s/n)`;
  if (squished(d.number) > 10) return `${who}: o número tem até 10 caracteres`;
  if (squished(d.complement) > 60) return `${who}: o complemento tem até 60 caracteres`;
  if (!d.district.trim()) return `${who}: informe o bairro`;
  if (squished(d.district) > 80) return `${who}: o bairro tem até 80 caracteres`;
  if (!d.city.trim()) return `${who}: informe a cidade`;
  if (squished(d.city) > 80) return `${who}: a cidade tem até 80 caracteres`;
  if (!UFS.includes(d.uf)) return `${who}: escolha a UF`;
  if (onlyDigits(d.zip).length !== 8) return `${who}: o CEP precisa ter 8 dígitos`;
  return null;
}

// Uma forma por valor (contracts C4): CEP só dígitos, complemento ausente quando vazio.
export function addressInput(d: AddressDraft): SncrAddress {
  const complement = d.complement.trim();
  return {
    street: d.street.trim(), number: d.number.trim(), ...(complement ? { complement } : {}), district: d.district.trim(),
    city: d.city.trim(), uf: d.uf, zip: onlyDigits(d.zip)
  };
}

export function addressLine(a: SncrAddress | null | undefined): string {
  if (!a) return "—";
  const street = `${a.street}, ${a.number}`;
  return [ a.complement ? `${street} — ${a.complement}` : street, a.district, `${a.city}/${a.uf}`, maskCep(a.zip) ].join(" · ");
}

// O CPF é sempre o do cadastro (regra do 19a; sem "não possui CPF"): a tela
// só edita o endereço do paciente.
export interface IdentificationDraft { address: AddressDraft }
export const EMPTY_IDENTIFICATION: IdentificationDraft = { address: EMPTY_ADDRESS_DRAFT };

export function identificationDraftFrom(pi: PatientIdentification | null | undefined): IdentificationDraft {
  return pi ? { address: addressDraftFrom(pi.address) } : EMPTY_IDENTIFICATION;
}

export function identificationProblem(d: IdentificationDraft): string | null {
  return addressProblem(d.address, "endereço do paciente");
}

// Divergência D2: o CPF não vai no corpo — o api usa o do cadastro do paciente.
export function identificationInput(d: IdentificationDraft): PatientIdentificationInput {
  return { address: addressInput(d.address) };
}

export function phoneProblem(text: string): string | null {
  const d = onlyDigits(text);
  if (d.length !== 10 && d.length !== 11) return "telefone: DDD e número, 10 ou 11 dígitos";
  if (Number(d.slice(0, 2)) < 11) return "telefone: DDD inválido";
  return null;
}

export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return "—";
  const d = onlyDigits(digits);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

// ─── Limites (espelho dos 422 do api, na ordem dele) ──────────────────────────

// `category`: a do documento reemitido (PrescriptionDraft.category).
export function controlledProblems(d: { items: ItemDraft[]; category?: PrescriptionCategory }, identification: IdentificationDraft): string[] {
  // O api recusa o item bloqueado antes de classificar a receita.
  const blocked: string[] = [];
  d.items.forEach((it, i) => {
    const reason = it.medication ? controlledBlockReason(it.medication) : null;
    if (reason) blocked.push(`item ${i + 1}: ${reason}`);
  });
  if (blocked.length > 0) return blocked;
  const mixed = mixedIndex(d.items, d.category);
  if (mixed !== null) return [ `item ${mixed + 1}: ${MIXED_CATEGORIES}` ];
  if (dominantCategory(d.items, d.category) !== "special_control") return [];
  const out: string[] = [];
  // O api conta itens C1, não substâncias distintas.
  if (d.items.filter((it) => it.medication?.controlled_list === "C1").length > SPECIAL_CONTROL_MAX_C1) {
    out.push(`no máximo ${SPECIAL_CONTROL_MAX_C1} substâncias da lista C1 por receita`);
  }
  // Todo item da receita de controle especial leva duração (plano do api, D15).
  // O item do documento reemitido não diz se é anticonvulsivante: o teto fica com o api.
  d.items.forEach((it, i) => {
    const known = !!it.medication && !fromIssuedDocument(it.medication);
    const max = maxDaysFor(it.medication);
    const days = positiveInt(it.durationDays);
    if (it.durationDays.trim() === "") out.push(`item ${i + 1}: informe a duração em dias${known ? ` (até ${max})` : ""}`);
    else if (known && days !== null && days > max) {
      out.push(`item ${i + 1}: duração acima de ${max} dias${max === ANTICONVULSANT_MAX_DAYS ? " (anticonvulsivante)" : ""}`);
    }
  });
  const identificationIssue = identificationProblem(identification);
  if (identificationIssue) out.push(identificationIssue);
  return out;
}

// ─── Previsão de papel (o modo é do api) ──────────────────────────────────────

export function sncrKindFor(category: PrescriptionCategory | "mixed"): SncrKind | null {
  if (category === "special_control") return "rce";
  if (category === "antimicrobial") return "ret";
  return null;
}

export interface ForecastInput {
  category: PrescriptionCategory | "mixed"; cboCode: string; signatureOn: boolean;
  certificate: SignerCertificate | null | undefined; stock: SncrStock | undefined;
}

// Ordem do `decide` do api. Indefinido = ainda carregando: não prevê papel por
// falta de dado. `free_text_items` não se prevê (a tela não reconhece texto
// livre antimicrobiano) e `feature_disabled` não se aplica com o 19d ligado.
export function paperForecast(i: ForecastInput): PaperReason | null {
  const kind = sncrKindFor(i.category);
  if (!kind) return null;
  if (kind === "ret" && professionalKind(i.cboCode) === "nurse") return "nurse_antimicrobial";
  if (!i.signatureOn) return "signature_unavailable";
  if (i.certificate === null || (i.certificate && i.certificate.status !== "active")) return "no_certificate";
  if (i.stock && i.stock[kind].free <= 0) return "no_sncr_number";
  return null;
}

const PAPER_REASON_LABEL: Record<PaperReason, string> = {
  no_certificate: "você não tem certificado digital ativo — vincule em Conta → Assinatura digital",
  signature_unavailable: "a assinatura digital não está disponível na cidade",
  no_sncr_number: "sem número SNCR no seu estoque — obtenha números em Conta → SNCR",
  nurse_antimicrobial: "a receita de antimicrobiano da enfermagem sai sempre em papel",
  feature_disabled: "a receita digital de antimicrobiano (SNCR) está desligada nesta cidade",
  free_text_items: "itens digitados à mão — sai em papel"
};

// Desconhecido aparece cru; nulo (digital, ou voltou ao papel) vira "—".
export function paperReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "—";
  return (PAPER_REASON_LABEL as Record<string, string>)[reason] ?? reason;
}

// ─── Depois da emissão ────────────────────────────────────────────────────────

export function controlledIssuedNotice(doc: ClinicalDocument): string {
  if (doc.kind === "controlled_notification_record") {
    return "Notificação de papel registrada: o medicamento entra na lista de medicamentos em uso. Guarde o talão; nada é impresso aqui.";
  }
  const category = documentCategory(doc);
  if (category !== "special_control" && category !== "antimicrobial") return issuedNotice(doc);
  const what = documentTitle(doc);
  if (doc.issue_mode === "digital") {
    const sncr = documentSncr(doc);
    const number = sncr ? ` com o número SNCR ${sncrLabel(sncr)}${sncr.simulated ? ` (${SNCR_SIMULATED_NOTICE.toLowerCase()})` : ""}` : "";
    return `${what} emitida em modo digital${number}: a assinatura entra na sua fila; o PDF assinado sai depois dela.`;
  }
  const reason = doc.paper_reason ? ` (${paperReasonLabel(doc.paper_reason)})` : "";
  return `${what} emitida em modo papel${reason}: imprima as 2 vias e assine à mão.`;
}

// ─── Estoque ──────────────────────────────────────────────────────────────────

const SNCR_KIND_LABEL: Record<SncrKind, string> = {
  rce: "Receita de controle especial (RCE)", ret: "Receita de antimicrobiano (RET)"
};
const OUT_OF_NUMBERS: Record<SncrKind, string> = {
  rce: "sem números: as receitas de controle especial saem em papel",
  ret: "sem números: as receitas de antimicrobiano saem em papel"
};

export interface StockRow {
  kind: SncrKind; label: string; free: number; used: number; voided: number; requests: number; limitReached: boolean;
  notice: { tone: Tone; text: string } | null;
}

export function stockRows(s: SncrStock): StockRow[] {
  return ([ "rce", "ret" ] as const).map((kind) => {
    const k = s[kind];
    const notice: StockRow["notice"] = k.free <= 0 ? { tone: "down", text: OUT_OF_NUMBERS[kind] }
      : k.free < s.low_threshold ? { tone: "warn", text: `saldo baixo: menos de ${s.low_threshold} números — obtenha mais antes que acabe` }
      : null;
    return {
      kind, label: SNCR_KIND_LABEL[kind], free: k.free, used: k.used, voided: k.voided, requests: k.requests_this_month,
      limitReached: k.requests_this_month >= MONTHLY_REQUEST_LIMIT, notice
    };
  });
}

// ─── Retorno do gov.br ────────────────────────────────────────────────────────

// A volta do login da Anvisa traz `session_id` (ou `error`) e não traz o nosso
// `state` (plano do api, D1/D2); se um dia trouxer, vale o da URL.
export interface SncrCallbackParams { state: string | null; sessionId: string | null; error: string | null }

const SNCR_CALLBACK_PATH = "sncr/callback";
export const SNCR_STATE_STORAGE_KEY = "rotasaude.sncr.state";

function sessionStore(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

// O `state` (só vale com a sessão do próprio usuário no api) fica nesta aba
// entre a ida e a volta (decisão 7); a volta o tira na primeira leitura.
// Storage indisponível não quebra: a volta só não acha o state e pede para
// começar de novo. Nunca vai a console, localStorage ou URL.
export function rememberSncrState(state: string, storage: Storage | null = sessionStore()): void {
  try { storage?.setItem(SNCR_STATE_STORAGE_KEY, state); } catch { /* sem storage: a volta pede para recomeçar */ }
}

export function takeSncrState(storage: Storage | null = sessionStore()): string | null {
  let value: string | null = null;
  try { value = storage?.getItem(SNCR_STATE_STORAGE_KEY) ?? null; } catch { value = null; }
  try { storage?.removeItem(SNCR_STATE_STORAGE_KEY); } catch { /* nada a apagar */ }
  return value && value.trim() !== "" ? value : null;
}

// Rota de retorno sob a base do dashboard. Pura (só lê a URL; o StrictMode
// chama o inicializador do useState duas vezes).
export function readSncrCallback(
  pathname: string = window.location.pathname,
  search: string = window.location.search,
  base: string = import.meta.env.BASE_URL
): SncrCallbackParams | null {
  const p = readReturnParams(SNCR_CALLBACK_PATH, [ "state", "session_id", "error" ], pathname, search, base);
  return p && { state: p.state, sessionId: p.session_id, error: p.error };
}

const KIND_FOR_SUMMARY: Record<string, string> = {
  rce: "receita de controle especial (RCE)", ret: "receita de antimicrobiano (RET)"
};

export function sncrCallbackSummary(r: SncrCallbackResult): string {
  const noun = r.received === 1 ? "número recebido" : "números recebidos";
  return `${fmtNumber(r.received)} ${noun} do SNCR para ${KIND_FOR_SUMMARY[r.kind] ?? r.kind}.`;
}

export function sncrCallbackLanding(r: { return_to?: unknown } | null | undefined): string {
  return safeReturnTo(r?.return_to, SNCR_RETURN_TO);
}

const AUTHORIZATION_DENIED = "a autorização foi negada no gov.br — nenhum número foi pedido";

export function sncrOauthErrorPhrase(error: string | null): string {
  return error === "access_denied" ? AUTHORIZATION_DENIED : "o gov.br não concluiu a autorização — comece de novo";
}

// ─── Notificação de papel ─────────────────────────────────────────────────────

export function notificationTypeFor(list: string | null | undefined): NotificationType | null {
  if (list === "A1" || list === "A2" || list === "A3") return "A";
  if (list === "B1") return "B";
  if (list === "B2") return "B2";
  return null;
}

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  A: "Notificação A (amarela — listas A1, A2, A3)", B: "Notificação B (azul — lista B1)", B2: "Notificação B2 (azul — lista B2)"
};

export interface NotificationDraft {
  type: NotificationType | ""; paperNumber: string; numberingUf: string; medication: ItemMedication | null; quantity: string;
  quantityUnit: string; route: MedicationRoute | ""; dosage: string; durationDays: string;
}

export function emptyNotification(uf: string): NotificationDraft {
  return { type: "", paperNumber: "", numberingUf: UFS.includes(uf) ? uf : "", medication: null, quantity: "", quantityUnit: "", route: "",
    dosage: "", durationDays: "" };
}

// Formato que o api aceita no número impresso do talão.
const PAPER_NUMBER = /^[0-9A-Za-z./-]{1,30}$/;

export function notificationProblems(d: NotificationDraft): string[] {
  const out: string[] = [];
  if (!d.type) out.push("escolha o tipo da Notificação");
  if (!d.paperNumber.trim()) out.push("informe o número impresso no talão");
  else if (!PAPER_NUMBER.test(d.paperNumber.trim())) out.push("o número do talão aceita até 30 letras, números, ponto, barra ou hífen");
  if (!UFS.includes(d.numberingUf)) out.push("escolha a UF da numeração");
  if (!d.medication) out.push("escolha o medicamento (listas A ou B)");
  else {
    const expected = notificationTypeFor(d.medication.controlled_list);
    if (!expected) out.push("o medicamento escolhido não é de Notificação (listas A ou B)");
    else if (d.type && expected !== d.type) out.push(`o medicamento é da lista ${d.medication.controlled_list}: a Notificação é ${expected}`);
  }
  if (quantityValue(d.quantity) === null) out.push("informe a quantidade (até 9999, com no máximo 2 casas decimais)");
  if (d.medication && !d.quantityUnit.trim()) out.push("informe a unidade da quantidade");
  if (!d.route) out.push("escolha a via");
  if (!d.dosage.trim()) out.push("escreva a posologia");
  const days = positiveInt(d.durationDays);
  if (days === null) out.push("informe a duração em dias");
  else if (d.type && days > NOTIFICATION_MAX_DAYS[d.type]) out.push(`duração acima de ${NOTIFICATION_MAX_DAYS[d.type]} dias para a Notificação ${d.type}`);
  return out;
}

export function notificationInput(d: NotificationDraft): NotificationRecordInput {
  return {
    notification_type: d.type as NotificationType, paper_number: d.paperNumber.trim(), numbering_uf: d.numberingUf,
    item: {
      catalog_item: { id: d.medication!.id }, quantity: quantityValue(d.quantity) ?? 0, quantity_unit: d.quantityUnit.trim(),
      route: d.route as MedicationRoute, dosage_instructions: d.dosage.trim(), duration_days: positiveInt(d.durationDays) ?? 0
    }
  };
}

// ─── Painel do admin ──────────────────────────────────────────────────────────

export function sortOverview(list: SncrOverviewProfessional[]): SncrOverviewProfessional[] {
  return [ ...list ].sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name, "pt-BR"));
}

export function overviewSummary(o: SncrOverview): { professionals: number; low: number; neverRequested: number } {
  return {
    professionals: o.professionals.length,
    low: o.professionals.filter((p) => p.low).length,
    neverRequested: o.professionals.filter((p) => !p.last_request_at).length
  };
}

// ─── Frases das recusas (SNCR e contato do prescritor) ────────────────────────

const SNCR_ERRORS: Record<string, string> = {
  monthly_limit_reached: `você já fez os ${MONTHLY_REQUEST_LIMIT} pedidos deste mês para este tipo — o limite volta no mês que vem`,
  cbo_not_allowed: "só médicos e dentistas pedem números do SNCR e prescrevem controlado",
  registration_mismatch: "a conta gov.br usada não bate com a sua inscrição no conselho, ou você não tem cadastro de prescritor no SNCR — entre com a sua própria conta gov.br",
  invalid_state: "este retorno do gov.br não vale mais (já usado ou vencido) — comece de novo",
  authorization_expired: "a autorização demorou demais e venceu — comece de novo; o pedido ao SNCR precisa sair em até 30 segundos",
  authorization_denied: AUTHORIZATION_DENIED,
  sncr_unavailable: "o SNCR não respondeu — tente de novo em alguns minutos; nenhum número foi gasto",
  sncr_exhausted: "o SNCR está sem números para a sua UF agora — tente mais tarde; até lá, as receitas saem em papel",
  invalid_phone: "telefone inválido — DDD e número, 10 ou 11 dígitos",
  // Pedido de números: só o `kind` volta como invalid_content.
  invalid_content: "pedido inválido — recarregue a página e tente de novo",
  // Contato do prescritor sem perfil de profissional.
  not_found: "seu cadastro de profissional ainda não foi feito — fale com a administração da cidade"
};

// O que não é do SNCR nem do contato (papel, sessão, interruptores do 19c,
// genérico) cai nas frases da emissão: uma fonte só.
export function controlledError(err: unknown): string {
  const feature = featureDisabledKey(err);
  if (feature === "controlled_prescriptions" || feature === "") return CONTROLLED_DISABLED;
  if (feature !== null) return documentError(err);
  const code = errorCode(err);
  if (code === "invalid_address") {
    const body = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as { field?: unknown }) : null;
    const field = typeof body?.field === "string" ? body.field.split(".").pop() ?? "" : "";
    return `endereço inválido: confira ${ADDRESS_FIELD_LABEL[field] ?? ADDRESS_FIELD_LABEL.address}`;
  }
  if (code && SNCR_ERRORS[code]) return SNCR_ERRORS[code];
  return documentError(err);
}
