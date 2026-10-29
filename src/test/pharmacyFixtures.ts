import type {
  AdminLocation, Dispensation, LocationRef, LotBalance, PharmacyAlerts, PharmacyLocation, PharmacySettings, PrescriptionItemView, PrescriptionView,
  SessionUser, StockAdjustment, StockItem, StockLot, StockPosition, StockTransfer
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

// Formas do contrato do 27a com as emendas H12 (unit = concentração; dispensing_unit = o que se conta no balcão;
// catmat_code numérico). Hoje: quinta, 2026-10-29; dados ilustrativos.
export const TODAY27 = "2026-10-29";
export const CENTRAL_REF: LocationRef = { id: "l1", name: "Almoxarifado Central", kind: "central" };
export const UBS_REF: LocationRef = { id: "l2", name: "Farmácia UBS Centro", kind: "unit" };
export const CENTRAL: PharmacyLocation = { ...CENTRAL_REF, health_unit: null, active: true, roles: [ "stock_keeper" ] };
export const UBS_FARM: PharmacyLocation = { ...UBS_REF, health_unit: { id: "u1", name: "UBS Centro" }, active: true, roles: [ "pharmacist" ] };
export const AMOXI: StockItem = {
  catalog_item_id: "ci1", catmat_code: 267645, name: "Amoxicilina 500 mg cápsula", unit: "mg", dispensing_unit: "cápsula",
  controlled: false, controlled_list: null
};
export const CLONA: StockItem = {
  catalog_item_id: "ci2", catmat_code: 268370, name: "Clonazepam 2 mg comprimido", unit: "mg", dispensing_unit: "comprimido",
  controlled: true, controlled_list: "B1"
};

export function phUser(roles: string[] = [ "pharmacist" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, { features: [ "pharmacy" ], ...over });
}
export function stockLot(over: Partial<StockLot> = {}): StockLot {
  return { id: "lot1", item: AMOXI, lot_number: "AMX2611", expires_on: "2026-11-20", manufacturer: "EMS", ...over };
}
export function lotBalance(over: Partial<LotBalance> = {}): LotBalance { return { lot: stockLot(), balance: "30", in_transit: "0", ...over }; }
export function position(over: Partial<StockPosition> = {}): StockPosition {
  return { location: UBS_REF, item: AMOXI, lots: [ lotBalance() ], balance: "30", minimum: "50", below_minimum: true, expiring_soon: true, ...over };
}
// A amoxicilina é antimicrobiano: a receita pede retenção (retention_required, calculado pelo api).
export function rxItem(over: Partial<PrescriptionItemView> = {}): PrescriptionItemView {
  return {
    id: "pi1", catalog_item_id: "ci1", free_text: null, printed_description: "Amoxicilina 500 mg cápsula", quantity: "21", quantity_unit: "cápsula",
    dosage_instructions: "1 cápsula de 8 em 8 horas por 7 dias", continuous: false, controlled: false, retention_required: true, dispensed_total: "0",
    last_dispensed_on: null, next_allowed_on: null, completed: false, ...over
  };
}
export function prescription(over: Partial<PrescriptionView> = {}): PrescriptionView {
  return {
    kind: "digital", id: "doc1", short_code: "ABCDE23456", issued_on: "2026-10-27", valid_until: "2026-11-26", expired: false, cancelled: false,
    prescriber: { name: "Dra. Helena Prado", council: "CRM-PR 12345" }, patient: { id: "pa1", display_name: "Joana Lima", has_cpf: true, cns_masked: null },
    items: [ rxItem() ], ...over
  };
}
export function dispensation(over: Partial<Dispensation> = {}): Dispensation {
  return {
    id: "dp1", location: UBS_REF, prescription: { kind: "digital", id: "doc1" }, patient: { id: "pa1", display_name: "Joana Lima", has_cpf: true, cns_masked: null },
    by: { name: "Marta Souza", role: "pharmacist" }, at: "2026-10-29T10:15:00-03:00",
    items: [ {
      id: "di1", prescription_item_id: "pi1", catalog_item_id: "ci1", item: AMOXI, lot_id: "lot1",
      lot: { id: "lot1", lot_number: "AMX2611", expires_on: "2026-11-20" }, quantity: "21.00", returned_total: "0.00", mapped_from_free_text: false
    } ],
    retention: null, ...over
  };
}
export function transfer(over: Partial<StockTransfer> = {}): StockTransfer {
  return {
    id: "t1", from: CENTRAL_REF, to: UBS_REF, status: "sent", sent_at: "2026-10-28T09:00:00-03:00", received_at: null,
    items: [ { lot: stockLot(), quantity: "100.00", quantity_received: null, difference: null } ], ...over
  };
}
export function adjustment(over: Partial<StockAdjustment> = {}): StockAdjustment {
  return {
    id: "a1", location: UBS_REF, lot: stockLot(), kind: "adjustment", status: "pending", quantity: "-10.00", counted_quantity: "20.00",
    balance_at_request: "30.00", reason: "Contagem do fim do mês", requested_by: { user_id: "u-9", name: "Paulo Almeida" },
    decided_by: null, decision_reason: null, created_at: "2026-10-29T08:00:00-03:00", ...over
  };
}
export function phSettings(over: Partial<PharmacySettings> = {}): PharmacySettings {
  return { common_validity_days: 30, continuous_validity_days: 180, continuous_interval_days: 25, expiry_alert_days: 90, adjustment_approval_percent: 10, ...over };
}
export function adminLocation(over: Partial<AdminLocation> = {}): AdminLocation {
  return { ...UBS_REF, health_unit: { id: "u1", name: "UBS Centro" }, active: true,
    staff: [ { user_id: "u-9", name: "Marta Souza", role: "pharmacist" } ], ...over };
}
export function phAlerts(over: Partial<PharmacyAlerts> = {}): PharmacyAlerts {
  return { expiring: 2, expired: 1, below_minimum: 1, in_transit: 1, pending_adjustments: 1, ...over };
}
