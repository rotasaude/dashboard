import type {
  BnafarDomains, BnafarPendencies, BnafarPendency, BnafarRecord, BnafarStatus, BnafarSubmission, BnafarSubmissionDetail, ExternalExit,
  IntegrationCredential, LotBnafar, ObmPresentation, OpeningImport, OpeningImportRow, SessionUser, StockLot, StockOpening
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";
import { AMOXI, UBS_REF } from "./pharmacyFixtures";

// Formas do api do 27b (api-shapes.md, HEAD 9ae6d660) mais Q43–Q45 (campos que o api acrescenta numa rodada própria).
// Hoje: quinta, 2026-11-26; dados ilustrativos.
export const NOW27B = "2026-11-26T14:30:00-03:00";
export const TODAY27B = "2026-11-26";

export const BNAFAR_FEATURES = [ "pharmacy", "bnafar", "bnafar_medications" ];
export const bnafarUser = (roles: string[] = [ "stock_keeper" ], features: string[] = BNAFAR_FEATURES): SessionUser =>
  sessionWith(roles, { features });

export const BNAFAR_DOMAINS: BnafarDomains = {
  programs: [
    { code: "AF", label: "Assistência Farmacêutica básica", product_type: "medication" },
    { code: "HIPERTEN", label: "Hipertensão", product_type: "medication" },
    { code: "INSULDEP I", label: "Insulina", product_type: "medication" }
  ],
  exit_types: [
    { code: "S-DF", label: "Devolução ao fornecedor" }, { code: "S-TR", label: "Transferência" },
    { code: "S-D", label: "Doação" }, { code: "S-E", label: "Empréstimo" }
  ],
  location_types: [ { kind: "central", code: "01" }, { kind: "unit", code: "02" } ],
  enabled_domains: [ "medication" ]
};

export const PRESENTATIONS: ObmPresentation[] = [
  { ampp_code: "AMPP0001", vmp_code: "VMP0001", description: "Amoxicilina 500 mg cápsula, caixa com 21", anvisa_registration: "1234567890123", manufacturer_cnpj: "11222333000181" },
  { ampp_code: "AMPP0002", vmp_code: "VMP0001", description: "Amoxicilina 500 mg cápsula, caixa com 500", anvisa_registration: null, manufacturer_cnpj: null }
];

export const lotBnafar = (o: Partial<LotBnafar> = {}): LotBnafar => ({
  unit_price_cents: 1250, manufacturer_cnpj: "11222333000181", manufacturer_international: false, anvisa_registration: "1234567890123",
  health_program: "AF", ium: null, ampp_code: "AMPP0001", version: 1, missing: [], ...o
});

export const FIVE_MISSING = [ "unit_price_cents", "manufacturer_cnpj", "anvisa_registration", "health_program", "ampp_code" ];
export const incompleteLot = (o: Partial<StockLot> = {}): StockLot => ({
  id: "lt1", item: AMOXI, lot_number: "AMX2611", expires_on: "2027-06-30", manufacturer: null,
  bnafar: { version: 0, missing: FIVE_MISSING }, ...o
});

export const status = (o: Partial<BnafarStatus> = {}): BnafarStatus => ({
  environment: "production", alert: { late: 0, lost: 0, rejected: 0, last_finished_on: "2026-11-25" },
  days: [ { reference_on: "2026-11-25", subjects: [
    { subject: "position", status: "finished", accepted: 12, rejected: 0, pending: 0, lost: 0 },
    { subject: "exit", status: "finished", accepted: 3, rejected: 0, pending: 0, lost: 0 }
  ] } ], ...o
});

export const submission = (o: Partial<BnafarSubmission> = {}): BnafarSubmission => ({
  id: "bs1", reference_on: "2026-11-25", subject: "position", environment: "production", status: "finished", attempts: 1, last_error: null,
  sent_at: "2026-11-26T02:10:00-03:00", finished_at: "2026-11-26T02:14:00-03:00", retry_until: "2026-11-27T23:59:59-03:00",
  counts: { accepted: 12, rejected: 0, pending: 0, lost: 0 }, ...o
});

export const record = (o: Partial<BnafarRecord> = {}): BnafarRecord => ({
  id: "br1", subject: "position", status: "accepted", lost: false, lost_reason: null, deleted: false,
  stock_location_id: UBS_REF.id, location_name: UBS_REF.name, item_key: "medication:ci1", item_label: AMOXI.name,
  error_codes: [], rejected_items: 0, bnafar_code: "123456", protocol: "P-0001", retry_until: null, correct_until: null, ...o
});
export const exitRecord = (o: Partial<BnafarRecord> = {}): BnafarRecord => record({
  id: "br2", subject: "exit", correct_until: "2026-12-26T23:59:59-03:00", stock_external_exit_id: "ex1", stock_external_exit_version: 1, ...o
});
// O perdido não é um status: é `lost: true` sobre um registro recusado (api-shapes, registro).
export const lostRecord = (o: Partial<BnafarRecord> = {}): BnafarRecord => record({
  id: "br3", status: "rejected", lost: true, lost_reason: "MSG09", error_codes: [ "MSG09" ], ...o
});

export const rejectedSubmission = (o: Partial<BnafarSubmissionDetail> = {}): BnafarSubmissionDetail => ({
  ...submission({ id: "bs2", status: "finished", counts: { accepted: 1, rejected: 2, pending: 0, lost: 0 } }),
  batches: [ { operation: "post", status: "finished", protocol: "P-0002" } ],
  records: [
    record({ id: "br4" }),
    record({ id: "br5", status: "rejected", error_codes: [ "MSG09" ], bnafar_code: null, retry_until: "2026-11-27T23:59:59-03:00" }),
    record({ id: "br6", status: "rejected", error_codes: [ "MSG12" ], bnafar_code: null, retry_until: "2026-11-27T23:59:59-03:00" })
  ],
  next_before: null, ...o
});

const PENDENCY_BASE: BnafarPendency = {
  code: "lot_incomplete", stock_location_id: UBS_REF.id, location_name: UBS_REF.name, item_key: "medication:ci1", item_label: AMOXI.name,
  stock_lot_id: "lt1", lot_id: "lt1", lot_number: "AMX2611", lot_version: 0, vmp_code: "VMP0001", fields: FIVE_MISSING
};
export const pendencies = (codes: string[], o: Partial<BnafarPendencies> = {}): BnafarPendencies => ({
  items: codes.map((code, i): BnafarPendency => ({
    ...PENDENCY_BASE, code, stock_location_id: `l${i + 2}`, location_name: `Local ${i + 2}`,
    ...(code === "lot_incomplete" ? {} : { stock_lot_id: null, lot_id: null, lot_number: null, lot_version: null, vmp_code: null, fields: [] })
  })),
  next_before: null,
  totals: { by_code: Object.fromEntries(codes.map((c) => [ c, 1 ])), by_location: Object.fromEntries(codes.map((_, i) => [ `l${i + 2}`, 1 ])) },
  ...o
});

const EXIT_LOT: StockLot = { id: "lt2", item: AMOXI, lot_number: "AMX2610", expires_on: "2027-03-31", manufacturer: null };
export const externalExit = (o: Partial<ExternalExit> = {}): ExternalExit => ({
  id: "ex1", location: UBS_REF, exit_type: "S-D", destination_kind: "cnes", destination_code: "2384299", version: 1,
  recorded_at: NOW27B, items: [ { lot: EXIT_LOT, quantity: 30 } ], ...o
});
export const externalExitDetail = (o: Partial<ExternalExit> = {}): ExternalExit => externalExit({ reason: "doação à unidade vizinha, sem demanda local", ...o });

export const opening = (o: Partial<StockOpening> = {}): StockOpening => ({
  stock_entry_id: "se1", created_at: NOW27B, recorded_by: { name: "Helena Prado" }, from_import: false, reverted: false,
  lots: [ { stock_lot_id: "lt1", item_label: AMOXI.name, lot_number: "AMX2611", expires_on: "2027-06-30", quantity: "300.00", bnafar: { missing: [] } } ], ...o
});

export const openingImport = (o: Partial<OpeningImport> = {}): OpeningImport => ({
  id: "oi1", status: "validated", version: 1, rows_total: 10, rows_valid: 8, created_at: NOW27B, applied_at: null, reverted_at: null,
  uploaded_by: { name: "Helena Prado" },
  report: {
    rows_valid: 8, rows_error: 2, errors_by_code: { cnes_unknown: 1, invalid_date: 1 }, rows_missing_send_fields: 3,
    products_without_catalog: [ { tipo_produto: "medication", codigo_produto: "999999" } ],
    locations_without_cnes: [ { id: "l9", name: "Farmácia UBS Norte", kind: "unit" } ],
    totals_by_location: [ { stock_location_id: "l2", location_name: UBS_REF.name, rows: 8, quantity: "2400.00", value_cents: 300000 } ]
  }, ...o
});
export const importRows = (n: number, o: Partial<OpeningImportRow> = {}): OpeningImportRow[] =>
  Array.from({ length: n }, (_, i): OpeningImportRow => ({
    line: i + 2, status: "valid", error_codes: [], stock_location_id: "l2", cnes: "2384299", tipo_produto: "medication", codigo_produto: "267645",
    ampp: null, lote: `L${i + 1}`, validade: "2027-06-30", quantidade: "10", valor_unitario: "12,50", cnpj_fabricante: null, registro_anvisa: null,
    programa: null, ...o
  }));

export const bnafarCredential = (environment: "production" | "homologation", o: Partial<IntegrationCredential> = {}): IntegrationCredential => ({
  kind: "bnafar", environment, set: true, set_at: NOW27B, set_by: "Helena Prado", last_check_at: NOW27B, last_check_status: "ok", last_check_message: null, ...o
});
