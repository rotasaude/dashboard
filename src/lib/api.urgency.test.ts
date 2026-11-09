import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, callAttendance, callForClassification, callNext, classifyUrgency, createCallLocation, createPairingCode,
  createUrgencyArrival, createWaitingRoomDisplay, fetchWaitingRoomBoard, finalizeConsultation, getUrgencyDashboard,
  getUrgencyEncounter, getUrgencyQueue, identifyUrgencyPatient, listCallLocations, listCounterReferrals,
  listProvisionalEncounters, listWaitingRoomDisplays, lookupUrgencyPerson, pairWaitingRoomDisplay, recallAttendance,
  recordUrgencyOutcome, revokeWaitingRoomDisplay, startConsultation, suggestUrgencyColor, updateCallLocation, updateUnit,
  updateWaitingRoomDisplay
} from "./api";
import { EMPTY_ADDRESS as ADDRESS } from "./unitAddress";
import {
  board, counterReferral, dashboard, encounter, provisionalEncounter, queue, suggestion, waitingRoomDisplay
} from "../test/urgencyFixtures";

// fetch falso: devolve `next` (ou a falha marcada por failNext) e guarda cada chamada.
const seen: { url: string; init: RequestInit }[] = [];
let next: unknown = {};
let failure: { status: number; body: unknown } | null = null;
beforeEach(() => {
  next = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    if (failure) {
      const f = failure;
      failure = null;
      return new Response(JSON.stringify(f.body), { status: f.status, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { seen.length = 0; failure = null; vi.unstubAllGlobals(); });
const respond = (body: unknown) => { next = body; };
const failNext = (status: number, body: unknown) => { failure = { status, body }; };
const calls = () => seen.map(({ url, init }) => ({
  url, method: init.method ?? "GET", body: init.body === undefined ? undefined : JSON.parse(String(init.body))
}));
const lastCall = () => calls()[calls().length - 1];
const lastInit = () => seen[seen.length - 1].init;

describe("cliente da urgência (módulo 32a)", () => {
  it("busca de pessoa e chegada: tudo no corpo, nada na URL", async () => {
    await lookupUrgencyPerson({ cpf: "52998224725" });
    expect(lastCall()).toEqual({ url: "/urgency/person_lookup", method: "POST", body: { cpf: "52998224725" } });
    await createUrgencyArrival({ health_unit_id: "upa1", unidentified: { description: "homem, cerca de 40 anos, achado na rodoviária" } });
    expect(lastCall().url).toBe("/urgency/arrivals");
    expect(lastCall().body).toEqual({ health_unit_id: "upa1", unidentified: { description: "homem, cerca de 40 anos, achado na rodoviária" } });
    await createUrgencyArrival({
      health_unit_id: "upa1", duplicates_reviewed: true,
      new_patient: { full_name: "Maria Lima", birth_date: "1980-03-02", sex: "female", cpf: "52998224725" }
    });
    expect(lastCall().body).toMatchObject({ duplicates_reviewed: true, new_patient: { full_name: "Maria Lima" } });
    for (const c of calls()) expect(c.url).not.toMatch(/52998224725|rodovi|Maria/);
  });

  it("fila e painel: só ids e mês na URL", async () => {
    respond(queue());
    expect((await getUrgencyQueue("upa1")).by_color[0].classified_at).toBe("2026-11-05T09:33:00-03:00");
    expect(lastCall()).toEqual({ url: "/urgency/queue?health_unit_id=upa1", method: "GET", body: undefined });
    respond(dashboard());
    const panel = await getUrgencyDashboard({ month: "2026-11", unitId: null });
    expect(lastCall().url).toBe("/urgency/dashboard?month=2026-11");
    expect(panel.by_outcome).not.toHaveProperty("registered_in_error");
    await getUrgencyDashboard({ month: "2026-11", unitId: "upa1" });
    expect(lastCall().url).toBe("/urgency/dashboard?month=2026-11&health_unit_id=upa1");
  });

  it("detalhe desembrulha { encounter }; as escritas devolvem o envelope", async () => {
    respond({ encounter: encounter({ state: "classified", color: "yellow" }) });
    expect((await getUrgencyEncounter("en1")).color).toBe("yellow");
    expect(lastCall()).toEqual({ url: "/urgency/encounters/en1", method: "GET", body: undefined });

    respond(suggestion());
    await suggestUrgencyColor({ encounter_id: "en1", complaint: "febre", vital_signs: { temperature_c: 39.4 }, pain_scale: 5 });
    expect(lastCall()).toEqual({
      url: "/urgency/suggest", method: "POST",
      body: { encounter_id: "en1", complaint: "febre", vital_signs: { temperature_c: 39.4 }, pain_scale: 5 }
    });

    respond({ encounter: encounter({ state: "classified" }), suggested: { color: "yellow", criterion: "Temperatura de 39 °C ou mais" } });
    const classified = await classifyUrgency("en1", { complaint: "febre", vital_signs: { temperature_c: 39.4 }, pain_scale: 5, color: "yellow" });
    expect(classified.encounter.state).toBe("classified");
    expect(classified.suggested?.color).toBe("yellow");
    expect(lastCall()).toEqual({
      url: "/urgency/encounters/en1/classifications", method: "POST",
      body: { complaint: "febre", vital_signs: { temperature_c: 39.4 }, pain_scale: 5, color: "yellow" }
    });

    respond({ encounter: encounter(), merged: true, moved: 3, kept_duplicates: 1 });
    const identified = await identifyUrgencyPatient("en9", { patient_id: "pa5" });
    expect(identified).toMatchObject({ merged: true, moved: 3, kept_duplicates: 1 });
    expect(lastCall()).toEqual({ url: "/urgency/encounters/en9/identify", method: "POST", body: { patient_id: "pa5" } });

    respond({ encounter: encounter({ state: "closed" }), attendance: { id: "at1", status: "closed", outcome: "left" } });
    const closed = await recordUrgencyOutcome("en1", { kind: "registered_in_error", reason: "chegada registrada em duplicidade" });
    expect(closed.encounter.state).toBe("closed");
    expect(closed.attendance.outcome).toBe("left");
    expect(lastCall()).toEqual({
      url: "/urgency/encounters/en1/outcome", method: "POST",
      body: { kind: "registered_in_error", reason: "chegada registrada em duplicidade" }
    });
  });

  it("chamada do 13 leva o local só quando recebido; chamar de novo; classificação", async () => {
    await callNext("ubs1");
    expect(lastCall().body).toEqual({});
    await callNext("ubs1", null);
    expect(lastCall().body).toEqual({});
    await callNext("ubs1", "loc1");
    expect(lastCall().body).toEqual({ call_location_id: "loc1" });
    await callAttendance("at1", "ubs1");
    expect(lastCall().body).toEqual({ health_unit_id: "ubs1" });
    await callAttendance("at1", "ubs1", "loc1");
    expect(lastCall()).toEqual({ url: "/attendance/attendances/at1/call", method: "POST", body: { health_unit_id: "ubs1", call_location_id: "loc1" } });
    respond({ call_id: "ca1", call: { id: "ca1", kind: "care", ticket: "A-007", location: "Consultório 1", called_at: "2026-11-05T10:00:00-03:00" } });
    expect((await recallAttendance("at1", "loc1")).call.location).toBe("Consultório 1");
    expect(lastCall()).toEqual({ url: "/attendance/attendances/at1/recall", method: "POST", body: { call_location_id: "loc1" } });
    await recallAttendance("at1", null);
    expect(lastCall().body).toEqual({});
    respond({ encounter: encounter(), call: null });
    expect((await callForClassification("en1", null)).call).toBeNull();
    expect(lastCall()).toEqual({ url: "/urgency/encounters/en1/call_for_classification", method: "POST", body: {} });
    await callForClassification("en1", "loc2");
    expect(lastCall().body).toEqual({ call_location_id: "loc2" });
  });

  it("consulta de urgência e finalização sem desfecho do 13", async () => {
    await startConsultation("at1", { kind: "urgency" });
    expect(lastCall().body).toEqual({ kind: "urgency" });
    await finalizeConsultation("co1", null);
    expect(lastCall()).toEqual({ url: "/attendance/consultations/co1/finalize", method: "POST", body: {} });
    await finalizeConsultation("co1", { outcome: "discharged" });
    expect(lastCall().body).toEqual({ outcome: { outcome: "discharged" } });
  });

  it("TV: sem cookie, com o token no cabeçalho; 401 vira ApiError display_revoked", async () => {
    respond(board());
    expect((await fetchWaitingRoomBoard("tok-abc")).calls).toHaveLength(2);
    const init = lastInit();
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>)["X-Display-Token"]).toBe("tok-abc");
    expect(lastCall()).toEqual({ url: "/waiting_room/board", method: "GET", body: undefined });
    failNext(401, { error: "display_revoked" });
    const revoked = fetchWaitingRoomBoard("tok-abc");
    await expect(revoked).rejects.toBeInstanceOf(ApiError);
    await expect(revoked).rejects.toMatchObject({ status: 401, body: { error: "display_revoked" } });
    failNext(401, { error: "invalid_token" });
    await expect(fetchWaitingRoomBoard("tok-old")).rejects.toMatchObject({ status: 401, body: { error: "invalid_token" } });

    respond({ display_token: "tok-new" });
    expect(await pairWaitingRoomDisplay("012345")).toEqual({ display_token: "tok-new" });
    const pair = lastInit();
    expect(pair.credentials).toBe("omit");
    expect((pair.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(pair.headers as Record<string, string>).not.toHaveProperty("X-Display-Token");
    // O código vai como texto: o zero da frente não se perde.
    expect(lastCall()).toEqual({ url: "/waiting_room/pair", method: "POST", body: { code: "012345" } });
    failNext(422, { error: "invalid_pairing_code" });
    await expect(pairWaitingRoomDisplay("999999")).rejects.toMatchObject({ status: 422, body: { error: "invalid_pairing_code" } });
  });

  it("admin de locais e TVs pelos caminhos do contrato §8", async () => {
    respond({ items: [], location_required: true });
    expect(await listCallLocations("upa1")).toEqual({ items: [], location_required: true });
    expect(lastCall().url).toBe("/attendance/call_locations?health_unit_id=upa1");
    await createCallLocation({ health_unit_id: "upa1", name: "Consultório 1", active: true });
    expect(lastCall()).toEqual({ url: "/attendance/call_locations", method: "POST", body: { health_unit_id: "upa1", name: "Consultório 1", active: true } });
    await updateCallLocation("loc1", { name: "Consultório 1", active: false });
    expect(lastCall()).toEqual({ url: "/attendance/call_locations/loc1", method: "PATCH", body: { name: "Consultório 1", active: false } });

    respond({ items: [ waitingRoomDisplay() ] });
    expect((await listWaitingRoomDisplays("upa1"))[0].paired).toBe(true);
    expect(lastCall().url).toBe("/waiting_room/displays?health_unit_id=upa1");
    await createWaitingRoomDisplay({ health_unit_id: "upa1", name: "TV da recepção", active: true, show_wait_times: true });
    expect(lastCall()).toEqual({
      url: "/waiting_room/displays", method: "POST",
      body: { health_unit_id: "upa1", name: "TV da recepção", active: true, show_wait_times: true }
    });
    await updateWaitingRoomDisplay("d1", { name: "TV da recepção", active: true, show_wait_times: false });
    expect(lastCall()).toEqual({ url: "/waiting_room/displays/d1", method: "PATCH", body: { name: "TV da recepção", active: true, show_wait_times: false } });
    respond({ code: "004213", expires_at: "2026-11-05T10:10:00-03:00" });
    expect((await createPairingCode("d1")).code).toBe("004213");
    expect(lastCall()).toEqual({ url: "/waiting_room/displays/d1/pairing_code", method: "POST", body: {} });
    respond(waitingRoomDisplay({ paired: false, revoked: true, revoked_at: "2026-11-05T10:00:00-03:00" }));
    expect((await revokeWaitingRoomDisplay("d1")).revoked).toBe(true);
    expect(lastCall()).toEqual({ url: "/waiting_room/displays/d1/revoke", method: "POST", body: {} });
  });

  it("retornos à UBS e provisórios: desembrulham { items }, só o id da unidade na URL", async () => {
    respond({ items: [ counterReferral() ] });
    expect((await listCounterReferrals("ubs1"))[0].return_days).toBe(7);
    expect(lastCall()).toEqual({ url: "/urgency/counter_referrals?health_unit_id=ubs1", method: "GET", body: undefined });
    respond({ items: [ provisionalEncounter() ] });
    expect((await listProvisionalEncounters("upa1"))[0].outcome_kind).toBe("death");
    expect(lastCall()).toEqual({ url: "/urgency/provisional_encounters?health_unit_id=upa1", method: "GET", body: undefined });
  });

  it("prefixo da senha e tempos na TV só vão quando recebidos", async () => {
    await updateUnit("upa1", "UPA", "upa", ADDRESS, undefined, undefined, undefined, undefined, { ticket_prefix: "UB", show_wait_times: false });
    expect(lastCall().body).toMatchObject({ ticket_prefix: "UB", show_wait_times: false });
    await updateUnit("upa1", "UPA", "upa", ADDRESS);
    expect("ticket_prefix" in (lastCall().body as object)).toBe(false);
    expect("show_wait_times" in (lastCall().body as object)).toBe(false);
  });
});
