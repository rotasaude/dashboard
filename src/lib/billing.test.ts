// src/lib/billing.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  BILLING_DISABLED, EMPTY_FILTERS, sigtapQueryProblem, billingError, billingRoles, canUseBilling, cidHint, closeDescription, closingCompetence, demographicsMissingOf, emptyProcedure,
  establishmentKey, establishmentLabel, exportFileName, fallbackNotice, fixInfo, groupPending, isStale, manualProblem, normalizeCid,
  notBillableText, parseEstablishmentKey, periodStatusText, procedureBody, procedureProblem, procedureQuery, reasonLabel, reasonProblem,
  savedText, settingsBody, settingsComplete, settingsDraft, settingsProblem, showUnitProcedures, sigtapCompetence, sourceLabel, unitBills,
  verdict, NO_PATIENT_NAME, patientName
} from "./billing";
import { demographicsError } from "./demographics";
import { LAB_EST, SETTINGS, SUTURE, TODAY22, UPA, UBS, UPA_EST, URGENCY, billingExport, billingUser, pending, period, procedure } from "../test/billingFixtures";

const refusal = (status: number, error: string) => new ApiError(status, { error }, String(status));

describe("quem usa", () => {
  it("interruptor na sessão; operador nunca", () => {
    expect(canUseBilling(billingUser())).toBe(true);
    expect(canUseBilling(billingUser([ "billing_clerk" ], { features: [] }))).toBe(false);
    expect(canUseBilling({ ...billingUser(), operator: true })).toBe(false);
    expect(canUseBilling(null)).toBe(false);
  });

  it("papéis", () => {
    expect(billingRoles(billingUser([ "billing_clerk", "municipal_admin" ]))).toEqual({ clerk: true, admin: true, professional: false });
    expect(billingRoles(billingUser([ "health_professional" ]))).toEqual({ clerk: false, admin: false, professional: true });
  });

  it("unitBills e showUnitProcedures: UBS nunca, UPA sim", () => {
    expect(unitBills(UBS)).toBe(false);
    expect(unitBills(UPA)).toBe(true);
    expect(unitBills({ kind: "hospital" })).toBe(true);
    expect(unitBills(null)).toBe(false);
    const pro = billingUser([ "health_professional" ]);
    expect(showUnitProcedures({ user: pro, canCare: true, unit: UPA })).toBe(true);
    expect(showUnitProcedures({ user: pro, canCare: true, unit: UBS })).toBe(false);
    expect(showUnitProcedures({ user: pro, canCare: false, unit: UPA })).toBe(false);
    expect(showUnitProcedures({ user: billingUser([ "health_professional" ], { features: [] }), canCare: true, unit: UPA })).toBe(false);
  });
});

describe("veredito da crítica", () => {
  it("motivos dos dados do paciente (contrato §12, D-U1)", () => {
    expect(reasonLabel("missing_race_color")).toBe("paciente sem raça/cor");
    expect(reasonLabel("missing_address")).toBe("paciente sem CEP ou endereço");
    expect(demographicsMissingOf([ "missing_address", "missing_patient_id", "missing_race_color" ])).toEqual([ "race_color", "address" ]);
    expect(demographicsMissingOf([ "missing_patient_id" ])).toEqual([]);
  });

  it("faturável com o instrumento; não faturável com os motivos em português; cancelado", () => {
    expect(verdict(procedure())).toEqual({ tone: "ok", text: "faturável · BPA-I" });
    expect(verdict(procedure({ billable: false, instrument: "bpa_i", blocking_reasons: [ "cid_required", "missing_professional_cns" ] })))
      .toEqual({ tone: "warn", text: "não faturável — o procedimento exige CID-10; profissional sem CNS no cadastro" });
    expect(verdict(procedure({ billable: false, blocking_reasons: [] }))).toEqual({ tone: "warn", text: "não faturável" });
    expect(verdict(procedure({ status: "cancelled" }))).toEqual({ tone: "neutral", text: "cancelado" });
  });

  it("os 13 motivos do contrato têm frase; motivo novo sai cru", () => {
    for (const code of [ "not_in_sigtap", "cbo_not_allowed", "age_out_of_range", "sex_not_allowed", "cid_required", "cid_not_allowed",
      "not_bpa_instrument", "establishment_is_aps", "missing_professional_cns", "missing_professional_cbo", "missing_patient_id",
      "missing_required_patient_field", "missing_establishment_cnes" ]) {
      expect(reasonLabel(code)).not.toBe(code);
    }
    expect(reasonLabel("establishment_is_aps")).toBe("unidade de atenção primária — a produção vai pelo e-SUS APS");
    expect(reasonLabel("habilitation_missing")).toBe("habilitation_missing");
    expect(sourceLabel("lab_report")).toBe("laboratório municipal");
    expect(sourceLabel("rnds")).toBe("rnds");
  });

  it("SIGTAP de outra competência e a frase depois de registrar", () => {
    expect(fallbackNotice(procedure())).toBeNull();
    expect(fallbackNotice(procedure({ sigtap_fallback: true, sigtap_competence: "202609" })))
      .toBe("conferido com a SIGTAP de 09/2026: a tabela da competência ainda não foi importada — o fechamento confere de novo");
    expect(savedText(procedure())).toBe("Procedimento registrado — faturável.");
    expect(savedText(procedure({ billable: false, blocking_reasons: [ "cid_required" ] })))
      .toBe("Procedimento registrado — não faturável — o procedimento exige CID-10. O registro vale; o faturamento confere de novo no fechamento.");
  });
});

describe("formulário do procedimento", () => {
  const ready = { ...emptyProcedure(TODAY22), sigtap: URGENCY };

  it("começa com quantidade 1, eletivo e a data de hoje", () => {
    expect(emptyProcedure(TODAY22)).toEqual({ sigtap: null, quantity: "1", cid10: "", character: "elective", performedOn: TODAY22 });
    expect(sigtapCompetence(ready)).toBe("202610");
  });

  it("recusa só formato", () => {
    expect(procedureProblem(emptyProcedure(TODAY22), TODAY22)).toBe("escolha o procedimento pela busca");
    for (const q of [ "0", "1000", "1,5", "", "-1" ]) expect(procedureProblem({ ...ready, quantity: q }, TODAY22)).toBe("quantidade de 1 a 999, só números");
    expect(procedureProblem({ ...ready, quantity: "999" }, TODAY22)).toBeNull();
    expect(procedureProblem({ ...ready, cid10: "61S" }, TODAY22)).toBe("CID-10 inválido — ex.: S61 ou S610");
    expect(procedureProblem({ ...ready, cid10: "s61.0" }, TODAY22)).toBeNull();
    expect(procedureProblem({ ...ready, performedOn: "2026-10-22" }, TODAY22)).toBe("a data do procedimento não pode ser no futuro");
    expect(procedureProblem({ ...ready, performedOn: "" }, TODAY22)).toBe("informe a data do procedimento");
  });

  it("CID ausente num procedimento que exige: só aviso, nunca bloqueio", () => {
    const suture = { ...emptyProcedure(TODAY22), sigtap: SUTURE };
    expect(procedureProblem(suture, TODAY22)).toBeNull();
    expect(cidHint(suture)).toBe("a SIGTAP exige CID-10 para faturar este procedimento — sem ele, o registro vale, mas fica não faturável");
    expect(cidHint({ ...suture, cid10: "S61" })).toBeNull();
    expect(cidHint(ready)).toBeNull();
  });

  it("corpo: CID normalizado, opcionais só quando há valor", () => {
    expect(normalizeCid(" s61.0 ")).toBe("S610");
    expect(procedureBody({ ...ready, quantity: "2", cid10: "s61.0", character: "urgent" }, {
      establishment: { type: "health_unit", id: "u7" }, patientId: "pa1", attendanceId: "a1", consultationId: null
    })).toEqual({
      establishment: { type: "health_unit", id: "u7" }, performed_on: TODAY22, sigtap_code: "0301060061", quantity: 2,
      character: "urgent", cid10: "S610", patient_id: "pa1", attendance_id: "a1"
    });
    expect(procedureBody(ready, {
      establishment: { type: "lab_provider", id: "pv9" }, patientId: "pa1", professionalUserId: "us5", cboCode: "221205"
    })).toEqual({
      establishment: { type: "lab_provider", id: "pv9" }, performed_on: TODAY22, sigtap_code: "0301060061", quantity: 1,
      character: "elective", patient_id: "pa1", professional_user_id: "us5", cbo_code: "221205"
    });
  });

  it("motivo de cancelamento e de reabertura: 10 a 500, recusado e não cortado", () => {
    expect(reasonProblem("curto")).toBe("motivo com pelo menos 10 caracteres");
    expect(reasonProblem("          x")).toBe("motivo com pelo menos 10 caracteres");
    expect(reasonProblem("x".repeat(501))).toBe("motivo com até 500 caracteres — encurte o texto");
    expect(reasonProblem("lançado no paciente errado")).toBeNull();
  });

  it("lançamento manual: estabelecimento, paciente, profissional e o CBO quando há escolha", () => {
    const base = { establishment: "health_unit:u7", patientId: "pa1", professionalId: "us3", cboOptions: [ "223505", "223565" ], cbo: "" };
    expect(manualProblem({ ...base, establishment: "" })).toBe("escolha o estabelecimento");
    expect(manualProblem({ ...base, patientId: null })).toBe("busque o paciente pelo CPF");
    expect(manualProblem({ ...base, professionalId: "" })).toBe("escolha o profissional");
    expect(manualProblem(base)).toBe("escolha o CBO do profissional");
    expect(manualProblem({ ...base, cbo: "223505" })).toBeNull();
    // Sem CBO no vínculo: segue — a crítica marca missing_professional_cbo.
    expect(manualProblem({ ...base, cboOptions: [], cbo: "" })).toBeNull();
  });
});

describe("estabelecimentos e filtros", () => {
  it("rótulo com CNES ou sem; chave ida e volta", () => {
    expect(establishmentLabel(UPA_EST)).toBe("UPA Boa Vista · CNES 2384299");
    expect(establishmentLabel({ ...LAB_EST, cnes: null })).toBe("Laboratório Municipal · sem CNES");
    expect(establishmentKey(LAB_EST)).toBe("lab_provider:pv9");
    expect(parseEstablishmentKey("lab_provider:pv9")).toEqual({ type: "lab_provider", id: "pv9" });
    expect(parseEstablishmentKey("")).toBeNull();
    expect(parseEstablishmentKey("clinic:x")).toBeNull();
  });

  it("filtros viram só códigos e ids; motivo só com não faturáveis", () => {
    expect(EMPTY_FILTERS(TODAY22)).toEqual({ establishment: "", competence: "202610", billable: "", reason: "", patientId: null });
    expect(procedureQuery(EMPTY_FILTERS(TODAY22))).toEqual({ competence: "202610" });
    expect(procedureQuery({ establishment: "lab_provider:pv9", competence: "202609", billable: "false", reason: "cbo_not_allowed", patientId: "pa1" }))
      .toEqual({ establishmentType: "lab_provider", establishmentId: "pv9", competence: "202609", billable: false, reason: "cbo_not_allowed", patientId: "pa1" });
    expect(procedureQuery({ establishment: "", competence: "202609", billable: "true", reason: "cbo_not_allowed", patientId: null }))
      .toEqual({ competence: "202609", billable: true });
  });
});

describe("competência", () => {
  it("abre na anterior; situação e não faturáveis em frase", () => {
    expect(closingCompetence(TODAY22)).toBe("202609");
    expect(closingCompetence("2026-01-05")).toBe("202512");
    expect(periodStatusText(period())).toBe("aberta");
    expect(periodStatusText(period({ status: "open", version: 2 }))).toBe("aberta · reaberta depois da versão 2");
    expect(periodStatusText(period({ status: "closed", version: 1 }))).toBe("fechada · versão 1");
    expect(periodStatusText(period({ status: "archived" }))).toBe("archived");
    expect(notBillableText(period().summary)).toBe("3 — CBO do profissional não permitido para o procedimento: 2; profissional sem CNS no cadastro: 1");
    expect(notBillableText({ ...period().summary, not_billable: {} })).toBe("nenhum");
  });

  it("descrição do fechamento diz o que entra, o que fica fora e que o arquivo não muda", () => {
    expect(closeDescription(period())).toBe(
      "As críticas são conferidas de novo com o cadastro de agora. Pela última conferência, entram 12 linhas de BPA-I e 3 de BPA-C; " +
      "1 pendência fica fora do arquivo até ser corrigida. Depois de gerado, o arquivo não muda: reabrir gera uma nova versão."
    );
  });

  it("pendências agrupadas por correção, na ordem profissional → paciente → estabelecimento → procedimento; correção nova no fim", () => {
    const groups = groupPending([
      pending({ procedure_id: "a", fix: "procedure" }), pending({ procedure_id: "b", fix: "rnds_link" }),
      pending({ procedure_id: "c", fix: "patient" }), pending({ procedure_id: "d", fix: "professional" }), pending({ procedure_id: "e", fix: "patient" })
    ]);
    expect(groups.map((g) => [ g.fix, g.items.map((i) => i.procedure_id) ])).toEqual([
      [ "professional", [ "d" ] ], [ "patient", [ "c", "e" ] ], [ "procedure", [ "a" ] ], [ "rnds_link", [ "b" ] ]
    ]);
    expect(fixInfo("professional").title).toBe("Cadastro do profissional");
    expect(fixInfo("rnds_link")).toEqual({ title: "rnds_link", hint: "" });
  });

  it("nome do arquivo sem dado pessoal", () => {
    expect(exportFileName(period(), billingExport({ version: 2 }))).toBe("bpa-2384299-202609-v2.txt");
    expect(exportFileName(period({ establishment: { ...UPA_EST, cnes: null } }), billingExport())).toBe("bpa-sem-cnes-202609-v1.txt");
  });
});

describe("configuração", () => {
  const draft = settingsDraft(SETTINGS);

  it("rascunho a partir do api; completo só com tudo", () => {
    expect(draft).toEqual({ originName: "SMS CURITIBA", originAcronym: "SMS", originCnpj: "11222333000181", destinationBody: "SECRETARIA MUNICIPAL DE SAUDE", management: "M" });
    expect(settingsDraft(null).management).toBe("");
    expect(settingsComplete(SETTINGS)).toBe(true);
    expect(settingsComplete({ ...SETTINGS, origin_acronym: null })).toBe(true);
    expect(settingsComplete({ ...SETTINGS, origin_cnpj: null })).toBe(false);
    expect(settingsComplete({ ...SETTINGS, management: null })).toBe(false);
    expect(settingsComplete(null)).toBe(false);
  });

  it("larguras do layout recusadas, nunca cortadas; CNPJ e gestão conferidos", () => {
    expect(settingsProblem(draft)).toBeNull();
    expect(settingsProblem({ ...draft, originName: "x".repeat(31) })).toBe("nome do órgão de origem com até 30 caracteres (largura do arquivo BPA) — abrevie");
    expect(settingsProblem({ ...draft, originAcronym: "SMSCWB1" })).toBe("sigla do órgão de origem com até 6 caracteres (largura do arquivo BPA)");
    expect(settingsProblem({ ...draft, destinationBody: "x".repeat(41) })).toBe("órgão de destino com até 40 caracteres (largura do arquivo BPA) — abrevie");
    expect(settingsProblem({ ...draft, originCnpj: "11222333000180" })).toBe("CNPJ de origem inválido");
    expect(settingsProblem({ ...draft, management: "" })).toBe("escolha a gestão: municipal (M) ou estadual (E)");
    expect(settingsProblem({ ...draft, originAcronym: "" })).toBeNull();
    expect(settingsProblem({ ...draft, originCnpj: "12.ABC.345/01DE-35" })).toBe("CNPJ de origem inválido");
    expect(settingsProblem({ ...draft, originName: "  " })).toBe("informe o nome do órgão de origem");
    expect(settingsBody({ ...draft, originCnpj: "11.222.333/0001-81", originName: " SMS CURITIBA " })).toEqual({
      origin_name: "SMS CURITIBA", origin_acronym: "SMS", origin_cnpj: "11222333000181", destination_body: "SECRETARIA MUNICIPAL DE SAUDE", management: "M"
    });
  });
});

describe("recusas", () => {
  it("frases do contrato e das divergências; desconhecido com o status", () => {
    expect(billingError(new ApiError(403, { error: "feature_disabled", feature: "procedure_billing" }, "403"))).toBe(BILLING_DISABLED);
    expect(billingError(refusal(422, "settings_missing"))).toBe(
      "falta a configuração do faturamento (nome e CNPJ de origem, órgão de destino e gestão) — a administração municipal preenche em Faturamento → Configuração do faturamento"
    );
    expect(billingError(refusal(422, "nothing_to_export"))).toBe("nada a exportar: nenhum procedimento faturável nesta competência e estabelecimento");
    expect(billingError(refusal(409, "already_exported"))).toBe("este procedimento já está no arquivo de uma competência fechada — para cancelar, o faturista reabre a competência");
    expect(billingError(refusal(422, "invalid_date"))).toBe("data inválida: fora da competência atual e das 3 anteriores (BPA Magnético 05.00)");
    expect(billingError(refusal(422, "reason_required"))).toBe("informe o motivo, de 10 a 500 caracteres");
    expect(billingError(refusal(404, "not_found"))).toBe("registro não encontrado — a tela foi atualizada");
    expect(billingError(refusal(422, "citizen_not_verified"))).toBe("o cadastro desta pessoa ainda não foi validado na unidade — valide antes de registrar");
    expect(billingError(new ApiError(500, "", "500"))).toBe("não foi possível concluir (500) — tente de novo");
    expect(billingError(new Error("rede"))).toBe("sem conexão com o servidor — tente de novo");
  });

  it("recusas que pedem reler a tela", () => {
    expect(isStale(refusal(404, "not_found"))).toBe(true);
    expect(isStale(refusal(409, "invalid_transition"))).toBe(true);
    expect(isStale(refusal(409, "already_exported"))).toBe(true);
    expect(isStale(refusal(422, "invalid_date"))).toBe(false);
    // As frases destes dizem "a tela foi atualizada": quem chama relê.
    expect(isStale(refusal(422, "invalid_cursor"))).toBe(true);
    expect(isStale(refusal(409, "already_revoked"))).toBe(true);
  });

  it("frase × comportamento: invalid_filter não promete reinício; dados do paciente com uma fonte só", () => {
    expect(billingError(refusal(422, "invalid_filter"))).not.toMatch(/reiniciada/);
    expect(billingError(refusal(422, "invalid_zip"))).toBe(demographicsError(refusal(422, "invalid_zip")));
    expect(billingError(refusal(422, "invalid_ethnicity"))).toBe(demographicsError(refusal(422, "invalid_ethnicity")));
    expect(billingError(new ApiError(422, { error: "invalid_demographics", field: "race_color" }, "422")))
      .toBe(demographicsError(new ApiError(422, { error: "invalid_demographics", field: "race_color" }, "422")));
    expect(demographicsError(refusal(409, "already_revoked"))).toBe("esta validação já foi desfeita — atualize a tela");
    expect(demographicsError(refusal(422, "invalid_demographics"))).toBe("dados do paciente inválidos — confira os campos");
  });
});

describe("busca SIGTAP", () => {
  it("termo de 2 a 60 caracteres; recusado, nunca cortado", () => {
    expect(sigtapQueryProblem("a")).toBe("digite pelo menos 2 caracteres para buscar");
    expect(sigtapQueryProblem(" a ")).toBe("digite pelo menos 2 caracteres para buscar");
    expect(sigtapQueryProblem("ab")).toBeNull();
    expect(sigtapQueryProblem("x".repeat(60))).toBeNull();
    expect(sigtapQueryProblem("x".repeat(61))).toBe("busca com até 60 caracteres — encurte o termo");
  });
});

describe("frases por código (decisão 6)", () => {
  const cases: [number, string][] = [
    [ 422, "invalid_patient" ], [ 422, "invalid_character" ], [ 422, "invalid_query" ], [ 503, "terminology_unavailable" ],
    [ 422, "invalid_filter" ], [ 422, "invalid_cursor" ], [ 422, "establishment_is_aps" ], [ 403, "not_author" ], [ 422, "missing_link" ],
    [ 409, "already_revoked" ], [ 409, "citizen_not_verified" ], [ 422, "invalid_race_color" ], [ 422, "invalid_ethnicity" ],
    [ 422, "ethnicity_required" ], [ 422, "invalid_zip" ], [ 422, "invalid_demographics" ], [ 409, "integrity_mismatch" ],
    [ 422, "too_many_sheets" ], [ 422, "nothing_to_export" ], [ 422, "settings_missing" ], [ 422, "too_long" ]
  ];
  it.each(cases)("%s %s tem frase em português", (status, code) => {
    const text = billingError(refusal(status, code));
    expect(text).not.toBe(code);
    expect(text).not.toMatch(/não foi possível concluir/);
  });

  it("citizen_not_verified (409) e integrity_mismatch", () => {
    expect(billingError(refusal(409, "citizen_not_verified"))).toBe("o cadastro desta pessoa ainda não foi validado na unidade — valide antes de registrar");
    expect(billingError(refusal(409, "integrity_mismatch"))).toBe("o arquivo não confere com o gerado; gere de novo reabrindo a competência");
  });

  it("settings_missing não cita a sigla", () => {
    expect(billingError(refusal(422, "settings_missing"))).not.toMatch(/sigla/);
  });

  it("too_long e invalid_demographics usam o field", () => {
    expect(billingError(new ApiError(422, { error: "too_long", field: "origin_name" }, "422")))
      .toBe("nome do órgão de origem maior que a largura do arquivo BPA — abrevie");
    expect(billingError(new ApiError(422, { error: "invalid_demographics", field: "address_zip" }, "422"))).toMatch(/CEP/);
    for (const [ field, text ] of [ [ "address_street", "logradouro" ], [ "address_number", "número" ], [ "address_complement", "complemento" ], [ "address_district", "bairro" ], [ "race_color", "raça/cor" ], [ "ethnicity", "etnia" ] ]) {
      expect(billingError(new ApiError(422, { error: "invalid_demographics", field }, "422"))).toContain(text);
    }
    expect(billingError(new ApiError(422, { error: "too_long", field: "campo_novo" }, "422"))).toBe("campo_novo maior que a largura do arquivo BPA — abrevie");
  });

  it("código desconhecido aparece cru", () => {
    expect(billingError(refusal(422, "codigo_novo"))).toBe("codigo_novo");
  });
});

describe("patientName", () => {
  it("devolve o nome ou a frase de paciente sem nome", () => {
    expect(patientName({ display_name: "Joana Lima" })).toBe("Joana Lima");
    expect(patientName({ display_name: null })).toBe("paciente sem nome no cadastro");
    expect(patientName({ display_name: "" })).toBe(NO_PATIENT_NAME);
    expect(patientName(null)).toBe(NO_PATIENT_NAME);
  });
});
