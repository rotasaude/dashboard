// src/lib/api.lab.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectSampleByBarcode, countUnnotifiedCriticals, createLabRequisition, enterLabResults, fetchLabLabels, fetchLabReportCsv,
  fetchWorklistPdf, getLabEntry, listLabRequisitions, listWorklist, receiveSample, receiveShipment, releaseRequisition,
  revokeMiddlewareToken, rotateMiddlewareToken, setGalRequisition, updateUnit
} from "./api";

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
}

describe("cliente do laboratório (contrato §3–§6)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(() => ok({ requisitions: [], next_before: null }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => fetchMock.mock.calls[i][1] as RequestInit;
  const headersOf = (i = 0) => initOf(i).headers as Record<string, string>;
  const bodyOf = (i = 0) => JSON.parse(String(initOf(i).body));

  it("lista de requisições: status[] repetido, laboratório, unidade, número, etiqueta, cursor e limit", async () => {
    await listLabRequisitions({ statuses: [ "open", "typed" ], providerId: "pv9", originUnitId: "u1", number: "00000123",
      barcode: "0000012301", before: "c1" });
    const url = urlOf();
    expect(url.pathname).toBe("/lab/requisitions");
    expect(url.searchParams.getAll("status[]")).toEqual([ "open", "typed" ]);
    expect(url.searchParams.get("provider_id")).toBe("pv9");
    expect(url.searchParams.get("origin_unit_id")).toBe("u1");
    expect(url.searchParams.get("number")).toBe("00000123");
    expect(url.searchParams.get("barcode")).toBe("0000012301");
    expect(url.searchParams.get("before")).toBe("c1");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(initOf().credentials).toBe("include");
  });

  it("requisição nova: nome da mãe e informação clínica só no corpo JSON", async () => {
    fetchMock.mockReturnValueOnce(ok({ id: "rq1" }));
    await createLabRequisition({
      patient_id: "pa1", provider_id: "pv9", origin_unit_id: "u1", collection_place: "ubs", biological_sex: "female",
      mother_name: "Maria Lima", urgent: false, clinical_info: "jejum de 12 h", exam_order_ids: [ "eo1" ],
      paper_orders: [ { sigtap_code: "0202010473", requester: { name: "Dr. Externo", cns: "702002887429583" } } ]
    });
    expect(urlOf().pathname).toBe("/lab/requisitions");
    expect(urlOf().search).toBe("");
    expect(initOf().method).toBe("POST");
    expect(headersOf()["Content-Type"]).toBe("application/json");
    expect(bodyOf().mother_name).toBe("Maria Lima");
    expect(bodyOf().paper_orders[0].requester.cns).toBe("702002887429583");
  });

  it("coleta, recebimento e conferência por leitura: o código vai no corpo, nunca na URL", async () => {
    fetchMock.mockImplementation(() => ok({}));
    await collectSampleByBarcode("0000012301");
    await receiveSample({ barcode: "0000012301", decision: "reject", reason_id: "rr1" });
    await receiveShipment("sh1", [ "0000012301", "0000012302" ]);
    expect(urlOf(0).pathname).toBe("/lab/samples/collect");
    expect(urlOf(1).pathname).toBe("/lab/samples/receive");
    expect(urlOf(2).pathname).toBe("/lab/shipments/sh1/receive");
    for (const i of [ 0, 1, 2 ]) {
      expect(urlOf(i).search).toBe("");
      expect(initOf(i).method).toBe("POST");
      expect(headersOf(i)["Content-Type"]).toBe("application/json");
    }
    expect(bodyOf(0)).toEqual({ barcode: "0000012301" });
    expect(bodyOf(1)).toEqual({ barcode: "0000012301", decision: "reject", reason_id: "rr1" });
    expect(bodyOf(2)).toEqual({ barcodes: [ "0000012301", "0000012302" ] });
  });

  it("etiquetas: sample_ids[] na URL e Accept de PDF", async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response(new Blob([ "%PDF" ]), { status: 200 })));
    await fetchLabLabels("rq1", [ "sa1", "sa2" ]);
    expect(urlOf().pathname).toBe("/lab/requisitions/rq1/labels.pdf");
    expect(urlOf().searchParams.getAll("sample_ids[]")).toEqual([ "sa1", "sa2" ]);
    expect(headersOf().Accept).toBe("application/pdf");
  });

  it("mapa de trabalho: filtros na URL; o PDF usa os mesmos filtros", async () => {
    fetchMock.mockImplementation(() => ok({ groups: [] }));
    const q = { providerId: "pv9", sector: "biochemistry", bench: "B1", urgent: true, date: "2026-10-15", pending: true };
    await listWorklist(q);
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response(new Blob([ "%PDF" ]), { status: 200 })));
    await fetchWorklistPdf(q);
    expect(urlOf(0).pathname).toBe("/lab/worklists");
    expect(urlOf(1).pathname).toBe("/lab/worklists.pdf");
    expect(urlOf(0).search).toBe(urlOf(1).search);
    expect(Object.fromEntries(urlOf(0).searchParams)).toEqual({
      provider_id: "pv9", sector: "biochemistry", bench: "B1", urgent: "true", date: "2026-10-15", pending: "true"
    });
  });

  it("digitação: abre por item ou por etiqueta; valores só no corpo", async () => {
    fetchMock.mockImplementation(() => ok({ items: [] }));
    await getLabEntry({ itemId: "it1" });
    await getLabEntry({ barcode: "0000012301" });
    await enterLabResults({ item_id: "it1", values: [ { analyte_key: "glicose", value: "98" } ] });
    expect(urlOf(0).searchParams.get("item_id")).toBe("it1");
    expect(urlOf(1).searchParams.get("barcode")).toBe("0000012301");
    expect(urlOf(2).pathname).toBe("/lab/results");
    expect(urlOf(2).search).toBe("");
    expect(bodyOf(2).values).toEqual([ { analyte_key: "glicose", value: "98" } ]);
  });

  it("liberação: TOTP só na avançada e só no corpo", async () => {
    fetchMock.mockImplementation(() => ok({ id: "lr1" }));
    await releaseRequisition("rq1", { item_ids: [ "it1" ], signature: "icp" });
    await releaseRequisition("rq1", { item_ids: [ "it1" ], signature: "advanced", totp: "123456" });
    expect(bodyOf(0)).toEqual({ item_ids: [ "it1" ], signature: "icp" });
    expect(bodyOf(1)).toEqual({ item_ids: [ "it1" ], signature: "advanced", totp: "123456" });
    expect(urlOf(1).search).toBe("");
  });

  it("contagem de críticos sem aviso: rota própria, sem lista", async () => {
    fetchMock.mockReturnValueOnce(ok({ count: 3 }));
    expect(await countUnnotifiedCriticals()).toBe(3);
    expect(urlOf().pathname).toBe("/lab/criticals/unnotified/count");
  });

  it("token do middleware: POST devolve o token; DELETE manda corpo JSON vazio", async () => {
    fetchMock.mockReturnValueOnce(ok({ token: "mw-secret" }));
    expect(await rotateMiddlewareToken("pv9")).toBe("mw-secret");
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response(null, { status: 204 })));
    await revokeMiddlewareToken("pv9");
    expect(urlOf(1).pathname).toBe("/lab/admin/providers/pv9/middleware_token");
    expect(initOf(1).method).toBe("DELETE");
    expect(initOf(1).body).toBe("{}");
    expect(headersOf(1)["Content-Type"]).toBe("application/json");
  });

  it("relatórios: CSV pela mesma consulta, com Accept text/csv", async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response(new Blob([ "a\n" ]), { status: 200 })));
    await fetchLabReportCsv("rejections", { providerId: "pv9", month: "2026-10" });
    expect(urlOf().pathname).toBe("/lab/reports/rejections.csv");
    expect(Object.fromEntries(urlOf().searchParams)).toEqual({ provider_id: "pv9", month: "2026-10" });
    expect(headersOf().Accept).toBe("text/csv");
  });

  it("GAL: número só no corpo", async () => {
    fetchMock.mockReturnValueOnce(ok({}));
    await setGalRequisition("eo1", "GAL-2026-77");
    expect(urlOf().pathname).toBe("/exams/orders/eo1/gal_requisition");
    expect(bodyOf()).toEqual({ gal_requisition: "GAL-2026-77" });
  });

  it("unidade: collects_samples só quando informado", async () => {
    fetchMock.mockImplementation(() => ok({ unit: { id: "u1" } }));
    const address = { address_street: null, address_number: null, address_complement: null, address_zip: null, neighborhood_id: null };
    await updateUnit("u1", "UBS Centro", "ubs", address, "walk_in", true);
    await updateUnit("u1", "UBS Centro", "ubs", address, "walk_in");
    expect(bodyOf(0).collects_samples).toBe(true);
    expect("collects_samples" in bodyOf(1)).toBe(false);
  });
});

describe("dados de teste do laboratório (contrato §14)", () => {
  it("linha de resultado traz effective (B30); faixa com idade obrigatória (B3); números reais (B16)", async () => {
    const f = await import("../test/labFixtures");
    expect(f.labResultRow().effective).toBe(true);
    expect(f.releaseRequisition().items[0].results.every((r) => typeof r.effective === "boolean")).toBe(true);
    for (const r of f.labTemplate().analytes.flatMap((a) => a.reference_ranges)) {
      expect(typeof r.age_min_days).toBe("number");
      expect(typeof r.age_max_days).toBe("number");
    }
    expect(f.labRequisition().number).toMatch(/^\d{8}$/);
    expect(f.labSample().barcode).toMatch(/^\d{10}$/);
    expect(f.labTemplate().sector).toBe("biochemistry");
    expect(f.labContext({ labs: [] }).labs).toEqual([]);
  });
});
