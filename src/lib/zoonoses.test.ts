import { describe, expect, it } from "vitest";
import { ApiError, type MyProfessional, type RabiesCampaign } from "./api";
import {
  AFTER_PLANNED_END, NOMINAL_QUERY, STATIC_QUERY, ZOO_ANIMAL_KEY, ZOO_CAMPAIGNS_KEY, ZOO_COLLARS_KEY, ZOO_DEMANDS_KEY, ZOO_DEMAND_KEY, ZOO_DOMAINS_KEY,
  ZOO_ME_KEY, ZOO_NOT_VET, ZOO_NO_ROLE, ZOO_OBSERVATIONS_KEY, ZOO_OBSERVATION_KEY, ZOO_PARAMS_KEY, ZOO_REPORT_KEY, ZOO_STAYS_KEY, ZOO_SURVEYS_KEY,
  ZOO_TESTS_KEY, ZOO_VACCINATIONS_KEY, VET_CBO, ZOONOSES_SUBTYPES, animalProblems, canUseZoonoses, canUseZooDemands, closeObservationProblems,
  demandActions, demandProblems, elisaAllowed, euthanasiaProblems, focusBelowMinText, isReactiveDog, isVeterinarian, isZoonosesStale, leishOutcomeProblems,
  nextAnimalStatuses, observationDaysLeft, observationOutcomeLabel, observationStateLabel, parameterProblems, sampleCensusText, sampleTableProblems,
  stayExitProblems, suggestedGoal, vaccinationProblems, vetIdentity, zooLabel, zoonosesError, zoonosesRefusals, zoonosesRoles, zoonosesUsable
} from "./zoonoses";
import { ANIMAL_STAY_OPEN, ZOONOSES_DISABLED, ZOONOSES_ERRORS, ZOONOSES_OMBUDSMAN_DISABLED } from "./zoonosesErrors";
import { HOME_VISITS_DISABLED, STATIC_QUERY as HV_STATIC, NOMINAL_QUERY as HV_NOMINAL } from "./homeVisits";
import { OMBUDSMAN_ERRORS } from "./ombudsman";
import { TODAY35B, ZOO_DOMAINS, ZOO_PARAMS, campaign, demand, leishTest, observation, vetProfessional, zooUser } from "../test/zoonosesFixtures";

const err = (status: number, body: unknown) => new ApiError(status, body, "x");
const paths = (list: { path: string }[]) => list.map((p) => p.path);
const vetWith = (o: Partial<MyProfessional["professional"]>, ended = false): MyProfessional => {
  const v = vetProfessional();
  return { ...v, professional: { ...v.professional, ...o }, links: v.links.map((l) => ({ ...l, ended_at: ended ? "2026-06-01" : null })) };
};
const draft = (o: Record<string, unknown> = {}) => ({
  species: "dog", name: "Thor", sex: "male", size: "medium", coat: "caramelo", breed: "", birthEstimateOn: "", microchip: "", registryNumber: "",
  householdId: "h1", tutorId: "pt1", community: false, ...o
}) as Parameters<typeof animalProblems>[0];

describe("portões e papéis", () => {
  it("portão: zoonoses, cadastro territorial utilizável e um papel de leitura (Q10); operador nunca", () => {
    expect(canUseZoonoses(zooUser())).toBe(true);
    expect(canUseZoonoses(zooUser([ "municipal_admin" ]))).toBe(true);
    expect(canUseZoonoses(zooUser([ "health_professional" ]))).toBe(false);
    expect(canUseZoonoses(zooUser(undefined, [ "clinical_record", "zoonoses" ]))).toBe(false);
    expect(canUseZoonoses({ ...zooUser(), operator: true })).toBe(false);
  });
  it("zoonosesUsable ignora o papel (o que a ouvidoria usa)", () => {
    expect(zoonosesUsable(zooUser([ "health_professional" ]))).toBe(true);
    expect(zoonosesUsable(zooUser(undefined, [ "clinical_record", "territory_registry" ]))).toBe(false);
    expect(zoonosesUsable({ ...zooUser(), operator: true })).toBe(false);
    expect(zoonosesUsable(null)).toBe(false);
  });
  it("papéis: a coordenação de endemias é a do centro (Q1); admin só lê", () => {
    expect(zoonosesRoles(zooUser([ "endemic_coordinator" ]))).toEqual({ team: true, coordinator: true, admin: false, reader: true });
    expect(zoonosesRoles(zooUser([ "municipal_admin" ]))).toEqual({ team: false, coordinator: false, admin: true, reader: true });
    expect(zoonosesRoles(zooUser())).toEqual({ team: true, coordinator: false, admin: false, reader: true });
    expect(zoonosesRoles(zooUser([ "health_professional" ])).reader).toBe(false);
  });
  it("veterinário: papel da equipe, CBO 223305, CRMV completo e vínculo ativo (Q12)", () => {
    const team = zoonosesRoles(zooUser());
    expect(VET_CBO).toBe("223305");
    expect(isVeterinarian(vetProfessional(), team)).toBe(true);
    expect(isVeterinarian(vetProfessional(), zoonosesRoles(zooUser([ "health_professional" ])))).toBe(false);
    expect(isVeterinarian(vetProfessional(), zoonosesRoles(zooUser([ "municipal_admin" ])))).toBe(false);
    expect(vetIdentity(vetProfessional())).toBe("Dra. Ana Lima · CRMV-PR 12345");
    expect(isVeterinarian(vetWith({ council: "CRM" }), team)).toBe(false);
    expect(isVeterinarian(vetWith({ council_state: null }), team)).toBe(false);
    expect(isVeterinarian(vetWith({ registration_number: null }), team)).toBe(false);
    expect(isVeterinarian(vetWith({}, true), team)).toBe(false);
    expect(isVeterinarian(null, team)).toBe(false);
    const other = vetProfessional();
    expect(isVeterinarian({ ...other, links: other.links.map((l) => ({ ...l, cbo_code: "225125" })) }, team)).toBe(false);
  });
  it("demandas (Q35): exigem a ouvidoria além do centro", () => {
    expect(canUseZooDemands(zooUser())).toBe(false);
    expect(canUseZooDemands(zooUser(undefined, [ "clinical_record", "territory_registry", "zoonoses", "ombudsman" ]))).toBe(true);
    expect(canUseZooDemands(zooUser([ "health_professional" ], [ "clinical_record", "territory_registry", "zoonoses", "ombudsman" ]))).toBe(false);
  });
  it("frases de papel e veterinário", () => {
    expect(ZOO_NO_ROLE).toBe("seu papel não permite usar o centro de zoonoses");
    expect(ZOO_NOT_VET).toBe(ZOONOSES_ERRORS.veterinarian_required);
  });
});

describe("chaves, consultas e rótulos", () => {
  it("chaves distintas e as consultas do 24b reexportadas", () => {
    const keys = [ ZOO_DOMAINS_KEY, ZOO_ANIMAL_KEY, ZOO_CAMPAIGNS_KEY, ZOO_VACCINATIONS_KEY, ZOO_DEMANDS_KEY, ZOO_DEMAND_KEY, ZOO_OBSERVATIONS_KEY,
      ZOO_OBSERVATION_KEY, ZOO_SURVEYS_KEY, ZOO_TESTS_KEY, ZOO_COLLARS_KEY, ZOO_STAYS_KEY, ZOO_PARAMS_KEY, ZOO_REPORT_KEY, ZOO_ME_KEY ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith("zoo"))).toBe(true);
    expect(STATIC_QUERY).toBe(HV_STATIC);
    expect(NOMINAL_QUERY).toBe(HV_NOMINAL);
  });
  it("zooLabel: o rótulo da lista; código desconhecido ou lista ausente aparece cru", () => {
    expect(zooLabel(ZOO_DOMAINS.species, "dog")).toBe("Cão");
    expect(zooLabel(ZOO_DOMAINS.species, "ferret")).toBe("ferret");
    expect(zooLabel(undefined, "dog")).toBe("dog");
  });
  it("os oito subtipos do §4, na ordem, com os rótulos do contrato", () => {
    expect(ZOONOSES_SUBTYPES.map((s) => s.label)).toEqual([
      "Escorpião", "Morcego", "Rato ou outro roedor", "Carrapato", "Animal que mordeu ou atacou", "Animal com comportamento estranho ou paralisia",
      "Gato com feridas (esporotricose)", "Outro problema com animal"
    ]);
    expect(ZOONOSES_SUBTYPES).toEqual(ZOO_DOMAINS.subtypes);
  });
  it("rótulos fixos da observação (sem cancelled, Q16; eutanasiado como no domains.yml)", () => {
    expect(observationStateLabel("open")).toBe("em observação");
    expect(observationStateLabel("closed")).toBe("encerrada");
    expect(observationStateLabel("cancelled")).toBe("cancelled");
    expect([ "healthy", "died", "missing", "rabies_signs", "sent_to_exam", "euthanized" ].map(observationOutcomeLabel))
      .toEqual([ "sadio", "morreu", "desapareceu", "sinais de raiva", "enviado a exame", "eutanasiado" ]);
    expect(observationOutcomeLabel("novo")).toBe("novo");
  });
  it("frases fixas de tela do coordenador, letra por letra", () => {
    expect(AFTER_PLANNED_END).toBe("após o fim previsto da campanha");
    expect(focusBelowMinText(100)).toBe("O foco tem menos de 100 cães cadastrados: amplie a área ou confira o cadastro.");
    expect(sampleCensusText(500)).toBe("Abaixo de 500 cães, o manual não traz amostra: todos os cães entram no inquérito.");
  });
  it("os números das frases saem dos parâmetros de fábrica (100 e 500)", () => {
    expect(focusBelowMinText(ZOO_PARAMS.leish_focus_min_dogs)).toBe("O foco tem menos de 100 cães cadastrados: amplie a área ou confira o cadastro.");
    expect(sampleCensusText(ZOO_PARAMS.leish_sample_table[0].min_population ?? 0))
      .toBe("Abaixo de 500 cães, o manual não traz amostra: todos os cães entram no inquérito.");
  });
});

describe("animal", () => {
  it("rascunho válido não tem problema; tutor em branco é 'tutor não identificado' (Q22)", () => {
    expect(animalProblems(draft())).toEqual([]);
    expect(animalProblems(draft({ tutorId: null }))).toEqual([]);
  });
  it("tamanhos em code points depois do trim e recusa em vez de cortar", () => {
    expect(paths(animalProblems(draft({ name: "x".repeat(61) })))).toEqual([ "name" ]);
    expect(animalProblems(draft({ name: "  Thor  " }))).toEqual([]);
    expect(paths(animalProblems(draft({ coat: "x".repeat(41) })))).toEqual([ "coat" ]);
    expect(paths(animalProblems(draft({ breed: "x".repeat(61) })))).toEqual([ "breed" ]);
    expect(paths(animalProblems(draft({ registryNumber: "x".repeat(21) })))).toEqual([ "registry_number" ]);
    expect(animalProblems(draft({ name: "🐕".repeat(60) }))).toEqual([]);
  });
  it("microchip: 15 dígitos exatos", () => {
    expect(animalProblems(draft({ microchip: "985112345678901" }))).toEqual([]);
    expect(paths(animalProblems(draft({ microchip: "98511234567890" })))).toEqual([ "microchip" ]);
    expect(paths(animalProblems(draft({ microchip: "98511234567890A" })))).toEqual([ "microchip" ]);
  });
  it("tutor e comunitário juntos recusam em community; espécie e sexo obrigatórios", () => {
    expect(paths(animalProblems(draft({ community: true })))).toEqual([ "community" ]);
    expect(animalProblems(draft({ community: true, tutorId: null }))).toEqual([]);
    expect(paths(animalProblems(draft({ species: "", sex: "" })))).toEqual([ "species", "sex" ]);
  });
  it("situação (Q31): ativo vai a três; desaparecido volta ou morre; transferido e óbito são finais", () => {
    expect(nextAnimalStatuses("active")).toEqual([ "missing", "transferred", "deceased" ]);
    expect(nextAnimalStatuses("missing")).toEqual([ "active", "deceased" ]);
    expect(nextAnimalStatuses("transferred")).toEqual([]);
    expect(nextAnimalStatuses("deceased")).toEqual([]);
    expect(nextAnimalStatuses("novo")).toEqual([]);
  });
});

describe("vacinação", () => {
  const c = { campaign: campaign(), fieldUsable: true };
  const base = { modality: "house" as const, animalId: "a1", species: null, vaccinatedOn: TODAY35B, adverse: false, adverseNote: "", householdId: "h1" };
  it("posto fixo sem animal exige espécie; rotina sem campanha; casa a casa exige domicílio e campo", () => {
    expect(paths(vaccinationProblems({ ...base, modality: "fixed_post", animalId: null, householdId: null }, c, TODAY35B))).toEqual([ "species" ]);
    expect(vaccinationProblems({ ...base, modality: "fixed_post", animalId: null, species: "cat", householdId: null }, c, TODAY35B)).toEqual([]);
    expect(paths(vaccinationProblems({ ...base, householdId: null }, { ...c, fieldUsable: false }, TODAY35B))).toEqual([ "household_id", "modality" ]);
    expect(vaccinationProblems(base, c, TODAY35B)).toEqual([]);
    expect(vaccinationProblems({ ...base, modality: "routine", householdId: null }, { campaign: null, fieldUsable: false }, TODAY35B)).toEqual([]);
  });
  it("sem campanha aberta: casa e posto recusam em campaign_id; rotina com campanha aberta vale; casa sem animal recusa", () => {
    const noCampaign: { campaign: RabiesCampaign | null; fieldUsable: boolean } = { campaign: null, fieldUsable: true };
    expect(vaccinationProblems(base, noCampaign, TODAY35B)[0]).toMatchObject({ code: "campaign_not_open", path: "campaign_id" });
    expect(paths(vaccinationProblems({ ...base, modality: "fixed_post", species: "dog", animalId: null }, noCampaign, TODAY35B))).toEqual([ "campaign_id" ]);
    expect(vaccinationProblems({ ...base, modality: "routine", householdId: null }, c, TODAY35B)).toEqual([]);
    expect(paths(vaccinationProblems({ ...base, animalId: null }, c, TODAY35B))).toEqual([ "animal_id" ]);
    expect(paths(vaccinationProblems({ ...base, modality: "routine", animalId: null, householdId: null }, noCampaign, TODAY35B))).toEqual([ "animal_id" ]);
  });
  it("data entre o início da campanha (rotina: 30 dias antes) e hoje", () => {
    const open = { campaign: campaign({ starts_on: "2026-11-01" }), fieldUsable: true };
    const at = (vaccinatedOn: string, modality: "house" | "routine" = "house", cc: { campaign: RabiesCampaign | null; fieldUsable: boolean } = open) =>
      vaccinationProblems({ ...base, modality, householdId: modality === "house" ? "h1" : null, vaccinatedOn }, cc, TODAY35B);
    expect(at("2026-10-31")[0]).toMatchObject({ code: "date_out_of_range", path: "vaccinated_on" });
    expect(at("2026-11-01")).toEqual([]);
    expect(at("2026-11-24")[0]?.path).toBe("vaccinated_on");
    expect(at("2026-10-24", "routine", { campaign: null, fieldUsable: true })).toEqual([]);
    expect(at("2026-10-23", "routine", { campaign: null, fieldUsable: true })[0]?.path).toBe("vaccinated_on");
    expect(at("not-a-date")[0]?.path).toBe("vaccinated_on");
  });
  it("evento adverso: nota de 10 a 500 só com adverse", () => {
    expect(paths(vaccinationProblems({ ...base, adverse: true, adverseNote: "curta" }, c, TODAY35B))).toEqual([ "adverse_note" ]);
    expect(vaccinationProblems({ ...base, adverse: true, adverseNote: "inchaço no local da aplicação" }, c, TODAY35B)).toEqual([]);
    expect(paths(vaccinationProblems({ ...base, adverse: true, adverseNote: "x".repeat(501) }, c, TODAY35B))).toEqual([ "adverse_note" ]);
    expect(paths(vaccinationProblems({ ...base, adverse: false, adverseNote: "sobrou texto aqui" }, c, TODAY35B))).toEqual([ "adverse_note" ]);
  });
  it("meta sugerida = round(estimativa × cobertura); sem estimativa, null", () => {
    expect(suggestedGoal(1001, 0.8)).toBe(801);
    expect(suggestedGoal(1000, 0.8)).toBe(800);
    expect(suggestedGoal(null, 0.8)).toBeNull();
  });
});

describe("observação do agressor", () => {
  it.each([ [ "2026-11-24", true ], [ "2026-11-25", false ], [ "2026-11-23", true ] ] as const)(
    "sadio em %s com ends_on 2026-11-25 → observation_not_finished = %s (10º dia exato vale)", (outcomeOn, refused) => {
      const p = closeObservationProblems({ outcome: "healthy", outcomeOn, note: "" }, observation(), "2026-11-26");
      expect(p.some((x) => x.code === "observation_not_finished" && x.path === "outcome_on")).toBe(refused);
    });
  it("outras saídas não esperam o 10º dia", () => {
    expect(closeObservationProblems({ outcome: "died", outcomeOn: "2026-11-20", note: "" }, observation(), "2026-11-26")).toEqual([]);
  });
  it("desfecho antes da exposição ou no futuro recusa em outcome_on (date_out_of_range)", () => {
    const o = observation();
    for (const outcomeOn of [ "2026-11-14", "2026-11-27" ]) {
      expect(closeObservationProblems({ outcome: "died", outcomeOn, note: "" }, o, "2026-11-26")[0]).toMatchObject({ code: "date_out_of_range", path: "outcome_on" });
    }
  });
  it("desfecho obrigatório, data válida e nota opcional de 10 a 500", () => {
    const o = observation();
    expect(paths(closeObservationProblems({ outcome: null, outcomeOn: "2026-11-20", note: "" }, o, "2026-11-26"))).toEqual([ "outcome" ]);
    expect(paths(closeObservationProblems({ outcome: "died", outcomeOn: "", note: "" }, o, "2026-11-26"))).toEqual([ "outcome_on" ]);
    expect(paths(closeObservationProblems({ outcome: "died", outcomeOn: "2026-11-20", note: "curta" }, o, "2026-11-26"))).toEqual([ "outcome_note" ]);
    expect(closeObservationProblems({ outcome: "died", outcomeOn: "2026-11-20", note: "o animal morreu no quintal" }, o, "2026-11-26")).toEqual([]);
  });
  it("dias que faltam: 2 no dia 23, 0 no dia 25, -1 no dia 26", () => {
    expect([ "2026-11-23", "2026-11-25", "2026-11-26" ].map((d) => observationDaysLeft("2026-11-25", d))).toEqual([ 2, 0, -1 ]);
  });
});

describe("leishmaniose e canil", () => {
  it("ELISA só depois de DPP reagente; cão reagente com os dois", () => {
    expect(elisaAllowed(leishTest({ dpp_result: "non_reactive" }))).toBe(false);
    expect(elisaAllowed(leishTest({ dpp_result: null }))).toBe(false);
    expect(elisaAllowed(leishTest({ dpp_result: "reactive" }))).toBe(true);
    expect(isReactiveDog(leishTest({ dpp_result: "reactive", elisa_result: "reactive" }))).toBe(true);
    expect(isReactiveDog(leishTest({ dpp_result: "reactive", elisa_result: "inconclusive" }))).toBe(false);
    expect(isReactiveDog(leishTest({ dpp_result: "reactive", elisa_result: null }))).toBe(false);
  });
  it("desfecho da LV: eutanásia exige a eutanásia; tratamento e recusa exigem tutor", () => {
    expect(leishOutcomeProblems({ decision: "euthanasia", euthanasiaId: null }, { tutor: true })[0]).toMatchObject({ code: "euthanasia_required", path: "euthanasia_id" });
    expect(leishOutcomeProblems({ decision: "euthanasia", euthanasiaId: "eu1" }, { tutor: false })).toEqual([]);
    expect(leishOutcomeProblems({ decision: "refused", euthanasiaId: null }, { tutor: false })[0]).toMatchObject({ code: "tutor_required", path: "decision" });
    expect(leishOutcomeProblems({ decision: "tutor_treatment", euthanasiaId: null }, { tutor: false })[0].code).toBe("tutor_required");
    expect(leishOutcomeProblems({ decision: "tutor_treatment", euthanasiaId: null }, { tutor: true })).toEqual([]);
    expect(paths(leishOutcomeProblems({ decision: null, euthanasiaId: null }, { tutor: true }))).toEqual([ "decision" ]);
  });
  it("saída do canil: devolução exige tutor, adoção exige adotante, eutanásia exige a eutanásia", () => {
    expect(stayExitProblems({ exitKind: "adopted", adopterId: null }, { tutor: false, euthanized: false }).map((p) => p.path)).toEqual([ "adopter_patient_id" ]);
    expect(stayExitProblems({ exitKind: "returned", adopterId: null }, { tutor: false, euthanized: false })[0]).toMatchObject({ code: "tutor_required", path: "exit_kind" });
    expect(stayExitProblems({ exitKind: "returned", adopterId: null }, { tutor: true, euthanized: false })).toEqual([]);
    expect(stayExitProblems({ exitKind: "euthanasia", adopterId: null }, { tutor: false, euthanized: false })[0]).toMatchObject({ code: "euthanasia_required", path: "exit_kind" });
    expect(stayExitProblems({ exitKind: "euthanasia", adopterId: null }, { tutor: false, euthanized: true })).toEqual([]);
    expect(paths(stayExitProblems({ exitKind: "death", adopterId: "pt9" }, { tutor: false, euthanized: false }))).toEqual([ "adopter_patient_id" ]);
    expect(stayExitProblems({ exitKind: "transferred", adopterId: null }, { tutor: false, euthanized: false })).toEqual([]);
  });
  it("eutanásia: motivo, nota 10–1000, ao menos uma base legal e data até hoje", () => {
    expect(euthanasiaProblems({ reason: "leishmaniasis", note: "curta", legalBasis: [], performedOn: TODAY35B }, TODAY35B).map((p) => p.path)).toEqual([ "reason_note", "legal_basis" ]);
    expect(paths(euthanasiaProblems({ reason: "", note: "x".repeat(1001), legalBasis: [ "cfmv_1000_2012" ], performedOn: "2026-11-24" }, TODAY35B)))
      .toEqual([ "reason", "reason_note", "performed_on" ]);
    expect(euthanasiaProblems({ reason: "leishmaniasis", note: "sem cura e com sofrimento", legalBasis: [ "cfmv_1000_2012" ], performedOn: TODAY35B }, TODAY35B)).toEqual([]);
  });
});

describe("demandas", () => {
  it("ações por estado", () => {
    expect(demandActions(demand({ state: "open" }))).toEqual([ "schedule", "inspect", "close", "decline", "extend" ]);
    expect(demandActions(demand({ state: "scheduled" }))).toEqual([ "inspect", "close", "decline", "extend" ]);
    expect(demandActions(demand({ state: "inspected" }))).toEqual([ "close", "decline", "extend" ]);
    expect(demandActions(demand({ state: "closed" }))).toEqual([]);
  });
  it("sem encaminhamento pendente a demanda não oferece ação (forwarding_changed)", () => {
    expect(demandActions(demand({ state: "open", forwarding_state: "cancelled" }))).toEqual([]);
    expect(demandActions(demand({ state: "open", forwarding_state: "replied" }))).toEqual([]);
  });
  it("agendar: data a partir de hoje", () => {
    expect(demandProblems("schedule", { date: TODAY35B }, TODAY35B)).toEqual([]);
    expect(demandProblems("schedule", { date: "2026-11-22" }, TODAY35B)[0]).toMatchObject({ code: "date_out_of_range", path: "scheduled_on" });
    expect(paths(demandProblems("schedule", { date: "" }, TODAY35B))).toEqual([ "scheduled_on" ]);
  });
  it("vistoriar: data até hoje e nota de 10 a 2000", () => {
    expect(demandProblems("inspect", { date: TODAY35B, note: "escorpião recolhido no quintal" }, TODAY35B)).toEqual([]);
    expect(paths(demandProblems("inspect", { date: "2026-11-24", note: "curta" }, TODAY35B))).toEqual([ "inspected_on", "inspection_note" ]);
    expect(paths(demandProblems("inspect", { date: TODAY35B, note: "x".repeat(2001) }, TODAY35B))).toEqual([ "inspection_note" ]);
  });
  it("encerrar: desfecho e texto de 20 a 4000; recusar e prorrogar: 10 a 4000", () => {
    expect(paths(demandProblems("close", { outcome: "", text: "curto" }, TODAY35B))).toEqual([ "outcome", "text" ]);
    expect(demandProblems("close", { outcome: "resolved", text: "x".repeat(20) }, TODAY35B)).toEqual([]);
    expect(paths(demandProblems("decline", { text: "x".repeat(9) }, TODAY35B))).toEqual([ "text" ]);
    expect(demandProblems("extend", { text: "x".repeat(10) }, TODAY35B)).toEqual([]);
    expect(paths(demandProblems("extend", { text: "x".repeat(4001) }, TODAY35B))).toEqual([ "text" ]);
  });
});

describe("parâmetros", () => {
  const table = (rows: [ number, number ][]) => rows.map(([ population, sample ]) => ({ population, sample }));
  it("tabela da amostra: populações crescentes, inteiros > 0, amostra até a população (path da tabela, como o api)", () => {
    expect(sampleTableProblems(ZOO_PARAMS.leish_sample_table)).toEqual([]);
    expect(sampleTableProblems(table([ [ 1000, 100 ], [ 900, 90 ] ]))[0]).toMatchObject({ code: "invalid_parameter", path: "values.leish_sample_table" });
    expect(sampleTableProblems(table([ [ 1000, 100 ], [ 1000, 120 ] ]))).toHaveLength(1);
    expect(sampleTableProblems(table([ [ 0, 1 ] ]))).toHaveLength(1);
    expect(sampleTableProblems(table([ [ 100, 1.5 ] ]))).toHaveLength(1);
    expect(sampleTableProblems(table([ [ 100, 101 ] ]))).toHaveLength(1);
    expect(sampleTableProblems([])).toHaveLength(1);
  });
  it("mínimo da 1ª linha: inteiro > 0 e até a população dela", () => {
    expect(sampleTableProblems([ { population: 599, sample: 300, min_population: 600 } ])).toHaveLength(1);
    expect(sampleTableProblems([ { population: 599, sample: 300, min_population: 0 } ])).toHaveLength(1);
    expect(sampleTableProblems([ { population: 599, sample: 300, min_population: 500 }, { population: 699, sample: 334, a_conferir: true } ])).toEqual([]);
  });
  it("faixas do §9 (sem leish_expected_prevalence, Q18), com path values.<chave>", () => {
    expect(parameterProblems(ZOO_PARAMS)).toEqual([]);
    const bad = (o: Partial<typeof ZOO_PARAMS>) => paths(parameterProblems({ ...ZOO_PARAMS, ...o }));
    expect(bad({ observation_days: 9 })).toEqual([ "values.observation_days" ]);
    expect(bad({ observation_days: 31 })).toEqual([ "values.observation_days" ]);
    expect(bad({ observation_days: 10.5 })).toEqual([ "values.observation_days" ]);
    expect(bad({ collar_months: 0 })).toEqual([ "values.collar_months" ]);
    expect(bad({ collar_months: 13 })).toEqual([ "values.collar_months" ]);
    expect(bad({ leish_focus_min_dogs: 9 })).toEqual([ "values.leish_focus_min_dogs" ]);
    expect(bad({ leish_focus_min_dogs: 1001 })).toEqual([ "values.leish_focus_min_dogs" ]);
    expect(bad({ dogs_per_block: 0 })).toEqual([ "values.dogs_per_block" ]);
    expect(bad({ dogs_per_block: 101 })).toEqual([ "values.dogs_per_block" ]);
    expect(bad({ rabies_coverage_target: 0.09 })).toEqual([ "values.rabies_coverage_target" ]);
    expect(bad({ rabies_coverage_target: 1.01 })).toEqual([ "values.rabies_coverage_target" ]);
    expect(bad({ rabies_coverage_target: 1 })).toEqual([]);
    expect(bad({ dog_population_estimate: -1 })).toEqual([ "values.dog_population_estimate" ]);
    expect(bad({ cat_population_estimate: 2.5 })).toEqual([ "values.cat_population_estimate" ]);
    expect(bad({ dog_population_estimate: 1200, cat_population_estimate: 0 })).toEqual([]);
    expect(bad({ leish_sample_table: table([ [ 10, 5 ], [ 9, 4 ] ]) })).toEqual([ "values.leish_sample_table" ]);
  });
});

describe("recusas do api", () => {
  it("código do 35b com a frase; 403 zoonoses diz o interruptor; código novo cru", () => {
    expect(zoonosesError(err(422, { error: "microchip_taken", path: "microchip" }))).toBe(ZOONOSES_ERRORS.microchip_taken);
    expect(zoonosesError(err(403, { error: "feature_disabled", feature: "zoonoses" }))).toBe(ZOONOSES_DISABLED);
    expect(zoonosesError(err(422, { error: "brand_new" }))).toBe("recusado pelo servidor (brand_new)");
    expect(zoonosesRefusals(err(422, { error: "microchip_taken", path: "microchip" }))).toEqual([
      { path: "microchip", code: "microchip_taken", text: ZOONOSES_ERRORS.microchip_taken }
    ]);
  });
  it("feature_disabled da ouvidoria e da visita domiciliar nomeiam a que está desligada (Q35)", () => {
    expect(zoonosesError(err(403, { error: "feature_disabled", feature: "ombudsman" }))).toBe(ZOONOSES_OMBUDSMAN_DISABLED);
    expect(zoonosesError(err(403, { error: "feature_disabled", feature: "home_visits" }))).toBe(HOME_VISITS_DISABLED);
    expect(zoonosesRefusals(err(403, { error: "feature_disabled", feature: "ombudsman" }))[0].code).toBe("feature_disabled");
  });
  it("401 mfa_required diz o step-up, não sessão expirada; 401 sem código é sessão", () => {
    expect(zoonosesError(err(401, { error: "mfa_required" }))).toBe(ZOONOSES_ERRORS.mfa_required);
    expect(zoonosesError(err(401, { error: "unauthenticated" }))).toContain("sessão");
  });
  it("frases do 33 que o centro usa: forwarding_already_pending e already_extended", () => {
    expect(zoonosesError(err(409, { error: "forwarding_already_pending", path: "destination" }))).toBe("Já existe um encaminhamento pendente para este destino.");
    expect(zoonosesError(err(422, { error: "already_extended" }))).toBe(OMBUDSMAN_ERRORS.already_extended);
  });
  it("invalid_transition no PATCH do animal diz para fechar a estada; fora dele, a frase geral", () => {
    const e = err(409, { error: "invalid_transition", path: "status" });
    expect(zoonosesError(e, "animal_status")).toBe(ANIMAL_STAY_OPEN);
    expect(zoonosesError(e)).toBe(ZOONOSES_ERRORS.invalid_transition);
    expect(zoonosesRefusals(e, "animal_status")[0]).toEqual({ path: "status", code: "invalid_transition", text: ANIMAL_STAY_OPEN });
    expect(zoonosesError(err(409, { error: "animal_changed" }), "animal_status")).toBe(ZOONOSES_ERRORS.animal_changed);
  });
  it("sem resposta do api: a frase de rede do 24b", () => {
    expect(zoonosesError(new Error("offline"))).toContain("servidor");
  });
  it("409 de estado velho: tela relida uma vez; 422, citizen_not_verified e reserved_subject não são velhos", () => {
    expect(isZoonosesStale(err(409, { error: "campaign_already_open" }))).toBe(true);
    for (const code of [
      "animal_changed", "animal_not_active", "campaign_changed", "survey_changed", "collar_changed", "invalid_transition", "demand_changed",
      "forwarding_changed", "observation_changed", "test_changed", "stay_changed", "stay_already_open", "already_euthanized", "parameters_changed"
    ]) expect(isZoonosesStale(err(409, { error: code }))).toBe(true);
    expect(isZoonosesStale(err(404, { error: "not_found" }))).toBe(true);
    expect(isZoonosesStale(err(422, { error: "already_vaccinated_in_campaign" }))).toBe(false);
    expect(isZoonosesStale(err(409, { error: "citizen_not_verified" }))).toBe(false);
    expect(isZoonosesStale(err(409, { error: "reserved_subject" }))).toBe(false);
    expect(isZoonosesStale(err(401, { error: "mfa_required" }))).toBe(false);
    expect(isZoonosesStale(new Error("x"))).toBe(false);
  });
  it("invalid_transition com estada aberta é recusa de regra, não corrida", () => {
    expect(isZoonosesStale(err(409, { error: "invalid_transition", path: "status" }), "animal_status")).toBe(false);
    expect(isZoonosesStale(err(409, { error: "animal_changed" }), "animal_status")).toBe(true);
  });
});
