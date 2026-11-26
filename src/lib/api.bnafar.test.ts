import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyOpeningImport, checkBnafarCredential, correctBnafarRecord, discardOpeningImport, fetchOpeningImportTemplate, getBnafarDomains,
  getBnafarStatus, getBnafarSubmission, getExternalExit, getOpeningImport, listBnafarPendencies, listBnafarSubmissions, listExternalExits,
  listObmPresentations, listOpeningImports, listStockOpenings, recordExternalExit, retryBnafarSubmission, revertOpeningImport,
  setBnafarCredential, setColdChainCentralCnes, updateLotBnafar, uploadOpeningImport
} from "./api";
import {
  BNAFAR_DOMAINS, PRESENTATIONS, bnafarCredential, exitRecord, externalExit, externalExitDetail, incompleteLot, lotBnafar, opening, openingImport,
  pendencies, rejectedSubmission, status, submission
} from "../test/bnafarFixtures";

describe("cliente do envio à BNAFAR, da saída externa e do saldo inicial (módulo 27b)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(() => stub({})); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  function stub(body: unknown, st = 200): Promise<Response> {
    return Promise.resolve(new Response(JSON.stringify(body), { status: st, headers: { "Content-Type": "application/json" } }));
  }
  const next = (body: unknown) => fetchMock.mockImplementationOnce(() => stub(body));
  const last = () => {
    const [ url, init ] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [ string, RequestInit | undefined ];
    return { url: String(url), init: init ?? {} };
  };
  const bodyOf = () => JSON.parse(String(last().init.body));

  it("credencial: senha e ambiente só no corpo; o teste não leva corpo útil (o api testa o ambiente em uso)", async () => {
    next(bnafarCredential("production"));
    await setBnafarCredential("usuario.ente", " s3nh@ ", "production");
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/integrations/credentials/bnafar", "PUT", { username: "usuario.ente", password: " s3nh@ ", environment: "production" } ]);
    next(bnafarCredential("production"));
    expect((await checkBnafarCredential()).environment).toBe("production");
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/integrations/credentials/bnafar/check", "POST", {} ]);
  });

  it("status e remessas: só os filtros preenchidos; a lista vem em envelope", async () => {
    next(status());
    expect((await getBnafarStatus()).alert.late).toBe(0);
    expect(last().url).toBe("/pharmacy/bnafar/status");
    next({ items: [ submission() ], next_before: "c1" });
    expect(await listBnafarSubmissions({ from: "2026-11-01", subject: "exit", status: undefined, to: "" })).toEqual({ items: [ submission() ], next_before: "c1" });
    expect(last().url).toBe("/pharmacy/bnafar/submissions?from=2026-11-01&subject=exit");
    next({});
    expect(await listBnafarSubmissions({ before: "c1", status: "failed" })).toEqual({ items: [], next_before: null });
    expect(last().url).toBe("/pharmacy/bnafar/submissions?status=failed&before=c1");
  });

  it("detalhe da remessa, reenvio (envelope) e correção (desembrulha os registros)", async () => {
    next(rejectedSubmission());
    expect((await getBnafarSubmission("bs2", { status: "rejected", before: "c2" })).records).toHaveLength(3);
    expect(last().url).toBe("/pharmacy/bnafar/submissions/bs2?status=rejected&before=c2");
    const retried = { batch: { id: "b9", operation: "post", status: "queued", protocol: null }, retried: 2, submission: submission({ id: "bs2" }) };
    next(retried);
    expect(await retryBnafarSubmission("bs2")).toEqual(retried);
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/pharmacy/bnafar/submissions/bs2/retry", "POST", {} ]);
    next({ records: [ exitRecord() ] });
    const input = { expected_version: 1, destination_kind: "cnpj" as const, destination_code: "12ABC34501DE35", reason: "destino informado errado" };
    expect(await correctBnafarRecord("br2", input)).toEqual([ exitRecord() ]);
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/pharmacy/bnafar/records/br2/correct", "POST", input ]);
  });

  it("pendências: filtros, cursor e totais; domínios e apresentações", async () => {
    const P = pendencies([ "lot_incomplete", "location_without_cnes" ]);
    next(P);
    expect(await listBnafarPendencies({ locationId: "l2", code: "lot_incomplete", before: "c1" })).toEqual(P);
    expect(last().url).toBe("/pharmacy/bnafar/pendencies?location_id=l2&code=lot_incomplete&before=c1");
    next({});
    expect(await listBnafarPendencies({})).toEqual({ items: [], next_before: null, totals: { by_code: {}, by_location: {} } });
    expect(last().url).toBe("/pharmacy/bnafar/pendencies");
    next(BNAFAR_DOMAINS);
    expect(await getBnafarDomains()).toEqual(BNAFAR_DOMAINS);
    expect(last().url).toBe("/pharmacy/bnafar/domains");
    next({ items: PRESENTATIONS });
    expect(await listObmPresentations("VMP0001")).toEqual(PRESENTATIONS);
    expect(last().url).toBe("/pharmacy/obm_presentations?vmp_code=VMP0001");
  });

  it("complemento do lote: corpo com o internacional por nome; resposta { id, bnafar }", async () => {
    const reply = { id: "lt1", bnafar: lotBnafar({ manufacturer_cnpj: null, manufacturer_international: true }) };
    next(reply);
    const input = { location_id: "l1", expected_version: 0, unit_price_cents: 1250, manufacturer_international: true, manufacturer: "Pharma GmbH" };
    expect(await updateLotBnafar("lt1", input)).toEqual(reply);
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/pharmacy/lots/lt1/bnafar", "PATCH", input ]);
    expect(incompleteLot().bnafar).toEqual({ version: 0, missing: [ "unit_price_cents", "manufacturer_cnpj", "anvisa_registration", "health_program", "ampp_code" ] });
  });

  it("saída externa: grava, lista pelo local (chave external_exits) e lê o detalhe", async () => {
    const input = { location_id: "l2", exit_type: "S-D" as const, destination_kind: "cnes" as const, destination_code: "2384299", reason: "doação à unidade vizinha", items: [ { lot_id: "lt2", quantity: 30 } ] };
    next(externalExitDetail());
    expect((await recordExternalExit(input)).reason).toBeTruthy();
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/pharmacy/external_exits", "POST", input ]);
    next({ external_exits: [ externalExit() ], next_before: "c3" });
    expect(await listExternalExits({ locationId: "l2", before: "c2" })).toEqual({ external_exits: [ externalExit() ], next_before: "c3" });
    expect(last().url).toBe("/pharmacy/external_exits?location_id=l2&before=c2");
    next(externalExitDetail());
    expect((await getExternalExit("ex1")).version).toBe(1);
    expect(last().url).toBe("/pharmacy/external_exits/ex1");
  });

  it("aberturas: pelo local, com cursor", async () => {
    next({ items: [ opening() ], next_before: null });
    expect(await listStockOpenings("l2", "c1")).toEqual({ items: [ opening() ], next_before: null });
    expect(last().url).toBe("/pharmacy/openings?location_id=l2&before=c1");
    next({});
    expect(await listStockOpenings("l2")).toEqual({ items: [], next_before: null });
    expect(last().url).toBe("/pharmacy/openings?location_id=l2");
  });

  it("saldo inicial: base64 sem nome; atos com expected_version; leitura por cursor; modelo pelo binaryFetch", async () => {
    next(openingImport());
    await uploadOpeningImport(new File([ "abc" ], "saldo.csv"));
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/pharmacy/opening_imports", "POST", { file_base64: "YWJj" } ]);
    next(openingImport({ status: "applied" }));
    await applyOpeningImport("oi1", 1);
    expect([ last().url, bodyOf() ]).toEqual([ "/pharmacy/opening_imports/oi1/apply", { expected_version: 1 } ]);
    next(openingImport({ status: "reverted" }));
    await revertOpeningImport("oi1", 2);
    expect([ last().url, bodyOf() ]).toEqual([ "/pharmacy/opening_imports/oi1/revert", { expected_version: 2 } ]);
    next(openingImport({ status: "discarded" }));
    await discardOpeningImport("oi1", 1);
    expect([ last().url, bodyOf() ]).toEqual([ "/pharmacy/opening_imports/oi1/discard", { expected_version: 1 } ]);
    next({ ...openingImport(), rows: [], next_before: null });
    await getOpeningImport("oi1", { before: "c100", status: "error", limit: 100 });
    expect(last().url).toBe("/pharmacy/opening_imports/oi1?before=c100&status=error&limit=100");
    next({ ...openingImport(), rows: [] });
    expect((await getOpeningImport("oi1")).next_before).toBeNull();
    expect(last().url).toBe("/pharmacy/opening_imports/oi1");
    next({ items: [ openingImport() ], next_before: "c5" });
    expect(await listOpeningImports("c4")).toEqual({ items: [ openingImport() ], next_before: "c5" });
    expect(last().url).toBe("/pharmacy/opening_imports?before=c4");
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("cnes;…\r\n", {
      status: 200, headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="saldo-inicial.csv"' }
    })));
    expect((await fetchOpeningImportTemplate()).filename).toBe("saldo-inicial.csv");
    expect(last().url).toBe("/pharmacy/opening_imports/template.csv");
  });

  it("CNES da rede de frio: PATCH com a chave cnes (nulo limpa)", async () => {
    next({ id: "l7", cnes: "2384299" });
    await setColdChainCentralCnes("2384299");
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vaccination/admin/cold_chain_central", "PATCH", { cnes: "2384299" } ]);
    next({ id: "l7", cnes: null });
    await setColdChainCentralCnes(null);
    expect(bodyOf()).toEqual({ cnes: null });
  });
});
