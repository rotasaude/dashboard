// Test fixtures for module 16 (record mode).
// Common data for tests; types from api only.
import type { CnesOverview, CnesProposal, IntegrationCredential, Integrations, LediFicha, Production } from "../lib/api";

export function credential(overrides: Partial<IntegrationCredential> = {}): IntegrationCredential {
  return {
    kind: "ledi", set: true, set_at: "2026-10-01T13:00:00Z", set_by: "admin@curitiba.demo",
    last_check_at: "2026-10-02T12:30:00Z", last_check_status: "ok", last_check_message: null,
    ...overrides
  };
}

export function integrationsFixture(overrides: Partial<Integrations> = {}): Integrations {
  return {
    record_mode: "integrated", pec_url_set: true, ibge_code_set: true,
    credentials: [
      credential(),
      credential({ kind: "cadsus", set: false, set_at: null, set_by: null, last_check_at: null, last_check_status: null })
    ],
    features: [
      { key: "ledi_export", enabled: true, usable: true, missing: [] },
      { key: "cadsus_lookup", enabled: false, usable: false, missing: [ "credential_missing:cadsus" ] }
    ],
    ...overrides
  };
}

export function proposal(overrides: Partial<CnesProposal> = {}): CnesProposal {
  return {
    id: "p1", kind: "unit", action: "link", local: { name: "UBS Centro" },
    cnes: { name: "UBS CENTRO", cnes: "2384299" }, confidence: "exact", ...overrides
  };
}

export function cnesFixture(overrides: Partial<CnesOverview> = {}): CnesOverview {
  return {
    snapshot: { competence: "202609", imported_at: "2026-10-03T12:00:00Z" },
    proposals: [
      proposal(),
      proposal({
        id: "p2", kind: "member", action: "create", local: null, confidence: "probable",
        cnes: { name: "ANA SOUZA", ine: "0001234567", cbo: "225142", cpf_masked: "***.982.247-**", cns_masked: "7** **** **** 1234" }
      })
    ],
    divergences: [
      { kind: "cbo_mismatch", subject: { type: "professional", id: "pr1", label: "Bruno Lima" }, detail: "CBO local 225125, CNES 225142" }
    ],
    ...overrides
  };
}

export function ficha(overrides: Partial<LediFicha> = {}): LediFicha {
  return {
    id: "f1", ficha_type: "synthetic", status: "accepted", attempts: 1, last_error: null,
    created_at: "2026-10-02T13:00:00Z", accepted_at: "2026-10-02T13:01:00Z", ...overrides
  };
}

// 16/11/2026 é o 10º dia útil de novembro (02/11 Finados; 20/11 é depois).
export function productionFixture(overrides: Partial<Production> = {}): Production {
  return {
    competence: "202610", deadline_on: "2026-11-16", business_days_left: 7, alert: "attention",
    counts: { accepted: 120, rejected: 3, pending: 10, sending: 0, failed: 0 },
    rejections: [ { message: "CNS do profissional inválido", count: 3 } ],
    fichas: [
      ficha(),
      ficha({ id: "f2", status: "rejected", accepted_at: null, last_error: "CNS do profissional inválido" })
    ],
    fichas_total: 2,
    ...overrides
  };
}
