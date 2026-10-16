// src/lib/examsAdmin.ts
// Formulários do admin municipal de exames (módulo 21a; contrato §5): o
// catálogo da cidade e (Task 13) os prestadores. Prazo em branco = herda.
import type {
  ExamCatalogItem, ExamCatalogItemInput, ExamProvider, ExamProviderInput, ExamProviderKind, ExamReleasePolicy, ExamResultField
} from "./api";
import {
  cnesProblem, deadlineDraft, deadlinesFrom, deadlinesProblem, resultFieldsProblem, sigtapProblem, type DeadlineDraft
} from "./exams";

export interface CatalogDraft {
  sigtapCode: string; requiresAuthorization: boolean; releasePolicy: ExamReleasePolicy;
  deadlines: DeadlineDraft; fields: ExamResultField[]; active: boolean;
}

export const EMPTY_FIELD: ExamResultField = { key: "", label: "", unit: null, loinc: null };

export function catalogDraft(item?: ExamCatalogItem | null): CatalogDraft {
  return {
    sigtapCode: item?.sigtap_code ?? "",
    requiresAuthorization: item?.requires_authorization ?? false,
    releasePolicy: item?.release_policy ?? "after_acknowledgement",
    deadlines: deadlineDraft(item?.deadlines),
    fields: (item?.result_fields ?? []).map((f) => ({ ...f })),
    active: item?.active ?? true
  };
}

export function catalogProblem(d: CatalogDraft): string | null {
  return sigtapProblem(d.sigtapCode) ?? deadlinesProblem(d.deadlines) ?? resultFieldsProblem(d.fields) ?? limitsProblem(d.fields);
}

// Limites do api (catalog_input.rb): até 40 campos, nome até 80, unidade até 20.
function limitsProblem(fields: ExamResultField[]): string | null {
  if (fields.length > 40) return "no máximo 40 campos de resultado";
  for (const [ i, f ] of fields.entries()) {
    if (f.label.trim().length > 80) return `campo ${i + 1}: o nome tem até 80 caracteres`;
    if ((f.unit ?? "").trim().length > 20) return `campo ${i + 1}: a unidade tem até 20 caracteres`;
  }
  return null;
}

export function catalogBody(d: CatalogDraft): ExamCatalogItemInput {
  return {
    sigtap_code: d.sigtapCode.trim(),
    requires_authorization: d.requiresAuthorization,
    release_policy: d.releasePolicy,
    deadlines: deadlinesFrom(d.deadlines),
    result_fields: d.fields.map((f) => ({
      key: f.key.trim(), label: f.label.trim(), unit: f.unit?.trim() || null, loinc: f.loinc?.trim() || null
    })),
    active: d.active
  };
}

export interface ProviderDraft {
  name: string; cnes: string; kind: ExamProviderKind; active: boolean;
  // catalog_item_id → prazos próprios; presente = o prestador faz o exame.
  items: Record<string, DeadlineDraft>;
  // Módulo 21b: resultado pela liberação do laboratório municipal (B31: endereço e telefone obrigatórios com a marca).
  usesMunicipalLab: boolean; address: string; phone: string;
}

export function providerDraft(p?: ExamProvider | null): ProviderDraft {
  return {
    name: p?.name ?? "",
    cnes: p?.cnes ?? "",
    kind: p?.kind ?? "accredited",
    active: p?.active ?? true,
    items: Object.fromEntries((p?.items ?? []).map((i) => [ i.catalog_item_id, deadlineDraft(i.deadlines) ])),
    usesMunicipalLab: p?.uses_municipal_lab === true,
    address: p?.address ?? "",
    phone: p?.phone ?? ""
  };
}

export function providerProblem(d: ProviderDraft, labelOf: (catalogItemId: string) => string, labOn = false): string | null {
  if (!d.name.trim()) return "informe o nome do prestador";
  const cnes = cnesProblem(d.cnes);
  if (cnes) return cnes;
  for (const [ id, deadlines ] of Object.entries(d.items)) {
    const problem = deadlinesProblem(deadlines);
    if (problem) return `${labelOf(id)}: ${problem}`;
  }
  if (labOn && d.usesMunicipalLab) {
    // O laudo leva endereço e telefone do laboratório (RDC art. 167, II); o api guarda só dígitos (10 ou 11).
    if (!d.address.trim()) return "informe o endereço do laboratório — ele vai no laudo";
    if (d.address.trim().length > 200) return "o endereço tem até 200 caracteres";
    if (!/^\d{10,11}$/.test(d.phone.replace(/\D/g, ""))) return "informe o telefone do laboratório com DDD (10 ou 11 dígitos) — ele vai no laudo";
  }
  return null;
}

// Só os campos que o admin escreve: `simulated`, token e usuários nunca vão.
// `uses_municipal_lab`, endereço e telefone só vão com o interruptor `municipal_lab` (o api recusaria a marca sem ele).
export function providerBody(d: ProviderDraft, labOn = false): ExamProviderInput {
  return {
    name: d.name.trim(),
    cnes: d.cnes.trim() || null,
    kind: d.kind,
    active: d.active,
    items: Object.entries(d.items).map(([ catalog_item_id, deadlines ]) => ({ catalog_item_id, deadlines: deadlinesFrom(deadlines) })),
    ...(labOn ? {
      uses_municipal_lab: d.usesMunicipalLab,
      ...(d.usesMunicipalLab || d.address.trim() ? { address: d.address.trim() } : {}),
      ...(d.usesMunicipalLab || d.phone.trim() ? { phone: d.phone.replace(/\D/g, "") } : {})
    } : {})
  };
}
