// src/lib/api.surveillance.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countNotifications, createConsultationNotification, createLocalDisease, createManualNotification, dismissNotification, fetchNotificationPdf,
  fetchWeekCsv, findSurveillanceDuplicates, getNotification, getNotificationSuggestions, getSurveillancePanel, listLocalDiseases, listNotifications,
  listSurveillanceDiseases, listSurveillanceUnits, listWeeklyNegatives, lookupSurveillancePerson, recordWeeklyNegative, transitionNotification,
  updateLocalDisease, updateNotificationForm, updateUnit
} from "./api";

function ok(body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }): Promise<Response> {
  return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers }));
}
const SENSITIVE = /cpf|cns|name|nome|mother|mae|birth|nasc|form|ficha|\d{11}/i;

describe("cliente da vigilância (contrato §3–§8, §15)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(() => ok({})); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => (fetchMock.mock.calls[i][1] ?? {}) as RequestInit;
  const headersOf = (i = 0) => initOf(i).headers as Record<string, string>;
  const bodyOf = (i = 0) => JSON.parse(String(initOf(i).body));

  it("doenças da cidade e sugestões da consulta em envelope; ausente vira lista vazia", async () => {
    fetchMock.mockImplementationOnce(() => ok({ diseases: [ { code: "dengue" } ] })).mockImplementationOnce(() => ok({}));
    expect(await listSurveillanceDiseases()).toEqual([ { code: "dengue" } ]);
    expect(urlOf(0).pathname).toBe("/surveillance/diseases");
    expect(await getNotificationSuggestions("cs1")).toEqual([]);
    expect(urlOf(1).pathname).toBe("/attendance/consultations/cs1/notification_suggestions");
  });

  it("notificar na consulta: só ids, código e data no corpo, com JSON", async () => {
    fetchMock.mockImplementationOnce(() => ok({ id: "nt1" }));
    await createConsultationNotification({ consultation_id: "cs1", disease_code: "dengue", symptoms_on: "2026-10-25" });
    expect(urlOf().pathname).toBe("/surveillance/notifications");
    expect(initOf().method).toBe("POST");
    expect(headersOf()["Content-Type"]).toBe("application/json");
    expect(bodyOf()).toEqual({ consultation_id: "cs1", disease_code: "dengue", symptoms_on: "2026-10-25" });
  });

  it("manual: a pessoa e a residência no corpo, nunca na URL", async () => {
    await createManualNotification({ new_patient: { full_name: "José Souza", birth_date: "2026-09-30", sex: "male", no_cpf_reason: "3" },
      duplicates_reviewed: true, disease_code: "sarampo", suspected_on: "2026-10-27", symptoms_on: null, unit_id: "u1",
      resident_elsewhere: true, residence_ibge: "4106902" });
    expect(urlOf().pathname + urlOf().search).toBe("/surveillance/notifications");
    expect(bodyOf().new_patient.full_name).toBe("José Souza");
    expect(bodyOf().residence_ibge).toBe("4106902");
  });

  it("fila: filtros e cursor na URL; contagem sem envelope", async () => {
    fetchMock.mockImplementationOnce(() => ok({ notifications: [], next_before: "c1" }))
      .mockImplementationOnce(() => ok({ possible: 2, notified: 5, investigating: 1, overdue: 3, immediate_open: 1, without_official_number: 4 }));
    expect(await listNotifications({ status: "notified", disease: "dengue", overdue: true, unitId: "u1", before: "c0" }))
      .toEqual({ notifications: [], next_before: "c1" });
    expect(urlOf(0).pathname + urlOf(0).search).toBe("/surveillance/notifications?status=notified&disease=dengue&overdue=true&unit_id=u1&before=c0&limit=50");
    expect((await countNotifications()).immediate_open).toBe(1);
    expect(urlOf(1).pathname).toBe("/surveillance/notifications/count");
  });

  it("fila: doença vazia ou nula nunca vai na URL (A7); sem filtros só o limite", async () => {
    fetchMock.mockImplementation(() => ok({ notifications: [], next_before: null }));
    await listNotifications({});
    expect(urlOf(0).search).toBe("?limit=50");
    await listNotifications({ status: null, disease: null, unitId: null, before: null });
    expect(urlOf(1).search).toBe("?limit=50");
    await listNotifications({ disease: "", overdue: false });
    expect(urlOf(2).searchParams.has("disease")).toBe(false);
    expect(urlOf(2).searchParams.has("overdue")).toBe(false);
  });

  it("fila: encerradas sem número oficial vão como without_official_number=true (A11)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ notifications: [], next_before: null }));
    await listNotifications({ status: "closed", withoutOfficialNumber: true });
    expect(urlOf().pathname + urlOf().search).toBe("/surveillance/notifications?status=closed&without_official_number=true&limit=50");
  });

  it("lista sem envelope: ausente vira vazia e cursor nulo", async () => {
    expect(await listNotifications({})).toEqual({ notifications: [], next_before: null });
  });

  it("detalhe, ficha, transição e descarte: versão no corpo", async () => {
    fetchMock.mockImplementation(() => ok({ id: "nt1" }));
    await getNotification("nt1");
    expect(urlOf(0).pathname).toBe("/surveillance/notifications/nt1");
    await updateNotificationForm("nt1", { phone: "41999990000", pregnancy: null }, 3);
    expect(initOf(1).method).toBe("PATCH");
    expect(bodyOf(1)).toEqual({ form: { phone: "41999990000", pregnancy: null }, version: 3 });
    await transitionNotification("nt1", { to: "closed", classification: "confirmed", version: 4 });
    expect(urlOf(2).pathname).toBe("/surveillance/notifications/nt1/transition");
    expect(bodyOf(2)).toEqual({ to: "closed", classification: "confirmed", version: 4 });
    await dismissNotification("nt1", "não era caso", 5);
    expect(urlOf(3).pathname).toBe("/surveillance/notifications/nt1/dismiss");
    expect(bodyOf(3)).toEqual({ reason: "não era caso", version: 5 });
    for (let i = 0; i < 4; i++) expect(urlOf(i).search).toBe("");
  });

  it("unidades e busca de pessoa da vigilância (D2, D3): CPF e nome só no corpo", async () => {
    fetchMock.mockImplementationOnce(() => ok({ units: [ { id: "u1" } ] }))
      .mockImplementationOnce(() => ok({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", has_cpf: true, cns_masked: null }))
      .mockImplementationOnce(() => ok({ candidates: [ { patient_id: "pa7" } ] }));
    expect(await listSurveillanceUnits()).toEqual([ { id: "u1" } ]);
    expect(urlOf(0).pathname).toBe("/surveillance/units");
    expect(await lookupSurveillancePerson("52998224725")).toEqual({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", has_cpf: true, cns_masked: null, registration_id: null });
    expect(urlOf(1).pathname + urlOf(1).search).toBe("/surveillance/person_lookup");
    expect(bodyOf(1)).toEqual({ cpf: "52998224725" });
    expect(await findSurveillanceDuplicates({ full_name: "Maria da Silva", birth_date: "1960-02-01", mother_name: "Ana" }))
      .toEqual([ { patient_id: "pa7", registration_id: null } ]);
    expect(urlOf(2).pathname + urlOf(2).search).toBe("/surveillance/patients/duplicates");
    for (let i = 0; i < 3; i++) expect(urlOf(i).search).not.toMatch(SENSITIVE);
  });

  it("negativa, saídas e painel: só semana e doença na URL", async () => {
    fetchMock.mockImplementationOnce(() => ok({ week: "2026-42", units: [] })).mockImplementationOnce(() => ok({}))
      .mockImplementationOnce(() => ok("%PDF", { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="notificacao-nt1.pdf"' }))
      .mockImplementationOnce(() => ok("a;b", { "Content-Type": "text/csv" }))
      .mockImplementationOnce(() => ok({ weeks: [ "2026-42" ], rows: [], suppressed: true }));
    expect(await listWeeklyNegatives("2026-42")).toEqual({ week: "2026-42", units: [] });
    expect(urlOf(0).pathname + urlOf(0).search).toBe("/surveillance/weekly_negatives?week=2026-42");
    await recordWeeklyNegative("u1", "2026-42");
    expect(bodyOf(1)).toEqual({ unit_id: "u1", week: "2026-42" });
    expect((await fetchNotificationPdf("nt1")).filename).toBe("notificacao-nt1.pdf");
    expect(urlOf(2).pathname).toBe("/surveillance/notifications/nt1/form.pdf");
    expect((await fetchWeekCsv("2026-42")).filename).toBeNull();
    expect(urlOf(3).pathname + urlOf(3).search).toBe("/surveillance/exports/week.csv?week=2026-42");
    await getSurveillancePanel({ fromWeek: "2026-35", toWeek: "2026-42", disease: "dengue" });
    expect(urlOf(4).pathname + urlOf(4).search).toBe("/surveillance/panel?from_week=2026-35&to_week=2026-42&disease=dengue");
  });

  it("painel: doença nula ou vazia nunca vai na URL (A7)", async () => {
    fetchMock.mockImplementation(() => ok({ weeks: [], rows: [], suppressed: true }));
    await getSurveillancePanel({ fromWeek: "2026-35", toWeek: "2026-42", disease: null });
    expect(urlOf(0).searchParams.has("disease")).toBe(false);
    expect(urlOf(0).search).toBe("?from_week=2026-35&to_week=2026-42");
    await getSurveillancePanel({ fromWeek: "2026-35", toWeek: "2026-42", disease: "" });
    expect(urlOf(1).searchParams.has("disease")).toBe(false);
    await getSurveillancePanel({ fromWeek: "2026-35", toWeek: "2026-42" });
    expect(urlOf(2).searchParams.has("disease")).toBe(false);
  });

  it("doenças locais: lista, criação e alteração com JSON (D4)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ diseases: [ { id: "ld1" } ] })).mockImplementation(() => ok({ id: "ld1" }));
    expect(await listLocalDiseases()).toEqual([ { id: "ld1" } ]);
    expect(urlOf(0).pathname).toBe("/surveillance/admin/local_diseases");
    const input = { code: "local_febre_oropouche", name: "Febre do Oropouche", deadline: "immediate" as const, cid10: [ "A938" ], ciap2: [], repeat_after_days: 30 };
    await createLocalDisease(input);
    expect(initOf(1).method).toBe("POST");
    expect(bodyOf(1)).toEqual(input);
    await updateLocalDisease("ld1", { ...input, active: false });
    expect(urlOf(2).pathname).toBe("/surveillance/admin/local_diseases/ld1");
    expect(initOf(2).method).toBe("PATCH");
    expect(bodyOf(2).active).toBe(false);
  });

  it("unidade notificadora vai no corpo da edição da unidade (D15)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ unit: { id: "u1" } }));
    await updateUnit("u1", "UBS Centro", "ubs", { address_street: null, address_number: null, address_complement: null, address_zip: null, neighborhood_id: null },
      undefined, undefined, false);
    expect(bodyOf().notifying).toBe(false);
  });

  it("unidade sem o 7º argumento não manda notifying", async () => {
    fetchMock.mockImplementationOnce(() => ok({ unit: { id: "u1" } }));
    await updateUnit("u1", "UBS Centro", "ubs", { address_street: null, address_number: null, address_complement: null, address_zip: null, neighborhood_id: null });
    expect("notifying" in bodyOf()).toBe(false);
  });
});
