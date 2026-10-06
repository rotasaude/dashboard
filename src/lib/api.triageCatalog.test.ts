import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, listTriageCatalog, simulateOffer, updateTriageOffer, type TriageOffer } from "./api";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof stub>, i = 0) => fn.mock.calls[i] as [ string, RequestInit ];

const OFFER: TriageOffer = {
  protocol_name: "saude-do-idoso", title: "Saúde do idoso", active_version: 3,
  eligibility: { gte: [ "profile.age", 60 ] }, retake_after_days: 365, configured: true,
  enabled: true, position: 2, restriction: null, available_from: null, available_until: "2026-12-31",
  counters: { offered: 120, started: 40, completed: null, from_suggestion: 6 }
};
const FIELDS = { enabled: false, suggestion_only: false, position: 2, restriction: null, available_from: null, available_until: null };

describe("cliente do catálogo de triagens", () => {
  it("lista desembrulha { offers }, manda o cookie e mantém o null dos contadores", async () => {
    const fn = stub({ offers: [ OFFER ] });
    const offers = await listTriageCatalog();
    expect(offers[0].title).toBe("Saúde do idoso");
    expect(offers[0].counters.completed).toBeNull();
    expect(call(fn)[0]).toBe("/triage_catalog");
    expect(call(fn)[1].credentials).toBe("include");
  });

  it("grava com PUT no nome escapado e desembrulha { offer }", async () => {
    const fn = stub({ offer: OFFER });
    expect((await updateTriageOffer("saude/idoso", FIELDS)).protocol_name).toBe("saude-do-idoso");
    expect(call(fn)[0]).toBe("/triage_catalog/saude%2Fidoso");
    expect(call(fn)[1].method).toBe("PUT");
    expect(JSON.parse(call(fn)[1].body as string)).toEqual(FIELDS);
  });

  it("recusa do PUT vira ApiError com o código no corpo", async () => {
    stub({ error: "invalid_period" }, 422);
    const err = await updateTriageOffer("saude-do-idoso", FIELDS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toEqual({ error: "invalid_period" });
  });
});

describe("simulador de oferta", () => {
  it("manda definição, perfil, respostas e resultado para /authoring/protocols/simulate_offer", async () => {
    const result = { eligible: true, eligibility_text: "idade ≥ 60", suggestions: [ { protocol: "x-y", matches: true } ], errors: [], warnings: [] };
    const fn = stub(result);
    const input = {
      definition: { name: "saude-do-idoso" }, profile: { age: 62, sex: "female" as const, neighborhood_id: null },
      answers: { q1: "true" }, outcome: { tier: "alta", score: 17 }
    };
    expect(await simulateOffer(input)).toEqual(result);
    expect(call(fn)[0]).toBe("/authoring/protocols/simulate_offer");
    expect(call(fn)[1].method).toBe("POST");
    expect(JSON.parse(call(fn)[1].body as string)).toEqual(input);
  });

  it("definição inválida vem como 200 com os erros do gate", async () => {
    const invalid = { eligible: false, eligibility_text: null, suggestions: [], errors: [ "offer.eligibility usa outcome.score" ], warnings: [] };
    stub(invalid);
    expect(await simulateOffer({ definition: {}, profile: { age: 30, sex: "male", neighborhood_id: null } })).toEqual(invalid);
  });

  it("erro HTTP é exceção", async () => {
    stub({ error: "forbidden" }, 403);
    await expect(simulateOffer({ definition: {}, profile: { age: 30, sex: "male", neighborhood_id: null } }))
      .rejects.toBeInstanceOf(ApiError);
  });

  it("warnings não vazios passam sem mudança", async () => {
    const resultWithWarnings = {
      eligible: true, eligibility_text: "age ≥ 18", suggestions: [], errors: [],
      warnings: [ "suggestion 'preventive-care' does not exist in city" ]
    };
    stub(resultWithWarnings);
    expect(await simulateOffer({ definition: {}, profile: { age: 25, sex: "female", neighborhood_id: null } }))
      .toEqual(resultWithWarnings);
  });
});
