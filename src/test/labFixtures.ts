// src/test/labFixtures.ts
// Dados comuns aos testes do módulo 21b. Cada arquivo de teste faz o próprio
// vi.mock("…/lib/api"); aqui só tipos e a sessão.
import type {
  HealthUnit, LabContext, LabEntryItem, LabEntryListItem, LabExam, LabExamVersion, LabItem, LabReleaseRequisition, LabReportSummary, LabRequisition,
  LabResultRow, LabSample, LabShipment, LabTemplate, SessionUser
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const NOW21B = "2026-10-15T10:00:00-03:00";
export const TODAY21B = "2026-10-15";
export const LAB_PROVIDER = { id: "pv9", name: "Laboratório Municipal" };
export const UBS21B: HealthUnit = { id: "u1", name: "UBS Centro", kind: "ubs", collects_samples: true };

// Sessão com exames e laboratório ligados; `mfa_verified_at` = agora.
export function labUser(roles: string[] = [ "lab_staff" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, {
    id: "us9", email_address: "lab@curitiba.demo", features: [ "exam_tracking", "municipal_lab" ], ...over
  });
}

export function labContext(over: Partial<LabContext> = {}): LabContext {
  return { labs: [ LAB_PROVIDER ], releaser_of: [], council: null, ...over };
}

export function labSample(over: Partial<LabSample> = {}): LabSample {
  return {
    id: "sa1", barcode: "0000012301", material: "sangue total", container: "tubo roxo (EDTA)", status: "awaiting",
    collected_at: null, collected_by: null, received_at: null, rejection_reason: null, restriction_note: null,
    recollection_of_id: null, shipment_id: null, ...over
  };
}

export function labItem(over: Partial<LabItem> = {}): LabItem {
  return { id: "it1", exam_order_id: "eo1", sigtap_code: "0202020380", label: "Hemograma completo", version: 2, sample_id: "sa1", status: "pending", ...over };
}

export function labReport(over: Partial<LabReportSummary> = {}): LabReportSummary {
  return {
    id: "lr1", version: 1, partial: false, status: "released", signature_kind: "advanced", released_at: "2026-10-15T09:00:00-03:00",
    released_by: "Bia Farmacêutica", short_code: "QX7M2K9P", pdf_url: "/lab/files/tok-lr1", replaces_report_id: null, ...over
  };
}

export function labRequisition(over: Partial<LabRequisition> = {}): LabRequisition {
  return {
    id: "rq1", number: "00000123",
    patient: { id: "pa1", display_name: "Joana Lima", birth_date: "1980-05-02", biological_sex: "female" },
    origin_unit: { id: "u1", name: "UBS Centro" }, collection_place: "ubs", urgent: false, status: "open",
    expected_delivery_on: "2026-10-20", items: [ labItem() ], samples: [ labSample() ], reports: [],
    delivered_to: null, delivered_at: null, ...over
  };
}

export function labResultRow(over: Partial<LabResultRow> = {}): LabResultRow {
  return {
    id: "res1", item_id: "it2", analyte_key: "glicose", name: "Glicose", value: "98", unit: "mg/dL", flag: "normal",
    source: "typed", entered_at: "2026-10-15T08:30:00-03:00", entered_by: "Téc. Carla", chosen: true, effective: true, ...over
  };
}

export function labEntryListItem(over: Partial<LabEntryListItem> = {}): LabEntryListItem {
  return { item_id: "it2", sigtap_code: "0202010473", name: "Glicose", status: "pending", ...over };
}

export function glucoseEntry(over: Partial<LabEntryItem> = {}): LabEntryItem {
  return {
    item_id: "it2", requisition_id: "rq1", requisition_number: "00000123", barcode: "0000012302",
    patient: { display_name: "Joana Lima", birth_date: "1980-05-02", biological_sex: "female" },
    sigtap_code: "0202010473", label: "Glicose", version: 1, status: "pending", sample_status: "received", restriction_note: null,
    analytes: [ {
      key: "glicose", name: "Glicose", unit: "mg/dL", value_type: "numeric", choices: null, decimals: 0,
      reference: { low: 70, high: 99, text: null }, entry_min: 10, entry_max: 1500, critical_low: 40, critical_high: 400, formula: null
    } ],
    results: [], ...over
  };
}

// Colesterol: total e HDL digitados, não-HDL calculado pelo api.
export function lipidEntry(over: Partial<LabEntryItem> = {}): LabEntryItem {
  return glucoseEntry({
    item_id: "it3", label: "Colesterol total e frações", sigtap_code: "0202010295",
    analytes: [
      { key: "ct", name: "Colesterol total", unit: "mg/dL", value_type: "numeric", choices: null, decimals: 0,
        reference: { low: null, high: 190, text: "desejável < 190" }, entry_min: 20, entry_max: 1000, critical_low: null, critical_high: null, formula: null },
      { key: "hdl", name: "HDL", unit: "mg/dL", value_type: "numeric", choices: null, decimals: 0,
        reference: { low: 40, high: null, text: "> 40" }, entry_min: 5, entry_max: 300, critical_low: null, critical_high: null, formula: null },
      { key: "nao_hdl", name: "Não-HDL (calculado)", unit: "mg/dL", value_type: "numeric", choices: null, decimals: 0,
        reference: { low: null, high: 160, text: null }, entry_min: null, entry_max: null, critical_low: null, critical_high: null,
        formula: "ct - hdl" }
    ], ...over
  });
}

export function releaseRequisition(over: Partial<LabReleaseRequisition> = {}): LabReleaseRequisition {
  return {
    id: "rq1", number: "00000123",
    patient: { id: "pa1", display_name: "Joana Lima", birth_date: "1980-05-02", biological_sex: "female" }, urgent: false,
    items: [ { ...labItem({ id: "it2", label: "Glicose", sigtap_code: "0202010473", status: "typed" }), restriction_note: null,
      results: [ labResultRow() ] } ],
    reports: [], ...over
  };
}

export function labTemplate(over: Partial<LabTemplate> = {}): LabTemplate {
  return {
    id: "tp1", sigtap_code: "0202010473", name: "Glicose", sector: "biochemistry", material: "soro", container: "tubo cinza",
    suggested_method: "enzimático (GOD-PAP)", preparation: "jejum de 8 h",
    analytes: [ { key: "glicose", name: "Glicose", loinc: "2345-7", unit: "mg/dL", value_type: "numeric", choices: [], decimals: 0,
      reference_ranges: [ { sex: "any", age_min_days: 6570, age_max_days: 43800, low: 70, high: 99, text: null } ] } ],
    ...over
  };
}

export function labVersion(over: Partial<LabExamVersion> = {}): LabExamVersion {
  return {
    id: "ev1", version: 1, method: "enzimático (GOD-PAP)", material: "soro", container: "tubo cinza", instrument_test_code: "GLU",
    analytes: [ { key: "glicose", name: "Glicose", loinc: "2345-7", unit: "mg/dL", value_type: "numeric", choices: [], decimals: 0,
      reference_ranges: [ { sex: "any", age_min_days: 6570, age_max_days: 43800, low: 70, high: 99, text: null } ],
      entry_min: 10, entry_max: 1500, critical_low: 40, critical_high: 400, formula: null } ],
    created_by: "Admin", created_at: "2026-10-14T10:00:00-03:00", ...over
  };
}

export function labExam(over: Partial<LabExam> = {}): LabExam {
  return {
    id: "le1", provider_id: "pv9", template_id: "tp1", sigtap_code: "0202010473", name: "Glicose", sector: "biochemistry", bench: "B1",
    delivery_days: 2, active: true, current_version: labVersion(), versions: [ { id: "ev1", version: 1, created_at: "2026-10-14T10:00:00-03:00", created_by: "Admin" } ],
    ...over
  };
}

export function labShipment(over: Partial<LabShipment> = {}): LabShipment {
  return {
    id: "sh1", origin_unit: { id: "u1", name: "UBS Centro" }, provider: LAB_PROVIDER, status: "sent", temperature_celsius: 4,
    sent_at: "2026-10-15T07:30:00-03:00", sent_by: "Enf. Rita", received_at: null, received_by: null,
    samples: [
      { id: "sa1", barcode: "0000012301", material: "sangue total", status: "in_transit", requisition_number: "00000123" },
      { id: "sa2", barcode: "0000012302", material: "soro", status: "in_transit", requisition_number: "00000123" }
    ],
    ...over
  };
}
