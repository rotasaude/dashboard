import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type HomeVisitInput,
  addBlockNeighbor, addTransmissionCycle, assignHouseholdsBlock, closeLiraaSurvey, closeTransmissionBlock, closeVectorTask, collectOvitrap,
  confirmTransmissionBlock, countOvitrapReading, createCityBlock, createCycle, createLiraaSurvey, createVectorProduct, dismissTransmissionBlock,
  drawLiraaSurvey, fetchVectorReportFile, getCycleSummary, getHouseholdVectorProfile, getTransmissionBlock, getTransmissionCaseAddress,
  getVectorDomains, getVectorParameters, getVectorReport, getVectorSettings, installOvitrap, listCadences, listCityBlocks, listCycles, listDue,
  listLiraaItems, listLiraaSurveys, listOvitrapReadings, listOvitraps, listTransmissionBlocks, listVectorHouseholds, listVectorMapPoints,
  listVectorProducts, listVectorSamples, listVectorShortfalls, listVectorTasks, moveTransmissionCase, putCadences, putVectorParameters,
  putVectorSettings, recordHomeVisit, recordSampleResult, reconcileVectorShortfall, removeBlockNeighbor, searchPharmacyItems, updateCityBlock,
  updateCycle, updateHouseholdProfile, updateLiraaSurvey, updateVectorProduct
} from "./api";
import { day, visit } from "../test/homeVisitFixtures";
import {
  LARVICIDE, PARAMS, VC_DOMAINS, caseAddress, cityBlock, householdProfile, inspection, inspectionInput, liraaSurvey, mapPoints, ovitrap,
  parameterVersion, reading, sample, shortfall, transmissionBlock, vectorTask
} from "../test/vectorControlFixtures";

const calls: { url: string; init: RequestInit }[] = [];
function stub(body: unknown, status = 200, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }));
}
function stubBlob(status: number, text: string, disposition: string) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(new Blob([ text ]), { status, headers: { "Content-Disposition": disposition } });
  }));
}
afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });
const last = () => calls[calls.length - 1];
const bodyOf = () => JSON.parse(String(last().init.body));
const fetchCalls = () => calls.length;
const headerOf = (name: string) => (last().init.headers as Record<string, string> | undefined)?.[name];

// Uma visita mínima do 24b (domicílio, sem pessoa).
const HV_INPUT: HomeVisitInput = {
  client_uuid: "00000000-0000-4000-8000-000000000001", team_id: "t1", occurred_at: "2026-11-16T09:40:00-03:00", household_id: "h1",
  subject: "none", outcome: 1, reasons: [], shared: false
};
// O que nunca pode ir na URL: nota, motivo, contagem, endereço.
const SECRET_IN_URL = /lote achado|descartado|Rua|Palmeiras|egg_count|note|reason/i;

describe("cliente da vigilância ambiental — endemias (módulo 35a)", () => {
  it("visita leva vector_inspection no corpo; nada do boletim na URL", async () => {
    stub({ visit: visit({ vector_inspection: inspection() }), day: day() }, 201);
    const r = await recordHomeVisit({ ...HV_INPUT, vector_inspection: inspectionInput() });
    expect(last().url).toBe("/home_visits");
    expect(bodyOf().vector_inspection).toEqual(inspectionInput());
    expect(r.visit.vector_inspection?.samples[0].label).toBe("00000000-01");
  });

  it("filtros: só ids, estado e cursor; listas como chave[]", async () => {
    stub({}); expect(await listDue("ma-1", "c1")).toEqual({ items: [], next_before: null });
    expect(last().url).toBe("/vector_control/due?micro_area_id=ma-1&before=c1");
    stub({}); await listVectorHouseholds({ neighborhoodId: "nb1", withoutBlock: true });
    expect(last().url).toBe("/vector_control/households?neighborhood_id=nb1&without_block=true");
    stub({}); await listVectorHouseholds({ cityBlockId: "cb1", before: "c2" });
    expect(last().url).toBe("/vector_control/households?city_block_id=cb1&before=c2");
    stub({ columns: [], rows: [] }); await getVectorReport("ovitraps", { epi_weeks: [ "2026-45", "2026-46" ], neighborhood_ids: [ "nb1" ] });
    expect(last().url).toBe("/vector_control/reports/ovitraps?epi_weeks%5B%5D=2026-45&epi_weeks%5B%5D=2026-46&neighborhood_ids%5B%5D=nb1");
    stub({}); await listOvitraps({ microAreaId: "ma1", status: "active", before: "c3" });
    expect(last().url).toBe("/vector_control/ovitraps?micro_area_id=ma1&status=active&before=c3");
    stub({}); await listOvitraps({ neighborhoodId: "nb1" });
    expect(last().url).toBe("/vector_control/ovitraps?neighborhood_id=nb1");
    stub({}); await listOvitrapReadings({ state: "to_count" });
    expect(last().url).toBe("/vector_control/ovitrap_readings?state=to_count");
    stub({}); await listVectorTasks({ state: "closed", before: "c4" });
    expect(last().url).toBe("/vector_control/tasks?state=closed&before=c4");
    stub({}); await listTransmissionBlocks({ status: [ "proposed", "active" ] });
    expect(last().url).toBe("/vector_control/transmission_blocks?status%5B%5D=proposed&status%5B%5D=active");
    stub({}); await listVectorShortfalls({ state: "open", locationId: "loc-vc" });
    expect(last().url).toBe("/vector_control/stock_shortfalls?state=open&location_id=loc-vc");
    stub({}); await listCycles(2026);
    expect(last().url).toBe("/vector_control/cycles?year=2026");
    stub({}); await listLiraaItems("s1", "c5");
    expect(last().url).toBe("/vector_control/liraa_surveys/s1/items?before=c5");
    for (const c of calls) expect(c.url).not.toMatch(SECRET_IN_URL);
  });

  it("quarteirões: TODOS do bairro em { items }, sem cursor (Q18); escritas devolvem o CityBlock", async () => {
    stub({ items: [ cityBlock() ] });
    expect(await listCityBlocks("nb1")).toEqual([ cityBlock() ]);
    expect(last().url).toBe("/vector_control/blocks?neighborhood_id=nb1");
    stub({}); expect(await listCityBlocks("nb1")).toEqual([]);
    stub(cityBlock(), 201); await createCityBlock({ neighborhood_id: "nb1", number: "12" });
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/blocks", "POST", { neighborhood_id: "nb1", number: "12" } ]);
    stub(cityBlock({ active: false })); await updateCityBlock("cb1", { active: false });
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/blocks/cb1", "PATCH", { active: false } ]);
    stub(cityBlock()); await addBlockNeighbor("cb1", "cb2");
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/blocks/cb1/neighbors", "POST", { neighbor_block_id: "cb2" } ]);
  });

  it("atribuição em lote, nota, motivo e contagem só no corpo", async () => {
    stub({ assigned: 2 }); expect(await assignHouseholdsBlock([ "h1", "h2" ], "cb1")).toEqual({ assigned: 2 });
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/households/assign_block", "POST", { household_ids: [ "h1", "h2" ], city_block_id: "cb1" } ]);
    stub(shortfall()); await reconcileVectorShortfall("sf1", "lote achado no depósito");
    expect(last().url).toBe("/vector_control/stock_shortfalls/sf1/reconcile");
    expect(bodyOf()).toEqual({ note: "lote achado no depósito" });
    stub(transmissionBlock()); await dismissTransmissionBlock("tb1", "caso descartado pela vigilância");
    expect(last().url).toBe("/vector_control/transmission_blocks/tb1/dismiss");
    expect(bodyOf()).toEqual({ reason: "caso descartado pela vigilância" });
    stub(reading({ egg_count: 45 })); await countOvitrapReading("or0", { egg_count: 45, count_note: "contagem refeita na lupa" });
    expect([ last().url, bodyOf() ]).toEqual([ "/vector_control/ovitrap_readings/or0/count", { egg_count: 45, count_note: "contagem refeita na lupa" } ]);
    stub(sample()); await recordSampleResult("vs1", { examined_larvae: 8, aegypti_larvae: 6, albopictus_larvae: 1 });
    expect([ last().url, bodyOf() ]).toEqual([ "/vector_control/samples/vs1/result", { examined_larvae: 8, aegypti_larvae: 6, albopictus_larvae: 1 } ]);
    stub(vectorTask({ state: "done" })); await closeVectorTask("vt1", { state: "done", note: "quarteirões revisitados" });
    expect([ last().url, bodyOf() ]).toEqual([ "/vector_control/tasks/vt1/close", { state: "done", note: "quarteirões revisitados" } ]);
    stub(householdProfile()); await updateHouseholdProfile("h1", { city_block_id: null, risk_class: "red" });
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/households/h1/profile", "PATCH", { city_block_id: null, risk_class: "red" } ]);
    for (const c of calls) expect(c.url).not.toMatch(SECRET_IN_URL);
  });

  it("escrita sem campo manda {} (draw, close, remove neighbor)", async () => {
    stub(liraaSurvey({ status: "drawn" })); await drawLiraaSurvey("s1");
    expect([ last().url, last().init.method, last().init.body, headerOf("Content-Type") ])
      .toEqual([ "/vector_control/liraa_surveys/s1/draw", "POST", "{}", "application/json" ]);
    stub(liraaSurvey({ status: "closed" })); await closeLiraaSurvey("s1");
    expect([ last().url, last().init.body, headerOf("Content-Type") ]).toEqual([ "/vector_control/liraa_surveys/s1/close", "{}", "application/json" ]);
    stub(transmissionBlock({ status: "closed" })); await closeTransmissionBlock("tb1");
    expect([ last().url, last().init.body, headerOf("Content-Type") ]).toEqual([ "/vector_control/transmission_blocks/tb1/close", "{}", "application/json" ]);
    stub(cityBlock({ neighbor_ids: [] })); await removeBlockNeighbor("cb1", "cb2");
    expect([ last().url, last().init.method, last().init.body, headerOf("Content-Type") ])
      .toEqual([ "/vector_control/blocks/cb1/neighbors/cb2", "DELETE", "{}", "application/json" ]);
  });

  it("bloqueio: confirmar leva os casos vistos (Q26(4)); ciclo, mover e endereço só por ids na URL", async () => {
    stub(transmissionBlock({ status: "active" }));
    await confirmTransmissionBlock("tb1", { center_block_id: "cb1", block_ids: [ "cb1", "cb2" ], seen_case_ids: [ "tc1" ] });
    expect([ last().url, bodyOf() ]).toEqual([ "/vector_control/transmission_blocks/tb1/confirm", { center_block_id: "cb1", block_ids: [ "cb1", "cb2" ], seen_case_ids: [ "tc1" ] } ]);
    stub(transmissionBlock()); await addTransmissionCycle("tb1", { starts_on: "2026-11-17", ends_on: "2026-11-21" });
    expect([ last().url, bodyOf() ]).toEqual([ "/vector_control/transmission_blocks/tb1/cycles", { starts_on: "2026-11-17", ends_on: "2026-11-21" } ]);
    stub(transmissionBlock({ id: "tb2" })); await moveTransmissionCase("tb1", "tc1", "tb2");
    expect([ last().url, bodyOf() ]).toEqual([ "/vector_control/transmission_blocks/tb1/cases/tc1/move", { to_transmission_block_id: "tb2" } ]);
    stub(transmissionBlock()); expect(await getTransmissionBlock("tb1")).toEqual(transmissionBlock());
    stub(caseAddress()); expect(await getTransmissionCaseAddress("tb1", "tc1")).toEqual(caseAddress());
    expect(last().url).toBe("/vector_control/transmission_blocks/tb1/cases/tc1/address");
    expect(last().init.cache).toBe("no-store");
    for (const c of calls) expect(c.url).not.toMatch(SECRET_IN_URL);
  });

  it("arquivos: csv de qualquer relatório; pdf só do liraa, sem chamar o api nos outros", async () => {
    stubBlob(200, "a;b\r\n", 'attachment; filename="liraa-2026.csv"');
    expect((await fetchVectorReportFile("liraa", { survey_id: "s1" }, "csv")).filename).toBe("liraa-2026.csv");
    expect(last().url).toBe("/vector_control/reports/liraa.csv?survey_id=s1");
    await expect(fetchVectorReportFile("situations", {}, "pdf")).rejects.toThrow();
    expect(fetchCalls()).toBe(1);
    stubBlob(200, "%PDF", 'attachment; filename="liraa-2026-11-16.pdf"');
    await fetchVectorReportFile("liraa", { survey_id: "s1" }, "pdf");
    expect(last().url).toBe("/vector_control/reports/liraa.pdf?survey_id=s1");
  });

  it("mapa: layer e ids na URL; ausentes = { map: null, points: [] }", async () => {
    stub(mapPoints()); expect(await listVectorMapPoints({ layer: "ovitraps", neighborhoodId: "nb1", epiWeek: "2026-46" })).toEqual(mapPoints());
    expect(last().url).toBe("/vector_control/map_points?layer=ovitraps&neighborhood_id=nb1&epi_week=2026-46");
    stub({}); expect(await listVectorMapPoints({ layer: "risk", neighborhoodId: "nb1" })).toEqual({ map: null, points: [] });
    expect(last().url).toBe("/vector_control/map_points?layer=risk&neighborhood_id=nb1");
    stub({}); await listVectorMapPoints({ layer: "transmission", transmissionBlockId: "tb1" });
    expect(last().url).toBe("/vector_control/map_points?layer=transmission&transmission_block_id=tb1");
  });

  it("perfil do imóvel pela rota do 35a: { id, neighborhood_id, vector } (Q8, Q13(5))", async () => {
    stub(householdProfile()); expect(await getHouseholdVectorProfile("h1")).toEqual(householdProfile());
    expect(last().url).toBe("/vector_control/households/h1");
    stub(householdProfile({ vector: null })); expect((await getHouseholdVectorProfile("h2")).vector).toBeNull();
  });

  it("domínios, parâmetros (20 chaves), cadência, ciclos, produtos e local da baixa", async () => {
    stub(VC_DOMAINS); expect(await getVectorDomains()).toEqual(VC_DOMAINS);
    expect(last().url).toBe("/vector_control/domains");
    stub(parameterVersion()); expect((await getVectorParameters()).created_at).toBeNull();
    stub(parameterVersion({ version: 1, created_at: "2026-11-16T13:00:00.000000Z" })); await putVectorParameters(PARAMS);
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/parameters", "PUT", { values: PARAMS } ]);
    expect(Object.keys(bodyOf().values)).toHaveLength(20);
    const items = [ { neighborhood_id: null, risk_class: null, strategic_point: false, days: 60 } ];
    stub({ items }); expect(await putCadences(items)).toEqual(items);
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/cadences", "PUT", { items } ]);
    stub({}); expect(await listCadences()).toEqual([]);
    stub({ id: "cy1", year: 2026, number: 12, starts_on: "2026-11-02", ends_on: "2026-12-31" }, 201);
    await createCycle({ year: 2026, starts_on: "2026-11-02", ends_on: "2026-12-31" });
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/cycles", "POST", { year: 2026, starts_on: "2026-11-02", ends_on: "2026-12-31" } ]);
    stub({}); await updateCycle("cy1", { ends_on: "2026-12-30" });
    expect([ last().url, last().init.method ]).toEqual([ "/vector_control/cycles/cy1", "PATCH" ]);
    stub({ cycle: {}, neighborhoods: [] }); await getCycleSummary("cy1");
    expect(last().url).toBe("/vector_control/cycles/cy1");
    stub({ items: [ LARVICIDE ] }); expect(await listVectorProducts()).toEqual([ LARVICIDE ]);
    stub(LARVICIDE, 201); await createVectorProduct({ code: "PYR", name: "Pyriproxyfen 0,5% G", unit: "g", charge_size: "2.00", uses: [ "focal" ], active: true });
    expect(bodyOf().charge_size).toBe("2.00");
    stub(LARVICIDE); await updateVectorProduct("pr1", { active: false });
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/products/pr1", "PATCH", { active: false } ]);
    stub({ stock_location: null, options: [] }); await getVectorSettings();
    expect(last().url).toBe("/vector_control/settings");
    stub({ stock_location: null, options: [] }); await putVectorSettings(null);
    expect([ last().init.method, bodyOf() ]).toEqual([ "PUT", { stock_location_id: null } ]);
  });

  it("ovitrampa: instalação e coleta pelo corpo; LIRAa: criar e editar estratos", async () => {
    const install = { client_uuid: "u1", household_id: "h1", number: "OV-07", consent: true, installed_on: "2026-11-16" };
    stub(ovitrap(), 201); await installOvitrap(install);
    expect([ last().url, bodyOf() ]).toEqual([ "/vector_control/ovitraps", install ]);
    stub(ovitrap()); await collectOvitrap("ov1", { collected_on: "2026-11-16", condition: "ok", reinstall: true, remove: false });
    expect([ last().url, bodyOf() ]).toEqual([ "/vector_control/ovitraps/ov1/collect", { collected_on: "2026-11-16", condition: "ok", reinstall: true, remove: false } ]);
    stub(liraaSurvey(), 201); await createLiraaSurvey({ name: "LIRAa novembro", starts_on: "2026-11-23", ends_on: "2026-11-27" });
    expect([ last().url, last().init.method ]).toEqual([ "/vector_control/liraa_surveys", "POST" ]);
    stub(liraaSurvey()); await updateLiraaSurvey("s1", { strata: [ { name: "Estrato 1", mode: "half", block_ids: [ "cb1" ] } ] });
    expect([ last().url, last().init.method, bodyOf() ]).toEqual([ "/vector_control/liraa_surveys/s1", "PATCH", { strata: [ { name: "Estrato 1", mode: "half", block_ids: [ "cb1" ] } ] } ]);
    stub({ items: [ liraaSurvey() ] }); expect(await listLiraaSurveys()).toEqual([ liraaSurvey() ]);
  });

  it("amostras: o cursor é da aba (Q27) e vai como veio", async () => {
    stub({ items: [ sample() ], next_before: "ZG9uZXw" });
    expect((await listVectorSamples({ state: "done", before: "ZG9uZXw" })).next_before).toBe("ZG9uZXw");
    expect(last().url).toBe("/vector_control/samples?state=done&before=ZG9uZXw");
  });

  it("estoque: busca do domínio vector_control e entrada com vector_product_id (D-8)", async () => {
    stub({ items: [] }); await searchPharmacyItems("pyr", "vector_control");
    expect(bodyOf()).toEqual({ q: "pyr", domain: "vector_control" });
    stub({}); await searchPharmacyItems("dipirona");
    expect(bodyOf()).toEqual({ q: "dipirona" });
  });
});
