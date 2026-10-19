// src/lib/clinicalDocuments.ts
// Documentos clínicos da consulta (módulo 19c; ADR 0033; contrato 2026-10-09
// §1–§7). Regras fora do React: rótulos, quem emite o quê (espelho do api),
// rascunho ↔ corpo do POST, o que falta antes de emitir (espelho dos 422 —
// quem garante é o api), cancelar e emitir outro, medicamentos em uso,
// protocolos de enfermagem, CNPJ e as frases das recusas. Nenhuma frase
// repete texto clínico: só rótulos, posições ("item 2") e nomes de campo.
import {
  ApiError, errorCode, type CatalogItemRef, type ClinicalDocument, type CodedOption, type CompanionReason, type DeclarationContent,
  type DeclarationInput, type DeclarationPeriod, type DocumentKind, type DocumentStatusRow, type ExamRequisitionContent, type MaxDose, type MedicationChange,
  type MedicationRoute, type NursingProtocol, type NursingProtocolInput, type PatientMedication, type PrescriptionContent,
  type PrescriptionCategory, type PrescriptionInput, type PatientIdentification, type ProtocolItem, type PrescriptionItem, type ProtocolVersionInput, type RenewalItem, type SickNoteContent, type SickNoteInput, type SickNoteType
} from "./api";
import { describeActionError } from "./actionErrors";
import { featureDisabledKey, hasFeature } from "./features";
import { fmtDateTime } from "./format";
import { addDays } from "./campaigns";

export const DOCUMENTS_KEY = "consultationDocuments";
export const MEDICATIONS_KEY = "patientMedications";
export const PROTOCOLS_KEY = "nursingProtocols";
export const REMUME_KEY = "remume";
export const CITY_DOCS_PROFILE_KEY = "cityDocumentsProfile";

export const CANCEL_REASON_MIN = 10;
export const CANCEL_REASON_MAX = 500;
export const PENDING_REFETCH_MS = 15_000;

// Requisição de exames: o api só lê os exames da consulta finalizada (ou de adendos).
export const NO_EXAM_REQUESTS = "esta consulta não tem exames pedidos — finalize a consulta com os exames pedidos (ou inclua-os num adendo) antes de emitir a requisição";
export const DOCUMENTS_DISABLED = "os documentos clínicos estão desligados nesta cidade";
export const CANCEL_WARNING = "cancelar não desfaz medicamento já entregue ao paciente";
export const ANTIMICROBIAL_NOTE =
  "antimicrobiano: a receita sai em papel, em 2 vias (1ª via — farmácia, 2ª via — paciente), válida por 10 dias";
export const CONTROLLED_BLOCKED = "receita de controle especial — 19d";
export const NO_PROTOCOL = "a cidade não tem protocolo de enfermagem vigente — sem ele a enfermagem não prescreve";
// Módulo 19d (ADR 0034). Frases que a emissão (documentError) e as regras de
// tela (controlled.ts) dividem: uma fonte só, aqui (controlled.ts importa daqui).
export const CONTROLLED_DISABLED = "a receita de controlado está desligada nesta cidade";
// Espelho do classify do api (RCE > RET > comum): o que não serve à categoria
// dominante vira outra receita. Com o `index`, sai "item N: …".
export const MIXED_CATEGORIES =
  "este item não pode ir nesta receita — separe em duas receitas (controle especial só com itens C1/C5 do catálogo; antimicrobiano só com antimicrobianos do catálogo; item comum e texto livre vão numa receita comum)";
// Na de controle especial, sempre; na de antimicrobiano, quando ela sairia digital (plano do api, D12).
export const PRESCRIBER_MISSING = "falta o seu endereço e telefone — cadastre em Meu perfil antes de emitir esta receita";
const PRONTUARIO_DISABLED = "o prontuário está desligado nesta cidade";
const GENERIC = "não foi possível concluir — tente de novo";

// ─── Rótulos ──────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  sick_note: "Atestado", attendance_declaration: "Declaração de comparecimento", prescription: "Receita",
  exam_requisition: "Requisição de exames", controlled_notification_record: "Notificação de receita (papel)"
};
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

const MODE_LABEL: Record<string, string> = { digital: "digital", paper: "papel" };
export function issueModeLabel(mode: string): string {
  return MODE_LABEL[mode] ?? mode;
}

export function documentSituation(doc: Pick<ClinicalDocument, "status" | "cancelled_at">): string {
  if (doc.status === "issued") return "emitido";
  if (doc.status === "cancelled") return `cancelado em ${fmtDateTime(doc.cancelled_at)}`;
  return doc.status;
}

export function issuedNotice(doc: ClinicalDocument): string {
  const what = `Documento emitido (${kindLabel(doc.kind)})`;
  if (doc.issue_mode === "digital") return `${what} em modo digital: a assinatura entra na sua fila; o PDF assinado sai depois dela.`;
  const twoCopies = doc.kind === "prescription" && (doc.content as PrescriptionContent).copies === 2;
  return `${what} em modo papel: imprima${twoCopies ? " as 2 vias" : ""} e assine à mão.`;
}

export const ROUTE_LABEL: Record<MedicationRoute, string> = {
  oral: "oral", sublingual: "sublingual", topical: "tópica", ophthalmic: "oftálmica", otic: "otológica", nasal: "nasal",
  inhalation: "inalatória", vaginal: "vaginal", rectal: "retal", intramuscular: "intramuscular", intravenous: "intravenosa",
  subcutaneous: "subcutânea", other: "outra"
};
export const ROUTES = Object.keys(ROUTE_LABEL) as MedicationRoute[];

export const COMPANION_REASON_LABEL: Record<CompanionReason, string> = {
  clt_473_x: "acompanhar gestante em consulta ou exame de pré-natal (CLT art. 473, X)",
  clt_473_xi: "acompanhar filho de até 6 anos em consulta (CLT art. 473, XI)",
  clt_473_xii: "exame preventivo de câncer (CLT art. 473, XII)",
  other: "outro motivo"
};
export const PERIOD_LABEL: Record<DeclarationPeriod, string> = { morning: "manhã", afternoon: "tarde", full_day: "dia todo" };
export const MEDICATION_STATUS_LABEL: Record<string, string> = { active: "em uso", suspended: "suspenso" };
export const MEDICATION_ORIGIN_LABEL: Record<string, string> = { prescription: "receita", external: "de fora" };

// ─── Quem emite o quê (spec §4; o api confere) ────────────────────────────────

export type ProfessionalKind = "physician" | "dentist" | "nurse" | "other";

export function professionalKind(cbo: string | null | undefined): ProfessionalKind {
  const code = cbo ?? "";
  if (/^225[123]/.test(code)) return "physician";
  if (code.startsWith("2232")) return "dentist";
  if (code.startsWith("2235")) return "nurse";
  return "other";
}

export function kindsFor(cbo: string | null | undefined): DocumentKind[] {
  const who = professionalKind(cbo);
  const kinds: DocumentKind[] = [];
  if (who === "physician" || who === "dentist") kinds.push("sick_note");
  kinds.push("attendance_declaration");
  if (who !== "other") kinds.push("prescription");
  kinds.push("exam_requisition");
  return kinds;
}

export function canUseDocuments(user: { operator?: boolean; features?: unknown } | null | undefined): boolean {
  return !!user && !user.operator && hasFeature(user, "clinical_documents");
}

export function canCancel(doc: ClinicalDocument, userId: string | null | undefined): boolean {
  return !!userId && doc.status === "issued" && doc.author.id === userId;
}

export function documentsRefetchInterval(docs: ClinicalDocument[] | undefined): number | false {
  return (docs ?? []).some((d) => d.status === "issued" && d.signature?.mode === "pending") ? PENDING_REFETCH_MS : false;
}

// O estado lido no polling difere da lista na tela? Só id, status e modo da
// assinatura contam; difere → a tela relê a lista (que deixa trilha).
export function documentsStatusChanged(docs: ClinicalDocument[] | undefined, rows: DocumentStatusRow[]): boolean {
  if (!docs) return false;
  if (docs.length !== rows.length) return true;
  const byId = new Map(docs.map((d) => [ d.id, d ]));
  return rows.some((r) => {
    const doc = byId.get(r.id);
    return !doc || doc.status !== r.status || (doc.signature?.mode ?? null) !== r.signature_mode;
  });
}

export function withDocument(list: ClinicalDocument[], doc: ClinicalDocument): ClinicalDocument[] {
  return list.some((d) => d.id === doc.id) ? list.map((d) => (d.id === doc.id ? doc : d)) : [ doc, ...list ];
}

// Como o api conta (`squish`): pontas fora e espaços internos juntados.
const squish = (text: string): string => text.trim().replace(/\s+/g, " ");

export function cancelReasonProblem(reason: string): string | null {
  const length = squish(reason).length;
  if (length < CANCEL_REASON_MIN) return `descreva o motivo com pelo menos ${CANCEL_REASON_MIN} caracteres`;
  if (length > CANCEL_REASON_MAX) return `o motivo passa de ${CANCEL_REASON_MAX} caracteres — resuma`;
  return null;
}

// Inteiro de 1 a `max` (dias).
const boundedInt = (text: string, max: number): number | null => {
  const t = text.trim();
  return /^\d+$/.test(t) && Number(t) >= 1 && Number(t) <= max ? Number(t) : null;
};

// Quantidade e dose máxima: o api aceita de 0 a 9999 com até 2 casas
// (`scale <= 2`) e grava/devolve valor fracionário. Vírgula vira ponto.
const DECIMAL = /^\d{1,4}([.,]\d{1,2})?$/;
const positiveDecimal = (text: string): number | null => {
  const t = text.trim();
  if (!DECIMAL.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return n > 0 && n <= 9999 ? n : null;
};

const inRange = (text: string, min: number, max: number): boolean => squish(text).length >= min && squish(text).length <= max;

const BACKDATE_DAYS = 30;
// Janela das datas do atestado: de hoje − 30 a hoje (hoje = o da cidade).
export const backdateLimits = (today: string): { min: string; max: string } => ({ min: addDays(today, -BACKDATE_DAYS), max: today });
const inBackdateWindow = (date: string, today: string): boolean => {
  const { min, max } = backdateLimits(today);
  return date >= min && date <= max;
};

// ─── Atestado ─────────────────────────────────────────────────────────────────

export interface SickNoteDraft {
  type: SickNoteType; days: string; startOn: string; companionName: string; companionKinship: string;
  companionReason: CompanionReason | ""; cid: CodedOption | null; cidAuthorized: boolean; note: string;
}

export function emptySickNote(today: string): SickNoteDraft {
  return { type: "leave", days: "", startOn: today, companionName: "", companionKinship: "", companionReason: "", cid: null,
    cidAuthorized: false, note: "" };
}

export function sickNoteProblem(d: SickNoteDraft, today: string): string | null {
  const noteTooLong = d.note.trim().length > 500 ? "a observação passa de 500 caracteres" : null;
  if (d.type === "leave") {
    if (boundedInt(d.days, 365) === null) return "informe os dias de afastamento (número inteiro, de 1 a 365)";
    if (!d.startOn) return "informe o início do afastamento";
    if (!inBackdateWindow(d.startOn, today)) return "o início precisa estar entre 30 dias atrás e hoje";
    if (d.cid && !d.cidAuthorized) return "o CID só entra com a autorização do paciente — marque a autorização ou tire o CID";
    return noteTooLong;
  }
  if (!d.startOn) return "informe o dia do acompanhamento";
  if (!inBackdateWindow(d.startOn, today)) return "o dia do acompanhamento precisa estar entre 30 dias atrás e hoje";
  const name = d.companionName.trim();
  if (!name) return "informe o nome do acompanhante";
  if (name.length < 3 || name.length > 120) return "o nome do acompanhante precisa ter de 3 a 120 caracteres";
  const kinship = d.companionKinship.trim();
  if (!kinship) return "informe o parentesco";
  if (kinship.length < 2 || kinship.length > 60) return "o parentesco precisa ter de 2 a 60 caracteres";
  if (!d.companionReason) return "escolha o motivo do acompanhamento";
  return noteTooLong;
}

export function sickNoteInput(d: SickNoteDraft): SickNoteInput {
  const note = d.note.trim();
  const tail = note ? { note } : {};
  if (d.type === "leave") {
    return { type: "leave", days: boundedInt(d.days, 365) ?? 0, start_on: d.startOn,
      ...(d.cid ? { cid10: { code: d.cid.code } } : {}), cid_authorized: !!d.cid && d.cidAuthorized, ...tail };
  }
  return { type: "companion", start_on: d.startOn, companion_name: d.companionName.trim(), companion_kinship: d.companionKinship.trim(),
    companion_reason: d.companionReason as CompanionReason, cid_authorized: false, ...tail };
}

// ─── Declaração ───────────────────────────────────────────────────────────────

export interface DeclarationDraft {
  date: string; mode: "period" | "times"; period: DeclarationPeriod | ""; arrivedAt: string; leftAt: string;
  companionName: string; issuerRegistration: string;
}

const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptyDeclaration(today: string, arrivedAt = ""): DeclarationDraft {
  return { date: today, mode: arrivedAt ? "times" : "period", period: "", arrivedAt, leftAt: "", companionName: "", issuerRegistration: "" };
}

export function declarationProblem(d: DeclarationDraft): string | null {
  if (d.mode === "period") {
    if (!d.period) return "escolha o período";
  } else {
    if (!HOUR_MINUTE.test(d.arrivedAt)) return "informe a hora de chegada (HH:MM)";
    if (d.leftAt && !HOUR_MINUTE.test(d.leftAt)) return "a hora de saída precisa ser HH:MM";
    // O api aceita saída igual à chegada (`left >= arrived`).
    if (d.leftAt && d.leftAt < d.arrivedAt) return "a saída não pode ser antes da chegada";
  }
  const companion = d.companionName.trim();
  if (companion && (companion.length < 3 || companion.length > 120)) return "o nome do acompanhante precisa ter de 3 a 120 caracteres";
  if (d.issuerRegistration.trim().length > 30) return "a matrícula passa de 30 caracteres";
  return null;
}

export function declarationInput(d: DeclarationDraft): DeclarationInput {
  const companion = d.companionName.trim();
  const registration = d.issuerRegistration.trim();
  const tail = { ...(companion ? { companion_name: companion } : {}), ...(registration ? { issuer_registration: registration } : {}) };
  if (d.mode === "period") return { period: d.period as DeclarationPeriod, ...tail };
  return { arrived_at: d.arrivedAt, ...(d.leftAt ? { left_at: d.leftAt } : {}), ...tail };
}

// ─── Receita ──────────────────────────────────────────────────────────────────

// `fromDocument` (19d): item que veio de um documento emitido ("cancelar e
// emitir outro"). O api grava o catalog_item do documento SEM as marcas da
// lista; a origem fica marcada aqui em vez de inferida pela ausência da chave.
export type ItemMedication = CatalogItemRef & {
  antimicrobial?: boolean; controlled?: boolean; in_network?: boolean; max_dose?: MaxDose | null; fromDocument?: true;
};
export interface ItemDraft {
  key: string; medication: ItemMedication | null; freeText: string; quantity: string; quantityUnit: string;
  route: MedicationRoute | ""; dosage: string; durationDays: string; continuous: boolean;
}
// Módulo 19d, preenchidos por "cancelar e emitir outro": `identification` é a
// do documento cancelado (a tela converte) e `category` a dele — o api não
// grava as marcas da lista nos itens do documento, então a categoria da RCE
// reemitida vem daqui.
export interface PrescriptionDraft {
  items: ItemDraft[]; protocolVersionId: string; identification?: PatientIdentification | null; category?: PrescriptionCategory;
}

let itemSeq = 0;
const nextKey = () => { itemSeq += 1; return `item-${itemSeq}`; };

export function emptyItem(): ItemDraft {
  return { key: nextKey(), medication: null, freeText: "", quantity: "", quantityUnit: "", route: "", dosage: "", durationDays: "", continuous: false };
}

export function itemFromMedication(m: ItemMedication): ItemDraft {
  return { ...emptyItem(), medication: m, quantityUnit: m.dosage_form ?? "" };
}

// Item de protocolo vigente → rascunho da receita (enfermagem). O item do
// protocolo já traz antimicrobial/controlled, então o aviso de antimicrobiano
// aparece antes de emitir; a dose máxima viaja junto para a validação.
export function itemFromProtocolItem(pi: ProtocolItem): ItemDraft {
  return itemFromMedication({ ...pi.catalog_item, max_dose: pi.max_dose ?? null });
}

// Aceita o item de uma receita emitida e o da renovação, que o api monta sem as
// chaves que faltam (`.compact`): ausente vira campo vazio, nunca "undefined".
export function itemFromPrescription(item: PrescriptionItem | RenewalItem): ItemDraft {
  return {
    key: nextKey(),
    medication: item.catalog_item ? { ...item.catalog_item, antimicrobial: item.antimicrobial } : null,
    freeText: item.free_text ?? "", quantity: item.quantity != null ? String(item.quantity) : "", quantityUnit: item.quantity_unit ?? "",
    route: item.route ?? "", dosage: item.dosage_instructions ?? "", durationDays: item.duration_days ? String(item.duration_days) : "",
    continuous: item.continuous
  };
}

// Item de documento emitido (reemissão): marca a origem explícita do medicamento.
export function itemFromIssuedDocument(item: PrescriptionItem): ItemDraft {
  const draft = itemFromPrescription(item);
  return draft.medication ? { ...draft, medication: { ...draft.medication, fromDocument: true } } : draft;
}

const QUANTITY_HINT = "número maior que 0, com até 2 casas decimais";
const MAX_ITEMS = 20;

// `controlledAllowed` (19d ligado, médico ou dentista): o controlado não é
// acusado aqui — quem confere listas e limites é controlledProblems.
export function prescriptionProblems(d: PrescriptionDraft, nurse: boolean, controlledAllowed = false): string[] {
  const out: string[] = [];
  if (nurse && !d.protocolVersionId) out.push("escolha o protocolo de enfermagem");
  if (d.items.length === 0) out.push("inclua ao menos um medicamento");
  if (d.items.length > MAX_ITEMS) out.push(`a receita aceita até ${MAX_ITEMS} itens`);
  d.items.forEach((it, i) => {
    const n = `item ${i + 1}`;
    const quantity = positiveDecimal(it.quantity);
    const free = squish(it.freeText);
    if (!it.medication && !free) out.push(`${n}: escolha um medicamento do catálogo ou escreva em texto livre`);
    if (!it.medication && free && !inRange(free, 3, 200)) out.push(`${n}: o texto livre precisa ter de 3 a 200 caracteres`);
    if (it.medication?.controlled && !controlledAllowed) out.push(`${n}: ${CONTROLLED_BLOCKED}`);
    if (nurse && !it.medication && free) out.push(`${n}: a enfermagem só prescreve itens do protocolo`);
    if (quantity === null) out.push(`${n}: informe a quantidade (${QUANTITY_HINT})`);
    const max = it.medication?.max_dose;
    // O api compara a unidade sem diferenciar maiúsculas (`casecmp?`).
    if (nurse && quantity !== null && max && (quantity > max.quantity || it.quantityUnit.trim().toLowerCase() !== max.unit.trim().toLowerCase())) {
      out.push(`${n}: acima da dose máxima do protocolo (até ${max.quantity} ${max.unit})`);
    }
    const unit = squish(it.quantityUnit);
    if (!unit) out.push(`${n}: informe a unidade da quantidade`);
    else if (unit.length > 30) out.push(`${n}: a unidade da quantidade tem até 30 caracteres`);
    if (!it.route) out.push(`${n}: escolha a via`);
    const dosage = squish(it.dosage);
    if (!dosage) out.push(`${n}: escreva a posologia`);
    else if (!inRange(dosage, 3, 500)) out.push(`${n}: a posologia precisa ter de 3 a 500 caracteres`);
    if (it.durationDays.trim() && boundedInt(it.durationDays, 365) === null) out.push(`${n}: a duração é em dias (número inteiro, de 1 a 365)`);
  });
  return out;
}

export function prescriptionInput(d: PrescriptionDraft): PrescriptionInput {
  return {
    items: d.items.map((it) => {
      const duration = boundedInt(it.durationDays, 365);
      return {
        ...(it.medication ? { catalog_item: { id: it.medication.id } } : { free_text: squish(it.freeText) }),
        quantity: positiveDecimal(it.quantity) ?? 0, quantity_unit: squish(it.quantityUnit), route: it.route as MedicationRoute,
        dosage_instructions: it.dosage.trim(), ...(duration !== null ? { duration_days: duration } : {}), continuous: it.continuous
      };
    }),
    ...(d.protocolVersionId ? { nursing_protocol: { version_id: d.protocolVersionId } } : {})
  };
}

export function hasAntimicrobial(d: PrescriptionDraft): boolean {
  return d.items.some((it) => !!it.medication?.antimicrobial);
}

// ─── Cancelar e emitir outro ─────────────────────────────────────────────────

export interface ExamRequisitionDraft { note: string }
export type ReissueDraft =
  | { kind: "sick_note"; draft: SickNoteDraft }
  | { kind: "attendance_declaration"; draft: DeclarationDraft }
  | { kind: "prescription"; draft: PrescriptionDraft }
  | { kind: "exam_requisition"; draft: ExamRequisitionDraft };

export function reissueDraft(doc: ClinicalDocument): ReissueDraft | null {
  switch (doc.kind) {
    case "sick_note": {
      const c = doc.content as SickNoteContent;
      return { kind: "sick_note", draft: {
        type: c.type, days: c.days ? String(c.days) : "", startOn: c.start_on ?? "", companionName: c.companion_name ?? "",
        companionKinship: c.companion_kinship ?? "", companionReason: c.companion_reason ?? "",
        cid: c.cid10 ? { code: c.cid10.code, label: c.cid10.label } : null, cidAuthorized: c.cid_authorized, note: c.note ?? ""
      } };
    }
    case "attendance_declaration": {
      const c = doc.content as DeclarationContent;
      return { kind: "attendance_declaration", draft: {
        date: c.date, mode: c.period ? "period" : "times", period: c.period ?? "", arrivedAt: c.arrived_at ?? "",
        leftAt: c.left_at ?? "", companionName: c.companion_name ?? "", issuerRegistration: c.issuer_registration ?? ""
      } };
    }
    case "prescription": {
      const c = doc.content as PrescriptionContent;
      return { kind: "prescription", draft: {
        items: c.items.map(itemFromIssuedDocument), protocolVersionId: c.nursing_protocol?.version_id ?? "",
        identification: c.patient_identification ?? null, category: c.category ?? (c.antimicrobial ? "antimicrobial" : "common")
      } };
    }
    case "exam_requisition":
      return { kind: "exam_requisition", draft: { note: (doc.content as ExamRequisitionContent).note ?? "" } };
    default:
      return null;
  }
}

// ─── Medicamentos em uso ─────────────────────────────────────────────────────

export interface ExternalDraft { medication: CatalogItemRef | null; freeText: string; dosage: string; continuous: boolean }
export const EMPTY_EXTERNAL: ExternalDraft = { medication: null, freeText: "", dosage: "", continuous: true };

export function externalProblem(d: ExternalDraft): string | null {
  const free = squish(d.freeText);
  if (!d.medication && !free) return "escolha o medicamento no catálogo ou escreva o nome";
  if (!d.medication && !inRange(free, 3, 200)) return "o nome do medicamento precisa ter de 3 a 200 caracteres";
  if (d.dosage.trim().length > 200) return "a posologia passa de 200 caracteres";
  return null;
}

export function externalChange(d: ExternalDraft): MedicationChange {
  const dosage = d.dosage.trim();
  return {
    action: "add_external",
    ...(d.medication ? { catalog_item_id: d.medication.id } : { free_text: squish(d.freeText) }),
    ...(dosage ? { dosage_summary: dosage } : {}),
    continuous: d.continuous
  };
}

export function medicationLine(m: PatientMedication): string {
  return m.dosage_summary ? `${m.label} — ${m.dosage_summary}` : m.label;
}

export function sortMedications(list: PatientMedication[]): PatientMedication[] {
  const rank = (m: PatientMedication) => (m.status === "active" ? 0 : 1);
  return [ ...list ].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, "pt-BR"));
}

// ─── Protocolos de enfermagem ─────────────────────────────────────────────────

export function vigentProtocols(list: NursingProtocol[], today: string): NursingProtocol[] {
  return list.filter((p) => {
    const v = p.current_version;
    return !!v && v.valid_from <= today && (!v.valid_until || v.valid_until >= today);
  });
}

export function protocolLabel(p: NursingProtocol): string {
  return `${p.title} (nº ${p.number}, ${p.year})`;
}

export interface ProtocolDraft {
  title: string; number: string; year: string; validFrom: string; validUntil: string; items: { item: CatalogItemRef; maxDose: string; maxUnit: string }[];
}

export function emptyProtocol(today: string): ProtocolDraft {
  return { title: "", number: "", year: today.slice(0, 4), validFrom: today, validUntil: "", items: [] };
}

export function protocolDraftFrom(p: NursingProtocol, today: string): ProtocolDraft {
  return {
    title: p.title, number: p.number, year: String(p.year), validFrom: today, validUntil: "",
    items: (p.current_version?.items ?? []).map((i) => ({
      item: i.catalog_item, maxDose: i.max_dose ? String(i.max_dose.quantity) : "", maxUnit: i.max_dose?.unit ?? i.catalog_item.dosage_form ?? ""
    }))
  };
}

export function addProtocolItem(d: ProtocolDraft, item: CatalogItemRef): ProtocolDraft {
  if (d.items.some((i) => i.item.id === item.id)) return d;
  return { ...d, items: [ ...d.items, { item, maxDose: "", maxUnit: item.dosage_form ?? "" } ] };
}

// `today` (AAAA-MM-DD) liga o teto do ano de publicação (ano que vem); sem ele o teto não é conferido.
export function protocolProblem(d: ProtocolDraft, withHeader: boolean, today?: string): string | null {
  if (withHeader) {
    if (!squish(d.title)) return "informe o título do protocolo";
    if (!inRange(d.title, 3, 200)) return "o título precisa ter de 3 a 200 caracteres";
    if (!squish(d.number)) return "informe o número do protocolo";
    if (!inRange(d.number, 1, 30)) return "o número precisa ter de 1 a 30 caracteres";
    if (!/^\d{4}$/.test(d.year.trim())) return "informe o ano de publicação com 4 dígitos";
    const year = Number(d.year.trim());
    if (year < 1990 || (today && year > Number(today.slice(0, 4)) + 1)) return "o ano de publicação vai de 1990 até o ano que vem";
  }
  if (!d.validFrom) return "informe o início da vigência";
  if (d.validUntil && d.validUntil < d.validFrom) return "o fim da vigência não pode ser antes do início";
  if (d.items.length === 0) return "inclua ao menos um medicamento no protocolo";
  if (d.items.length > 100) return "o protocolo aceita até 100 itens";
  const bad = d.items.findIndex((i) => i.maxDose.trim() !== "" && positiveDecimal(i.maxDose) === null);
  if (bad >= 0) return `item ${bad + 1}: a dose máxima é um ${QUANTITY_HINT} (ou deixe em branco)`;
  const noUnit = d.items.findIndex((i) => i.maxDose.trim() !== "" && !squish(i.maxUnit));
  if (noUnit >= 0) return `item ${noUnit + 1}: informe a unidade da dose máxima`;
  const longUnit = d.items.findIndex((i) => i.maxDose.trim() !== "" && squish(i.maxUnit).length > 30);
  if (longUnit >= 0) return `item ${longUnit + 1}: a unidade da dose máxima tem até 30 caracteres`;
  return null;
}

export function protocolVersionInput(d: ProtocolDraft): ProtocolVersionInput {
  return {
    valid_from: d.validFrom,
    ...(d.validUntil ? { valid_until: d.validUntil } : {}),
    items: d.items.map((i) => {
      // `quantity` é número: o api recusa string na dose máxima.
      const max = positiveDecimal(i.maxDose);
      return { catalog_item_id: i.item.id, ...(max !== null ? { max_dose: { quantity: max, unit: squish(i.maxUnit) } } : {}) };
    })
  };
}

export function protocolInput(d: ProtocolDraft): NursingProtocolInput {
  return { title: squish(d.title), number: squish(d.number), year: Number(d.year.trim()), ...protocolVersionInput(d) };
}

// ─── CNPJ da cidade ───────────────────────────────────────────────────────────

// CNPJ sem máscara, maiúsculo: 12 caracteres [0-9A-Z] + 2 dígitos (IN RFB 2.229/2024; o numérico é o caso particular).
export function cnpjDigits(text: string): string {
  return text.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function isValidCnpj(text: string): boolean {
  const d = cnpjDigits(text);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(.)\1{13}$/.test(d)) return false;
  const digit = (length: number) => {
    const weights = length === 12 ? [ 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2 ] : [ 6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2 ];
    // Valor do caractere = código ASCII − 48 (dígitos 0–9; A = 17 …), como a RFB.
    const rest = weights.reduce((sum, w, i) => sum + (d.charCodeAt(i) - 48) * w, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(d[12]) && digit(13) === Number(d[13]);
}

export function formatCnpj(digits: string | null | undefined): string {
  if (!digits) return "não cadastrado";
  const d = cnpjDigits(digits);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}

// ─── Frases das recusas ───────────────────────────────────────────────────────

// Campo de `invalid_content` (documento, medicamento em uso e protocolo).
const FIELD_LABEL: Record<string, string> = {
  days: "dias de afastamento", start_on: "início", companion_name: "nome do acompanhante", companion_kinship: "parentesco",
  companion_reason: "motivo do acompanhamento", date: "dia", period: "período", arrived_at: "hora de chegada",
  left_at: "hora de saída", items: "medicamentos", note: "observação",
  type: "tipo do atestado", cid10: "CID", cid_authorized: "autorização do CID", kind: "tipo de documento",
  valid_until: "fim da vigência", valid_from: "início da vigência", issuer_registration: "matrícula de quem emite",
  action: "ação", free_text: "nome do medicamento", dosage_summary: "posologia", continuous: "uso contínuo",
  catalog_item_id: "medicamento do catálogo", title: "título", number: "número", year: "ano",
  // Módulo 19d: registro da Notificação de papel (o api manda o caminho inteiro).
  paper_number: "número do talão", numbering_uf: "UF da numeração", notification_type: "tipo da Notificação",
  "item.catalog_item": "medicamento", "item.quantity": "quantidade", "item.quantity_unit": "unidade", "item.route": "via",
  "item.dosage_instructions": "posologia", "item.duration_days": "duração em dias"
};

// Campo do endereço (identificação do paciente na receita; contato do prescritor).
export const ADDRESS_FIELD_LABEL: Record<string, string> = {
  street: "o logradouro", number: "o número", complement: "o complemento", district: "o bairro", city: "a cidade", uf: "a UF",
  zip: "o CEP", address: "o endereço"
};
const PATIENT_ADDRESS = "patient_identification.address";

// Campos próprios que pedem uma frase inteira, não "confira o campo".
const FIELD_PHRASE: Record<string, string> = {
  replaces_document_id: "este documento já foi substituído (ou não pode ser substituído) — a lista foi atualizada",
  exams: "um exame pedido não tem nome na tabela SIGTAP vigente — avise o suporte"
};

// Campo de `invalid_item` (receita e protocolo).
const ITEM_FIELD_LABEL: Record<string, string> = {
  catalog_item: "medicamento do catálogo", catalog_item_id: "medicamento do catálogo", free_text: "texto livre", quantity: "quantidade",
  quantity_unit: "unidade da quantidade", route: "via", dosage_instructions: "posologia", duration_days: "duração",
  continuous: "uso contínuo", reason_problem_id: "problema que motivou o uso", max_dose: "dose máxima"
};

const ERRORS: Record<string, string> = {
  not_author: "só a autora da consulta emite e cancela os documentos dela",
  cbo_not_allowed: "o seu CBO não emite este tipo de documento",
  missing_role: "seu papel não permite esta ação",
  attendance_outside_unit: "esta declaração é de um atendimento de outra unidade — troque a unidade no seletor",
  forbidden: "você não tem permissão para ver isto",
  cid_requires_authorization: "o CID só entra com a autorização do paciente",
  companion_cid_not_allowed: "atestado de acompanhante não leva CID",
  // 19c (interruptor do controlado desligado): o api recusa qualquer controlado.
  controlled_not_allowed: `medicamento controlado não entra aqui (${CONTROLLED_BLOCKED})`,
  not_in_nursing_protocol: "este medicamento não está no protocolo de enfermagem vigente",
  above_protocol_max_dose: "a quantidade passa da dose máxima do protocolo",
  free_text_not_allowed: "a enfermagem só prescreve itens do protocolo — sem texto livre",
  city_cnpj_missing: "a cidade ainda não cadastrou o CNPJ — sem ele a receita de enfermagem não sai; avise o administrador da cidade",
  no_exam_requests: NO_EXAM_REQUESTS,
  attendance_not_found_or_closed_long_ago: "atendimento não encontrado ou encerrado há mais de 30 dias — a declaração não sai mais por aqui",
  invalid_reason: `descreva o motivo com ${CANCEL_REASON_MIN} a ${CANCEL_REASON_MAX} caracteres`,
  already_cancelled: "este documento já estava cancelado — a lista foi atualizada",
  awaiting_signature: "o documento digital ainda não foi assinado — assine (sessão ou lote) ou volte ao papel em Pendentes de assinatura para imprimir",
  already_exists: "já existe um protocolo com este número e ano",
  already_active: "este medicamento já está em uso na lista",
  not_draft: "a consulta já foi finalizada — a lista de medicamentos muda só com a consulta em rascunho",
  invalid_medication: "este medicamento mudou desde a leitura — a lista foi atualizada",
  invalid_catalog_item: "este medicamento não está mais ativo no catálogo",
  invalid_unit: "alguma das unidades escolhidas não existe nesta cidade",
  not_found: "não encontramos o que você pediu — pode ter sido removido",
  // O api recusa qualquer receita sem catálogo (inclusive só de texto livre): não sugira texto livre.
  catalog_unavailable: "o catálogo de medicamentos está indisponível agora — a receita não sai; tente de novo em instantes",
  invalid_cnpj: "CNPJ inválido — confira os 14 caracteres (números e, no CNPJ novo, letras)",
  // Sai em documento, renovação e lista de medicamentos: frase neutra.
  out_of_context: "fora do atendimento, abra o prontuário com motivo para ver isto",
  opening_required: "a abertura justificada terminou — abra o prontuário de novo",
  // Módulo 19d (contrato §2–§3; relatório do api, "Contrato para o dashboard").
  mixed_categories: MIXED_CATEGORIES,
  requires_notification: "este medicamento é de Notificação (listas A/B): registre a Notificação de papel em vez da receita",
  not_supported: "medicamento das listas C2, C3 ou C4 (retinoide, talidomida, antirretroviral) não sai pelo Rota Saúde",
  too_many_c1_substances: "no máximo 3 substâncias da lista C1 por receita",
  duration_exceeded: "duração acima do permitido (controle especial: 60 dias, 180 para anticonvulsivante; Notificação A: 30; B: 60)",
  prescriber_address_missing: PRESCRIBER_MISSING,
  item_not_in_notification_list: "o medicamento não é de Notificação (listas A ou B)",
  notification_type_mismatch: "o tipo da Notificação não bate com a lista do medicamento",
  patient_identification_required: "falta na identificação do paciente: endereço"
};

// Com o 19d ligado, o api só recusa como controlled_not_allowed o controlado
// que reconheceu em TEXTO LIVRE (o do catálogo vai à receita de controle especial).
const CONTROLLED_FREE_TEXT = "medicamento controlado não entra em texto livre — escolha o item no catálogo";

// `controlled`: o interruptor `controlled_prescriptions` da sessão (controlledOn).
export function documentError(err: unknown, opts: { controlled?: boolean } = {}): string {
  const feature = featureDisabledKey(err);
  if (feature === "clinical_record") return PRONTUARIO_DISABLED;
  if (feature === "controlled_prescriptions") return CONTROLLED_DISABLED;
  if (feature !== null) return DOCUMENTS_DISABLED;
  const code = errorCode(err);
  const body = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as { field?: unknown; index?: unknown }) : null;
  const field = typeof body?.field === "string" ? body.field : "";
  const at = typeof body?.index === "number" ? `item ${body.index + 1}: ` : "";
  if (code === "invalid_content") {
    if (field === PATIENT_ADDRESS || field.startsWith(`${PATIENT_ADDRESS}.`)) {
      return `endereço do paciente: confira ${ADDRESS_FIELD_LABEL[field.split(".").pop() ?? ""] ?? ADDRESS_FIELD_LABEL.address}`;
    }
    if (field === "patient_identification") return "identificação do paciente inválida";
    return FIELD_PHRASE[field] ?? `confira o campo: ${FIELD_LABEL[field] ?? (field || "do formulário")}`;
  }
  if (code === "invalid_item") {
    if (!at) return "um dos itens não foi aceito";
    return `${at}confira ${field ? (ITEM_FIELD_LABEL[field] ?? field) : "os dados do item"}`;
  }
  if (code === "patient_identification_required" && field === "patient_identification.cpf") {
    return "o paciente está sem CPF válido no cadastro — corrija o cadastro antes";
  }
  if (code === "controlled_not_allowed" && opts.controlled) return `${at}${CONTROLLED_FREE_TEXT}`;
  if (code && ERRORS[code]) return `${at}${ERRORS[code]}`;
  const described = describeActionError(err);
  return "message" in described ? described.message : GENERIC;
}
