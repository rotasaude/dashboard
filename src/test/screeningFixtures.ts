// Dados comuns aos testes do módulo 18 (acolhimento). Relógio dos testes:
// quarta, 2026-10-07 10:00 em São Paulo (-03:00).
import type { Screening, ScreeningQueueItem, ScreeningRevision, ScreeningSuggestion } from "../lib/api";

export const NOW18 = "2026-10-07T10:00:00-03:00";

export function revision(over: Partial<ScreeningRevision> = {}): ScreeningRevision {
  return {
    id: "rv1", created_at: "2026-10-07T09:40:00-03:00", by: { id: "us1", name: "Enf. Lúcia Prado" },
    ciap2: { code: "K86", label: "Hipertensão sem complicações" }, complaint_note: "cefaleia desde ontem",
    vitals: { systolic: 185, diastolic: 110, heart_rate: 88, weight_kg: 80, height_cm: 170, bmi: 27.7 },
    alerts: [ "systolic_high", "diastolic_high" ],
    suggested_color: "red", final_color: "red", color_change_reason: null,
    matched_rules: [ { index: 0, text: "pressão sistólica a partir de 180 mmHg" } ],
    ...over
  };
}

export function screening(over: Partial<Screening> = {}): Screening {
  return {
    id: "sc1", attendance_id: "a1", status: "in_progress", started_at: "2026-10-07T09:35:00-03:00", completed_at: null,
    destination: null, orientation_note: null, appointment_request_id: null, current_revision: null, revisions_count: 0,
    ...over
  };
}

export function queueItem(over: Partial<ScreeningQueueItem> = {}): ScreeningQueueItem {
  return {
    attendance_id: "a1", citizen: { id: "c1", cpf_masked: "***.982.247-**" }, checked_in_at: "2026-10-07T09:20:00-03:00",
    triage_priority: 2, screening: null, ...over
  };
}

export function suggestion(over: Partial<ScreeningSuggestion> = {}): ScreeningSuggestion {
  return {
    suggested_color: "red", matched_rules: [ { index: 0, text: "pressão sistólica a partir de 180 mmHg" } ],
    alerts: [ "systolic_high", "diastolic_high" ], bmi: null, ...over
  };
}
