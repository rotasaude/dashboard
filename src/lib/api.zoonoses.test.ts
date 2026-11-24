import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, cancelVaccination, closeRabiesCampaign, closeLeishSurvey, closeDemand, closeObservation, collectLeishTest, createRabiesCampaign, updateLeishTest, updateRabiesCampaign, createAnimal, createOmbudsmanManifestation,
  declineDemand, enterShelter, exitShelter, fetchZoonosesReportFile, getAnimal, getDemand, getObservationContact, getZooParameters,
  getZoonosesDomains, getZoonosesReport, linkObservationAnimal, listRabiesCampaigns, listDemands, listDueCollars, listLeishTests, listObservations,
  listShelterStays, listVaccinations, lookupZooPerson, openRabiesCampaign, openLeishSurvey, placeCollar, putZooParameters, recordEuthanasia,
  recordLeishOutcome, recordNeutering, recordVaccination, removeCollar, searchAnimals, suggestLeishSurvey, updateAnimal
} from "./api";
import {
  CONTACT, PERSON, survey, ZOO_DOMAINS, ZOO_PARAMS, animal, campaign, collar, demandDetail, dueCollar, euthanasia, history, leishTest, observation,
  stay, vaccination, zooReport
} from "../test/zoonosesFixtures";

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
const methodOf = () => last().init.method ?? "GET";
const PERIOD = { from: "2026-10-05", to: "2026-11-23" };

describe("cliente do centro de zoonoses (módulo 35b)", () => {
  it("domínios e parâmetros: GET sem query; listas extras do api são toleradas", async () => {
    stub(ZOO_DOMAINS);
    const d = await getZoonosesDomains();
    expect([ last().url, methodOf() ]).toEqual([ "/zoonoses/domains", "GET" ]);
    expect(d.subtypes[0].code).toBe("scorpion");
    expect(d.demand_outcomes[0].label).toBe("Resolvida");
    stub({ version: 2, values: ZOO_PARAMS, created_at: null });
    expect((await getZooParameters()).values.observation_days).toBe(10);
    expect(last().url).toBe("/zoonoses/parameters");
  });

  it("parâmetros: PUT leva values e a versão lida, com a tabela como veio", async () => {
    stub({ version: 3, values: ZOO_PARAMS, created_at: null });
    await putZooParameters(ZOO_PARAMS, 2);
    expect([ last().url, methodOf() ]).toEqual([ "/zoonoses/parameters", "PUT" ]);
    expect(bodyOf()).toEqual({ values: ZOO_PARAMS, expected_version: 2 });
  });

  it("busca do animal: microchip só no corpo, nunca na URL; envelope com cursor", async () => {
    stub({ items: [ animal() ] });
    expect(await searchAnimals({ microchip: "985112003456789" })).toEqual({ items: [ animal() ], next_before: null });
    expect([ last().url, methodOf() ]).toEqual([ "/zoonoses/animals/search", "POST" ]);
    expect(bodyOf()).toEqual({ microchip: "985112003456789" });
    expect(last().url).not.toContain("985");
    stub({ items: [ animal() ], next_before: "c9" });
    expect((await searchAnimals({ household_id: "h1", before: "c8" })).next_before).toBe("c9");
    expect(bodyOf()).toEqual({ household_id: "h1", before: "c8" });
  });

  it("animal: criação leva o microchip no corpo; detalhe e edição por id", async () => {
    stub(animal(), 201); await createAnimal({ species: "dog", sex: "male", community: false, microchip: "985112003456789", name: "Thor" });
    expect([ last().url, methodOf() ]).toEqual([ "/zoonoses/animals", "POST" ]);
    expect(bodyOf().microchip).toBe("985112003456789");
    stub(history()); expect((await getAnimal("an1")).vaccinations).toHaveLength(1);
    expect(last().url).toBe("/zoonoses/animals/an1");
    stub(animal({ version: 2 })); await updateAnimal("an1", { status: "missing", status_on: "2026-11-22", expected_version: 1 });
    expect([ last().url, methodOf(), bodyOf() ]).toEqual([ "/zoonoses/animals/an1", "PATCH", { status: "missing", status_on: "2026-11-22", expected_version: 1 } ]);
  });

  it("person_lookup: documento no corpo; o domicílio vem da pessoa; só o 404 person_not_found vira null", async () => {
    stub(PERSON); expect((await lookupZooPerson({ cpf: "52998224725" }))?.household?.id).toBe("h1");
    expect([ last().url, methodOf(), bodyOf() ]).toEqual([ "/zoonoses/person_lookup", "POST", { cpf: "52998224725" } ]);
    stub({ error: "person_not_found" }, 404); expect(await lookupZooPerson({ cns: "898001160651234" })).toBeNull();
    expect([ last().url, bodyOf() ]).toEqual([ "/zoonoses/person_lookup", { cns: "898001160651234" } ]);
    expect(last().url).not.toContain("8980");
    stub({ error: "citizen_not_verified" }, 409);
    await expect(lookupZooPerson({ cpf: "52998224725" })).rejects.toBeInstanceOf(ApiError);
    stub({ error: "not_found" }, 404);
    await expect(lookupZooPerson({ cpf: "52998224725" })).rejects.toBeInstanceOf(ApiError);
  });

  it("filtros: só ids, datas, estados escalares, due=1 e cursor; sem chave[] em estado", async () => {
    stub({ items: [] }); expect(await listDueCollars()).toEqual([]);
    expect(last().url).toBe("/zoonoses/collars?due=1");
    stub({}); expect(await listDemands({ state: "open", before: "c1" })).toEqual({ items: [], next_before: null });
    expect(last().url).toBe("/zoonoses/demands?state=open&before=c1");
    stub({}); await listObservations({ state: "closed" });
    expect(last().url).toBe("/zoonoses/observations?state=closed");
    stub({}); await listVaccinations({ campaignId: "cp1", from: "2026-10-05", to: "2026-11-23", modality: "routine", before: "c2" });
    expect(last().url).toBe("/zoonoses/vaccinations?campaign_id=cp1&from=2026-10-05&to=2026-11-23&modality=routine&before=c2");
    stub({}); await listLeishTests({ surveyId: "sv1", pending: "elisa" });
    expect(last().url).toBe("/zoonoses/leish_tests?survey_id=sv1&pending=elisa");
    stub({}); expect(await listShelterStays({ open: true, healthUnitId: "uvz1" })).toEqual({ items: [], next_before: null, occupancy: [] });
    expect(last().url).toBe("/zoonoses/shelter_stays?open=1&health_unit_id=uvz1");
    stub({}); await listShelterStays({});
    expect(last().url).toBe("/zoonoses/shelter_stays");
  });

  it("relatório: o período é obrigatório e vai na query; só ids e datas", async () => {
    stub({ columns: [], rows: [] }); await getZoonosesReport("rabies_weekly", { ...PERIOD, campaign_id: "cp1" });
    expect(last().url).toBe("/zoonoses/reports/rabies_weekly?from=2026-10-05&to=2026-11-23&campaign_id=cp1");
    stub(zooReport()); expect((await getZoonosesReport("leish", { ...PERIOD, survey_id: "sv1" })).rows).toHaveLength(1);
    expect(last().url).toBe("/zoonoses/reports/leish?from=2026-10-05&to=2026-11-23&survey_id=sv1");
  });

  it("notas, motivos, contato e texto só no corpo ou na resposta", async () => {
    stub(vaccination({ cancelled: true })); await cancelVaccination("v1", "dose registrada no animal errado");
    expect([ last().url, bodyOf() ]).toEqual([ "/zoonoses/vaccinations/v1/cancel", { reason: "dose registrada no animal errado" } ]);
    stub(CONTACT); expect(await getObservationContact("ob1")).toEqual(CONTACT);
    expect([ last().url, methodOf(), last().init.cache ]).toEqual([ "/zoonoses/observations/ob1/contact", "GET", "no-store" ]);
    stub(demandDetail()); expect((await getDemand("dm1")).place_address).toBe("Rua das Palmeiras, 45");
    expect(last().url).toBe("/zoonoses/demands/dm1");
    stub(demandDetail({ state: "closed" })); await declineDemand("dm1", { text: "não é competência da UVZ", expected_version: 2 });
    expect([ last().url, bodyOf() ]).toEqual([ "/zoonoses/demands/dm1/decline", { text: "não é competência da UVZ", expected_version: 2 } ]);
    expect(last().url).not.toMatch(/competência|Palmeiras/);
  });

  it("abertura e fechamento da campanha mandam corpo vazio; o inquérito leva só expected_version", async () => {
    stub(campaign()); await openRabiesCampaign("cp1");
    expect([ last().url, methodOf(), bodyOf() ]).toEqual([ "/zoonoses/campaigns/cp1/open", "POST", {} ]);
    stub(campaign({ stage: "closed" })); await closeRabiesCampaign("cp1");
    expect([ last().url, bodyOf() ]).toEqual([ "/zoonoses/campaigns/cp1/close", {} ]);
    stub({ items: [ campaign() ] }); expect(await listRabiesCampaigns()).toEqual([ campaign() ]);
    stub(survey({ stage: "open" })); await openLeishSurvey("sv1", 3);
    expect([ last().url, bodyOf() ]).toEqual([ "/zoonoses/leish_surveys/sv1/open", { expected_version: 3 } ]);
    stub(survey({ stage: "open" })); await closeLeishSurvey("sv1", 4);
    expect(bodyOf()).toEqual({ expected_version: 4 });
  });

  it("rotina: a chave campaign_id nem vai; casa a casa leva a do animal sem household_id", async () => {
    stub(vaccination({ modality: "routine", campaign_id: null }), 201);
    await recordVaccination({ modality: "routine", animal_id: "an1", vaccinated_on: "2026-11-23", vector_product_id: "pz1", adverse_event: false });
    expect([ last().url, methodOf() ]).toEqual([ "/zoonoses/vaccinations", "POST" ]);
    expect("campaign_id" in bodyOf()).toBe(false);
    expect("household_id" in bodyOf()).toBe(false);
  });

  it("demanda: encerra com desfecho e texto no corpo", async () => {
    stub(demandDetail({ state: "closed", outcome: "resolved" }));
    await closeDemand("dm1", { outcome: "resolved", text: "escorpião retirado", expected_version: 2 });
    expect([ last().url, methodOf(), bodyOf() ]).toEqual([ "/zoonoses/demands/dm1/close", "POST", { outcome: "resolved", text: "escorpião retirado", expected_version: 2 } ]);
  });

  it("exame de LV: PATCH com a versão; null apaga o campo", async () => {
    stub(leishTest()); await updateLeishTest("lt1", { elisa_result: "reactive", elisa_on: "2026-11-24", expected_version: 1 });
    expect([ last().url, methodOf(), bodyOf() ]).toEqual([ "/zoonoses/leish_tests/lt1", "PATCH", { elisa_result: "reactive", elisa_on: "2026-11-24", expected_version: 1 } ]);
    stub(leishTest()); await updateLeishTest("lt1", { elisa_request: null, elisa_result: null, elisa_on: null, expected_version: 2 });
    expect(bodyOf()).toEqual({ elisa_request: null, elisa_result: null, elisa_on: null, expected_version: 2 });
  });

  it("campanha: criação sem versão; edição leva expected_version no corpo", async () => {
    stub(campaign(), 201); await createRabiesCampaign({ name: "Campanha 2026", starts_on: "2026-10-05", ends_on: "2026-11-30" });
    expect([ last().url, methodOf(), bodyOf() ]).toEqual([ "/zoonoses/campaigns", "POST", { name: "Campanha 2026", starts_on: "2026-10-05", ends_on: "2026-11-30" } ]);
    stub(campaign({ version: 4 })); await updateRabiesCampaign("cp1", { goal_dogs: 900, expected_version: 3 });
    expect([ last().url, methodOf(), bodyOf() ]).toEqual([ "/zoonoses/campaigns/cp1", "PATCH", { goal_dogs: 900, expected_version: 3 } ]);
  });

  it("observação: encerra com a versão; liga o animal uma vez", async () => {
    stub(observation()); await closeObservation("ob1", { outcome: "healthy", outcome_on: "2026-11-25", expected_version: 1 });
    expect([ last().url, bodyOf() ]).toEqual([ "/zoonoses/observations/ob1/close", { outcome: "healthy", outcome_on: "2026-11-25", expected_version: 1 } ]);
    stub(observation()); await linkObservationAnimal("ob1", { animal_id: "an1", expected_version: 1 });
    expect(last().url).toBe("/zoonoses/observations/ob1/link_animal");
  });

  it("LV: sugestão sem gravar; coleta com leish_survey_id; desfecho com euthanasia_id", async () => {
    stub({ city_block_ids: [ "cb1" ], dog_population_suggested: 120, target_dogs: 120, below_focus_min: false });
    await suggestLeishSurvey({ kind: "focus", neighborhood_id: "nb1", center_city_block_id: "cb1", rings: 1 });
    expect([ last().url, methodOf() ]).toEqual([ "/zoonoses/leish_surveys/suggest", "POST" ]);
    stub(leishTest(), 201); await collectLeishTest({ leish_survey_id: "sv1", animal_id: "an1", collected_on: "2026-11-23", dpp_result: "reactive", dpp_on: "2026-11-23" });
    expect([ last().url, bodyOf().leish_survey_id ]).toEqual([ "/zoonoses/leish_tests", "sv1" ]);
    stub({ id: "lo1", leish_test_id: "lt1", animal_id: "an1", decision: "euthanasia", decided_on: "2026-11-23", euthanasia_id: "eu1", created_at: "x" }, 201);
    await recordLeishOutcome({ leish_test_id: "lt1", decision: "euthanasia", decided_on: "2026-11-23", euthanasia_id: "eu1" });
    expect([ last().url, bodyOf().euthanasia_id ]).toEqual([ "/zoonoses/leish_outcomes", "eu1" ]);
  });

  it("coleira: a retirada leva reason (sem expected_version); a colocação, o produto", async () => {
    stub(collar(), 201); await placeCollar({ animal_id: "an1", vector_product_id: "pz2" });
    expect([ last().url, bodyOf() ]).toEqual([ "/zoonoses/collars", { animal_id: "an1", vector_product_id: "pz2" } ]);
    stub(collar({ removed_on: "2026-11-23", removal_reason: "lost" })); await removeCollar("co1", { reason: "lost", removed_on: "2026-11-23" });
    expect([ last().url, bodyOf() ]).toEqual([ "/zoonoses/collars/co1/remove", { reason: "lost", removed_on: "2026-11-23" } ]);
    stub({ items: [ dueCollar() ] }); expect((await listDueCollars())[0].household_id).toBe("h1");
  });

  it("canil: entrada e saída; castração e eutanásia no corpo", async () => {
    stub({ ...stay(), animal: animal() }, 201);
    await enterShelter({ animal_id: "an1", health_unit_id: "uvz1", entry_kind: "observation", bite_observation_id: "ob1" });
    expect([ last().url, bodyOf().bite_observation_id ]).toEqual([ "/zoonoses/shelter_stays", "ob1" ]);
    stub(stay({ exit_kind: "returned" })); await exitShelter("st1", { exit_kind: "returned", expected_version: 1 });
    expect([ last().url, bodyOf() ]).toEqual([ "/zoonoses/shelter_stays/st1/exit", { exit_kind: "returned", expected_version: 1 } ]);
    stub({ id: "ne1" }, 201); await recordNeutering({ animal_id: "an1" });
    expect(last().url).toBe("/zoonoses/neuterings");
    stub(euthanasia(), 201);
    await recordEuthanasia({ animal_id: "an1", performed_on: "2026-11-23", reason: "leishmaniasis", reason_note: "caso confirmado pelo exame", legal_basis: [ "cfmv_1000_2012" ] });
    expect([ last().url, bodyOf().reason_note ]).toEqual([ "/zoonoses/euthanasias", "caso confirmado pelo exame" ]);
  });

  it("CSV do relatório pelo binaryFetch, com o nome do api", async () => {
    stubBlob(200, "a;b\r\n", 'attachment; filename="rabies_weekly-2026-11-23.csv"');
    expect((await fetchZoonosesReportFile("rabies_weekly", { ...PERIOD, campaign_id: "cp1" })).filename).toBe("rabies_weekly-2026-11-23.csv");
    expect(last().url).toBe("/zoonoses/reports/rabies_weekly.csv?from=2026-10-05&to=2026-11-23&campaign_id=cp1");
  });

  it("manifestação da equipe leva zoonoses_subtype e place_address só quando preenchidos", async () => {
    const base = { kind: "report" as const, identification_mode: "anonymous" as const, channel: "in_person" as const, body: "escorpião no quintal" };
    stub({ id: "m1", protocol: "P1", due_on: "2026-12-10" }, 201);
    await createOmbudsmanManifestation({ ...base, zoonoses_subtype: "scorpion", place_address: "  Rua das Palmeiras, 45  " });
    expect(bodyOf().zoonoses_subtype).toBe("scorpion");
    expect(bodyOf().place_address).toBe("Rua das Palmeiras, 45");
    expect(last().url).toBe("/ombudsman/manifestations");
    stub({ id: "m2", protocol: "P2", due_on: "2026-12-10" }, 201);
    await createOmbudsmanManifestation({ ...base, place_address: "   " });
    expect("zoonoses_subtype" in bodyOf()).toBe(false);
    expect("place_address" in bodyOf()).toBe(false);
  });
});
