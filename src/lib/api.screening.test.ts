import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abandonScreening, callAttendance, completeScreening, getScreening, listGenerationFailures, listScreeningQueue,
  listUnitQueue, reassessScreening, retryGenerationFailure, searchCiap2, simulateScreening, startScreening,
  suggestScreening, updateUnit
} from "./api";
import { EMPTY_ADDRESS } from "./unitAddress";
import { queueItem, revision, screening, suggestion } from "../test/screeningFixtures";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof stub>, i = 0) => fn.mock.calls[i] as [ string, RequestInit ];
const sent = (fn: ReturnType<typeof stub>, i = 0) => JSON.parse(call(fn, i)[1].body as string);

describe("cliente do módulo 18 — escuta", () => {
  it("fila do acolhimento desembrulha { items }", async () => {
    const fn = stub({ items: [ queueItem() ] });
    expect((await listScreeningQueue("u/1"))[0].attendance_id).toBe("a1");
    expect(call(fn)[0]).toBe("/attendance/units/u%2F1/screening_queue");
    expect(call(fn)[1].credentials).toBe("include");
  });

  it("iniciar, abandonar e ler devolvem a escuta pura", async () => {
    let fn = stub(screening());
    expect((await startScreening("a1")).status).toBe("in_progress");
    expect(call(fn)[0]).toBe("/attendance/attendances/a1/screening");
    expect(call(fn)[1].method).toBe("POST");

    fn = stub(screening({ status: "abandoned" }));
    expect((await abandonScreening("sc1")).status).toBe("abandoned");
    expect(call(fn)[0]).toBe("/attendance/screenings/sc1/abandon");

    fn = stub(screening({ status: "completed", revisions: [ revision() ] }));
    expect((await getScreening("sc1")).revisions).toHaveLength(1);
    expect(call(fn)[0]).toBe("/attendance/screenings/sc1");
    expect(call(fn)[1].method).toBeUndefined();
  });

  it("sugestão manda queixa, sinais e o atendimento; nada vai na URL", async () => {
    const fn = stub(suggestion());
    const out = await suggestScreening({ ciap2_code: "K86", vitals: { systolic: 185, diastolic: 110 }, attendance_id: "a1" });
    expect(out.suggested_color).toBe("red");
    expect(call(fn)[0]).toBe("/attendance/screenings/suggest");
    expect(sent(fn)).toEqual({ ciap2_code: "K86", vitals: { systolic: 185, diastolic: 110 }, attendance_id: "a1" });
  });

  it("sugestão aceita atendimento sem queixa (ciap2_code opcional)", async () => {
    const fn = stub(suggestion({ suggested_color: null, matched_rules: [] }));
    await suggestScreening({ vitals: { spo2: 88 }, attendance_id: "a1" });
    expect("ciap2_code" in sent(fn)).toBe(false);
  });

  it("concluir e reavaliar mandam o corpo inteiro", async () => {
    let fn = stub(screening({ status: "completed", destination: "schedule" }));
    await completeScreening("sc1", {
      ciap2_code: "K86", vitals: { systolic: 150, diastolic: 95 }, final_color: "green", color_change_reason: "sem sintoma agudo agora",
      destination: "schedule", schedule: { appointment_type_key: "consulta_medica", priority: "routine", due_in_days: 15 }
    });
    expect(call(fn)[0]).toBe("/attendance/screenings/sc1/complete");
    expect(sent(fn).schedule).toEqual({ appointment_type_key: "consulta_medica", priority: "routine", due_in_days: 15 });
    expect(sent(fn).color_change_reason).toBe("sem sintoma agudo agora");

    fn = stub(screening({ status: "completed", destination: "same_day", revisions_count: 2 }));
    await reassessScreening("sc1", { ciap2_code: "K86", vitals: { systolic: 170 }, final_color: "yellow" });
    expect(call(fn)[0]).toBe("/attendance/screenings/sc1/reassess");
    expect(sent(fn)).toEqual({ ciap2_code: "K86", vitals: { systolic: 170 }, final_color: "yellow" });
  });

  it("CIAP-2: busca pelo corpo e desembrulha { items }", async () => {
    const fn = stub({ items: [ { code: "K86", label: "Hipertensão sem complicações" } ] });
    expect(await searchCiap2("pressão alta")).toEqual([ { code: "K86", label: "Hipertensão sem complicações" } ]);
    expect(call(fn)[0]).toBe("/attendance/ciap2/search");
    expect(sent(fn)).toEqual({ q: "pressão alta" });
  });

  it("simulador do editor manda a definição do rascunho", async () => {
    const fn = stub({ suggested_color: "red", matched_rules: [ { index: 0, text: "SpO2 baixa" } ], errors: [], warnings: [] });
    const out = await simulateScreening({
      definition: { name: "acolhimento", kind: "screening" }, ciap2_code: null, vitals: { spo2: 88 }, profile: { age: 70, sex: "female" }
    });
    expect(out.errors).toEqual([]);
    expect(out.suggested_color).toBe("red");
    expect(call(fn)[0]).toBe("/authoring/protocols/simulate_screening");
    expect(sent(fn).profile).toEqual({ age: 70, sex: "female" });
  });
});

describe("cliente do módulo 18 — fila, chamada e unidade", () => {
  it("fila do profissional traz o bloco da escuta e a espera da escuta", async () => {
    stub({
      waiting: [ { id: "a1", awaiting_screening: false, screening: { id: "sc1", color: "red", destination: "same_day", waited_minutes: 12 } } ],
      in_care: []
    });
    const out = await listUnitQueue("u1");
    expect(out.waiting[0].screening?.color).toBe("red");
    expect(out.waiting[0].awaiting_screening).toBe(false);
  });

  it("a chamada devolve a escuta aninhada no atendimento (contrato §9)", async () => {
    stub({ attendance: { id: "a1", screening: screening({ status: "completed" }) } });
    const out = await callAttendance("a1", "u1");
    expect(out.attendance.screening?.id).toBe("sc1");
  });

  it("updateUnit só manda screening_scope quando recebe", async () => {
    let fn = stub({ unit: { id: "u1" } });
    await updateUnit("u1", "UBS Centro", "ubs", EMPTY_ADDRESS, "all");
    expect(sent(fn).screening_scope).toBe("all");
    fn = stub({ unit: { id: "u1" } });
    await updateUnit("u1", "UBS Centro", "ubs", EMPTY_ADDRESS);
    expect("screening_scope" in sent(fn)).toBe(false);
  });
});

describe("cliente do módulo 18 — produção", () => {
  it("fichas não geradas: só as não resolvidas; gerar de novo é POST", async () => {
    let fn = stub({ items: [ { id: "g1", source_type: "Screening", source_id: "sc1", attendance_id: "a1",
      reason_codes: [ "unit_without_cnes" ], created_at: "2026-10-07T09:00:00Z", resolved_at: null } ] });
    expect((await listGenerationFailures())[0].reason_codes).toEqual([ "unit_without_cnes" ]);
    expect(call(fn)[0]).toBe("/production/generation_failures?resolved=false");

    fn = stub({ id: "g1", source_type: "Screening", source_id: "sc1", attendance_id: "a1", reason_codes: [],
      created_at: "2026-10-07T09:00:00Z", resolved_at: "2026-10-07T10:00:00Z" });
    expect((await retryGenerationFailure("g1")).resolved_at).not.toBeNull();
    expect(call(fn)[0]).toBe("/production/generation_failures/g1/retry");
    expect(call(fn)[1].method).toBe("POST");
  });
});
