// Test fixtures for module 16 (record mode).
// Common data for tests; types from api only.
import type { IntegrationCredential, Integrations } from "../lib/api";

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
