import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { SETTINGS, tfdCase, trip } from "../test/transportFixtures";

const calls: { url: string; init: RequestInit }[] = [];
function stub(body: unknown, status = 200, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }));
}
afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });
const last = () => calls[calls.length - 1];
const bodyOf = () => JSON.parse(String(last().init.body));

describe("cliente do transporte e TFD (módulo 30)", () => {
  it("viagens do dia: só data e veículo na URL; lista em { items }", async () => {
    stub({ items: [ trip() ] });
    const list = await api.listTrips({ date: "2026-11-03", vehicleId: "v1" });
    expect(last().url).toBe("/transport/trips?date=2026-11-03&vehicle_id=v1");
    expect(list[0].id).toBe("tr1");
    await api.listTrips({ date: "2026-11-03", vehicleId: null });
    expect(last().url).toBe("/transport/trips?date=2026-11-03");
  });
  it("frota: filtro ativo só quando pedido; envelope ausente vira lista vazia", async () => {
    stub({});
    expect(await api.listDrivers()).toEqual([]);
    expect(last().url).toBe("/transport/drivers");
    await api.listVehicles({ active: true });
    expect(last().url).toBe("/transport/vehicles?active=true");
  });
  it("motorista: a CNH vai no corpo, nunca na URL", async () => {
    stub({ id: "d1" }, 201);
    await api.createDriver({ user_id: "u-d1", license_number: "01234567890", license_category: "D", license_expires_on: "2028-05-10" });
    expect(last().url).toBe("/transport/drivers");
    expect(last().url).not.toContain("01234567890");
    expect(bodyOf().license_number).toBe("01234567890");
    expect((last().init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
  it("busca de pessoa pela central é POST com o CPF no corpo; vira PharmacyPerson", async () => {
    stub({ patient_id: "pt1", display_name: "Maria", has_cpf: true, cns_masked: null });
    const p = await api.lookupTransportPerson("12345678909");
    expect(last().url).toBe("/transport/person_lookup");
    expect(last().init.method).toBe("POST");
    expect(bodyOf()).toEqual({ cpf: "12345678909" });
    expect(p).toEqual({ patient_id: "pt1", display_name: "Maria", has_cpf: true, cns_masked: null, citizen_id: null, registration_id: null });
  });
  it("duplicados lêem { candidates } e ganham registration_id nulo", async () => {
    stub({ candidates: [ { patient_id: "pt1", display_name: "Maria", birth_date: "1958-04-12", has_cpf: false } ] });
    const c = await api.findTransportDuplicates({ full_name: "Maria da Silva", birth_date: "1958-04-12" });
    expect(last().url).toBe("/transport/patients/duplicates");
    expect(bodyOf()).toEqual({ full_name: "Maria da Silva", birth_date: "1958-04-12" });
    expect(c).toEqual([ { patient_id: "pt1", display_name: "Maria", birth_date: "1958-04-12", has_cpf: false, registration_id: null } ]);
  });
  it("unidades da central: GET /transport/health_units, lista em { units }", async () => {
    stub({ units: [ { id: "u1", name: "UBS Centro" } ] });
    expect(await api.listTransportHealthUnits()).toEqual([ { id: "u1", name: "UBS Centro" } ]);
    expect(last().url).toBe("/transport/health_units");
    expect(last().init.method ?? "GET").toBe("GET");
    stub({});
    expect(await api.listTransportHealthUnits()).toEqual([]);
  });
  it("atendimentos marcados: POST com tudo no corpo, sem chave vazia", async () => {
    stub({ items: [] });
    await api.findScheduledCare({ date: "2026-11-03", destinationId: null, healthUnitId: "hu1" });
    expect(last().url).toBe("/transport/scheduled_care");
    expect(last().init.method).toBe("POST");
    expect(bodyOf()).toEqual({ date: "2026-11-03", health_unit_id: "hu1" });
  });
  it("passageiro: acompanhante e documento só no corpo", async () => {
    stub({ id: "p9" }, 201);
    await api.addPassenger("tr1", { patient_id: "pt1", origin: "exception", exception_reason: "follow_up_return", stop_id: "s1",
      destination_id: "t1", takes_seat: true, wheelchair: false, companion: { name: "Joana", document: "MG1234567", reason: "idosa" } });
    expect(last().url).toBe("/transport/trips/tr1/passengers");
    expect(last().url).not.toMatch(/Joana|MG1234567/);
    expect(bodyOf().companion.document).toBe("MG1234567");
  });
  it("retirar passageiro: DELETE com motivo no corpo; o api devolve a viagem (200)", async () => {
    stub(trip({ passengers: [] }));
    const t = await api.removePassenger("tr1", "p1", "paciente desistiu da viagem");
    expect(last().url).toBe("/transport/trips/tr1/passengers/p1");
    expect(last().init.method).toBe("DELETE");
    expect(bodyOf()).toEqual({ reason: "paciente desistiu da viagem" });
    expect(t.id).toBe("tr1");
    expect(t.passengers).toEqual([]);
  });
  it("lista de passageiros em PDF por fetch, com o nome do arquivo do cabeçalho", async () => {
    stub("%PDF", 200, { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"passageiros.pdf\"" });
    const file = await api.fetchTripManifest("tr1");
    expect(last().url).toBe("/transport/trips/tr1/manifest.pdf");
    expect((last().init.headers as Record<string, string>).Accept).toBe("application/pdf");
    expect(file.filename).toBe("passageiros.pdf");
  });
  it("PDF recusado vira ApiError com o corpo", async () => {
    stub({ error: "not_found" }, 404);
    const err = await api.fetchTripManifest("tr9").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(api.ApiError);
    expect(api.errorCode(err)).toBe("not_found");
  });
  it("presença em lote e início", async () => {
    stub(trip({ status: "in_progress" }));
    await api.recordAttendance("tr1", [ { passenger_id: "p1", attendance: "boarded" } ]);
    expect(last().url).toBe("/transport/my_trips/tr1/attendance");
    expect(bodyOf()).toEqual({ items: [ { passenger_id: "p1", attendance: "boarded" } ] });
    await api.startMyTrip("tr1");
    expect(last().url).toBe("/transport/my_trips/tr1/start");
    expect(bodyOf()).toEqual({});
  });
  it("série: suspensão com data e motivo no corpo", async () => {
    stub({ id: "se1" });
    await api.suspendSeries("se1", { from_on: "2026-11-10", reason: "paciente internado no hospital" });
    expect(last().url).toBe("/transport/series/se1/suspend");
    expect(bodyOf()).toEqual({ from_on: "2026-11-10", reason: "paciente internado no hospital" });
  });
  it("regras da cidade: GET e PATCH em /transport/admin/settings", async () => {
    stub(SETTINGS);
    const s = await api.getTransportSettings();
    expect(last().url).toBe("/transport/admin/settings");
    expect(s.allowance_codes.find((c) => c.code === "0803010125")?.kind).toBe("ground_km");
    await api.updateTransportSettings({ tfd_min_distance_km: 60 });
    expect(last().init.method).toBe("PATCH");
    expect(bodyOf()).toEqual({ tfd_min_distance_km: 60 });
  });
  it("TFD: prefill só com o id da consulta; laudo e decisão no corpo", async () => {
    stub({ patient_id: "pt1", cid10: null, sigtap_code: null });
    await api.getTfdPrefill("co1");
    expect(last().url).toBe("/tfd/prefill?consultation_id=co1");
    stub(tfdCase());
    await api.decideTfdCase("c1", { decision: "deny", reason: "destino a menos de 50 km" });
    expect(last().url).toBe("/tfd/cases/c1/decide");
    expect(bodyOf()).toEqual({ decision: "deny", reason: "destino a menos de 50 km" });
    await api.readTfdCase("c1");
    expect(last().url).toBe("/tfd/cases/c1/read");
    expect(last().init.method).toBe("POST");
    await api.cancelTfdCase("c1", "paciente desistiu do tratamento");
    expect(last().url).toBe("/tfd/cases/c1/cancel");
    expect(bodyOf()).toEqual({ reason: "paciente desistiu do tratamento" });
  });
  it("fila da comissão: situação e cursor na URL; meus pedidos em { items } sem cursor", async () => {
    stub({ items: [], next_before: null });
    const page = await api.listTfdCases({ status: "submitted", before: "abc" });
    expect(last().url).toBe("/tfd/cases?status=submitted&before=abc");
    expect(page).toEqual({ items: [], next_before: null });
    await api.listTfdCases({ status: null, before: null });
    expect(last().url).toBe("/tfd/cases");
    stub({ items: [ { id: "c1", patient: { display_name: "Maria" }, destination: { name: "Curitiba" }, status: "draft", submitted_at: null } ] });
    const mine = await api.listMyTfdCases();
    expect(last().url).toBe("/tfd/my_cases");
    expect(mine[0].status).toBe("draft");
  });
  it("ajuda de custo: { items, total_cents }", async () => {
    stub({ items: [], total_cents: 0 });
    const a = await api.listTfdAllowances("c1");
    expect(last().url).toBe("/tfd/cases/c1/allowances");
    expect(a).toEqual({ items: [], total_cents: 0 });
  });
  it("prestação de contas em base64, sem o nome do arquivo (D11)", async () => {
    stub(tfdCase({ status: "completed" }));
    const file = new File([ new Uint8Array([ 137, 80, 78, 71 ]) ], "comprovante-maria.png", { type: "image/png" });
    await api.uploadTfdAccountability("c1", file);
    expect(last().url).toBe("/tfd/cases/c1/accountability");
    const sent = bodyOf();
    expect(Object.keys(sent).sort()).toEqual([ "content_type", "data" ]);
    expect(sent.content_type).toBe("image/png");
    expect(sent.data).toBe("iVBORw==");
    expect(JSON.stringify(sent)).not.toContain("comprovante-maria");
  });
  it("painel: mês na URL; lt5 chega como string e ocupação como número ou nulo", async () => {
    stub({ month: "2026-11", trips: "lt5", occupancy_pct: null, no_shows: 7, km: 1200, fuel_cents: 50000, tfd_by_status: { submitted: "lt5" },
      tfd_paid_cents: 0, exceptions: 0 });
    const d = await api.getTransportDashboard("2026-11");
    expect(last().url).toBe("/transport/dashboard?month=2026-11");
    expect(d.trips).toBe("lt5");
    expect(d.occupancy_pct).toBeNull();
    expect(d.tfd_by_status.submitted).toBe("lt5");
  });
});
