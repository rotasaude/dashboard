// src/test/documentFixtures.ts
// Dados comuns aos testes do módulo 19c (documentos clínicos). Relógio dos
// testes: sexta, 2026-10-09 10:00 em São Paulo (-03:00). A autora é `us1`,
// a mesma das fixtures da consulta do 19a (CBO 225142, médica).
import type {
  CatalogItemRef, ClinicalDocument, MedicationSearchItem, NursingProtocol, PatientMedication, PrescriptionItem, RemumeEntry, RenewalItem, SessionUser
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const NOW19C = "2026-10-09T10:00:00-03:00";
export const TODAY19C = "2026-10-09";

// Janela de step-up aberta (sessionWith põe `mfa_verified_at` = agora): crie a
// sessão DEPOIS de fixar o relógio. `{ mfa_verified_at: null }` força o código.
export function docUser(roles: string[] = [ "health_professional" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, {
    id: "us1", email_address: "medica@curitiba.demo", features: [ "clinical_record", "clinical_documents" ], ...over
  });
}

export function catalogItem(over: Partial<CatalogItemRef> = {}): CatalogItemRef {
  return {
    id: "ci1", catmat_code: 267656, label: "Metformina, cloridrato 850 mg, comprimido",
    active_ingredient: "cloridrato de metformina", strength: "850 mg", dosage_form: "comprimido", ...over
  };
}

export function searchItem(over: Partial<MedicationSearchItem> = {}): MedicationSearchItem {
  return { ...catalogItem(), antimicrobial: false, controlled: false, in_network: true, ...over };
}

export const AMOXICILLIN = searchItem({
  id: "ci2", catmat_code: 267621, label: "Amoxicilina 500 mg, cápsula", active_ingredient: "amoxicilina",
  strength: "500 mg", dosage_form: "cápsula", antimicrobial: true
});
export const CLONAZEPAM = searchItem({
  id: "ci3", catmat_code: 269999, label: "Clonazepam 2 mg, comprimido", active_ingredient: "clonazepam",
  strength: "2 mg", dosage_form: "comprimido", controlled: true, in_network: false
});
export const DIPYRONE_REF = catalogItem({
  id: "ci4", catmat_code: 268144, label: "Dipirona sódica 500 mg/mL, solução oral", active_ingredient: "dipirona sódica",
  strength: "500 mg/mL", dosage_form: "solução oral"
});
export const DIPYRONE: MedicationSearchItem = { ...DIPYRONE_REF, antimicrobial: false, controlled: false, in_network: true };

export function prescriptionItem(over: Partial<PrescriptionItem> = {}): PrescriptionItem {
  return {
    position: 1, catalog_item: catalogItem(), printed_description: "Cloridrato de metformina 850 mg — comprimido",
    quantity: 60, quantity_unit: "comprimido", route: "oral", dosage_instructions: "1 comprimido após o café e 1 após o jantar",
    duration_days: 30, continuous: true, antimicrobial: false, ...over
  };
}

function documentOf(over: Partial<ClinicalDocument>): ClinicalDocument {
  return {
    id: "doc1", kind: "sick_note", status: "issued", issue_mode: "paper", issued_at: "2026-10-09T09:40:00-03:00",
    cancelled_at: null, cancel_reason: null,
    author: { id: "us1", name: "Dra. Helena Prado", council: "CRM-PR 45678", cbo_code: "225142" },
    patient: { id: "pa1", display_name: "Joana Lima" }, consultation_id: "cs1", attendance_id: "a1",
    short_code: "K7Q2M-9XW4P", verification_url: "https://curitiba.rotasaude.app/v/tok1", replaces_document_id: null,
    content: { type: "leave", days: 3, start_on: "2026-10-09", cid_authorized: false, note: null }, signature: null,
    ...over
  };
}

export function sickNoteDoc(over: Partial<ClinicalDocument> = {}): ClinicalDocument {
  return documentOf(over);
}

export function prescriptionDoc(over: Partial<ClinicalDocument> = {}): ClinicalDocument {
  return documentOf({
    id: "doc2", kind: "prescription", short_code: "P3H8T-2LQ6R",
    content: { items: [ prescriptionItem() ], antimicrobial: false, copies: 1 }, ...over
  });
}

export function declarationDoc(over: Partial<ClinicalDocument> = {}): ClinicalDocument {
  return documentOf({
    id: "doc3", kind: "attendance_declaration", short_code: "D9W4N-7KC3M",
    content: { date: "2026-10-09", period: "morning", unit_name: "UBS Centro" }, ...over
  });
}

export function examDoc(over: Partial<ClinicalDocument> = {}): ClinicalDocument {
  return documentOf({
    id: "doc4", kind: "exam_requisition", short_code: "E2R6Y-8VB4T",
    content: { exams: [ { sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA", competence: "202609" } ], note: null },
    ...over
  });
}

export function medication(over: Partial<PatientMedication> = {}): PatientMedication {
  return {
    id: "pm1", catalog_item: catalogItem(), free_text: null, label: "Metformina 850 mg", dosage_summary: "1 cp 2x/dia",
    continuous: true, status: "active", origin: "prescription", started_on: "2026-03-10", updated_at: "2026-09-10T14:30:00-03:00",
    ...over
  };
}

export function remumeEntry(over: Partial<RemumeEntry> = {}): RemumeEntry {
  return { catalog_item: { ...catalogItem(), antimicrobial: false, controlled: false }, unit_ids: [], ...over };
}

export function nursingProtocol(over: Partial<NursingProtocol> = {}): NursingProtocol {
  return {
    id: "np1", title: "Protocolo de enfermagem na atenção primária", number: "007/2025", year: 2025,
    current_version: { id: "npv1", version: 1, valid_from: "2025-03-01", valid_until: null, items: [ { catalog_item: DIPYRONE_REF, max_dose: { quantity: 2, unit: "frasco" } } ] },
    ...over
  };
}

// Item da renovação como o api monta (`.compact`): só position, printed_description,
// continuous e antimicrobial são garantidos; o resto é omitido quando falta.
export function renewalItem(over: Partial<RenewalItem> = {}): RenewalItem {
  return {
    position: 1, printed_description: "Cloridrato de metformina 850 mg — comprimido", continuous: true, antimicrobial: false,
    dosage_instructions: "1 cp/dia", ...over
  };
}
