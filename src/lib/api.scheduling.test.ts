// src/lib/api.scheduling.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, assignRequestUnit, bookAppointment, createAppointmentType, createScheduleTemplate, gateProtocol, getMyAgenda,
  getUnitAgenda, getUnitAvailability, listAppointmentTypes, listScheduleTemplates, listUnassignedRequests,
  previewScheduleTemplate, scheduleShift, setLinkDefaultType, setShiftTemplate, updateAppointmentType, updateScheduleTemplate,
  type AppointmentType, type ScheduleTemplate
} from "./api";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof stub>, i = 0) => fn.mock.calls[i] as [ string, RequestInit ];
const sent = (fn: ReturnType<typeof stub>, i = 0) => JSON.parse(call(fn, i)[1].body as string);

const TYPE: AppointmentType = { key: "consulta_medica", name: "Consulta médica", duration_minutes: 20,
  cbo_prefixes: [ "2251", "2252", "2253" ], active: true, origin: "platform" };
const TEMPLATE: ScheduleTemplate = { id: "t1", name: "Manhã", fit_in_limit: 2, active: true,
  blocks: [ { starts: "09:00", ends: "11:00", kind: "bookable", appointment_type_key: "consulta_medica" } ] };

describe("cliente do módulo 17 — Profissionais", () => {
  it("tipos: lista desembrulha { types }; criar e alterar devolvem o tipo puro", async () => {
    let fn = stub({ types: [ TYPE ] });
    expect((await listAppointmentTypes())[0].key).toBe("consulta_medica");
    expect(call(fn)[0]).toBe("/professionals/appointment_types");
    expect(call(fn)[1].credentials).toBe("include");

    fn = stub({ ...TYPE, key: "puericultura", origin: "city" });
    const created = await createAppointmentType({ key: "puericultura", name: "Puericultura", duration_minutes: 30, cbo_prefixes: [ "2235" ] });
    expect(created.origin).toBe("city");
    expect(call(fn)[1].method).toBe("POST");
    expect(sent(fn)).toEqual({ key: "puericultura", name: "Puericultura", duration_minutes: 30, cbo_prefixes: [ "2235" ] });

    fn = stub(TYPE);
    await updateAppointmentType("consulta/medica", { active: false });
    expect(call(fn)[0]).toBe("/professionals/appointment_types/consulta%2Fmedica");
    expect(sent(fn)).toEqual({ active: false });
  });

  it("modelos: lista, criar, alterar e pré-visualizar", async () => {
    let fn = stub({ templates: [ TEMPLATE ] });
    expect((await listScheduleTemplates())[0].name).toBe("Manhã");
    expect(call(fn)[0]).toBe("/professionals/schedule_templates");

    fn = stub(TEMPLATE);
    await createScheduleTemplate({ name: "Manhã", fit_in_limit: 2, blocks: TEMPLATE.blocks });
    expect(call(fn)[0]).toBe("/professionals/schedule_templates");
    expect(sent(fn)).toEqual({ name: "Manhã", fit_in_limit: 2, blocks: TEMPLATE.blocks });

    fn = stub(TEMPLATE);
    await updateScheduleTemplate("t1", { active: false });
    expect(call(fn)[0]).toBe("/professionals/schedule_templates/t1");

    fn = stub({ slots: [ { starts_at: "2026-10-06T09:00:00-03:00", ends_at: "2026-10-06T09:20:00-03:00", appointment_type_key: "consulta_medica" } ], blocks: TEMPLATE.blocks });
    const preview = await previewScheduleTemplate({ blocks: TEMPLATE.blocks, fit_in_limit: 2,
      sample: { starts_at: "2026-10-06T07:00:00-03:00", ends_at: "2026-10-06T13:00:00-03:00", cbo_code: "225125" } });
    expect(preview.slots).toHaveLength(1);
    expect(call(fn)[0]).toBe("/professionals/schedule_templates/preview");
    expect(sent(fn).sample.cbo_code).toBe("225125");
  });

  it("turno: lançar manda o modelo só quando informado; trocar o modelo aceita null", async () => {
    let fn = stub({ shift: { id: "s1" } });
    await scheduleShift("l1", "a", "b");
    expect(sent(fn)).toEqual({ starts_at: "a", ends_at: "b" });

    fn = stub({ shift: { id: "s1" } });
    await scheduleShift("l1", "a", "b", "t1");
    expect(sent(fn)).toEqual({ starts_at: "a", ends_at: "b", schedule_template_id: "t1" });

    fn = stub({ id: "s1" });
    await setShiftTemplate("s1", null);
    expect(call(fn)[0]).toBe("/professionals/shifts/s1/template");
    expect(sent(fn)).toEqual({ schedule_template_id: null });
  });

  it("vínculo: tipo padrão; Minha agenda com from e to na query", async () => {
    let fn = stub({ id: "l1" });
    await setLinkDefaultType("l1", "consulta_medica");
    expect(call(fn)[0]).toBe("/professionals/links/l1/default_type");
    expect(sent(fn)).toEqual({ appointment_type_key: "consulta_medica" });

    fn = stub({ days: [] });
    await getMyAgenda("2026-10-05", "2026-10-11");
    expect(call(fn)[0]).toBe("/professionals/me/agenda?from=2026-10-05&to=2026-10-11");
  });
});

describe("cliente do módulo 17 — Atendimento", () => {
  it("vagas: tipo e período na query; legacy_days vem junto", async () => {
    const fn = stub({ slots: [], legacy_days: [ "2026-10-07" ] });
    const result = await getUnitAvailability("u1", "consulta_medica", "2026-10-05", "2026-10-18");
    expect(result.legacy_days).toEqual([ "2026-10-07" ]);
    expect(call(fn)[0]).toBe("/attendance/units/u1/availability?type=consulta_medica&from=2026-10-05&to=2026-10-18");
  });

  it("marcar: as três formas levam a unidade e desembrulham { appointment }", async () => {
    const appointment = { id: "a1", scheduled_at: "x", status: "scheduled", confirmation_deadline_at: null };
    let fn = stub({ appointment }, 201);
    expect((await bookAppointment("r1", "u1", { kind: "slot", professional_id: "p1",
      starts_at: "2026-10-06T09:00:00-03:00", appointment_type_key: "consulta_medica" })).id).toBe("a1");
    expect(call(fn)[0]).toBe("/attendance/requests/r1/appointments");
    expect(sent(fn)).toEqual({ kind: "slot", professional_id: "p1", starts_at: "2026-10-06T09:00:00-03:00",
      appointment_type_key: "consulta_medica", health_unit_id: "u1" });

    fn = stub({ appointment }, 201);
    await bookAppointment("r1", "u1", { kind: "fit_in", professional_id: "p1", shift_id: "s1",
      starts_at: "2026-10-06T10:10:00-03:00", appointment_type_key: "consulta_medica", reason: "gestante com dor" });
    expect(sent(fn).reason).toBe("gestante com dor");

    fn = stub({ appointment }, 201);
    await bookAppointment("r1", "u1", { kind: "legacy", scheduled_at: "2026-10-07T12:00:00.000Z", allow_overlap: true });
    expect(sent(fn)).toEqual({ kind: "legacy", scheduled_at: "2026-10-07T12:00:00.000Z", allow_overlap: true, health_unit_id: "u1" });
  });

  it("marcar: 409 slot_taken vira ApiError com o código", async () => {
    stub({ error: "slot_taken" }, 409);
    const err = await bookAppointment("r1", "u1", { kind: "slot", professional_id: "p1", starts_at: "x", appointment_type_key: "k" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toEqual({ error: "slot_taken" });
  });

  it("agenda nova é o objeto puro; sem unidade e atribuição", async () => {
    let fn = stub({ date: "2026-10-06", professionals: [], unassigned: [] });
    expect((await getUnitAgenda("u1", "2026-10-06")).date).toBe("2026-10-06");
    expect(call(fn)[0]).toBe("/attendance/units/u1/agenda?date=2026-10-06");

    fn = stub({ requests: [] });
    expect(await listUnassignedRequests()).toEqual([]);
    expect(call(fn)[0]).toBe("/attendance/requests/unassigned");

    fn = stub({ id: "r1" });
    await assignRequestUnit("r1", "u2");
    expect(call(fn)[0]).toBe("/attendance/requests/r1/assign_unit");
    expect(sent(fn)).toEqual({ unit_id: "u2" });
  });
});

describe("gate com avisos", () => {
  it("200 sem corpo continua { valid: true }; 200 com warnings devolve os avisos", async () => {
    stub(undefined, 200);
    expect(await gateProtocol({})).toEqual({ valid: true });
    stub({ warnings: [ "scheduling[0].appointment_type: tipo inexistente na cidade (puericultura)" ] });
    expect(await gateProtocol({})).toEqual({
      valid: true, warnings: [ "scheduling[0].appointment_type: tipo inexistente na cidade (puericultura)" ]
    });
  });
});
