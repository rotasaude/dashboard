// src/lib/api.careLines.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptCareSuggestion, adoptCareLine, countCareSuggestions, countOverdueEnrollments, createCustomCareLine, dismissCareSuggestion,
  endCareEnrollment, enrollCare, getCareContext, getCareEnrollment, getCarePreview, listCareEnrollments, listCareSuggestions,
  listCareTemplates, listCityCareLines, lookupCarePerson, openCareAppointment, recordCareContact, updateCareLine
} from "./api";

function ok(body: unknown, init: ResponseInit = {}): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init }));
}

describe("cliente das linhas de cuidado (contrato §3–§6)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(() => ok({}));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => fetchMock.mock.calls[i][1] as RequestInit;
  const headersOf = (i = 0) => initOf(i).headers as Record<string, string>;
  const bodyOf = (i = 0) => JSON.parse(String(initOf(i).body));

  it("contexto: as duas listas de apoio (L10); ausentes viram vazias", async () => {
    fetchMock.mockImplementation((url: string) => ok(String(url).endsWith("/teams")
      ? { teams: [ { id: "tm1", can_confirm: true } ] } : { lines: [ { id: "cl4", requires_anchor: null } ] }));
    expect(await getCareContext()).toEqual({ teams: [ { id: "tm1", can_confirm: true } ], lines: [ { id: "cl4", requires_anchor: null } ] });
    expect(fetchMock.mock.calls.map((c) => new URL(String(c[0]), "http://x").pathname).sort()).toEqual([ "/care_lines/lines", "/care_lines/teams" ]);
    fetchMock.mockImplementation(() => ok({}));
    expect(await getCareContext()).toEqual({ teams: [], lines: [] });
  });

  it("admin: catálogo-base e linhas da cidade em envelope; adotar, criar e salvar devolvem a linha pura (sem envelope)", async () => {
    fetchMock
      .mockImplementationOnce(() => ok({ templates: [ { key: "diabetes_c4" } ] }))
      .mockImplementationOnce(() => ok({ lines: [ { id: "cl4" } ] }))
      .mockImplementationOnce(() => ok({ id: "cl3" }))
      .mockImplementationOnce(() => ok({ id: "cl9" }))
      .mockImplementationOnce(() => ok({ id: "cl4" }));
    expect(await listCareTemplates()).toEqual([ { key: "diabetes_c4" } ]);
    expect(urlOf(0).pathname).toBe("/care_lines/admin/templates");
    expect(await listCityCareLines()).toEqual([ { id: "cl4" } ]);
    expect(urlOf(1).pathname).toBe("/care_lines/admin/lines");
    expect(await adoptCareLine("pregnancy_c3", 1)).toEqual({ id: "cl3" });
    expect(urlOf(2).pathname).toBe("/care_lines/admin/lines");
    expect(initOf(2).method).toBe("POST");
    expect(headersOf(2)["Content-Type"]).toBe("application/json");
    expect(bodyOf(2)).toEqual({ template_key: "pregnancy_c3", template_version: 1 });
    const input = {
      name: "Saúde mental", declared_condition: "mental_health" as const,
      eligibility: { problems: { ciap2: [ "P76" ], cid10: [ "F32" ] }, age_min_years: 18, age_max_years: null, sex: null,
        declared: [ "mental_health" ], requires_anchor: null },
      practices: [ { key: "consulta", label: "Consulta", source: "consultation", window_days: 90, min_count: 1,
        schedule: "end_of_window" as const, anchor: "rolling" as const, cbo_filter: [ "2231", "2251", "2252", "2253", "2235" ] } ]
    };
    expect(await createCustomCareLine(input)).toEqual({ id: "cl9" });
    expect(bodyOf(3)).toEqual(input);
    expect(await updateCareLine("cl4", { template_version: 3 })).toEqual({ id: "cl4" });
    expect(urlOf(4).pathname).toBe("/care_lines/admin/lines/cl4");
    expect(initOf(4).method).toBe("PATCH");
    expect(bodyOf(4)).toEqual({ template_version: 3 });
  });

  it("listas: só ids, situação e cursor na URL; envelope com next_before", async () => {
    fetchMock.mockImplementationOnce(() => ok({ enrollments: [ { id: "en1" } ], next_before: "c2" }));
    expect(await listCareEnrollments({ teamId: "tm1", careLineId: "cl4", status: "overdue", before: "c1" }))
      .toEqual({ enrollments: [ { id: "en1" } ], next_before: "c2" });
    expect(urlOf(0).pathname).toBe("/care_lines/enrollments");
    expect(Object.fromEntries(urlOf(0).searchParams)).toEqual({ team_id: "tm1", care_line_id: "cl4", status: "overdue", before: "c1", limit: "50" });
    expect(await listCareEnrollments({ teamId: "tm1", status: "all" })).toEqual({ enrollments: [], next_before: null });
    expect(Object.fromEntries(urlOf(1).searchParams)).toEqual({ team_id: "tm1", status: "all", limit: "50" });
    fetchMock.mockImplementationOnce(() => ok({ suggestions: [ { id: "sg1" } ], next_before: null }));
    expect(await listCareSuggestions({ teamId: "tm1" })).toEqual({ suggestions: [ { id: "sg1" } ], next_before: null });
    expect(urlOf(2).pathname).toBe("/care_lines/suggestions");
    expect(Object.fromEntries(urlOf(2).searchParams)).toEqual({ team_id: "tm1", limit: "50" });
  });

  it("aceitar, recusar, inscrever, encerrar e contato: tudo no corpo, nada na URL", async () => {
    await acceptCareSuggestion("sg1", { team_id: "tm1", anchor_date: "2026-08-01" });
    expect(urlOf(0).pathname).toBe("/care_lines/suggestions/sg1/accept");
    expect(urlOf(0).search).toBe("");
    expect(bodyOf(0)).toEqual({ team_id: "tm1", anchor_date: "2026-08-01" });
    await dismissCareSuggestion("sg1", "já acompanhada no CAPS da região");
    expect(urlOf(1).pathname).toBe("/care_lines/suggestions/sg1/dismiss");
    expect(bodyOf(1)).toEqual({ reason: "já acompanhada no CAPS da região" });
    fetchMock.mockImplementationOnce(() => ok({ id: "en9", status: "active" }));
    expect(await enrollCare({ citizen_id: "ci3", care_line_id: "cl6", team_id: "tm1" })).toEqual({ id: "en9", status: "active" });
    expect(urlOf(2).pathname).toBe("/care_lines/enrollments");
    expect(bodyOf(2)).toEqual({ citizen_id: "ci3", care_line_id: "cl6", team_id: "tm1" });
    await endCareEnrollment("en1", "moved", "");
    expect(urlOf(3).pathname).toBe("/care_lines/enrollments/en1/end");
    expect(bodyOf(3)).toEqual({ reason: "moved" });
    await endCareEnrollment("en1", "other", "acompanhamento no plano de saúde");
    expect(bodyOf(4)).toEqual({ reason: "other", note: "acompanhamento no plano de saúde" });
    await recordCareContact("en1", { channel: "phone", outcome: "no_answer", note: "" });
    expect(urlOf(5).pathname).toBe("/care_lines/enrollments/en1/contacts");
    expect(urlOf(5).search).toBe("");
    expect(bodyOf(5)).toEqual({ channel: "phone", outcome: "no_answer" });
    for (let i = 0; i <= 5; i += 1) {
      expect(initOf(i).method).toBe("POST");
      expect(headersOf(i)["Content-Type"]).toBe("application/json");
    }
  });

  it("detalhe; contadores sem trilha com { count }; ausente vira 0", async () => {
    fetchMock
      .mockImplementationOnce(() => ok({ id: "en1", contacts: [] }))
      .mockImplementationOnce(() => ok({ count: 3 }))
      .mockImplementationOnce(() => ok({ count: 12 }))
      .mockImplementationOnce(() => ok({}));
    expect(await getCareEnrollment("en1")).toEqual({ id: "en1", contacts: [] });
    expect(urlOf(0).pathname).toBe("/care_lines/enrollments/en1");
    expect(await countCareSuggestions("tm1")).toBe(3);
    expect(urlOf(1).pathname).toBe("/care_lines/suggestions/count");
    expect(Object.fromEntries(urlOf(1).searchParams)).toEqual({ team_id: "tm1" });
    expect(await countOverdueEnrollments("tm1")).toBe(12);
    expect(urlOf(2).pathname).toBe("/care_lines/enrollments/overdue/count");
    expect(await countOverdueEnrollments("tm1")).toBe(0);
  });

  it("prévia: equipe e indicador na URL; ausentes normalizados e estimate fica true", async () => {
    fetchMock.mockImplementationOnce(() => ok({ indicator: "C4", team: { id: "tm1" }, template_version: 1, denominator: 41, score: "37.5",
      max_score: 100, concept: "sufficient" }));
    expect(await getCarePreview("tm1", "C4")).toEqual({
      indicator: "C4", team: { id: "tm1" }, template_version: 1, denominator: 41, score: "37.5", max_score: 100, concept: "sufficient",
      practices: [], excluded: [], excluded_practices: [], estimate: true
    });
    expect(urlOf().pathname).toBe("/care_lines/preview");
    expect(Object.fromEntries(urlOf().searchParams)).toEqual({ team_id: "tm1", indicator: "C4" });
  });

  it("pessoa pelo CPF no corpo de um POST; atalho do agendamento devolve pedido e unidade", async () => {
    fetchMock
      .mockImplementationOnce(() => ok({ person: { patient_id: null, citizen_id: "ci3", display_name: null, cpf_masked: "***.982.247-**", verified: true } }))
      .mockImplementationOnce(() => ok({ request: { id: "rq1" }, unit: { id: "u1" }, can_book: false }));
    expect((await lookupCarePerson("52998224725")).citizen_id).toBe("ci3");
    expect(urlOf(0).pathname).toBe("/care_lines/person_lookup");
    expect(urlOf(0).search).toBe("");
    expect(initOf(0).method).toBe("POST");
    expect(bodyOf(0)).toEqual({ cpf: "52998224725" });
    expect(await openCareAppointment("en1")).toEqual({ request: { id: "rq1" }, unit: { id: "u1" }, can_book: false });
    expect(urlOf(1).pathname).toBe("/care_lines/enrollments/en1/appointment_request");
    expect(initOf(1).method).toBe("POST");
    expect(bodyOf(1)).toEqual({});
  });

  it("prévia: excluded_practices e score nulo (sem dados) chegam como o api manda", async () => {
    const body = {
      indicator: "C2", team: { id: "tm1" }, template_version: 1, denominator: 0, score: null, max_score: 100, concept: null,
      practices: [ { key: "c2_a", label: "Consulta", tracked: true, points: 20, weight: "0.0", achieved: 0, denominator: 0 } ],
      excluded: [ "acs_visit" ], excluded_practices: [ { key: "c2_a", reason: "no_eligible" }, { key: "c2_d", reason: "untracked" } ], estimate: true
    };
    fetchMock.mockImplementationOnce(() => ok(body));
    expect(await getCarePreview("tm1", "C2")).toEqual(body);
  });

  it("atalho do agendamento: can_book decide a tela; erros do api sobem como ApiError com o código", async () => {
    fetchMock.mockImplementationOnce(() => ok({ request: { id: "rq2", kind: "care_line" }, unit: { id: "u1", kind: "ubs" }, can_book: true }, { status: 201 }));
    expect((await openCareAppointment("en1")).can_book).toBe(true);
    fetchMock.mockImplementationOnce(() => ok({ error: "already_scheduled" }, { status: 409 }));
    await expect(openCareAppointment("en1")).rejects.toMatchObject({ status: 409, body: { error: "already_scheduled" } });
    fetchMock.mockImplementationOnce(() => ok({ error: "citizen_not_verified" }, { status: 409 }));
    await expect(lookupCarePerson("52998224725")).rejects.toMatchObject({ status: 409, body: { error: "citizen_not_verified" } });
  });
});
