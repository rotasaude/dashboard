import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, createUrgencyBed, endObservation, getMedicationSchedule, getUrgencyObservation, issueUrgencyPrescription,
  listUrgencyBeds, listUrgencyShortfalls, reconcileUrgencyShortfall, recordAdministration, searchUrgencyMedication,
  startObservation, suspendUrgencyPrescription, updateUrgencyBed
} from "./api";
import {
  administration, bed, observationMap, observedEncounter, prescription, schedule, shortfall
} from "../test/urgencyObservationFixtures";

// fetch falso (o mesmo de api.urgency.test.ts): devolve `next` (ou a falha marcada) e guarda cada chamada.
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

describe("cliente da urgência: observação, prescrição e checagem (módulo 32b)", () => {
  it("leitos e mapa: só ids na URL; PATCH parcial; desembrulha items/bed", async () => {
    respond({ items: [ bed() ] });
    expect((await listUrgencyBeds("upa1"))[0].label).toBe("Obs 1");
    expect(lastCall()).toEqual({ url: "/urgency/beds?health_unit_id=upa1", method: "GET", body: undefined });
    respond({});
    expect(await listUrgencyBeds("upa1")).toEqual([]);
    respond({ bed: bed({ id: "b3", label: "Obs 3" }) });
    expect((await createUrgencyBed({ health_unit_id: "upa1", label: "Obs 3", active: true })).id).toBe("b3");
    expect(lastCall()).toEqual({ url: "/urgency/beds", method: "POST", body: { health_unit_id: "upa1", label: "Obs 3", active: true } });
    respond({ bed: bed({ active: false }) });
    expect((await updateUrgencyBed("b1", { active: false })).active).toBe(false);
    expect(lastCall()).toEqual({ url: "/urgency/beds/b1", method: "PATCH", body: { active: false } });
    respond(observationMap());
    expect((await getUrgencyObservation("upa1")).waiting_bed[0].ticket).toBe("U-041");
    expect(lastCall().url).toBe("/urgency/observation?health_unit_id=upa1");
  });

  it("entrada, troca e saída da observação devolvem o detalhe do encontro", async () => {
    respond({ encounter: observedEncounter() });
    expect((await startObservation("en3", "b2")).observation?.current?.bed_label).toBe("Obs 1");
    expect(lastCall()).toEqual({ url: "/urgency/encounters/en3/observation", method: "POST", body: { bed_id: "b2" } });
    expect((await endObservation("en3")).id).toBe("en3");
    expect(lastCall()).toEqual({ url: "/urgency/encounters/en3/observation/end", method: "POST", body: {} });
  });

  it("prescrição e suspensão: medicamento e motivo só no corpo; dose como texto", async () => {
    respond({ prescription: prescription() });
    const items = [ {
      catalog_item_id: "cat-dipirona", dose: "1", dose_unit: "g" as const, route: "intravenous" as const,
      frequency: { kind: "interval" as const, interval_hours: 6 }
    } ];
    expect((await issueUrgencyPrescription("en3", items)).version).toBe(1);
    expect(lastCall()).toEqual({ url: "/urgency/encounters/en3/prescriptions", method: "POST", body: { items } });
    respond({ prescription: prescription({ status: "suspended" }) });
    expect((await suspendUrgencyPrescription("pr1", "reação alérgica após a dose")).status).toBe("suspended");
    expect(lastCall()).toEqual({ url: "/urgency/prescriptions/pr1/suspend", method: "POST", body: { reason: "reação alérgica após a dose" } });
    for (const c of calls()) expect(c.url).not.toMatch(/dipirona|alérg|al%C3%A9rg/i);
  });

  it("busca de medicamento da UPA: POST, termo só no corpo", async () => {
    respond({ items: [ { catalog_item_id: "cat-dipirona", catmat_code: 267501, name: "Dipirona", strength: "500 mg/mL",
      dosage_form: "solução injetável", unit: "mg", controlled_list: null } ] });
    expect((await searchUrgencyMedication("dipirona"))[0].catalog_item_id).toBe("cat-dipirona");
    expect(lastCall()).toEqual({ url: "/urgency/medication_search", method: "POST", body: { query: "dipirona" } });
    expect(lastCall().url).not.toMatch(/dipirona/);
    respond({});
    expect(await searchUrgencyMedication("dipirona")).toEqual([]);
  });

  it("aprazamento e checagem: campos de estoque só quando recebidos", async () => {
    respond(schedule());
    expect((await getMedicationSchedule("en3")).items[0].slots).toHaveLength(4);
    expect(lastCall()).toEqual({ url: "/urgency/encounters/en3/medication_schedule", method: "GET", body: undefined });
    respond({ administration: administration(), shortfall: null });
    const r = await recordAdministration({ prescription_item_id: "pi1", scheduled_at: "2026-11-10T14:00:00-03:00", status: "administered" });
    expect(r.shortfall).toBeNull();
    expect(lastCall()).toEqual({ url: "/urgency/administrations", method: "POST",
      body: { prescription_item_id: "pi1", scheduled_at: "2026-11-10T14:00:00-03:00", status: "administered" } });
    await recordAdministration({ prescription_item_id: "pi1", status: "refused", reason: "paciente recusou a medicação" });
    expect("stock_lot_id" in (lastCall().body as object)).toBe(false);
    expect("stock_quantity" in (lastCall().body as object)).toBe(false);
    expect("scheduled_at" in (lastCall().body as object)).toBe(false);
    await recordAdministration({ prescription_item_id: "pi1", status: "administered", stock_lot_id: "lot1", stock_quantity: "1" });
    expect(lastCall().body).toEqual({ prescription_item_id: "pi1", status: "administered", stock_lot_id: "lot1", stock_quantity: "1" });
  });

  it("recusa do api vira ApiError com o código e os problemas", async () => {
    failNext(422, { error: "invalid_request", path: "items.0.dose", problems: [ { path: "items.0.dose", error: "invalid_request" } ] });
    await expect(issueUrgencyPrescription("en3", [])).rejects.toBeInstanceOf(ApiError);
  });

  it("faltas da UPA: local e estado na URL, cursor, limite; nota no corpo", async () => {
    respond({ items: [ shortfall() ], next_before: "cursor-1" });
    const page = await listUrgencyShortfalls({ locationId: "loc-upa", state: "open" });
    expect(page.items[0].shortfall_id).toBe("sf1");
    expect(page.next_before).toBe("cursor-1");
    expect(lastCall().url).toBe("/pharmacy/urgency_shortfalls?location_id=loc-upa&state=open&limit=50");
    await listUrgencyShortfalls({ state: "reconciled", before: "cursor-1" });
    expect(lastCall().url).toBe("/pharmacy/urgency_shortfalls?state=reconciled&before=cursor-1&limit=50");
    respond({});
    expect(await listUrgencyShortfalls({ state: "open" })).toEqual({ items: [], next_before: null });
    respond({ shortfall: shortfall({ reconciled_at: "2026-11-10T17:30:00Z" }) });
    expect((await reconcileUrgencyShortfall("sf1", "ajuste de contagem feito no estoque")).reconciled_at).toBe("2026-11-10T17:30:00Z");
    expect(lastCall()).toEqual({ url: "/pharmacy/urgency_shortfalls/sf1/reconcile", method: "POST", body: { note: "ajuste de contagem feito no estoque" } });
    expect(lastCall().url).not.toMatch(/ajuste/);
  });
});
