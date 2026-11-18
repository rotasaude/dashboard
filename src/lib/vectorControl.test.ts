import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  NOMINAL_QUERY, STATIC_QUERY, VC_BLOCKS_KEY, VC_BLOCKS_TB_KEY, VC_BLOCK_TB_KEY, VC_CADENCES_KEY, VC_CYCLES_KEY, VC_CYCLE_KEY, VC_DOMAINS_KEY,
  VC_DUE_KEY, VC_HOUSEHOLDS_KEY, VC_ITEMS_KEY, VC_MAP_KEY, VC_NOT_AGENT, VC_NO_ROLE, VC_OVITRAPS_KEY, VC_PARAMS_KEY, VC_PRODUCTS_KEY, VC_PROFILE_KEY,
  VC_READINGS_KEY, VC_REPORT_KEY, VC_SAMPLES_KEY, VC_SETTINGS_KEY, VC_SHORTFALLS_KEY, VC_SURVEYS_KEY, VC_TASKS_KEY,
  blockNumberProblem, blockStatusLabel, canReadVectorReport, canUseVectorControl, caseLabel, collectionProblems, conditionLabel, countProblems,
  cycleProblems, domainLabel, dueReasonLabel, installProblems, isEndemicAgentTeam, isVectorStale, itemStatusLabel, noteProblem, ovitrapStatusLabel,
  riskTone, sampleResultProblems, shortfallCauseLabel, stratumModeLabel, stratumRangeProblem, surveyStatusLabel, taskKindLabel, taskStateLabel,
  ubvCycleProblems, vectorError, vectorMapLayers, vectorRefusals, vectorRoles
} from "./vectorControl";
import { NOMINAL_QUERY as HV_NOMINAL, STATIC_QUERY as HV_STATIC } from "./homeVisits";
import { VECTOR_CONTROL_DISABLED, VECTOR_ERRORS } from "./vectorErrors";
import { acsTeam } from "../test/homeVisitFixtures";
import { PARAMS, TODAY35, VC_DOMAINS, agentTeam, transmissionBlock, vcUser } from "../test/vectorControlFixtures";

const err = (status: number, body: unknown) => new ApiError(status, body, "x");
const paths = (list: { path: string }[]) => list.map((p) => p.path);

describe("portões e papéis", () => {
  it("portão: exige vector_control e a visita domiciliar utilizável (Q1); operador nunca", () => {
    expect(canUseVectorControl(vcUser())).toBe(true);
    expect(canUseVectorControl(vcUser(undefined, [ "clinical_record", "territory_registry", "vector_control" ]))).toBe(false);
    expect(canUseVectorControl(vcUser(undefined, [ "clinical_record", "territory_registry", "home_visits" ]))).toBe(false);
    expect(canUseVectorControl({ ...vcUser(), operator: true })).toBe(false);
    expect(canUseVectorControl(null)).toBe(false);
  });

  it("papéis da cidade e o agente pela equipe do contexto", () => {
    expect(vectorRoles(vcUser([ "endemic_coordinator" ]))).toMatchObject({ coordinator: true, lab: false, reader: true });
    expect(vectorRoles(vcUser([ "municipal_admin" ]))).toMatchObject({ coordinator: false, reader: true, admin: true });
    expect(vectorRoles(vcUser([ "vector_lab" ]))).toEqual({
      coordinator: false, lab: true, reader: true, admin: false, professional: false, stockKeeper: false
    });
    expect(vectorRoles(vcUser([ "health_professional", "stock_keeper" ]))).toEqual({
      coordinator: false, lab: false, reader: false, admin: false, professional: true, stockKeeper: true
    });
    expect(vectorRoles(null).reader).toBe(false);
    expect(isEndemicAgentTeam(agentTeam())).toBe(true);
    expect(isEndemicAgentTeam(acsTeam())).toBe(false);
    expect(isEndemicAgentTeam(agentTeam({ can_register: false }))).toBe(false);
  });

  it("relatórios: coordenação e municipal_admin todos; laboratório só ovitrampas e LIRAa (Q28); profissional nenhum", () => {
    const coord = vectorRoles(vcUser([ "endemic_coordinator" ]));
    const admin = vectorRoles(vcUser([ "municipal_admin" ]));
    const lab = vectorRoles(vcUser([ "vector_lab" ]));
    const pro = vectorRoles(vcUser());
    expect(canReadVectorReport(coord, "production")).toBe(true);
    expect(canReadVectorReport(admin, "blocks")).toBe(true);
    expect(canReadVectorReport(lab, "ovitraps")).toBe(true);
    expect(canReadVectorReport(lab, "liraa")).toBe(true);
    expect(canReadVectorReport(lab, "situations")).toBe(false);
    expect(canReadVectorReport(pro, "ovitraps")).toBe(false);
  });

  it("mapa: coordenação lê as três camadas; laboratório só ovitrampas; municipal_admin nenhuma", () => {
    expect(vectorMapLayers(vectorRoles(vcUser([ "endemic_coordinator" ])))).toEqual([ "risk", "ovitraps", "transmission" ]);
    expect(vectorMapLayers(vectorRoles(vcUser([ "vector_lab" ])))).toEqual([ "ovitraps" ]);
    expect(vectorMapLayers(vectorRoles(vcUser([ "municipal_admin" ])))).toEqual([]);
  });

  it("frases do portão e leituras reexportadas do 24b", () => {
    expect(VC_NO_ROLE).toBe("seu papel não permite usar a vigilância ambiental");
    expect(VC_NOT_AGENT).toBe("só o agente de combate às endemias (CBO 515140) usa esta tela");
    expect(STATIC_QUERY).toBe(HV_STATIC);
    expect(NOMINAL_QUERY).toBe(HV_NOMINAL);
    const keys = [ VC_DOMAINS_KEY, VC_BLOCKS_KEY, VC_HOUSEHOLDS_KEY, VC_PROFILE_KEY, VC_DUE_KEY, VC_CYCLES_KEY, VC_CYCLE_KEY, VC_CADENCES_KEY,
      VC_PARAMS_KEY, VC_PRODUCTS_KEY, VC_SETTINGS_KEY, VC_OVITRAPS_KEY, VC_READINGS_KEY, VC_TASKS_KEY, VC_SURVEYS_KEY, VC_ITEMS_KEY, VC_BLOCKS_TB_KEY,
      VC_BLOCK_TB_KEY, VC_SAMPLES_KEY, VC_SHORTFALLS_KEY, VC_REPORT_KEY, VC_MAP_KEY ];
    expect(keys.every((k) => typeof k === "string" && k.startsWith("vc"))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("rótulos (código novo cru)", () => {
  it("domínios, risco e motivos da folha", () => {
    expect(domainLabel(VC_DOMAINS.activities, "li_t")).toBe("LI+T — Levantamento de índice e tratamento");
    expect(domainLabel(VC_DOMAINS.activities, "novo")).toBe("novo");
    expect([ "green", "yellow", "red", "gray", "purple" ].map(riskTone)).toEqual([ "ok", "warn", "down", "neutral", "accent" ]);
    expect(riskTone("brown")).toBe("neutral");
    expect(riskTone(null)).toBe("neutral");
    expect([ "transmission_block", "liraa", "pending", "due" ].map(dueReasonLabel)).toEqual([ "bloqueio", "LIRAa", "pendência", "vencido" ]);
    expect(dueReasonLabel("novo")).toBe("novo");
  });

  it("ovitrampa, palheta e tarefa", () => {
    expect([ "active", "removed", "lost", "x" ].map(ovitrapStatusLabel)).toEqual([ "ativa", "retirada", "perdida", "x" ]);
    expect([ "ok", "damaged", "lost", "dry", "x" ].map(conditionLabel)).toEqual([ "em bom estado", "avariada", "perdida", "seca", "x" ]);
    expect(taskKindLabel("ovitrap_intensification")).toBe("Intensificar em torno da ovitrampa");
    expect(taskKindLabel("case_resident_elsewhere")).toBe("Caso de residente de outro município");
    expect(taskKindLabel("block_case_without_place")).toBe("Caso de bloqueio sem quarteirão");
    expect(taskKindLabel("x")).toBe("x");
    expect([ "open", "done", "dismissed", "x" ].map(taskStateLabel)).toEqual([ "aberta", "concluída", "descartada", "x" ]);
  });

  it("LIRAa, bloqueio, faltas e caso", () => {
    expect([ "draft", "drawn", "closed", "x" ].map(surveyStatusLabel)).toEqual([ "rascunho", "sorteado", "fechado", "x" ]);
    expect(stratumModeLabel("standard")).toBe("Padrão (8.100 a 12.000 imóveis)");
    expect(stratumModeLabel("half")).toBe("Reduzido (2.000 a 8.099)");
    expect(stratumModeLabel("census")).toBe("Censitário (até 1.999)");
    expect(stratumModeLabel("x")).toBe("x");
    expect([ "proposed", "active", "closed", "dismissed", "x" ].map(blockStatusLabel)).toEqual([ "proposto", "ativo", "fechado", "descartado", "x" ]);
    expect([ "no_location", "insufficient_balance", "no_lot", "x" ].map(shortfallCauseLabel))
      .toEqual([ "sem local de estoque configurado", "saldo insuficiente", "sem lote do produto", "x" ]);
    expect([ "pending", "inspected", "substituted", "x" ].map(itemStatusLabel)).toEqual([ "pendente", "inspecionado", "substituído", "x" ]);
    expect(caseLabel(transmissionBlock().cases[0])).toBe("caso 1");
  });
});

describe("regras de tela", () => {
  it("quarteirão: número de 1 a 10 letras, dígitos ou hífen", () => {
    for (const ok of [ "12", "12-A", "A", "1234567890" ]) expect(blockNumberProblem(ok), ok).toBeNull();
    for (const bad of [ "", "12 A", "12345678901", " 12", "12/A", "ç" ]) expect(blockNumberProblem(bad)?.path, bad).toBe("number");
  });

  it("instalação: número, data, quarteirão do imóvel e termo, na ordem do api", () => {
    const ok = { number: "OV-07", consent: true, installedOn: TODAY35, householdHasBlock: true };
    expect(installProblems(ok, TODAY35)).toEqual([]);
    expect(installProblems({ ...ok, householdHasBlock: null }, TODAY35)).toEqual([]);
    expect(installProblems({ ...ok, number: "123456789012" }, TODAY35)).toEqual([]);
    expect(installProblems({ ...ok, consent: false }, TODAY35)).toEqual([ { code: "consent_required", path: "consent", text: VECTOR_ERRORS.consent_required } ]);
    expect(installProblems({ ...ok, householdHasBlock: false }, TODAY35))
      .toEqual([ { code: "household_without_block", path: "household_id", text: VECTOR_ERRORS.household_without_block } ]);
    for (const number of [ "", "OV 07", "1234567890123" ]) expect(paths(installProblems({ ...ok, number }, TODAY35)), number).toEqual([ "number" ]);
    for (const installedOn of [ "2026-11-17", "", "2026-02-30", "16/11/2026" ]) {
      expect(paths(installProblems({ ...ok, installedOn }, TODAY35)), installedOn).toEqual([ "installed_on" ]);
    }
    expect(installProblems({ ...ok, installedOn: "2026-11-01" }, TODAY35)).toEqual([]);
    expect(paths(installProblems({ number: "", consent: false, installedOn: "", householdHasBlock: false }, TODAY35)))
      .toEqual([ "number", "installed_on", "household_id", "consent" ]);
  });

  it.each([ [ "2026-11-02", "2026-11-04", true ], [ "2026-11-02", "2026-11-05", false ], [ "2026-11-02", "2026-11-12", false ], [ "2026-11-02", "2026-11-13", true ] ])(
    "coleta: instalada %s, coletada %s → fora do prazo = %s (bordas de 2 e 11 dias)", (installedOn, collectedOn, out) => {
      const p = collectionProblems({ installedOn, collectedOn, condition: "ok" }, PARAMS, TODAY35);
      expect(p.some((x) => x.code === "collection_out_of_range" && x.path === "collected_on")).toBe(out);
    });

  it("coleta: data futura ou inválida e condição fora da lista", () => {
    const base = { installedOn: "2026-11-09", collectedOn: TODAY35, condition: "ok" };
    expect(collectionProblems(base, PARAMS, TODAY35)).toEqual([]);
    expect(collectionProblems({ ...base, collectedOn: "2026-11-17" }, PARAMS, TODAY35)).toEqual([
      { code: null, path: "collected_on", text: expect.any(String) }
    ]);
    expect(paths(collectionProblems({ ...base, collectedOn: "" }, PARAMS, TODAY35))).toEqual([ "collected_on" ]);
    expect(paths(collectionProblems({ ...base, condition: "" }, PARAMS, TODAY35))).toEqual([ "condition" ]);
    expect(paths(collectionProblems({ ...base, condition: "wet" }, PARAMS, TODAY35))).toEqual([ "condition" ]);
    for (const condition of [ "damaged", "lost", "dry" ]) expect(collectionProblems({ ...base, condition }, PARAMS, TODAY35)).toEqual([]);
  });

  it("contagem: 0 vale; 10000, -1 e 3,5 não; correção exige nota", () => {
    expect(countProblems({ eggs: "0", note: "" }, false)).toEqual([]);
    expect(countProblems({ eggs: "9999", note: "" }, false)).toEqual([]);
    for (const eggs of [ "10000", "-1", "3,5", "", "3.5", "1e3" ]) expect(countProblems({ eggs, note: "" }, false).map((p) => p.path), eggs).toEqual([ "egg_count" ]);
    expect(countProblems({ eggs: "12", note: "curta" }, true).map((p) => p.path)).toEqual([ "count_note" ]);
    expect(countProblems({ eggs: "12", note: "recontagem no laboratório" }, true)).toEqual([]);
  });

  it("contagem: a primeira não leva nota; correção só da nota (mesma contagem) recusa em egg_count (Q23)", () => {
    expect(paths(countProblems({ eggs: "12", note: "recontagem no laboratório" }, false))).toEqual([ "count_note" ]);
    expect(countProblems({ eggs: "12", note: "   " }, false)).toEqual([]);
    expect(paths(countProblems({ eggs: "12", note: "recontagem no laboratório" }, true, 12))).toEqual([ "egg_count" ]);
    expect(countProblems({ eggs: "13", note: "recontagem no laboratório" }, true, 12)).toEqual([]);
  });

  it("resultado da amostra: examinadas ≤ coletadas; aegypti + albopictus ≤ examinadas", () => {
    expect(sampleResultProblems({ examined: "9", aegypti: "0", albopictus: "0", note: "" }, { larvae_collected: 8 }, false)[0].code).toBe("sample_result_invalid");
    expect(sampleResultProblems({ examined: "8", aegypti: "5", albopictus: "4", note: "" }, { larvae_collected: 8 }, false)[0].code).toBe("sample_result_invalid");
    expect(sampleResultProblems({ examined: "8", aegypti: "5", albopictus: "3", note: "" }, { larvae_collected: 8 }, false)).toEqual([]);
    expect(sampleResultProblems({ examined: "0", aegypti: "0", albopictus: "0", note: "" }, { larvae_collected: 8 }, false)).toEqual([]);
  });

  it("resultado da amostra: paths do api, números inteiros, nota só na correção, correção só da nota recusa", () => {
    const s = { larvae_collected: 8 };
    expect(paths(sampleResultProblems({ examined: "9", aegypti: "0", albopictus: "0", note: "" }, s, false))).toEqual([ "examined_larvae" ]);
    expect(paths(sampleResultProblems({ examined: "8", aegypti: "5", albopictus: "4", note: "" }, s, false))).toEqual([ "aegypti_larvae" ]);
    expect(paths(sampleResultProblems({ examined: "", aegypti: "-1", albopictus: "1,5", note: "" }, s, false)))
      .toEqual([ "examined_larvae", "aegypti_larvae", "albopictus_larvae" ]);
    expect(paths(sampleResultProblems({ examined: "8", aegypti: "5", albopictus: "3", note: "conferido de novo" }, s, false))).toEqual([ "result_note" ]);
    expect(paths(sampleResultProblems({ examined: "8", aegypti: "5", albopictus: "3", note: "curta" }, s, true))).toEqual([ "result_note" ]);
    const previous = { ...s, result: { examined_larvae: 8, aegypti_larvae: 5, albopictus_larvae: 3, result_at: "2026-11-16T12:00:00Z", corrected: false } };
    expect(paths(sampleResultProblems({ examined: "8", aegypti: "5", albopictus: "3", note: "conferido de novo" }, previous, true))).toEqual([ "examined_larvae" ]);
    expect(sampleResultProblems({ examined: "8", aegypti: "6", albopictus: "2", note: "conferido de novo" }, previous, true)).toEqual([]);
  });

  it("ciclo de UBV: intervalo de 4 dias recusa, 5 vale; duração 3 a 5; máximo 3", () => {
    const prev = [ { ends_on: "2026-11-10" } ];
    expect(ubvCycleProblems(prev, { starts_on: "2026-11-14", ends_on: "2026-11-16" }, PARAMS).map((p) => p.path)).toEqual([ "starts_on" ]);
    expect(ubvCycleProblems(prev, { starts_on: "2026-11-15", ends_on: "2026-11-17" }, PARAMS)).toEqual([]);
    expect(ubvCycleProblems(prev, { starts_on: "2026-11-15", ends_on: "2026-11-20" }, PARAMS).map((p) => p.path)).toEqual([ "ends_on" ]);
    expect(ubvCycleProblems(prev, { starts_on: "2026-11-15", ends_on: "2026-11-19" }, PARAMS)).toEqual([]);
    expect(ubvCycleProblems(prev, { starts_on: "2026-11-15", ends_on: "2026-11-16" }, PARAMS).map((p) => p.path)).toEqual([ "ends_on" ]);
    expect(ubvCycleProblems([ ...prev, ...prev, ...prev ], { starts_on: "2026-12-01", ends_on: "2026-12-03" }, PARAMS).map((p) => p.path)).toContain("cycles");
    expect(ubvCycleProblems([ ...prev, ...prev ], { starts_on: "2026-12-01", ends_on: "2026-12-03" }, PARAMS)).toEqual([]);
  });

  it("ciclo de UBV: primeiro ciclo sem intervalo; teto de 3 mesmo com parâmetro maior; código e datas inválidas", () => {
    expect(ubvCycleProblems([], { starts_on: TODAY35, ends_on: "2026-11-18" }, PARAMS)).toEqual([]);
    const four = [ { ends_on: "2026-10-01" }, { ends_on: "2026-10-10" }, { ends_on: "2026-10-20" } ];
    expect(paths(ubvCycleProblems(four, { starts_on: TODAY35, ends_on: "2026-11-18" }, { ...PARAMS, ubv_cycles_max: 5 }))).toEqual([ "cycles" ]);
    expect(ubvCycleProblems([], { starts_on: TODAY35, ends_on: "2026-11-25" }, PARAMS)[0].code).toBe("cycle_invalid");
    expect(paths(ubvCycleProblems([], { starts_on: "", ends_on: "2026-13-01" }, PARAMS))).toEqual([ "starts_on", "ends_on" ]);
  });

  it("ciclo de trabalho: número 1–12, fim ≥ início, ano civil ou epidemiológico do início (Q22)", () => {
    const ok = { year: 2026, number: 11, starts_on: "2026-11-02", ends_on: "2026-12-31" };
    expect(cycleProblems(ok)).toEqual([]);
    expect(cycleProblems({ ...ok, number: undefined })).toEqual([]);
    expect(paths(cycleProblems({ ...ok, number: 0 }))).toEqual([ "number" ]);
    expect(paths(cycleProblems({ ...ok, number: 13 }))).toEqual([ "number" ]);
    expect(cycleProblems({ ...ok, number: 12 })).toEqual([]);
    expect(cycleProblems({ ...ok, ends_on: "2026-11-01" })).toEqual([ { code: "cycle_invalid", path: "ends_on", text: expect.any(String) } ]);
    expect(cycleProblems({ ...ok, ends_on: "2026-11-02" })).toEqual([]);
    expect(cycleProblems({ ...ok, year: 2025 })).toEqual([ { code: "cycle_invalid", path: "year", text: expect.any(String) } ]);
    // 2026-01-02 é da semana 53 de 2025 (a semana 1 de 2026 começa no domingo 4 de janeiro).
    expect(cycleProblems({ year: 2025, starts_on: "2026-01-02", ends_on: "2026-01-31" })).toEqual([]);
    expect(cycleProblems({ year: 2026, starts_on: "2026-01-02", ends_on: "2026-01-31" })).toEqual([]);
    expect(paths(cycleProblems({ year: 2024, starts_on: "2026-01-02", ends_on: "2026-01-31" }))).toEqual([ "year" ]);
    expect(paths(cycleProblems({ year: 1999, starts_on: "", ends_on: "x" }))).toEqual([ "year", "starts_on", "ends_on" ]);
  });

  it.each([ [ "half", 8099, null ], [ "standard", 8099, "x" ], [ "standard", 8100, null ], [ "standard", 12000, null ], [ "standard", 12001, "x" ],
    [ "census", 1999, null ], [ "census", 2000, "x" ], [ "half", 2000, null ], [ "half", 1999, "x" ], [ "census", 0, null ], [ "half", 8100, "x" ] ] as const)(
    "estrato %s com N = %i", (mode, n, problem) => {
      expect(stratumRangeProblem(mode, n, PARAMS) === null).toBe(problem === null);
    });

  it("estrato: a faixa sai dos parâmetros; tipo desconhecido recusa", () => {
    expect(stratumRangeProblem("standard", 9000, { ...PARAMS, liraa_standard_min: 9500 })).not.toBeNull();
    expect(stratumRangeProblem("standard", 12001, PARAMS)).toMatch(/8\.100 a 12\.000/);
    expect(stratumRangeProblem("x" as "census", 10, PARAMS)).not.toBeNull();
  });

  it("nota de 10 a 500 caracteres (code points depois do trim)", () => {
    expect(noteProblem("curta", "note")?.path).toBe("note");
    expect(noteProblem("  ".concat("a".repeat(10), "  "), "note")).toBeNull();
    expect(noteProblem("a".repeat(501), "count_note")?.path).toBe("count_note");
    expect(noteProblem("a".repeat(500), "note")).toBeNull();
  });
});

describe("recusas do api", () => {
  it("recusas: código do 35a tem a frase da tabela; 403 vector_control diz o interruptor; código novo cru", () => {
    expect(vectorError(new ApiError(409, { error: "survey_not_draft" }, "x"))).toBe(VECTOR_ERRORS.survey_not_draft);
    expect(isVectorStale(new ApiError(409, { error: "invalid_transition", path: "status" }, "x"))).toBe(true);
    expect(vectorError(new ApiError(403, { error: "feature_disabled", feature: "vector_control" }, "x"))).toBe(VECTOR_CONTROL_DISABLED);
    expect(vectorError(new ApiError(422, { error: "brand_new" }, "x"))).toBe("recusado pelo servidor (brand_new)");
    expect(vectorRefusals(new ApiError(422, { error: "deposit_counts_inconsistent", path: "vector_inspection.deposits[0].treated" }, "x"))[0].path)
      .toBe("vector_inspection.deposits[0].treated");
  });

  it("todo código do 35a e os gerais têm frase; cbo_not_allowed é a do 35a; mfa_required não vira sessão expirada", () => {
    for (const code of Object.keys(VECTOR_ERRORS)) {
      if (code === "feature_disabled") continue;
      expect(vectorError(err(422, { error: code })), code).toBe(VECTOR_ERRORS[code as keyof typeof VECTOR_ERRORS]);
    }
    expect(vectorError(err(403, { error: "cbo_not_allowed" }))).toBe(VECTOR_ERRORS.cbo_not_allowed);
    expect(vectorError(err(403, { error: "missing_role" }))).toBe("seu papel não permite esta ação");
    expect(vectorError(err(401, { error: "mfa_required" }))).toBe("confirme sua identidade com o segundo fator e tente de novo");
    expect(vectorError(err(401, {}))).toBe("sessão expirada — entre de novo");
    expect(vectorError(new Error("rede"))).toBe("não foi possível falar com o servidor — tente de novo");
  });

  it("tela velha: relê nos 409 de estado, no not_found e na proposta que mudou (Q26(4)); não no resto", () => {
    for (const code of [ "invalid_transition", "survey_not_draft", "already_reconciled", "proposal_changed", "block_in_use", "product_in_use" ]) {
      expect(isVectorStale(err(409, { error: code })), code).toBe(true);
    }
    expect(isVectorStale(err(404, { error: "not_found" }))).toBe(true);
    expect(isVectorStale(err(422, { error: "invalid_request", path: "seen_case_ids" }))).toBe(true);
    expect(isVectorStale(err(422, { error: "invalid_request", path: "block_ids" }))).toBe(false);
    expect(isVectorStale(err(422, { error: "cycle_invalid", path: "ends_on" }))).toBe(false);
    expect(isVectorStale(err(403, { error: "feature_disabled", feature: "vector_control" }))).toBe(false);
    expect(isVectorStale(new Error("rede"))).toBe(false);
    expect(isVectorStale(null)).toBe(false);
  });
});
