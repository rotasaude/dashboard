// src/test/timelineFixtures.ts
// Dados comuns aos testes do módulo 20 (linha do tempo). A ordem das
// constantes é a do api (occurred_at decrescente). title e summary são
// ilustrativos (vêm prontos do api); status é o código da origem (D3).
import type { TimelineEntry, TimelinePage } from "../lib/api";

export function entry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "consultation:cs0", kind: "consultation", occurred_at: "2026-09-10T14:30:00-03:00",
    unit: { id: "u1", name: "UBS Centro" }, professional: { name: "Dra. Helena Prado", cbo_code: "225142" },
    title: "Consulta agendada", summary: "T90 Diabetes não insulino-dependente — avaliado", status: "finalized",
    detail_ref: { type: "consultation", id: "cs0" }, ...over
  };
}

export const APPOINTMENT = entry({
  id: "appointment:ap1", kind: "appointment", occurred_at: "2026-10-01T09:00:00-03:00",
  professional: { name: "Enf. Lúcia Prado", cbo_code: "223565" }, title: "Retorno — Consulta de enfermagem",
  summary: null, status: "confirmed", detail_ref: { type: "appointment_request", id: "rq1" }
});
export const DOCUMENT = entry({
  id: "clinical_document:doc2", kind: "clinical_document", occurred_at: "2026-09-10T14:40:00-03:00",
  title: "Receita", summary: "comum · digital", status: "issued", detail_ref: { type: "clinical_document", id: "doc2" }
});
export const CONSULTATION = entry();
export const SCREENING = entry({
  id: "screening:sc1", kind: "screening", occurred_at: "2026-09-10T13:50:00-03:00",
  professional: { name: "Enf. Lúcia Prado", cbo_code: "223565" }, title: "Escuta inicial",
  summary: "amarelo · R74 · atendimento no dia", status: "completed", detail_ref: { type: "screening", id: "sc1" }
});
export const TRIAGE = entry({
  id: "triage:tr1", kind: "triage", occurred_at: "2026-09-09T20:15:00-03:00", unit: null, professional: null,
  title: "Triagem respiratória", summary: "prioridade 2", status: "completed", detail_ref: { type: "triage", id: "tr1" }
});

export function page(over: Partial<TimelinePage> = {}): TimelinePage {
  return {
    person: { display_name: "Joana Lima", partial: false, patient_id: "pa1" },
    entries: [ APPOINTMENT, DOCUMENT, CONSULTATION, SCREENING, TRIAGE ],
    next_before: null,
    ...over
  };
}
