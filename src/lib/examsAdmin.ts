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
}

export function providerDraft(p?: ExamProvider | null): ProviderDraft {
  return {
    name: p?.name ?? "",
    cnes: p?.cnes ?? "",
    kind: p?.kind ?? "accredited",
    active: p?.active ?? true,
    items: Object.fromEntries((p?.items ?? []).map((i) => [ i.catalog_item_id, deadlineDraft(i.deadlines) ]))
  };
}

export function providerProblem(d: ProviderDraft, labelOf: (catalogItemId: string) => string): string | null {
  if (!d.name.trim()) return "informe o nome do prestador";
  const cnes = cnesProblem(d.cnes);
  if (cnes) return cnes;
  for (const [ id, deadlines ] of Object.entries(d.items)) {
    const problem = deadlinesProblem(deadlines);
    if (problem) return `${labelOf(id)}: ${problem}`;
  }
  return null;
}

// Só os campos que o admin escreve: `simulated`, token e usuários nunca vão.
export function providerBody(d: ProviderDraft): ExamProviderInput {
  return {
    name: d.name.trim(),
    cnes: d.cnes.trim() || null,
    kind: d.kind,
    active: d.active,
    items: Object.entries(d.items).map(([ catalog_item_id, deadlines ]) => ({ catalog_item_id, deadlines: deadlinesFrom(deadlines) }))
  };
}
