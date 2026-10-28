// src/lib/api.regulation.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addNurseItem, authorizeRegulationRequest, cancelRegulationRequest, complementRegulationRequest, countRegulationRequests, createCareOffer,
  createCareProvider, createRegulationRequest, deleteRegulationRequest, denyRegulationRequest, fetchRegulationGuide, fetchStateExportCsv,
  getRegulationRequest, getRiskDeadlines, listCareOffers, listCareProviders, listConsultationRegulationRequests, listNurseItems,
  listRegulationRequests, listReturnedRequests, recordRegulationOutcome, removeNurseItem, returnRegulationRequest, scheduleRegulationRequest,
  searchRegulationTargets, setRegulationExternal, updateCareOffer, updateRegulationRequest, updateRiskDeadlines
} from "./api";

function ok(body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }): Promise<Response> {
  return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers }));
}
// CID-10, trechos da justificativa e dos motivos usados abaixo; nada disso pode aparecer em URL.
const SENSITIVE = /I20|I209|K86|dor|tor[aá]cic|esfor|motivo|falta de exame|duplicad|cardio|justif|cid/i;

describe("cliente da regulação (contrato §3–§8)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(() => ok({})); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => (fetchMock.mock.calls[i][1] ?? {}) as RequestInit;
  const headersOf = (i = 0) => initOf(i).headers as Record<string, string>;
  const bodyOf = (i = 0) => JSON.parse(String(initOf(i).body));
  const INPUT = { type: "specialty" as const, target_code: "225120", cid10: "I209", ciap2: "K86", suggested_color: "yellow" as const,
    justification: "Dor torácica aos esforços há 3 meses, teste ergométrico alterado." };

  it("busca de alvo (R2): GET com tipo, termo e limite; envelope; ausente vira lista vazia", async () => {
    const CARDIO_T = { type: "specialty", code: "225120", name: "Cardiologia", group: null, nurse_allowed: false };
    fetchMock.mockImplementationOnce(() => ok({ targets: [ CARDIO_T ] })).mockImplementationOnce(() => ok({}));
    expect(await searchRegulationTargets("cardio", "specialty")).toEqual([ CARDIO_T ]);
    expect(urlOf(0).pathname).toBe("/regulation/targets");
    expect(Object.fromEntries(urlOf(0).searchParams)).toEqual({ type: "specialty", q: "cardio", limit: "20" });
    expect(await searchRegulationTargets("eco", "procedure")).toEqual([]);
    expect(Object.fromEntries(urlOf(1).searchParams)).toEqual({ type: "procedure", q: "eco", limit: "20" });
  });

  it("pedidos da consulta: listar, criar, editar e retirar o rascunho, com JSON", async () => {
    fetchMock.mockImplementationOnce(() => ok({ requests: [ { id: "rr1" } ] })).mockImplementationOnce(() => ok({ id: "rr1" }))
      .mockImplementationOnce(() => ok({ id: "rr1" })).mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await listConsultationRegulationRequests("cs1")).toEqual([ { id: "rr1" } ]);
    expect(urlOf(0).pathname).toBe("/attendance/consultations/cs1/regulation_requests");
    await createRegulationRequest("cs1", INPUT);
    expect([ urlOf(1).pathname, initOf(1).method ]).toEqual([ "/attendance/consultations/cs1/regulation_requests", "POST" ]);
    expect(headersOf(1)["Content-Type"]).toBe("application/json");
    expect(bodyOf(1)).toEqual(INPUT);
    await updateRegulationRequest("cs1", "rr1", { ...INPUT, suggested_color: "red" });
    expect([ urlOf(2).pathname, initOf(2).method, bodyOf(2).suggested_color ]).toEqual([ "/attendance/consultations/cs1/regulation_requests/rr1", "PATCH", "red" ]);
    await deleteRegulationRequest("cs1", "rr1");
    expect([ urlOf(3).pathname, initOf(3).method ]).toEqual([ "/attendance/consultations/cs1/regulation_requests/rr1", "DELETE" ]);
    expect(headersOf(3)["Content-Type"]).toBe("application/json");
    expect(bodyOf(3)).toEqual({});
  });

  it("fila: só os filtros que vieram, com limite; página e contagem com padrões", async () => {
    fetchMock.mockImplementationOnce(() => ok({ requests: [ { id: "rr1" } ], next_before: "c1" })).mockImplementationOnce(() => ok({}))
      .mockImplementationOnce(() => ok({ pending: 4 }));
    expect(await listRegulationRequests({ status: "pending", type: "specialty", targetCode: "225120", color: "red", before: "c0" }))
      .toEqual({ requests: [ { id: "rr1" } ], next_before: "c1" });
    expect(urlOf(0).pathname).toBe("/regulation/requests");
    expect(Object.fromEntries(urlOf(0).searchParams)).toEqual({ status: "pending", type: "specialty", target_code: "225120", color: "red", before: "c0", limit: "50" });
    expect(await listRegulationRequests({ overdue: true, status: null, type: null, targetCode: null, color: null }))
      .toEqual({ requests: [], next_before: null });
    expect(Object.fromEntries(urlOf(1).searchParams)).toEqual({ overdue: "true", limit: "50" });
    expect(await countRegulationRequests()).toEqual({ pending: 4, overdue: 0, returned: 0, authorized: 0, external: 0 });
    expect(urlOf(2).pathname).toBe("/regulation/requests/count");
    await listRegulationRequests({ status: "pending", overdue: false });
    expect(Object.fromEntries(urlOf(3).searchParams)).toEqual({ status: "pending", overdue: "false", limit: "50" });
  });

  it("decisões: versão e motivos só no corpo", async () => {
    await getRegulationRequest("rr1");
    await authorizeRegulationRequest("rr1", { offer_id: "of1", color: "red", color_reason: "motivo da cor", skip_reason: "falta de exame", version: 3 });
    await returnRegulationRequest("rr1", "motivo de devolver", 3);
    await denyRegulationRequest("rr1", "motivo de negar", 3);
    await cancelRegulationRequest("rr1", "duplicado", 3);
    expect(urlOf(0).pathname).toBe("/regulation/requests/rr1");
    expect([ urlOf(1).pathname, bodyOf(1) ]).toEqual([ "/regulation/requests/rr1/authorize",
      { offer_id: "of1", color: "red", color_reason: "motivo da cor", skip_reason: "falta de exame", version: 3 } ]);
    expect([ urlOf(2).pathname, bodyOf(2) ]).toEqual([ "/regulation/requests/rr1/return", { reason: "motivo de devolver", version: 3 } ]);
    expect([ urlOf(3).pathname, bodyOf(3) ]).toEqual([ "/regulation/requests/rr1/deny", { reason: "motivo de negar", version: 3 } ]);
    expect([ urlOf(4).pathname, bodyOf(4) ]).toEqual([ "/regulation/requests/rr1/cancel", { reason: "duplicado", version: 3 } ]);
    for (let i = 1; i <= 4; i++) expect([ initOf(i).method, headersOf(i)["Content-Type"] ]).toEqual([ "POST", "application/json" ]);
  });

  it("solicitante, agendamento, desfecho e número externo", async () => {
    fetchMock.mockImplementationOnce(() => ok({ requests: [ { id: "rr1" } ] }));
    expect(await listReturnedRequests("u1")).toEqual([ { id: "rr1" } ]);
    expect([ urlOf(0).pathname, urlOf(0).search ]).toEqual([ "/regulation/returned", "?unit_id=u1" ]);
    await complementRegulationRequest("rr1", { justification: INPUT.justification, ciap2: "K86", suggested_color: "yellow", version: 4 });
    expect([ urlOf(1).pathname, bodyOf(1) ]).toEqual([ "/regulation/requests/rr1/complement",
      { justification: INPUT.justification, ciap2: "K86", suggested_color: "yellow", version: 4 } ]);
    await scheduleRegulationRequest("rr1", { at: "2026-11-10T14:30:00-03:00", place: "Clínica do Coração, Rua XV, 100", notes: null, version: 5 });
    expect([ urlOf(2).pathname, bodyOf(2) ]).toEqual([ "/regulation/requests/rr1/schedule",
      { at: "2026-11-10T14:30:00-03:00", place: "Clínica do Coração, Rua XV, 100", notes: null, version: 5 } ]);
    await recordRegulationOutcome("rr1", "missed", 6);
    expect([ urlOf(3).pathname, bodyOf(3) ]).toEqual([ "/regulation/requests/rr1/outcome", { result: "missed", version: 6 } ]);
    await setRegulationExternal("rr1", "sisreg", "2026/123456", 7);
    expect([ urlOf(4).pathname, bodyOf(4) ]).toEqual([ "/regulation/requests/rr1/external", { system: "sisreg", number: "2026/123456", version: 7 } ]);
  });

  it("guia e CSV lidos com fetch; nome do arquivo seguro ou nulo", async () => {
    fetchMock.mockImplementationOnce(() => ok("%PDF", { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="guia-regulacao-rr1.pdf"' }))
      .mockImplementationOnce(() => ok("a;b", { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="Joana Lima.csv"' }));
    expect((await fetchRegulationGuide("rr1")).filename).toBe("guia-regulacao-rr1.pdf");
    expect(urlOf(0).pathname).toBe("/regulation/requests/rr1/guide.pdf");
    expect((await fetchStateExportCsv("pending")).filename).toBeNull();
    expect([ urlOf(1).pathname, urlOf(1).search ]).toEqual([ "/regulation/exports/state.csv", "?status=pending" ]);
  });

  it("administração: prestadores, ofertas, prazos e lista do enfermeiro", async () => {
    fetchMock.mockImplementationOnce(() => ok({ providers: [ { id: "pr1" } ] })).mockImplementationOnce(() => ok({ id: "pr1" }))
      .mockImplementationOnce(() => ok({ offers: [ { id: "of1" } ] })).mockImplementationOnce(() => ok({ id: "of1" }))
      .mockImplementationOnce(() => ok({ id: "of1" })).mockImplementationOnce(() => ok({ red: 7, yellow: 30, green: 90, blue: 180 }))
      .mockImplementationOnce(() => ok({ red: 5, yellow: 30, green: 90, blue: 180 })).mockImplementationOnce(() => ok({ items: [] }))
      .mockImplementationOnce(() => ok({ target_type: "procedure", target_code: "0205010032", name: "Ecocardiografia transtorácica" }))
      .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await listCareProviders()).toEqual([ { id: "pr1" } ]);
    await createCareProvider({ name: "UBS Especialidades", cnes: "2384310", kind: "own", health_unit_id: "u2", active: true });
    expect([ urlOf(1).pathname, initOf(1).method, bodyOf(1).kind ]).toEqual([ "/regulation/admin/providers", "POST", "own" ]);
    expect(await listCareOffers({ month: "2026-10", targetCode: "225120" })).toEqual([ { id: "of1" } ]);
    expect(Object.fromEntries(urlOf(2).searchParams)).toEqual({ month: "2026-10", target_code: "225120" });
    await createCareOffer({ provider_id: "pr1", target_type: "specialty", target_code: "225120", month: "2026-11", quantity: 10 });
    expect([ urlOf(3).pathname, bodyOf(3).quantity ]).toEqual([ "/regulation/admin/offers", 10 ]);
    await updateCareOffer("of1", 12);
    expect([ urlOf(4).pathname, initOf(4).method, bodyOf(4) ]).toEqual([ "/regulation/admin/offers/of1", "PATCH", { quantity: 12 } ]);
    expect(await getRiskDeadlines()).toEqual({ red: 7, yellow: 30, green: 90, blue: 180 });
    await updateRiskDeadlines({ red: 5, yellow: 30, green: 90, blue: 180 });
    expect([ urlOf(6).pathname, initOf(6).method, bodyOf(6) ]).toEqual([ "/regulation/admin/deadlines", "PATCH", { red: 5, yellow: 30, green: 90, blue: 180 } ]);
    expect(await listNurseItems()).toEqual([]);
    await addNurseItem({ target_type: "procedure", target_code: "0205010032" });
    expect([ urlOf(8).pathname, bodyOf(8) ]).toEqual([ "/regulation/admin/nurse_items", { target_type: "procedure", target_code: "0205010032" } ]);
    await removeNurseItem({ target_type: "procedure", target_code: "0205010032" });
    expect([ urlOf(9).pathname, initOf(9).method, bodyOf(9) ]).toEqual([ "/regulation/admin/nurse_items", "DELETE",
      { target_type: "procedure", target_code: "0205010032" } ]);
  });

  it("nada sensível na URL: CID, justificativa e motivos só no corpo", async () => {
    await createRegulationRequest("cs1", INPUT);
    await authorizeRegulationRequest("rr1", { offer_id: "of1", color_reason: "motivo da cor", skip_reason: "falta de exame", version: 3 });
    await returnRegulationRequest("rr1", "motivo de devolver", 3);
    await complementRegulationRequest("rr1", { justification: INPUT.justification, cid10: "I209", ciap2: "K86", version: 4 });
    for (const call of fetchMock.mock.calls) expect(decodeURIComponent(String(call[0]))).not.toMatch(SENSITIVE);
  });
});
