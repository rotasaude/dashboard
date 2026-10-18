// src/test/qcFixtures.ts
// Dados comuns aos testes do módulo 21c. Cada arquivo de teste faz o próprio
// vi.mock("…/lib/api"); aqui só tipos, a sessão e o ResizeObserver do gráfico.
// Formatos do api real: decimal como string com ponto e SEM zero à direita
// ("98", "2.5"; qc/decimal.rb), z_score e deviation_pct como número, e null
// onde o api manda null (fabricante, modelo, série).
import type {
  EqaAnnualReport, EqaRound, LabConsumptionRow, LabContext, LabExamRef, LabInstrument, LabSupply, LabSupplyInUse, LabSupplyLot,
  LabSupplyMovement, QcBlock, QcChart, QcException, QcLot, QcMaterial, QcReview, QcRuleSet, QcRun, QcSuggestion, QcTarget, QcValue,
  SessionUser
} from "../lib/api";
import { LAB_PROVIDER, labContext, labUser } from "./labFixtures";

export const NOW21C = "2026-10-18T10:00:00-03:00";
export const TODAY21C = "2026-10-18";
export const QC_FEATURES = [ "exam_tracking", "municipal_lab", "lab_quality_control", "lab_inventory" ];

export function qcUser(roles: string[] = [ "lab_staff" ], over: Partial<SessionUser> = {}): SessionUser {
  return labUser(roles, { features: QC_FEATURES, ...over });
}

export function qcContext(over: Partial<LabContext> = {}): LabContext {
  return labContext({ releaser_of: [], technical_lead_of: [], ...over });
}

export const GLU_EXAM: LabExamRef = {
  id: "le1", sigtap_code: "0202010473", name: "Glicose", material: "soro", delivery_days: 2, analytes: [ { key: "glicose", name: "Glicose" } ]
};
export const CHOL_EXAM: LabExamRef = {
  id: "le2", sigtap_code: "0202010295", name: "Colesterol total e frações", material: "soro", delivery_days: 2,
  analytes: [ { key: "ct", name: "Colesterol total" }, { key: "hdl", name: "HDL" } ]
};

export function instrument(over: Partial<LabInstrument> = {}): LabInstrument {
  return {
    id: "in1", provider_id: LAB_PROVIDER.id, name: "BS-200", manufacturer: "Mindray", model: "BS-200", serial_number: "SN-0042",
    sector: "biochemistry", hl7_equipment_id: "BS200-01", active: true, ...over
  };
}

export function qcMaterial(over: Partial<QcMaterial> = {}): QcMaterial {
  return {
    id: "qm1", provider_id: LAB_PROVIDER.id, name: "Controle bioquímico", manufacturer: "Controllab", levels: [ "normal", "patológico" ],
    analytes: [ { lab_exam_id: "le1", analyte_key: "glicose" } ], active: true, has_lots: true, ...over
  };
}

export function qcLot(over: Partial<QcLot> = {}): QcLot {
  return {
    id: "ql1", material_id: "qm1", material_name: "Controle bioquímico", lot_number: "L2026A", expires_on: "2027-03-31",
    level_barcodes: { normal: "QC-L2026A-N", "patológico": "QC-L2026A-P" }, status: "in_use", opened_on: "2026-10-01", closed_on: null,
    expired: false, ...over
  };
}

export function qcTarget(over: Partial<QcTarget> = {}): QcTarget {
  return {
    id: "qt1", lot_id: "ql1", level: "normal", analyte_key: "glicose", instrument_id: "in1", version: 1, source: "package_insert",
    mean: "98", sd: "2.5", based_on_runs: null, reason: null, accepted_by: "Bia Farmacêutica", accepted_at: "2026-10-01T09:00:00-03:00", ...over
  };
}

export function qcSuggestion(over: Partial<QcSuggestion> = {}): QcSuggestion {
  return {
    lot_id: "ql1", level: "normal", analyte_key: "glicose", instrument_id: "in1", mean: "97.6", sd: "2.1", runs: 20,
    current_version: 1, current_source: "package_insert", ...over
  };
}

export function qcValue(over: Partial<QcValue> = {}): QcValue {
  return {
    id: "qv1", run_id: "qr1", lot_id: "ql1", level: "normal", analyte_key: "glicose", value: "99", z_score: 0.4, rules_fired: [], outcome: "ok",
    source: "typed", target_version: 1, reagent_lot_id: "sl1", reagent_lot: { id: "sl1", lot_number: "R-778" },
    entered_at: "2026-10-18T07:10:00-03:00", entered_by: "Téc. Carla", ...over
  };
}

export function qcRun(over: Partial<QcRun> = {}): QcRun {
  return {
    id: "qr1", instrument_id: "in1", sector: "biochemistry", status: "approved", started_at: "2026-10-18T07:00:00-03:00",
    evaluated_at: "2026-10-18T07:12:00-03:00", values: [ qcValue() ], ...over
  };
}

export function qcBlock(over: Partial<QcBlock> = {}): QcBlock {
  return {
    id: "qb1", instrument_id: "in1", analyte_key: "glicose", opened_at: "2026-10-18T08:00:00-03:00", opened_by_run_id: "qr2",
    corrective_action: null, corrective_action_at: null, closed_at: null, closed_by_run_id: null, ...over
  };
}

export function qcReview(over: Partial<QcReview> = {}): QcReview {
  return {
    id: "rv1", block_id: "qb1", item_id: "it2", requisition_id: "rq1", requisition_number: "00000123", sigtap_code: "0202010473",
    exam_label: "Glicose", analyte_key: "glicose", instrument_id: "in1", released_at: "2026-10-18T07:40:00-03:00", decision: "pending",
    decided_by: null, decided_at: null, note: null, ...over
  };
}

export function qcException(over: Partial<QcException> = {}): QcException {
  return {
    id: "qe1", block_id: "qb1", item_id: "it2", requisition_id: "rq1", requisition_number: "00000123", sigtap_code: "0202010473",
    exam_label: "Glicose", analyte_key: "glicose", instrument_id: "in1", justification: "paciente internado, médico assistente ciente",
    granted_by: "Bia Farmacêutica", granted_at: "2026-10-18T09:00:00-03:00", ...over
  };
}

export function qcRules(over: Partial<QcRuleSet> = {}): QcRuleSet {
  return {
    instrument_id: "in1", analyte_key: "glicose",
    rules: { "1_2s": true, "1_3s": true, "2_2s": true, "R_4s": true, "4_1s": true, "10x": true },
    is_default: true, justification: null, changed_by: null, changed_at: null, ...over
  };
}

// Seis pontos: dois avisos/reprovações e a troca da versão 1 para a 2 no quinto.
export function qcChart(over: Partial<QcChart> = {}): QcChart {
  return {
    target: { mean: "98", sd: "2.5", version: 2, source: "laboratory" },
    points: [
      { at: "2026-10-13T07:10:00-03:00", value: "99", z_score: 0.4, outcome: "ok", rules_fired: [], target_version: 1 },
      { at: "2026-10-14T07:10:00-03:00", value: "103.5", z_score: 2.2, outcome: "warning", rules_fired: [ "1_2s" ], target_version: 1 },
      { at: "2026-10-15T07:10:00-03:00", value: "104", z_score: 2.4, outcome: "reject", rules_fired: [ "2_2s" ], target_version: 1 },
      { at: "2026-10-16T07:10:00-03:00", value: "97", z_score: -0.4, outcome: "ok", rules_fired: [], target_version: 1 },
      { at: "2026-10-17T07:10:00-03:00", value: "98.5", z_score: 0.2, outcome: "ok", rules_fired: [], target_version: 2 },
      { at: "2026-10-18T07:10:00-03:00", value: "96", z_score: -0.8, outcome: "ok", rules_fired: [], target_version: 2 }
    ],
    ...over
  };
}

// C-E24: a rodada não tem relatório anual.
export function eqaRound(over: Partial<EqaRound> = {}): EqaRound {
  return {
    id: "er1", provider_id: LAB_PROVIDER.id, program: "PNCQ", round_code: "2026-03", round_date: "2026-09-20",
    items: [ { analyte_key: "glicose", lab_exam_id: "le1", submitted: "101", target: "100", acceptable_low: "94", acceptable_high: "106", adequacy: "adequate", action: null } ],
    recorded_by: "Bia Farmacêutica", recorded_at: "2026-09-21T10:00:00-03:00", ...over
  };
}

export function eqaAnnualReport(over: Partial<EqaAnnualReport> = {}): EqaAnnualReport {
  return {
    id: "ar1", provider_id: LAB_PROVIDER.id, program: "PNCQ", year: 2026, url: "/lab/eqa/annual_reports/ar1/pdf",
    recorded_by: "Bia Farmacêutica", recorded_at: "2026-10-10T10:00:00-03:00", ...over
  };
}

export function supply(over: Partial<LabSupply> = {}): LabSupply {
  return {
    id: "su1", provider_id: LAB_PROVIDER.id, name: "Glicose GOD-PAP 2×100 mL", kind: "reagent", unit: "kit", tests_per_package: 400,
    minimum_stock: 2, expiry_alert_days: 30, lab_exam_ids: [ "le1" ], active: true, balance: 5, below_minimum: false, ...over
  };
}

export function supplyLot(over: Partial<LabSupplyLot> = {}): LabSupplyLot {
  return {
    id: "sl1", supply_id: "su1", supply_name: "Glicose GOD-PAP 2×100 mL", lot_number: "R-778", expires_on: "2027-01-31",
    supplier: "Distribuidora Sul", origin: "purchase", balance: 5, expired: false, in_use: [ { instrument_id: "in1", lab_exam_id: "le1" } ], ...over
  };
}

export function supplyMovement(over: Partial<LabSupplyMovement> = {}): LabSupplyMovement {
  return {
    id: "mv1", lot_id: "sl1", kind: "receipt", quantity: 6, reason: null, document: "NF 1234", recorded_by: "Téc. Carla",
    recorded_at: "2026-10-10T09:00:00-03:00", ...over
  };
}

export function inUse(over: Partial<LabSupplyInUse> = {}): LabSupplyInUse {
  return {
    id: "iu1", lot_id: "sl1", lot_number: "R-778", supply_name: "Glicose GOD-PAP 2×100 mL", instrument_id: "in1", lab_exam_id: "le1",
    exam_name: "Glicose", started_at: "2026-10-12T07:00:00-03:00", ended_at: null, ...over
  };
}

// C-E33: a linha total e as sub-linhas (aparelho e "sem aparelho") de um reagente.
export function consumptionRows(): LabConsumptionRow[] {
  return [
    { line: "total", supply_id: "su1", name: "Glicose GOD-PAP 2×100 mL", instrument_id: null, tests_performed: 410, tests_opened: 400, deviation_pct: 2.5 },
    { line: "instrument", supply_id: "su1", name: "Glicose GOD-PAP 2×100 mL", instrument_id: "in1", tests_performed: 400, tests_opened: null, deviation_pct: null },
    { line: "no_instrument", supply_id: "su1", name: "Glicose GOD-PAP 2×100 mL", instrument_id: null, tests_performed: 10, tests_opened: null, deviation_pct: null }
  ];
}

// Recharts (ResponsiveContainer) mede o pai por ResizeObserver; o jsdom não tem
// layout. Este informa 600×260 ao observar (prova técnica do Ambiente).
export class SizedResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const rect = { width: 600, height: 260, x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 260, toJSON() {} };
    this.callback([ { target, contentRect: rect } as unknown as ResizeObserverEntry ], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
