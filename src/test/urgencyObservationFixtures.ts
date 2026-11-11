// Dados dos testes do módulo 32b (observação, prescrição interna, checagem). Agora: segunda, 2026-11-10, 14h.
// Formas REAIS do api (docs/.superpowers/sdd/2026-11-10-module-32b-urgency-observation-dashboard/api-shapes.md §3).
import type {
  ObservationBed, ObservationStayRef, ProfessionalLink, ScheduleItem, UrgencyAdministration, UrgencyBed,
  UrgencyCatalogItem, UrgencyDetailAdministration, UrgencyEncounter, UrgencyMedicationSchedule, UrgencyObservationBlock,
  UrgencyObservationMap, UrgencyPrescription, UrgencyPrescriptionItem, UrgencyShortfall, UrgencyStay
} from "../lib/api";
import { DOCTOR_LINK, encounter, patientRef } from "./urgencyFixtures";

export const NOW32B = new Date("2026-11-10T14:00:00-03:00");
export const TECH_LINK = { ...DOCTOR_LINK, id: "l3", cbo_code: "322205", cbo_title: "Técnico de enfermagem" } as ProfessionalLink;

export const bed = (o: Partial<UrgencyBed> = {}): UrgencyBed =>
  ({ id: "b1", health_unit_id: "upa1", label: "Obs 1", active: true, occupied: false, ...o });
export const stayRef = (o: Partial<ObservationStayRef> = {}): ObservationStayRef => ({
  stay_id: "st1", encounter_id: "en3", ticket: "U-038", patient: patientRef({ patient_id: "pa3", name: "João Reis" }),
  started_at: "2026-11-10T08:00:00-03:00", hours: 6, alert: null, ...o
});
export const observationBed = (o: Partial<ObservationBed> = {}): ObservationBed =>
  ({ bed_id: "b1", label: "Obs 1", active: true, stay: stayRef(), ...o });
export const observationMap = (o: Partial<UrgencyObservationMap> = {}): UrgencyObservationMap => ({
  beds: [ observationBed(), observationBed({ bed_id: "b2", label: "Obs 2", stay: null }) ],
  waiting_bed: [ { encounter_id: "en4", ticket: "U-041", patient: patientRef({ patient_id: "pa4", name: "Rita Melo" }),
    called_at: "2026-11-10T13:30:00-03:00" } ],
  ...o
});
export const stay = (o: Partial<UrgencyStay> = {}): UrgencyStay => ({
  stay_id: "st1", bed_id: "b1", bed_label: "Obs 1", started_at: "2026-11-10T08:00:00-03:00", ended_at: null, end_kind: null,
  started_by: { name: "Dr. Caio" }, ended_by: null, ...o
});
export const observationBlock = (o: Partial<UrgencyObservationBlock> = {}): UrgencyObservationBlock =>
  ({ current: stay(), stays: [ stay() ], hours: 6, alert: null, ...o });
export const catalogItem = (o: Partial<UrgencyCatalogItem> = {}): UrgencyCatalogItem => ({
  catalog_item_id: "cat-dipirona", catmat_code: 267_501, name: "Dipirona 500 mg/mL solução injetável", unit: "mg",
  dispensing_unit: "ampola", controlled: false, controlled_list: null, ...o
});
export const prescriptionItem = (o: Partial<UrgencyPrescriptionItem> = {}): UrgencyPrescriptionItem => ({
  id: "pi1", position: 1, catalog_item: catalogItem(), controlled: false, controlled_list: null, dose: "1", dose_unit: "g",
  route: "intravenous", frequency: { kind: "interval", interval_hours: 6, max_per_day: null },
  first_dose_at: "2026-11-10T08:00:00-03:00", instructions: null, stock_quantity_per_dose: "1.00", stock_unit: "ampola", ...o
});
export const prescription = (o: Partial<UrgencyPrescription> = {}): UrgencyPrescription => ({
  id: "pr1", encounter_id: "en3", version: 1, status: "active", supersedes_id: null, prescribed_at: "2026-11-10T08:00:00-03:00",
  prescribed_by: { name: "Dr. Caio", cbo_code: "225125" }, suspension_reason: null, status_changed_at: null,
  items: [ prescriptionItem() ], ...o
});
export const administration = (o: Partial<UrgencyAdministration> = {}): UrgencyAdministration => ({
  id: "ad1", status: "administered", scheduled_at: "2026-11-10T08:00:00-03:00", administered_at: "2026-11-10T08:05:00-03:00",
  reason: null, stock_lot: null, stock_quantity: null, recorded_at: "2026-11-10T08:06:00-03:00",
  by: { name: "Ana Souza", cbo_code: "223505" }, ...o
});
export const detailAdministration = (o: Partial<UrgencyDetailAdministration> = {}): UrgencyDetailAdministration =>
  ({ ...administration(), prescription_item_id: "pi1", catalog_item: catalogItem(), controlled: false, ...o });
// Item de 6 em 6 h desde as 8h: 8h (checado), 14h (agora), 20h, 2h.
export const scheduleItem = (o: Partial<ScheduleItem> = {}): ScheduleItem => ({
  ...prescriptionItem(), item_id: "pi1",
  slots: [
    { scheduled_at: "2026-11-10T08:00:00-03:00", administration: administration() },
    { scheduled_at: "2026-11-10T14:00:00-03:00", administration: null },
    { scheduled_at: "2026-11-10T20:00:00-03:00", administration: null },
    { scheduled_at: "2026-11-11T02:00:00-03:00", administration: null }
  ],
  recent: null, remaining: null, last_administration: administration(), ...o
});
export const schedule = (o: Partial<UrgencyMedicationSchedule> = {}): UrgencyMedicationSchedule =>
  ({ prescription_id: "pr1", version: 1, stock_deduction: false, items: [ scheduleItem() ], ...o });
export const shortfall = (o: Partial<UrgencyShortfall> = {}): UrgencyShortfall => ({
  shortfall_id: "sf1", created_at: "2026-11-10T11:06:00.123456Z", stock_location_id: "loc-upa", catalog_item: catalogItem(),
  quantity: "1.00", cause: "insufficient_balance", administration: { administered_at: "2026-11-10T11:05:00Z", ticket: "U-038" },
  reconciled_at: null, reconciled_by: null, ...o
});
// O detalhe que o médico lê, com os três blocos do 32b.
export const observedEncounter = (o: Partial<UrgencyEncounter> = {}): UrgencyEncounter => encounter({
  id: "en3", attendance_id: "at3", state: "in_care", ticket: "U-038", color: "orange", consultation_id: "co1",
  consultation_status: "finalized", observation: observationBlock(), prescription: prescription(),
  administrations: [ detailAdministration() ], ...o
});
