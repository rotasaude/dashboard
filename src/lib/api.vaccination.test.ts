import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRoomStaff, cancelImmunization, closeOutVial, confirmCardComplete, createColdChainCentral, createEquipment, createVaccineRoom,
  decideExcursion, findVaccinationDuplicates, getColdChainStatus, getImmunization, getMonthlySummary, getVaccinationCard,
  getVaccinationCatalog, getVaccinationDashboard, getVaccinationSettings, listEquipments, listMyVaccineLocations, listRndsPending,
  listVaccineRooms, listVials, lookupVaccinationPerson, notifyEsavi, openVial, recordImmunization, recordReading, recordTranscriptions,
  recordVaccineOpening, recordVaccineReceipt, removeRoomStaff, setRndsCredential, updateVaccinationSettings, updateVaccineRoom
} from "./api";

function ok(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
// CPF, nome, vacina, dose, lote, motivo, senha e certificado nunca na URL.
const SENSITIVE = /12345678909|Joana|Penta|BCG|D1|PNT2611|febre alta|desistiu|s3nh4|TUlJ|2001234/i;
const IMM = { patient_id: "pa1", immunobiological_code: "42", dose_code: "D1", strategy: "1", care_group: "1", route: "IM", site: "VLD",
  applied_at: "2026-11-02T10:00:00-03:00", lot_id: "lot9" };

describe("cliente da sala de vacina (contrato §3–§11, §15)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(() => ok({})); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => (fetchMock.mock.calls[i][1] ?? {}) as RequestInit;
  const bodyOf = (i = 0) => JSON.parse(String(initOf(i).body));
  const writeOf = (i = 0) => [ urlOf(i).pathname, initOf(i).method, (initOf(i).headers as Record<string, string>)["Content-Type"] ];

  it("locais, catálogo e pessoa: envelopes e corpo (busca e duplicados na rota da sala, V3/V21)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ locations: [ { id: "l5" } ] }));
    expect(await listMyVaccineLocations()).toEqual([ { id: "l5" } ]);
    expect(urlOf(0).pathname).toBe("/vaccination/my_locations");
    await getVaccinationCatalog();
    expect(urlOf(1).pathname).toBe("/vaccination/catalog");
    fetchMock.mockImplementationOnce(() => ok({ patient_id: "pa1", display_name: "Joana Lima", has_cpf: true, cns_masked: null }));
    expect(await lookupVaccinationPerson("r1", "12345678909")).toEqual(
      { patient_id: "pa1", display_name: "Joana Lima", has_cpf: true, cns_masked: null, citizen_id: null, registration_id: null });
    expect([ ...writeOf(2), bodyOf(2) ]).toEqual([ "/vaccination/rooms/r1/person_lookup", "POST", "application/json", { cpf: "12345678909" } ]);
    expect(await findVaccinationDuplicates("r1", { full_name: "Joana Lima", birth_date: "2023-05-01" })).toEqual([]);
    expect(writeOf(3)).toEqual([ "/vaccination/rooms/r1/patients/duplicates", "POST", "application/json" ]);
    fetchMock.mockImplementationOnce(() => ok({ candidates: [ { patient_id: "pa2", display_name: "J", birth_date: "2023-05-01", has_cpf: false } ] }));
    expect(await findVaccinationDuplicates("r1", { full_name: "Joana Lima", birth_date: "2023-05-01" })).toEqual(
      [ { patient_id: "pa2", display_name: "J", birth_date: "2023-05-01", has_cpf: false, registration_id: null } ]);
  });

  it("caderneta, conferência, dose, transcrição e cancelamento", async () => {
    await getVaccinationCard("r1", { patient_id: "pa1" });
    expect([ ...writeOf(0), bodyOf(0) ]).toEqual([ "/vaccination/rooms/r1/card", "POST", "application/json", { patient_id: "pa1" } ]);
    await confirmCardComplete("r1", "pa1");
    expect([ ...writeOf(1), bodyOf(1) ]).toEqual([ "/vaccination/rooms/r1/checks", "POST", "application/json",
      { patient_id: "pa1", mode: "confirmed_complete" } ]);
    await recordImmunization("r1", { ...IMM, vial_id: "v1", override_reason: "atraso por internação longa" });
    expect([ ...writeOf(2), bodyOf(2) ]).toEqual([ "/vaccination/rooms/r1/immunizations", "POST", "application/json",
      { ...IMM, vial_id: "v1", override_reason: "atraso por internação longa" } ]);
    fetchMock.mockImplementationOnce(() => ok({ immunizations: [ { id: "im1" } ], card: { items: [] } }, 201));
    const t = { patient_id: "pa1", items: [ { immunobiological_code: "15", dose_code: "D1", applied_on: "2023-05-02" } ], close_check: true };
    expect(await recordTranscriptions("r1", t)).toEqual({ immunizations: [ { id: "im1" } ], card: { items: [] } });
    expect([ ...writeOf(3), bodyOf(3) ]).toEqual([ "/vaccination/rooms/r1/transcriptions", "POST", "application/json", t ]);
    await cancelImmunization("im1", { reason: "lote errado digitado na sala", replacement: IMM });
    expect([ ...writeOf(4), bodyOf(4) ]).toEqual([ "/vaccination/immunizations/im1/cancel", "POST", "application/json",
      { reason: "lote errado digitado na sala", replacement: IMM } ]);
    await getImmunization("im1");
    expect(urlOf(5).pathname).toBe("/vaccination/immunizations/im1");
  });

  it("recém-nascido sem cadastro: new_patient e duplicates_reviewed vão no corpo do card (V3)", async () => {
    const req = { new_patient: { full_name: "Joana Lima", birth_date: "2026-10-30", sex: "female" as const }, duplicates_reviewed: true };
    await getVaccinationCard("r1", req);
    expect(bodyOf(0)).toEqual(req);
    expect(urlOf(0).search).toBe("");
  });

  it("pendências (items, counts, cursor) e frascos: só ids, status e cursor na URL", async () => {
    fetchMock.mockImplementationOnce(() => ok({ items: [ { immunization_id: "im1" } ], counts: { blocked: 1, rejected: 0, failed: 2, late: 3 }, next_before: "c1" }));
    expect(await listRndsPending("r1", "c0")).toEqual({ items: [ { immunization_id: "im1" } ],
      counts: { blocked: 1, rejected: 0, failed: 2, late: 3 }, next_before: "c1" });
    expect([ urlOf(0).pathname, Object.fromEntries(urlOf(0).searchParams) ]).toEqual([ "/vaccination/rooms/r1/pending", { before: "c0", limit: "50" } ]);
    expect(await listRndsPending("r1", null)).toEqual({ items: [], counts: { blocked: 0, rejected: 0, failed: 0, late: 0 }, next_before: null });
    expect(Object.fromEntries(urlOf(1).searchParams)).toEqual({ limit: "50" });
    await openVial("r1", "lot9");
    expect([ ...writeOf(2), bodyOf(2) ]).toEqual([ "/vaccination/rooms/r1/vials", "POST", "application/json", { lot_id: "lot9" } ]);
    fetchMock.mockImplementationOnce(() => ok({ vials: [ { id: "v1" } ] }));
    expect(await listVials("r1", "open")).toEqual([ { id: "v1" } ]);
    expect([ urlOf(3).pathname, Object.fromEntries(urlOf(3).searchParams) ]).toEqual([ "/vaccination/rooms/r1/vials", { status: "open" } ]);
    expect(await listVials("r1", null)).toEqual([]);
    expect(urlOf(4).search).toBe("");
    await closeOutVial("v1", "frasco caiu e trincou");
    expect([ ...writeOf(5), bodyOf(5) ]).toEqual([ "/vaccination/vials/v1/close_out", "POST", "application/json", { reason: "frasco caiu e trincou" } ]);
  });

  it("resumo mensal da sala e da rede de frio", async () => {
    await getMonthlySummary({ roomId: "r1" }, "2026-10");
    expect([ urlOf(0).pathname, Object.fromEntries(urlOf(0).searchParams) ]).toEqual([ "/vaccination/rooms/r1/monthly_summary", { month: "2026-10" } ]);
    await getMonthlySummary({ central: true }, "2026-10");
    expect(urlOf(1).pathname).toBe("/vaccination/cold_chain_central/monthly_summary");
  });

  it("cadeia de frio: equipamentos, leitura, conduta e situação", async () => {
    fetchMock.mockImplementationOnce(() => ok({ equipments: [ { id: "eq1" } ] }));
    expect(await listEquipments("l5")).toEqual([ { id: "eq1" } ]);
    expect(Object.fromEntries(urlOf(0).searchParams)).toEqual({ location_id: "l5" });
    const eq = { location_id: "l5", name: "Geladeira 1", kind: "refrigerator", min_c: 2, max_c: 8, active: true };
    await createEquipment(eq);
    expect([ ...writeOf(1), bodyOf(1) ]).toEqual([ "/vaccination/cold_chain/equipments", "POST", "application/json", eq ]);
    await (await import("./api")).updateEquipment("eq1", eq);
    expect(writeOf(2)).toEqual([ "/vaccination/cold_chain/equipments/eq1", "PATCH", "application/json" ]);
    const r = { read_at: "2026-11-02T08:00:00-03:00", current_c: 8.5, min_c: 3, max_c: 9 };
    await recordReading("eq1", r);
    expect([ ...writeOf(3), bodyOf(3) ]).toEqual([ "/vaccination/cold_chain/equipments/eq1/readings", "POST", "application/json", r ]);
    const lots = [ { lot_id: "lot9", decision: "discard" as const, reason: "febre alta do equipamento por 6 horas" } ];
    await decideExcursion("ex1", lots);
    expect([ ...writeOf(4), bodyOf(4) ]).toEqual([ "/vaccination/cold_chain/excursions/ex1/decide", "POST", "application/json", { lots } ]);
    expect(await getColdChainStatus("l5")).toEqual({ equipments: [], open_excursions: [] });
    expect([ urlOf(5).pathname, Object.fromEntries(urlOf(5).searchParams) ]).toEqual([ "/vaccination/cold_chain/status", { location_id: "l5" } ]);
  });

  it("ESAVI (200 existing ou 201) e painel", async () => {
    fetchMock.mockImplementationOnce(() => ok({ notification_id: "n1", existing: true }));
    expect(await notifyEsavi("im1")).toEqual({ notification_id: "n1", existing: true });
    expect([ ...writeOf(0), bodyOf(0) ]).toEqual([ "/vaccination/immunizations/im1/esavi", "POST", "application/json", {} ]);
    await getVaccinationDashboard({ month: "2026-10", healthUnitId: "u1" });
    expect([ urlOf(1).pathname, Object.fromEntries(urlOf(1).searchParams) ]).toEqual([ "/vaccination/dashboard", { month: "2026-10", health_unit_id: "u1" } ]);
    await getVaccinationDashboard({ month: "2026-10", healthUnitId: null });
    expect(Object.fromEntries(urlOf(2).searchParams)).toEqual({ month: "2026-10" });
  });

  it("administração: salas, equipe, rede de frio (com nome) e go-live", async () => {
    fetchMock.mockImplementationOnce(() => ok({ rooms: [ { id: "r1" } ] }));
    expect(await listVaccineRooms()).toEqual({ rooms: [ { id: "r1" } ], cold_chain_central: null });
    await createVaccineRoom({ health_unit_id: "u1", name: "Sala UBS Centro", active: true });
    expect([ ...writeOf(1), bodyOf(1) ]).toEqual([ "/vaccination/admin/rooms", "POST", "application/json", { health_unit_id: "u1", name: "Sala UBS Centro", active: true } ]);
    await updateVaccineRoom("r1", { health_unit_id: "u1", name: "Sala UBS Centro", active: false });
    expect(writeOf(2)).toEqual([ "/vaccination/admin/rooms/r1", "PATCH", "application/json" ]);
    await addRoomStaff("r1", "us7", "room_lead");
    expect([ ...writeOf(3), bodyOf(3) ]).toEqual([ "/vaccination/admin/rooms/r1/staff", "POST", "application/json", { user_id: "us7", role: "room_lead" } ]);
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));
    await removeRoomStaff("r1", "us7", "room_lead");
    expect([ ...writeOf(4), bodyOf(4) ]).toEqual([ "/vaccination/admin/rooms/r1/staff", "DELETE", "application/json", { user_id: "us7", role: "room_lead" } ]);
    await createColdChainCentral("Rede de frio municipal");
    expect([ ...writeOf(5), bodyOf(5) ]).toEqual([ "/vaccination/admin/cold_chain_central", "POST", "application/json", { name: "Rede de frio municipal" } ]);
    await getVaccinationSettings();
    await updateVaccinationSettings({ go_live_on: "2026-12-01" });
    expect([ ...writeOf(7), bodyOf(7) ]).toEqual([ "/vaccination/admin/settings", "PATCH", "application/json", { go_live_on: "2026-12-01" } ]);
  });

  it("credencial RNDS: arquivo em base64, senha e CNES só no corpo do PUT (D1)", async () => {
    await setRndsCredential(new Blob([ "MII" ], { type: "application/x-pkcs12" }), "s3nh4", "2001234");
    expect([ ...writeOf(0), bodyOf(0) ]).toEqual([ "/integrations/credentials/rnds", "PUT", "application/json",
      { pfx_base64: "TUlJ", pfx_password: "s3nh4", requester_cnes: "2001234" } ]);
  });

  it("entrada e inventário inicial de imunobiológico pelas rotas do 27a, fabricante por key (D6, V19)", async () => {
    const item = { immunobiological_code: "42", manufacturer_key: "serum", lot_number: "PNT2611", expires_on: "2027-03-31", quantity: "100",
      package: { units_per_package: 1, packages: 100 } };
    await recordVaccineReceipt({ location_id: "l9", document: { kind: "invoice", number: "NF 88", supplier: "SESA-PR" }, items: [ item ] });
    expect([ ...writeOf(0), bodyOf(0).items ]).toEqual([ "/pharmacy/receipts", "POST", "application/json", [ item ] ]);
    await recordVaccineOpening({ location_id: "l9", items: [ item ] });
    expect(writeOf(1)).toEqual([ "/pharmacy/openings", "POST", "application/json" ]);
  });

  it("nada pessoal ou clínico na URL", async () => {
    await lookupVaccinationPerson("r1", "12345678909");
    await getVaccinationCard("r1", { new_patient: { full_name: "Joana Lima", birth_date: "2023-05-01", sex: "female" } });
    await recordImmunization("r1", { ...IMM, override_reason: "febre alta na última dose" });
    await cancelImmunization("im1", { reason: "paciente desistiu, dose registrada por engano" });
    await setRndsCredential(new Blob([ "MII" ]), "s3nh4", "2001234");
    for (const call of fetchMock.mock.calls) expect(decodeURIComponent(String(call[0]))).not.toMatch(SENSITIVE);
  });
});
