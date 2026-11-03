// Dados dos testes do módulo 29 (sala de vacina). Hoje: segunda, 2026-11-02, 10h. Formas conferidas contra o api (contrato §2 e §15).
import type {
  CardItem, CardPatient, CodeName, ColdChainEquipment, ColdChainStatus, Immunization, Immunobiological, LotBalance, MonthlySummary,
  RndsPendingItem, SessionUser, StockItem, StockPosition, VaccinationCard, VaccinationCatalog, VaccinationDashboard, VaccineLocation,
  VaccineRoom, Vial
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";
import { lotBalance, position, stockLot } from "./pharmacyFixtures";

export const TODAY29 = "2026-11-02";
export const NOW29 = new Date("2026-11-02T10:00:00-03:00");
export const ROOM: VaccineLocation = { id: "l5", name: "Sala de vacina UBS Centro", kind: "vaccine_room",
  health_unit: { id: "u1", name: "UBS Centro" }, active: true, roles: [ "vaccinator" ], room_id: "r1" };
export const LEAD_ROOM: VaccineLocation = { ...ROOM, roles: [ "room_lead" ] };
export const COLD_CENTRAL: VaccineLocation = { id: "l9", name: "Rede de frio municipal", kind: "cold_chain_central", health_unit: null,
  active: true, roles: [ "stock_keeper" ], room_id: null };
// Fabricante por `key` (V19); o código RNDS pode ser nulo.
export const PENTA: Immunobiological = { code: "42", name: "Penta (DTP/HepB/Hib)", multidose: false, doses_per_vial: 1, default_route: "IM",
  default_site: "VLD", manufacturers: [ { key: "serum", code: "SER", name: "Serum Institute", validity_after_opening_hours: null } ] };
export const BCG: Immunobiological = { code: "15", name: "BCG", multidose: true, doses_per_vial: 10, default_route: "ID", default_site: "DD",
  manufacturers: [ { key: "fap", code: null, name: "Fundação Ataulpho de Paiva", validity_after_opening_hours: 6 } ] };
const t = (pairs: [ string, string ][]): CodeName[] => pairs.map(([ code, name ]) => ({ code, name }));
export const TERMS = {
  dose: t([ [ "D1", "1ª dose" ], [ "D2", "2ª dose" ], [ "D3", "3ª dose" ], [ "REF", "Reforço" ] ]),
  strategy: t([ [ "1", "Rotina" ], [ "2", "Campanha" ] ]),
  route: t([ [ "IM", "Intramuscular" ], [ "ID", "Intradérmica" ], [ "VO", "Oral" ] ]),
  site: t([ [ "VLD", "Vasto lateral da coxa direita" ], [ "DD", "Deltoide direito" ] ]),
  care_group: t([ [ "1", "Criança" ], [ "2", "Gestante" ] ]),
  maternal_condition: t([ [ "N", "Nenhuma" ], [ "G", "Gestante" ], [ "P", "Puérpera" ] ])
};
export const CATALOG29: VaccinationCatalog = { calendar_version: "2026.1", immunobiologicals: [ PENTA, BCG ], terminologies: TERMS };
const vacItem = (code: string, name: string): StockItem => ({ catalog_item_id: null, catmat_code: null, immunobiological_code: code,
  item_kind: "immunobiological", name, unit: "dose", dispensing_unit: "dose", controlled: false, controlled_list: null });
export const PENTA_ITEM = vacItem("42", "Penta (DTP/HepB/Hib)");
export const BCG_ITEM = vacItem("15", "BCG");

export const vacUser = (roles = [ "health_professional" ], over: Partial<SessionUser> = {}): SessionUser =>
  sessionWith(roles, { id: "us1", features: [ "clinical_record", "vaccination" ], ...over });
export const vacLotBalance = (over: Partial<LotBalance> = {}): LotBalance => lotBalance({
  lot: stockLot({ id: "lot9", item: PENTA_ITEM, lot_number: "PNT2611", expires_on: "2027-03-31", manufacturer: "Serum Institute", manufacturer_key: "serum" }),
  balance: "20", in_transit: "0", expiring_soon: false, expired: false, blocked: false, ...over });
export const vacPosition = (over: Partial<StockPosition> = {}): StockPosition =>
  position({ location: { id: ROOM.id, name: ROOM.name, kind: ROOM.kind }, item: PENTA_ITEM, lots: [ vacLotBalance() ], balance: "20",
    minimum: null, below_minimum: false, expiring_soon: false, ...over });
export const cardPatient = (over: Partial<CardPatient> = {}): CardPatient =>
  ({ id: "pa1", display_name: "Joana Lima", birth_date: "2026-07-01", sex: "female", has_cpf: false, cns_masked: "*** **** **** 1234", ...over });
export const cardItem = (over: Partial<CardItem> = {}): CardItem =>
  ({ immunobiological: { code: "42", name: PENTA.name }, dose: { code: "D2", name: "2ª dose" }, status: "due", due_on: TODAY29, applied: null, ...over });
export function immunization(over: Partial<Immunization> = {}): Immunization {
  return { id: "im1", immunobiological: { code: "42", name: PENTA.name }, dose: { code: "D1", name: "1ª dose" }, strategy: "1", care_group: "1",
    route: "IM", site: "VLD", maternal_condition: null, applied_at: "2026-09-01T09:30:00-03:00",
    lot: { id: "lot9", number: "PNT2611", manufacturer: { code: "SER", name: "Serum Institute" }, expires_on: "2027-03-31" }, transcription: false,
    room: { id: "r1", name: ROOM.name, health_unit: { id: "u1", name: "UBS Centro" } }, by: { name: "Téc. Ana Souza", cbo: "322205" },
    campaign_id: null, status: "active", cancel_reason: null, replaces_id: null, replaced_by_id: null,
    rnds: { status: "accepted", sent_at: "2026-09-01T09:31:00-03:00", accepted_at: "2026-09-01T09:31:05-03:00", block_reason: null, error: null },
    can_cancel: true, ...over };
}
export function card(over: Partial<VaccinationCard> = {}): VaccinationCard {
  return { patient: cardPatient(), checked: { mode: "born_after_go_live", at: "2026-07-01T00:00:00-03:00", by_name: null }, calendar_version: "2026.1",
    items: [ cardItem({ dose: { code: "D1", name: "1ª dose" }, status: "complete", due_on: "2026-09-01", applied: { id: "im1", applied_at: "2026-09-01T09:30:00-03:00", transcription: false } }),
      cardItem(), cardItem({ dose: { code: "D3", name: "3ª dose" }, status: "upcoming", due_on: "2027-01-01" }) ],
    immunizations: [ immunization() ], ...over };
}
export const vial = (over: Partial<Vial> = {}): Vial => ({ id: "v1", lot: { id: "lot15", number: "BCG2610", immunobiological_code: "15" },
  opened_at: "2026-11-02T08:00:00-03:00", expires_at: "2026-11-02T14:00:00-03:00", doses_per_vial: 10, doses_used: 3, doses_left: 7, status: "open", ...over });
export const pendingItem = (over: Partial<RndsPendingItem> = {}): RndsPendingItem => ({ immunization_id: "im2", patient_id: "pa1",
  immunobiological: { code: "42", name: PENTA.name }, applied_at: "2026-11-01T09:00:00-03:00",
  rnds: { status: "blocked", sent_at: null, accepted_at: null, block_reason: "professional_cns_not_in_cnes", error: null }, ...over });
export const vaccineRoom = (over: Partial<VaccineRoom> = {}): VaccineRoom => ({ id: "r1", name: ROOM.name, active: true,
  health_unit: { id: "u1", name: "UBS Centro" }, stock_location_id: "l5",
  staff: [ { user_id: "us1", name: "Téc. Ana Souza", role: "vaccinator", cbo: "322205" } ], ...over });
export const equipment = (over: Partial<ColdChainEquipment> = {}): ColdChainEquipment =>
  ({ id: "eq1", location_id: "l5", name: "Geladeira 1", kind: "refrigerator", min_c: 2, max_c: 8, active: true, ...over });
export const coldStatus = (over: Partial<ColdChainStatus> = {}): ColdChainStatus => ({ equipments: [ { ...equipment(), last_reading: null, readings_today: 0 } ],
  open_excursions: [], ...over });
export const monthly = (over: Partial<MonthlySummary> = {}): MonthlySummary => ({ month: "2026-10", location: { id: ROOM.id, name: ROOM.name, kind: ROOM.kind },
  rows: [ { immunobiological: { code: "15", name: "BCG" }, lot: { id: "lot15", number: "BCG2610", expires_on: "2027-03-31" },
    opening_balance: 40, received: 20, transferred_in: 0, transferred_out: 0, vials_opened: 3, doses_applied: 24, technical_loss: 6,
    physical_loss: { broken: 10 }, closing_balance: 20, vial_doses: 30, unit_doses: 0, adjustment: 0 } ], ...over });
export const vacDashboard = (over: Partial<VaccinationDashboard> = {}): VaccinationDashboard => ({ month: "2026-10", suppressed: true,
  doses_by_immunobiological: [ { immunobiological: { code: "42", name: PENTA.name }, room: { id: "r1", name: ROOM.name }, count: 31 } ],
  c2_coverage_by_team: [ { team: { id: "t1", name: "eSF Centro 1" }, eligible: 40, complete: 30 } ],
  rnds: { pending: 2, blocked: 1, rejected: 0, late: 1 }, losses: { technical: 6, physical: 10 }, unchecked_cards: 12, ...over });
