// src/lib/api.exams.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeExam, fetchExamPdf, fetchExamReportCsv, isExamLinkExpired, listExamOrders, listPendingAcknowledgements,
  listProviderOrders, listTeamAcknowledgements, lookupExamPatient, providerSchedule, revokeFhirToken, updateCatalogItem, uploadExamFile
} from "./api";

function ok(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } }));
}

describe("cliente de exames (contrato §3–§6)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(() => ok({ orders: [], next_before: null }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => fetchMock.mock.calls[i][1] as RequestInit;
  const headersOf = (i = 0) => initOf(i).headers as Record<string, string>;

  it("lista com status[] repetido, atraso, etapa, prestador, exame, cursor e limit", async () => {
    await listExamOrders({ unitId: "u1", statuses: [ "scheduled", "collected" ], overdue: true, stage: "collect",
      providerId: "pv1", sigtapCode: "0202020380", before: "c1" });
    const url = urlOf();
    expect(url.pathname).toBe("/exams/orders");
    expect(url.searchParams.get("unit_id")).toBe("u1");
    expect(url.searchParams.getAll("status[]")).toEqual([ "scheduled", "collected" ]);
    expect(url.searchParams.get("overdue")).toBe("true");
    expect(url.searchParams.get("stage")).toBe("collect");
    expect(url.searchParams.get("provider_id")).toBe("pv1");
    expect(url.searchParams.get("sigtap_code")).toBe("0202020380");
    expect(url.searchParams.get("before")).toBe("c1");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(initOf().method).toBeUndefined();
    expect(initOf().credentials).toBe("include");
  });

  it("coordenação sem unidade: nenhum unit_id nem patient_id (Divergência D15)", async () => {
    await listExamOrders({ overdue: true, before: null });
    expect([ ...urlOf().searchParams.keys() ].sort()).toEqual([ "limit", "overdue" ]);
  });

  it("o CPF da busca do paciente vai no corpo, nunca na URL (D2)", async () => {
    fetchMock.mockImplementation(() => ok({ patient: { id: "pa1", display_name: "Joana Lima", cpf_masked: "***.982.247-**" } }));
    expect((await lookupExamPatient("52998224725")).id).toBe("pa1");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/exams/patient_lookup");
    expect(initOf().method).toBe("POST");
    expect(JSON.parse(String(initOf().body))).toEqual({ cpf: "52998224725" });
    expect(headersOf()["Content-Type"]).toBe("application/json");
  });

  it("upload: JSON com o tipo e o base64, sem o nome do arquivo (D1)", async () => {
    fetchMock.mockImplementation(() => ok({ upload_id: "up1" }));
    const file = new File([ "%PDF-1.4 exemplo" ], "laudo Joana Lima.pdf", { type: "application/pdf" });
    expect(await uploadExamFile(file)).toBe("up1");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/exams/uploads");
    expect(headersOf()["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(initOf().body))).toEqual({ content_type: "application/pdf", data: btoa("%PDF-1.4 exemplo") });
    expect(String(initOf().body)).not.toContain("Joana");
  });

  it("ciência sem motivo manda {}; com motivo manda o motivo", async () => {
    fetchMock.mockImplementation(() => ok({}));
    await acknowledgeExam("eo1");
    await acknowledgeExam("eo1", "Paciente avisado por telefone");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/exams/orders/eo1/acknowledge");
    expect(JSON.parse(String(initOf(0).body))).toEqual({});
    expect(JSON.parse(String(initOf(1).body))).toEqual({ reason: "Paciente avisado por telefone" });
  });

  it("pendentes: resposta sem `denied` vira lista vazia (D7)", async () => {
    fetchMock.mockImplementation(() => ok({ orders: [] }));
    expect(await listPendingAcknowledgements()).toEqual({ orders: [], denied: [], next_before: null });
    expect(urlOf().pathname).toBe("/exams/acknowledgements/pending");
  });

  it("revogar o token: DELETE com corpo JSON", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await revokeFhirToken("pv1");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/exams/admin/providers/pv1/fhir_token");
    expect(initOf().method).toBe("DELETE");
    expect(initOf().body).toBe("{}");
    expect(headersOf()["Content-Type"]).toBe("application/json");
  });

  it("portal do prestador: lê overdue_count do corpo (A20); ausente ou torto vira 0", async () => {
    fetchMock.mockImplementationOnce(() => ok({ orders: [], next_before: null, overdue_count: 3 }));
    expect((await listProviderOrders({ statuses: [ "scheduled" ], before: null })).overdue_count).toBe(3);
    expect(urlOf().pathname).toBe("/exams/provider/orders");
    expect(urlOf().searchParams.getAll("status[]")).toEqual([ "scheduled" ]);
    fetchMock.mockImplementationOnce(() => ok({ orders: [], next_before: null, overdue_count: "muitos" }));
    expect((await listProviderOrders({ overdue: true, before: null })).overdue_count).toBe(0);
    expect(urlOf(1).searchParams.get("overdue")).toBe("true");
  });

  it("fila da equipe devolve a página com o cursor", async () => {
    fetchMock.mockImplementation(() => ok({ orders: [], next_before: "c9" }));
    expect(await listTeamAcknowledgements()).toEqual({ orders: [], next_before: "c9" });
    expect(urlOf().pathname).toBe("/exams/acknowledgements/team");
  });

  it("link vencido é 410 link_expired; 404 e 403 feature_disabled não são (C9)", async () => {
    const gone = () => Promise.resolve(new Response(JSON.stringify({ error: "link_expired" }), { status: 410 }));
    fetchMock.mockImplementationOnce(gone);
    const err = await fetchExamPdf("/exams/files/tok").catch((e) => e);
    expect(isExamLinkExpired(err)).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/exams/files/tok");
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 })));
    expect(isExamLinkExpired(await fetchExamPdf("/exams/files/x").catch((e) => e))).toBe(false);
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ error: "feature_disabled", feature: "exam_tracking" }), { status: 403 })));
    expect(isExamLinkExpired(await fetchExamPdf("/exams/files/y").catch((e) => e))).toBe(false);
  });

  it("PATCH do catálogo não manda sigtap_code (C17)", async () => {
    fetchMock.mockImplementation(() => ok({}));
    await updateCatalogItem("ci1", {
      sigtap_code: "0202020380", requires_authorization: true, release_policy: "immediate", active: true,
      deadlines: { authorize: null, schedule: null, collect: null, result: 10, acknowledge: null }, result_fields: []
    });
    expect(initOf().method).toBe("PATCH");
    expect(JSON.parse(String(initOf().body))).not.toHaveProperty("sigtap_code");
    expect(JSON.parse(String(initOf().body)).release_policy).toBe("immediate");
  });

  it("agendar pelo portal não manda provider_id (D9)", async () => {
    fetchMock.mockImplementation(() => ok({}));
    await providerSchedule("eo1", { scheduled_at: "2026-10-20T08:30:00-03:00", scheduled_place: "Posto de coleta" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/exams/provider/orders/eo1/schedule");
    expect(JSON.parse(String(initOf().body))).toEqual({ scheduled_at: "2026-10-20T08:30:00-03:00", scheduled_place: "Posto de coleta" });
  });

  it("CSV detalhado do relatório: mês, prestador e detail na URL; Accept text/csv", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("short_code,sigtap_code\n", {
      status: 200, headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="conferencia-2026-10.csv"' }
    })));
    const file = await fetchExamReportCsv("2026-10", "pv1", true);
    const url = urlOf();
    expect(url.pathname).toBe("/exams/admin/report.csv");
    expect(url.searchParams.get("month")).toBe("2026-10");
    expect(url.searchParams.get("provider_id")).toBe("pv1");
    expect(url.searchParams.get("detail")).toBe("true");
    expect(headersOf().Accept).toBe("text/csv");
    expect(file.filename).toBe("conferencia-2026-10.csv");
  });

  it("recusa vira ApiError com o código do corpo", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "invalid_transition", status: "scheduled" }), { status: 409 })));
    await expect(listExamOrders({ patientId: "pa1" })).rejects.toMatchObject({ status: 409, body: { error: "invalid_transition" } });
  });
});
