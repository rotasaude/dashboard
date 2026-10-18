// src/lib/api.qc.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptQcSuggestion, closeQcLot, countActiveQcBlocks, createEqaAnnualReport, createInstrument, decideQcReview, fetchConsumptionCsv,
  fetchEqaAnnualReport, fetchSupplyLotTraceCsv, getConsumption, getEqaSummary, getInventoryAlerts, listInUse, setInUse, getQcChart, grantQcException, listEqaAnnualReports,
  listLabInstruments, listQcLots, listQcReviews, listSupplyLots, recordQcValue, recordSupplyMovement, saveQcRules, traceSupplyLot,
  updateInstrument, uploadEqaReport
} from "./api";

function ok(body: unknown, init: ResponseInit = {}): Promise<Response> {
  return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" }, ...init
  }));
}

describe("cliente do 21c (contrato §2–§5)", () => {
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

  it("aparelhos: leitura por laboratório; escrita do admin com JSON", async () => {
    fetchMock.mockImplementationOnce(() => ok({ instruments: [ { id: "in1" } ] }));
    expect(await listLabInstruments("pv9")).toEqual([ { id: "in1" } ]);
    expect(urlOf().pathname).toBe("/lab/instruments");
    expect(urlOf().searchParams.get("provider_id")).toBe("pv9");
    const input = { provider_id: "pv9", name: "BS-200", manufacturer: "Mindray", model: "BS-200", serial_number: "SN1", sector: "biochemistry", hl7_equipment_id: null, active: true };
    await createInstrument(input);
    expect(urlOf(1).pathname).toBe("/lab/admin/instruments");
    expect(initOf(1).method).toBe("POST");
    expect(headersOf(1)["Content-Type"]).toBe("application/json");
    expect(bodyOf(1)).toEqual(input);
    await updateInstrument("in1", { ...input, active: false });
    expect(urlOf(2).pathname).toBe("/lab/admin/instruments/in1");
    expect(initOf(2).method).toBe("PATCH");
  });

  it("lotes de controle: filtro por laboratório e situação; encerrar manda {}", async () => {
    fetchMock.mockImplementationOnce(() => ok({ lots: [] }));
    await listQcLots({ providerId: "pv9", status: "in_use" });
    expect(urlOf().pathname).toBe("/lab/qc/lots");
    expect(urlOf().searchParams.get("provider_id")).toBe("pv9");
    expect(urlOf().searchParams.get("status")).toBe("in_use");
    await closeQcLot("ql1");
    expect(urlOf(1).pathname).toBe("/lab/qc/lots/ql1/close");
    expect(initOf(1).method).toBe("POST");
    expect(bodyOf(1)).toEqual({});
  });

  it("valor de controle e regras: tudo no corpo, nada na URL", async () => {
    fetchMock.mockImplementationOnce(() => ok({ value: {}, run: {}, block: null }));
    await recordQcValue({ run_id: null, instrument_id: "in1", lot_id: "ql1", level: "normal", analyte_key: "glicose", value: "98.5" });
    expect(urlOf().pathname).toBe("/lab/qc/values");
    expect(urlOf().search).toBe("");
    expect(bodyOf()).toEqual({ run_id: null, instrument_id: "in1", lot_id: "ql1", level: "normal", analyte_key: "glicose", value: "98.5" });
    const rules = { "1_2s": true, "1_3s": true, "2_2s": true, "R_4s": true, "4_1s": false, "10x": false };
    await saveQcRules({ instrument_id: "in1", analyte_key: "glicose", rules, justification: "aparelho novo em validação, 4-1s gera falso alarme" });
    expect(urlOf(1).pathname).toBe("/lab/qc/rules");
    expect(initOf(1).method).toBe("PUT");
    expect(headersOf(1)["Content-Type"]).toBe("application/json");
    expect(urlOf(1).search).toBe("");
  });

  it("sugestão aceita, exceção e revisão: chave e texto no corpo", async () => {
    await acceptQcSuggestion({ lot_id: "ql1", level: "normal", analyte_key: "glicose", instrument_id: "in1", reason: "20 corridas aprovadas no lote" });
    expect(urlOf().pathname).toBe("/lab/qc/targets/suggestions/accept");
    expect(bodyOf().reason).toBe("20 corridas aprovadas no lote");
    await grantQcException({ block_id: "qb1", item_id: "it2", justification: "paciente internado, médico ciente" });
    expect(urlOf(1).pathname).toBe("/lab/qc/exceptions");
    expect(urlOf(1).search).toBe("");
    await decideQcReview("rv1", { decision: "kept", note: "valor coerente com o anterior" });
    expect(urlOf(2).pathname).toBe("/lab/qc/reviews/rv1");
    expect(bodyOf(2)).toEqual({ decision: "kept", note: "valor coerente com o anterior" });
  });

  it("Levey-Jennings: só chaves e datas na URL", async () => {
    fetchMock.mockImplementationOnce(() => ok({ target: null, points: [] }));
    await getQcChart({ lot_id: "ql1", level: "patológico", analyte_key: "glicose", instrument_id: "in1", from: "2026-09-18", to: "2026-10-18" });
    const p = urlOf().searchParams;
    expect(urlOf().pathname).toBe("/lab/qc/chart");
    expect([ ...p.keys() ].sort()).toEqual([ "analyte_key", "from", "instrument_id", "level", "lot_id", "to" ]);
    expect(p.get("level")).toBe("patológico");
  });

  it("contador de bloqueios: número; corpo estranho vira 0", async () => {
    fetchMock.mockImplementationOnce(() => ok({ count: 3 }));
    expect(await countActiveQcBlocks()).toBe(3);
    expect(urlOf().pathname).toBe("/lab/qc/blocks/active/count");
    fetchMock.mockImplementationOnce(() => ok({ count: "x" }));
    expect(await countActiveQcBlocks()).toBe(0);
  });

  it("estoque: lotes com saldo; movimento com quantidade no corpo", async () => {
    fetchMock.mockImplementationOnce(() => ok({ lots: [] }));
    await listSupplyLots({ supplyId: "su1" });
    expect(urlOf().pathname).toBe("/lab/inventory/lots");
    expect(urlOf().searchParams.get("supply_id")).toBe("su1");
    expect(urlOf().searchParams.get("with_balance")).toBe("true");
    await recordSupplyMovement({ lot_id: "sl1", kind: "loss", quantity: 1, reason: "frasco quebrado" });
    expect(urlOf(1).pathname).toBe("/lab/inventory/movements");
    expect(urlOf(1).search).toBe("");
    expect(bodyOf(1)).toEqual({ lot_id: "sl1", kind: "loss", quantity: 1, reason: "frasco quebrado" });
  });

  it("rastreio e consumo: JSON e CSV com fetch (não navegação)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ results: [], qc_values: [] }));
    await traceSupplyLot("sl1");
    expect(urlOf().pathname).toBe("/lab/inventory/lots/sl1/trace");
    fetchMock.mockImplementationOnce(() => ok("a,b\n", { headers: { "Content-Type": "text/csv" } }));
    await fetchSupplyLotTraceCsv("sl1");
    expect(urlOf(1).pathname).toBe("/lab/inventory/lots/sl1/trace.csv");
    expect(headersOf(1).Accept).toBe("text/csv");
    fetchMock.mockImplementationOnce(() => ok("a,b\n", { headers: { "Content-Type": "text/csv" } }));
    await fetchConsumptionCsv({ providerId: "pv9", month: "2026-10" });
    expect(urlOf(2).pathname).toBe("/lab/inventory/consumption.csv");
    expect(urlOf(2).searchParams.get("month")).toBe("2026-10");
  });

  it("relatório anual do CEQ: só tipo e conteúdo (o nome do arquivo não vai)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ upload_id: "up1" }));
    const file = new File([ "%PDF-1.4" ], "Relatorio Joana.pdf", { type: "application/pdf" });
    expect(await uploadEqaReport(file)).toBe("up1");
    expect(urlOf().pathname).toBe("/lab/eqa/uploads");
    expect(Object.keys(bodyOf()).sort()).toEqual([ "content_type", "data" ]);
    expect(String(initOf().body)).not.toContain("Joana");
  });
  it("Levey-Jennings sem período: o api usa os últimos 31 dias (C-E5)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ target: null, points: [] }));
    await getQcChart({ lot_id: "ql1", level: "normal", analyte_key: "glicose", instrument_id: "in1" });
    expect([ ...urlOf().searchParams.keys() ].sort()).toEqual([ "analyte_key", "instrument_id", "level", "lot_id" ]);
  });

  it("revisões: pendentes por padrão, decididas a pedido", async () => {
    fetchMock.mockImplementation(() => ok({ reviews: [] }));
    await listQcReviews("pv9");
    expect(urlOf().searchParams.get("status")).toBe("pending");
    await listQcReviews("pv9", "decided");
    expect(urlOf(1).searchParams.get("status")).toBe("decided");
  });

  it("relatório anual do CEQ é registro próprio (C-E24/C-E25)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ annual_reports: [ { id: "ar1" } ] }));
    expect(await listEqaAnnualReports("pv9", "2026")).toEqual([ { id: "ar1" } ]);
    expect(urlOf().pathname).toBe("/lab/eqa/annual_reports");
    expect(urlOf().searchParams.get("provider_id")).toBe("pv9");
    expect(urlOf().searchParams.get("year")).toBe("2026");
    await createEqaAnnualReport({ provider_id: "pv9", program: "PNCQ", year: 2026, upload_id: "up1" });
    expect(urlOf(1).pathname).toBe("/lab/eqa/annual_reports");
    expect(initOf(1).method).toBe("POST");
    expect(bodyOf(1)).toEqual({ provider_id: "pv9", program: "PNCQ", year: 2026, upload_id: "up1" });
    fetchMock.mockImplementationOnce(() => ok("%PDF", { headers: { "Content-Type": "application/pdf" } }));
    await fetchEqaAnnualReport("ar1");
    expect(urlOf(2).pathname).toBe("/lab/eqa/annual_reports/ar1/pdf");
    expect(headersOf(2).Accept).toBe("application/pdf");
  });

  it("resumo do CEQ traz as linhas e os programas", async () => {
    fetchMock.mockImplementationOnce(() => ok({ year: 2026, rows: [], programs: [ { program: "PNCQ", annual_report: true, annual_report_id: "ar1" } ] }));
    expect(await getEqaSummary("pv9", "2026")).toEqual({
      year: 2026, rows: [], programs: [ { program: "PNCQ", annual_report: true, annual_report_id: "ar1" } ]
    });
    expect(urlOf().pathname).toBe("/lab/eqa/summary");
  });

  it("lotes do estoque: o rastreio pede também os esgotados", async () => {
    fetchMock.mockImplementationOnce(() => ok({ lots: [] }));
    await listSupplyLots({ providerId: "pv9", withBalance: false });
    expect(urlOf().searchParams.get("provider_id")).toBe("pv9");
    expect(urlOf().searchParams.has("with_balance")).toBe(false);
  });

  it("rastreio: guarda o aviso de corte (C-E37)", async () => {
    fetchMock.mockImplementationOnce(() => ok({
      lot_id: "sl1", lot_number: "R-778", results: [], results_truncated: true, qc_values: [], qc_values_truncated: false
    }));
    const trace = await traceSupplyLot("sl1");
    expect(trace.results_truncated).toBe(true);
    expect(trace.qc_values_truncated).toBe(false);
    expect(trace.lot_number).toBe("R-778");
  });

  it("consumo: linhas total/aparelho com nulos como o api manda (C-E33)", async () => {
    const rows = [
      { line: "total", supply_id: "su1", name: "Glicose", instrument_id: null, tests_performed: 410, tests_opened: 400, deviation_pct: 2.5 },
      { line: "instrument", supply_id: "su1", name: "Glicose", instrument_id: "in1", tests_performed: 400, tests_opened: null, deviation_pct: null },
      { line: "no_instrument", supply_id: "su1", name: "Glicose", instrument_id: null, tests_performed: 10, tests_opened: null, deviation_pct: null }
    ];
    fetchMock.mockImplementationOnce(() => ok({ rows }));
    expect(await getConsumption({ providerId: "pv9", month: "2026-10" })).toEqual(rows);
    expect(urlOf().pathname).toBe("/lab/inventory/consumption");
    expect(urlOf().searchParams.get("month")).toBe("2026-10");
  });

  it("lote em uso: lista por aparelho; marcar manda tudo no corpo (C-E6, C-E31)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ in_use: [ { id: "iu1" } ] }));
    expect(await listInUse("in1")).toEqual([ { id: "iu1" } ]);
    expect(urlOf().pathname).toBe("/lab/inventory/in_use");
    expect(urlOf().searchParams.get("instrument_id")).toBe("in1");
    fetchMock.mockImplementationOnce(() => ok({ id: "iu2", lot_id: "sl1" }, { status: 201 }));
    expect(await setInUse({ lot_id: "sl1", instrument_id: "in1", lab_exam_id: "le1" })).toEqual({ id: "iu2", lot_id: "sl1" });
    expect(initOf(1).method).toBe("POST");
    expect(urlOf(1).search).toBe("");
    expect(bodyOf(1)).toEqual({ lot_id: "sl1", instrument_id: "in1", lab_exam_id: "le1" });
  });

  it("alertas: lê por laboratório, mantém as chaves C-3 e normaliza o que falta", async () => {
    const expiring = [ { id: "sl1", lot_id: "sl1", lot_number: "R-778", supply_name: "Glicose", expires_on: "2026-11-05", balance: 5 } ];
    const below = [ { id: "su2", supply_id: "su2", name: "Ponteiras", unit: "caixa", balance: 1, minimum_stock: 3 } ];
    fetchMock.mockImplementationOnce(() => ok({ expiring, below_minimum: below, untraced_results: 3 }));
    expect(await getInventoryAlerts("pv9")).toEqual({ expiring, below_minimum: below, untraced_results: 3 });
    expect(urlOf().pathname).toBe("/lab/inventory/alerts");
    expect(urlOf().searchParams.get("provider_id")).toBe("pv9");
    expect(initOf().method ?? "GET").toBe("GET");
    fetchMock.mockImplementationOnce(() => ok({}));
    expect(await getInventoryAlerts("pv9")).toEqual({ expiring: [], below_minimum: [], untraced_results: 0 });
    fetchMock.mockImplementationOnce(() => ok({ expiring: null, below_minimum: null, untraced_results: "x" }));
    expect(await getInventoryAlerts("pv9")).toEqual({ expiring: [], below_minimum: [], untraced_results: 0 });
    fetchMock.mockImplementationOnce(() => ok({ untraced_results: "7" }));
    expect((await getInventoryAlerts("pv9")).untraced_results).toBe(7);
  });
});
