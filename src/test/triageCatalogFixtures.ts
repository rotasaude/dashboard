import type { TriageOffer } from "../lib/api";

export function catalogOffer(overrides: Partial<TriageOffer> = {}): TriageOffer {
  return {
    protocol_name: "saude-do-idoso", title: "Saúde do idoso", active_version: 3,
    eligibility: { gte: [ "profile.age", 60 ] }, retake_after_days: 365,
    configured: true, enabled: true, position: 2,
    restriction: { in: [ "citizen.neighborhood_id", [ "n2" ] ] },
    available_from: null, available_until: "2026-12-31",
    counters: { offered: 120, started: 40, completed: null, from_suggestion: 6 },
    ...overrides
  };
}

export const RESPIRATORY: TriageOffer = catalogOffer({
  protocol_name: "triage-respiratoria", title: "Sintomas respiratórios", active_version: 5,
  eligibility: null, retake_after_days: null, configured: false, enabled: null, position: null,
  restriction: null, available_from: null, available_until: null,
  counters: { offered: 0, started: 0, completed: 0, from_suggestion: 0 }
});
