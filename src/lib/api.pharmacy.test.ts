import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addLocationStaff, approveAdjustment, createAdminLocation, createExternalPrescription, findPharmacyDuplicates, getMinimums, getPharmacyAlerts,
  getPharmacySettings, listAdjustments, listAdminLocations, listDispensations, listLotMovements, listMyPharmacyLocations, listPositions,
  listTransfers, lookupPharmacyPerson, lookupPrescriptions, putMinimums, receiveTransfer, recordAdjustment, recordDispensation, recordOpening,
  recordReceipt, recordReturn, rejectAdjustment, removeLocationStaff, searchPharmacyItems, sendTransfer, updateAdminLocation, updatePharmacySettings
} from "./api";

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
}
// Código da receita, CPF, nome, profissional, posologia, motivo e número de notificação: nunca em URL.
const SENSITIVE = /ABCDE|23456|12345678909|Joana|Helena|cápsula de 8|quebra|contagem|B1-0042|retid|frasco devolvido/i;
const ITEM = { catalog_item_id: "ci1", lot_number: "AMX2611", expires_on: "2026-11-20", quantity: "300", package: { units_per_package: 30, packages: 10 } };

describe("cliente da farmácia (contrato §3–§9)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(() => ok({})); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => (fetchMock.mock.calls[i][1] ?? {}) as RequestInit;
  const bodyOf = (i = 0) => JSON.parse(String(initOf(i).body));
  const writeOf = (i = 0) => [ urlOf(i).pathname, initOf(i).method, (initOf(i).headers as Record<string, string>)["Content-Type"] ];

  it("locais, equipe, configurações e mínimos: envelopes e JSON em toda escrita", async () => {
    fetchMock.mockImplementationOnce(() => ok({ locations: [ { id: "l2" } ] })).mockImplementationOnce(() => ok({}));
    expect(await listMyPharmacyLocations()).toEqual([ { id: "l2" } ]);
    expect(urlOf(0).pathname).toBe("/pharmacy/locations");
    expect(await listAdminLocations()).toEqual([]);
    expect(urlOf(1).pathname).toBe("/pharmacy/admin/locations");
    await createAdminLocation({ kind: "unit", health_unit_id: "u1", name: "Farmácia UBS Centro", active: true });
    expect(writeOf(2)).toEqual([ "/pharmacy/admin/locations", "POST", "application/json" ]);
    expect(bodyOf(2)).toEqual({ kind: "unit", health_unit_id: "u1", name: "Farmácia UBS Centro", active: true });
    await updateAdminLocation("l2", { kind: "unit", health_unit_id: "u1", name: "Farmácia UBS Centro", active: false });
    expect(writeOf(3)).toEqual([ "/pharmacy/admin/locations/l2", "PATCH", "application/json" ]);
    await addLocationStaff("l2", "u-9", "pharmacist");
    expect([ ...writeOf(4), bodyOf(4) ]).toEqual([ "/pharmacy/admin/locations/l2/staff", "POST", "application/json", { user_id: "u-9", role: "pharmacist" } ]);
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));
    await removeLocationStaff("l2", "u-9", "pharmacist");
    expect([ ...writeOf(5), bodyOf(5) ]).toEqual([ "/pharmacy/admin/locations/l2/staff", "DELETE", "application/json", { user_id: "u-9", role: "pharmacist" } ]);
    await getPharmacySettings();
    expect(urlOf(6).pathname).toBe("/pharmacy/admin/settings");
    const S = { common_validity_days: 30, continuous_validity_days: 180, continuous_interval_days: 25, expiry_alert_days: 90, adjustment_approval_percent: 10 };
    await updatePharmacySettings(S);
    expect([ ...writeOf(7), bodyOf(7) ]).toEqual([ "/pharmacy/admin/settings", "PATCH", "application/json", S ]);
    fetchMock.mockImplementationOnce(() => ok({ minimums: [ { catalog_item_id: "ci1", minimum: "50" } ] }));
    expect(await getMinimums("l2")).toEqual([ { catalog_item_id: "ci1", minimum: "50" } ]);
    expect(urlOf(8).pathname).toBe("/pharmacy/locations/l2/minimums");
    await putMinimums("l2", [ { catalog_item_id: "ci1", minimum: "60" } ]);
    expect([ ...writeOf(9), bodyOf(9) ]).toEqual([ "/pharmacy/locations/l2/minimums", "PUT", "application/json", { minimums: [ { catalog_item_id: "ci1", minimum: "60" } ] } ]);
  });

  it("busca no catálogo no corpo; entrada e abertura com a forma do §4", async () => {
    fetchMock.mockImplementationOnce(() => ok({ items: [ { catalog_item_id: "ci1" } ] }));
    expect(await searchPharmacyItems("amox")).toEqual([ { catalog_item_id: "ci1" } ]);
    expect([ ...writeOf(0), urlOf(0).search, bodyOf(0) ]).toEqual([ "/pharmacy/items/search", "POST", "application/json", "", { q: "amox" } ]);
    const RECEIPT = { location_id: "l1", document: { kind: "invoice" as const, number: "NF 1234", supplier: "Distribuidora Sul" }, items: [ ITEM ] };
    await recordReceipt(RECEIPT);
    expect([ ...writeOf(1), bodyOf(1) ]).toEqual([ "/pharmacy/receipts", "POST", "application/json", RECEIPT ]);
    await recordOpening({ location_id: "l2", items: [ ITEM ] });
    expect([ ...writeOf(2), bodyOf(2) ]).toEqual([ "/pharmacy/openings", "POST", "application/json", { location_id: "l2", items: [ ITEM ] } ]);
  });

  it("posição: só os filtros que vieram, com limite; extrato do lote pelo local", async () => {
    fetchMock.mockImplementationOnce(() => ok({ positions: [ { balance: "30" } ], next_before: "c1" }));
    expect(await listPositions({ locationId: "l2", q: "amox", expiring: true, belowMinimum: false, catalogItemId: null, before: "c0" }))
      .toEqual({ positions: [ { balance: "30" } ], next_before: "c1" });
    expect(urlOf(0).pathname).toBe("/pharmacy/positions");
    expect(Object.fromEntries(urlOf(0).searchParams)).toEqual({ location_id: "l2", q: "amox", expiring: "true", below_minimum: "false", before: "c0", limit: "50" });
    expect(await listPositions({ catalogItemId: "ci1" })).toEqual({ positions: [], next_before: null });
    expect(Object.fromEntries(urlOf(1).searchParams)).toEqual({ catalog_item_id: "ci1", limit: "50" });
    expect(await listLotMovements("lot1", "l2", null)).toEqual({ movements: [], next_before: null });
    expect([ urlOf(2).pathname, Object.fromEntries(urlOf(2).searchParams) ]).toEqual([ "/pharmacy/lots/lot1/movements", { location_id: "l2", limit: "50" } ]);
  });

  it("transferências e ajustes", async () => {
    await sendTransfer({ to_location_id: "l2", items: [ { lot_id: "lot1", quantity: "100" } ] });
    expect([ ...writeOf(0), bodyOf(0) ]).toEqual([ "/pharmacy/transfers", "POST", "application/json", { to_location_id: "l2", items: [ { lot_id: "lot1", quantity: "100" } ] } ]);
    await receiveTransfer("t1", { items: [ { lot_id: "lot1", quantity_received: "90", reason: "uma caixa chegou quebrada" } ] });
    expect([ ...writeOf(1), bodyOf(1).items[0].quantity_received ]).toEqual([ "/pharmacy/transfers/t1/receive", "POST", "application/json", "90" ]);
    expect(await listTransfers({ locationId: "l2", status: "sent" })).toEqual({ transfers: [], next_before: null });
    expect(Object.fromEntries(urlOf(2).searchParams)).toEqual({ location_id: "l2", status: "sent", limit: "50" });
    await recordAdjustment({ location_id: "l2", lot_id: "lot1", kind: "adjustment", counted_quantity: "20", reason: "contagem do fim do mês" });
    expect([ ...writeOf(3), bodyOf(3).counted_quantity ]).toEqual([ "/pharmacy/adjustments", "POST", "application/json", "20" ]);
    await approveAdjustment("a1");
    expect([ ...writeOf(4), bodyOf(4) ]).toEqual([ "/pharmacy/adjustments/a1/approve", "POST", "application/json", {} ]);
    await rejectAdjustment("a1", "contagem refeita, saldo confere");
    expect([ ...writeOf(5), bodyOf(5) ]).toEqual([ "/pharmacy/adjustments/a1/reject", "POST", "application/json", { reason: "contagem refeita, saldo confere" } ]);
    expect(await listAdjustments({ locationId: "l2", status: "pending" })).toEqual({ adjustments: [], next_before: null });
    expect([ urlOf(6).pathname, Object.fromEntries(urlOf(6).searchParams) ]).toEqual([ "/pharmacy/adjustments", { location_id: "l2", status: "pending", limit: "50" } ]);
  });

  it("dispensação: receita pelo código ou paciente, externa, dispensar e histórico", async () => {
    fetchMock.mockImplementationOnce(() => ok({ prescriptions: [ { id: "doc1" } ] }));
    expect(await lookupPrescriptions({ location_id: "l2", short_code: "ABCDE23456" })).toEqual([ { id: "doc1" } ]);
    expect([ ...writeOf(0), urlOf(0).search, bodyOf(0) ]).toEqual([ "/pharmacy/prescriptions/lookup", "POST", "application/json", "", { location_id: "l2", short_code: "ABCDE23456" } ]);
    expect(await lookupPrescriptions({ location_id: "l2", patient_id: "pa1" })).toEqual([]);
    const EXT = { patient_id: "pa1", prescriber: { name: "Dra. Helena Prado", council: "CRM", council_state: "PR", council_number: "12345" }, issued_on: "2026-10-28",
      items: [ { catalog_item_id: "ci1", quantity: "21", quantity_unit: "cápsula", dosage_instructions: "1 cápsula de 8 em 8 horas", continuous: false } ] };
    await createExternalPrescription(EXT);
    expect([ ...writeOf(2), bodyOf(2) ]).toEqual([ "/pharmacy/external_prescriptions", "POST", "application/json", EXT ]);
    const DISP = { location_id: "l2", prescription: { kind: "digital" as const, id: "doc1" }, items: [ { prescription_item_id: "pi1", lot_id: "lot1", quantity: "21", complete: true } ],
      retention: {} };
    await recordDispensation(DISP);
    expect([ ...writeOf(3), bodyOf(3) ]).toEqual([ "/pharmacy/dispensations", "POST", "application/json", DISP ]);
    expect(await listDispensations("pa1", "c0")).toEqual({ dispensations: [], next_before: null });
    expect([ urlOf(4).pathname, Object.fromEntries(urlOf(4).searchParams) ]).toEqual([ "/pharmacy/dispensations", { patient_id: "pa1", before: "c0", limit: "50" } ]);
  });

  it("escritas devolvem o objeto sem envelope (emenda H12)", async () => {
    fetchMock.mockImplementation(() => ok({ id: "x1", kind: "invoice", items: [] }));
    expect((await recordReceipt({ location_id: "l1", document: { kind: "invoice", number: "NF 1", supplier: "Sul" }, items: [ ITEM ] })).id).toBe("x1");
    expect((await sendTransfer({ to_location_id: "l2", items: [ { lot_id: "lot1", quantity: "1" } ] })).id).toBe("x1");
    expect((await approveAdjustment("a1")).id).toBe("x1");
    expect((await addLocationStaff("l2", "u-9", "stock_keeper")).id).toBe("x1");
  });

  it("devolução: item dispensado, quantidade e motivo só no corpo", async () => {
    fetchMock.mockImplementationOnce(() => ok({ id: "dp1", items: [ { id: "di1", returned_total: "5.00" } ] }));
    const returned = await recordReturn({ location_id: "l2", dispensation_item_id: "di1", quantity: "5", reason: "frasco devolvido fechado e lacrado" });
    expect(returned.id).toBe("dp1");
    expect([ ...writeOf(0), urlOf(0).search, bodyOf(0) ]).toEqual([
      "/pharmacy/returns", "POST", "application/json", "",
      { location_id: "l2", dispensation_item_id: "di1", quantity: "5", reason: "frasco devolvido fechado e lacrado" }
    ]);
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).not.toMatch(SENSITIVE);
  });

  it("pessoa e alertas: busca no corpo; listas ausentes viram vazias", async () => {
    fetchMock.mockImplementationOnce(() => ok({ patient_id: "pa1", display_name: "Joana Lima", has_cpf: true, cns_masked: null }))
      .mockImplementationOnce(() => ok({ candidates: [ { patient_id: "pa1", display_name: "Joana Lima", birth_date: "1980-02-03", has_cpf: false } ] }))
      .mockImplementationOnce(() => ok({ expiring: 2 }));
    const person = await lookupPharmacyPerson("12345678909");
    expect([ person.patient_id, person.citizen_id, person.registration_id ]).toEqual([ "pa1", null, null ]);
    expect([ ...writeOf(0), bodyOf(0) ]).toEqual([ "/pharmacy/person_lookup", "POST", "application/json", { cpf: "12345678909" } ]);
    expect((await findPharmacyDuplicates({ full_name: "Joana Lima", birth_date: "1980-02-03" }))[0].registration_id).toBeNull();
    expect(urlOf(1).pathname).toBe("/pharmacy/patients/duplicates");
    expect(await getPharmacyAlerts("l2")).toEqual({ expiring: 2, expired: 0, below_minimum: 0, in_transit: 0, pending_adjustments: 0 });
    expect([ urlOf(2).pathname, urlOf(2).search ]).toEqual([ "/pharmacy/alerts", "?location_id=l2" ]);
  });

  it("nada sensível na URL: código, CPF, nome, receita, motivo e notificação só no corpo", async () => {
    await lookupPrescriptions({ location_id: "l2", short_code: "ABCDE23456" });
    await lookupPharmacyPerson("12345678909");
    await createExternalPrescription({ patient_id: "pa1", prescriber: { name: "Dra. Helena Prado", council: "CRM", council_state: "PR", council_number: "12345" },
      issued_on: "2026-10-28", notification_number: "B1-0042", items: [ { catalog_item_id: "ci2", quantity: "30", quantity_unit: "comprimido",
        dosage_instructions: "1 cápsula de 8 em 8 horas", continuous: true } ] });
    await recordDispensation({ location_id: "l2", prescription: { kind: "external", id: "ex1" }, items: [ { prescription_item_id: "pi1", lot_id: "lot1", quantity: "30" } ],
      retention: {} });
    await receiveTransfer("t1", { items: [ { lot_id: "lot1", quantity_received: "90", reason: "uma caixa chegou quebrada" } ] });
    await recordAdjustment({ location_id: "l2", lot_id: "lot1", kind: "loss", quantity: "2", reason: "contagem: frasco retido quebrado" });
    for (const call of fetchMock.mock.calls) expect(decodeURIComponent(String(call[0]))).not.toMatch(SENSITIVE);
  });
});
