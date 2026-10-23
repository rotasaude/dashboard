// src/lib/careLines.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  CARE_DISABLED, CARE_NO_ROLE, COUNT_QUERY, NOMINAL_QUERY, UNTRACKED_TEXT, anchorProblem, canUseCareLines, careLineError, careLineRoles,
  codeList, contactProblem, customLineBody, customLineProblem, decimalBr, draftOfLine, emptyCustomLine, emptyPractice, endProblem, fmtDay,
  isStaleCare, knownCareLineError, newerVersion, originText, personName, personStatus, practiceText, reasonProblem, ruleText, slugKey, sourceLabel, statusLabel,
  statusTone, worstStatus, type CustomLineDraft, type PracticeDraft
} from "./careLines";
import { DIABETES_TEMPLATE, TODAY23, cityLine, practice } from "../test/careLineFixtures";

const user = (roles: string[], features = [ "clinical_record", "care_lines" ], operator = false) =>
  ({ operator, memberships: roles.map((role) => ({ role })), features });

describe("papel e interruptor", () => {
  it("só com care_lines na sessão e fora do operador", () => {
    expect(canUseCareLines(user([ "health_professional" ]))).toBe(true);
    expect(canUseCareLines(user([ "health_professional" ], [ "clinical_record" ]))).toBe(false);
    expect(canUseCareLines(user([ "health_professional" ], [ "care_lines" ]))).toBe(false); // P9: exige o prontuário também
    expect(canUseCareLines(user([ "municipal_admin" ], [ "care_lines" ], true))).toBe(false);
    expect(canUseCareLines(null)).toBe(false);
    expect(careLineRoles(user([ "health_professional", "analyst" ]))).toEqual({ professional: true, admin: false, analyst: true });
    expect(careLineRoles(user([ "municipal_admin" ]))).toEqual({ professional: false, admin: true, analyst: false });
  });

  it("nome nulo tem frase própria", () => {
    expect(personName({ display_name: null })).toBe("cidadão sem nome no cadastro");
    expect(personName({ display_name: "Maria" })).toBe("Maria");
  });
});

describe("situação e boa prática", () => {
  it("rótulos e tons; código novo aparece cru", () => {
    expect(statusLabel("ok")).toBe("em dia");
    expect(statusLabel("due_soon")).toBe("vence em até 30 dias");
    expect(statusLabel("overdue")).toBe("vencida");
    expect(statusLabel("untracked")).toBe(UNTRACKED_TEXT);
    expect(statusLabel("paused")).toBe("paused");
    expect([ "ok", "due_soon", "overdue", "untracked", "paused" ].map(statusTone)).toEqual([ "ok", "warn", "down", "neutral", "neutral" ]);
  });

  it("frase da boa prática: última vez, vencimento e contagem proporcional", () => {
    expect(practiceText(practice({ status: "ok", done_at: "2026-07-10", due_on: "2027-01-06" })))
      .toBe("em dia · última em 10/07/2026 · vence em 06/01/2027");
    expect(practiceText(practice({ status: "overdue", done_at: "2025-08-20", due_on: "2026-08-20" })))
      .toBe("vencida · última em 20/08/2025 · venceu em 20/08/2026");
    expect(practiceText(practice({ status: "overdue", done_at: null, due_on: "2026-09-01", count: 2, expected: 4 })))
      .toBe("vencida · 2 de 4 esperadas até agora · nunca registrada · venceu em 01/09/2026");
  });

  it("untracked nunca piora e tem frase própria", () => {
    expect(practiceText(practice({ status: "untracked", done_at: null, due_on: "2026-01-01" }))).toBe(UNTRACKED_TEXT);
    expect(worstStatus([ practice({ status: "ok" }), practice({ status: "untracked" }) ])).toBe("ok");
    expect(worstStatus([ practice({ status: "untracked" }) ])).toBeNull();
    expect(worstStatus([ practice({ status: "due_soon" }), practice({ status: "overdue" }), practice({ status: "untracked" }) ])).toBe("overdue");
    expect(personStatus({ worst_status: null, practices: [ practice({ status: "due_soon" }), practice({ status: "untracked" }) ] })).toBe("due_soon");
    expect(personStatus({ worst_status: "ok", practices: [ practice({ status: "overdue" }) ] })).toBe("ok");
  });

  it("datas sem fuso, vírgula decimal e fontes", () => {
    expect(fmtDay("2026-10-22")).toBe("22/10/2026");
    expect(fmtDay("2026-10-22T08:00:00-03:00")).toBe("22/10/2026");
    expect(fmtDay(null)).toBe("—");
    expect(decimalBr(37.5)).toBe("37,5");
    expect(decimalBr(40)).toBe("40");
    expect(decimalBr(12.345)).toBe("12,3");
    expect(decimalBr(null)).toBe("—");
    expect(decimalBr("37.5")).toBe("37,5");
    expect(decimalBr("")).toBe("—");
    expect(sourceLabel("exam:0202010503")).toBe("exame SIGTAP 0202010503 (pedido ou resultado)");
    expect(sourceLabel("procedure:0301100039")).toBe("procedimento SIGTAP 0301100039");
    expect(sourceLabel("vaccine:9")).toBe(`vacina 9 — ${UNTRACKED_TEXT}`);
    expect(sourceLabel("acs_visit")).toBe(`visita do ACS — ${UNTRACKED_TEXT}`);
    expect(sourceLabel("teleconsulta")).toBe("teleconsulta");
    expect(ruleText(DIABETES_TEMPLATE.practices[0])).toBe("1× em 183 dias · janela móvel · só médico ou enfermeiro · 20 pontos");
    expect(ruleText({ ...DIABETES_TEMPLATE.practices[0], min_count: 7, window_days: 294, schedule: "proportional", anchor: "lmp", cbo_filter: null,
      points: null })).toBe("7× em 294 dias, proporcional ao tempo · desde a DUM");
    expect(ruleText({ ...DIABETES_TEMPLATE.practices[0], cbo_filter: [ "2235", "2231", "2253", "2252", "2251" ], points: null }))
      .toBe("1× em 183 dias · janela móvel · só médico ou enfermeiro");
    expect(ruleText({ ...DIABETES_TEMPLATE.practices[0], cbo_filter: [ "2251", "2235", "251510" ], points: null }))
      .toBe("1× em 183 dias · janela móvel · só CBO 2251, 2235, 251510");
    expect(ruleText({ ...DIABETES_TEMPLATE.practices[0], cbo_filter: [ "2251", "2235" ], points: null }))
      .toBe("1× em 183 dias · janela móvel · só CBO 2251, 2235");
    expect(ruleText({ ...DIABETES_TEMPLATE.practices[0], window_start_days: 196, window_days: 294, anchor: "lmp", cbo_filter: null, points: 9 }))
      .toBe("1× do dia 196 ao 294 · desde a DUM · 9 pontos");
  });

  it("origem e versão nova", () => {
    expect(originText(cityLine())).toBe("catálogo C4 · versão 1");
    expect(originText(cityLine({ source: "custom", template_key: null, template_version: null, indicator: null }))).toBe("própria da cidade");
    expect(newerVersion(cityLine(), [ DIABETES_TEMPLATE ])).toBe(2);
    expect(newerVersion(cityLine({ template_version: 2 }), [ DIABETES_TEMPLATE ])).toBeNull();
    expect(newerVersion(cityLine({ latest_template_version: undefined }), [ DIABETES_TEMPLATE ])).toBe(2);
    expect(newerVersion(cityLine({ source: "custom", template_key: null }), [ DIABETES_TEMPLATE ])).toBeNull();
  });
});

describe("formulários", () => {
  it("motivo de recusa: 1 a 500, recusado e nunca cortado", () => {
    expect(reasonProblem("   ")).toBe("escreva o motivo");
    expect(reasonProblem("convênio")).toBeNull();
    expect(reasonProblem("  já acompanhada no CAPS  ")).toBeNull();
    expect(reasonProblem("x".repeat(501))).toBe("motivo com até 500 caracteres — encurte");
  });

  it("contato: canal, resultado e nota até 500", () => {
    expect(contactProblem({ channel: "", outcome: "", note: "" })).toBe("escolha como foi o contato");
    expect(contactProblem({ channel: "phone", outcome: "", note: "" })).toBe("escolha o resultado do contato");
    expect(contactProblem({ channel: "phone", outcome: "no_answer", note: "" })).toBeNull();
    expect(contactProblem({ channel: "phone", outcome: "reached", note: "x".repeat(501) })).toBe("nota com até 500 caracteres — encurte");
  });

  it("encerramento: motivo obrigatório; outro motivo pede a nota", () => {
    expect(endProblem({ reason: "", note: "" })).toBe("escolha o motivo do encerramento");
    expect(endProblem({ reason: "moved", note: "" })).toBeNull();
    expect(endProblem({ reason: "other", note: "  " })).toBe("descreva o motivo em “outro motivo”");
    expect(endProblem({ reason: "other", note: "x".repeat(501) })).toBe("nota com até 500 caracteres — encurte");
  });

  it("DUM: obrigatória, válida, não futura e até 336 dias (gestação e puerpério)", () => {
    expect(anchorProblem("", TODAY23)).toBe("informe a DUM (data da última menstruação)");
    expect(anchorProblem("2026-02-30", TODAY23)).toBe("DUM inválida — confira a data");
    expect(anchorProblem("2026-10-23", TODAY23)).toBe("a DUM não pode ser depois de hoje");
    expect(anchorProblem("2025-11-19", TODAY23)).toBe("DUM de mais de 48 semanas (gestação e puerpério) — confira a data");
    expect(anchorProblem("2025-11-20", TODAY23)).toBeNull();
    expect(anchorProblem(TODAY23, TODAY23)).toBeNull();
  });
});

describe("linha própria", () => {
  const filled = (over: Partial<CustomLineDraft> = {}): CustomLineDraft => ({
    ...emptyCustomLine(), name: "Saúde mental", declaredCondition: "mental_health", ciap: "p76, P74", cid10: "f32.1 F41", ageMinYears: "18",
    practices: [ { ...emptyPractice(), label: "Consulta de acompanhamento", citizenLabel: "consulta com a equipe", windowDays: "90" },
      { ...emptyPractice(), label: "Consulta de acompanhamento", sourceKind: "procedure", sigtap: "0301080232", doctorOrNurse: false,
        anchor: "enrollment" } ],
    ...over
  });

  it("códigos: maiúsculas, sem ponto, sem repetir", () => {
    expect(codeList(" t90; t90 , e11.9 ")).toEqual([ "T90", "E119" ]);
    expect(codeList("")).toEqual([]);
  });

  it("chave da boa prática: sem acento, única e começando com letra", () => {
    const taken = new Set([ "consulta" ]);
    expect(slugKey("Consulta", taken)).toBe("consulta_2");
    expect(slugKey("Pressão arterial", new Set())).toBe("pressao_arterial");
    expect(slugKey("3 consultas", new Set())).toBe("p_3_consultas");
    expect(slugKey("!!!", new Set())).toBe("pratica");
  });

  it("chave da boa prática: nunca passa de 40 caracteres, nem com prefixo nem com sufixo", () => {
    const long = "Consulta de acompanhamento com a equipe de saude mental";
    const key = slugKey(long, new Set());
    expect(key.length).toBeLessThanOrEqual(40);
    expect(key).toMatch(/^[a-z0-9_]{1,40}$/);
    const second = slugKey(long, new Set([ key ]));
    expect(second.length).toBeLessThanOrEqual(40);
    expect(second).not.toBe(key);
    expect(second.endsWith("_2")).toBe(true);
    const numeric = slugKey("1".repeat(60), new Set());
    expect(numeric.length).toBeLessThanOrEqual(40);
    expect(numeric.startsWith("p_")).toBe(true);
    expect(slugKey("1".repeat(60), new Set([ numeric ])).length).toBeLessThanOrEqual(40);
  });

  it("recusa o que o api recusaria por formato", () => {
    expect(customLineProblem(filled({ name: "" }))).toBe("dê um nome à linha");
    expect(customLineProblem(filled({ name: "x".repeat(121) }))).toBe("nome com até 120 caracteres — encurte");
    expect(customLineProblem(filled({ ciap: "P76, PX" }))).toBe("código CIAP-2 inválido: PX");
    expect(customLineProblem(filled({ cid10: "F3" }))).toBe("código CID-10 inválido: F3");
    expect(customLineProblem(filled({ ageMinYears: "1,5" }))).toBe("idade em anos inteiros, de 0 a 130");
    expect(customLineProblem(filled({ ageMinYears: "60", ageMaxYears: "18" }))).toBe("a idade mínima passa da máxima");
    expect(customLineProblem(filled({ practices: [] }))).toBe("inclua pelo menos uma boa prática");
    expect(customLineProblem(filled({ practices: [ { ...emptyPractice(), label: "" } ] }))).toBe("boa prática 1: escreva o que deve ser feito");
    expect(customLineProblem(filled({ practices: [ { ...emptyPractice(), label: "Exame", sourceKind: "exam", sigtap: "02020105" } ] })))
      .toBe("boa prática 1: código SIGTAP com 10 dígitos");
    expect(customLineProblem(filled({ practices: [ { ...emptyPractice(), label: "Consulta", citizenLabel: "x".repeat(81) } ] })))
      .toBe("boa prática 1: texto para o cidadão até 80 caracteres — encurte");
    expect(customLineProblem(filled({ practices: [ { ...emptyPractice(), label: "Consulta", windowDays: "0" } ] })))
      .toBe("boa prática 1: janela de 1 a 7300 dias");
    expect(customLineProblem(filled({ practices: [ { ...emptyPractice(), label: "Consulta", minCount: "51" } ] })))
      .toBe("boa prática 1: quantidade de 1 a 50");
    expect(customLineProblem(filled())).toBeNull();
  });

  it("corpo (L1/L2): problemas, idade em anos, condição declarada, fonte com SIGTAP, CBO só na consulta, chaves únicas", () => {
    expect(customLineBody(filled())).toEqual({
      name: "Saúde mental", declared_condition: "mental_health",
      eligibility: { problems: { ciap2: [ "P76", "P74" ], cid10: [ "F321", "F41" ] }, age_min_years: 18, age_max_years: null, sex: null,
        declared: [ "mental_health" ], requires_anchor: null },
      practices: [
        { key: "consulta_de_acompanhamento", label: "Consulta de acompanhamento", citizen_label: "consulta com a equipe", source: "consultation",
          window_days: 90, min_count: 1, schedule: "end_of_window", anchor: "rolling", cbo_filter: [ "2231", "2251", "2252", "2253", "2235" ] },
        { key: "consulta_de_acompanhamento_2", label: "Consulta de acompanhamento", source: "procedure:0301080232", window_days: 180,
          min_count: 1, schedule: "end_of_window", anchor: "enrollment", cbo_filter: null }
      ]
    });
    expect(customLineBody(filled({ declaredCondition: "", ageMaxYears: "64" })).eligibility).toMatchObject({ age_max_years: 64 });
    expect("declared" in customLineBody(filled({ declaredCondition: "" })).eligibility).toBe(false); // D-01: nunca lista vazia
    expect(customLineBody(filled({ declaredCondition: "" })).declared_condition).toBeNull();
  });

  it("recusa o que o Rules do api recusaria (exame 02, pontos, proporcional, all_of, CBO, janela)", () => {
    const one = (over: Partial<PracticeDraft>, line: Partial<CustomLineDraft> = {}) =>
      customLineProblem(filled({ practices: [ { ...emptyPractice(), label: "Consulta", ...over } ], ...line }));
    expect(one({ sourceKind: "exam", sigtap: "0301080232" })).toBe("boa prática 1: exame começa por 02 (código SIGTAP de 10 dígitos)");
    expect(one({ sourceKind: "exam", sigtap: "0202010503" })).toBeNull();
    expect(one({ points: "101" })).toBe("boa prática 1: pontos inteiros de 0 a 100");
    expect(one({ points: "-1" })).toBe("boa prática 1: pontos inteiros de 0 a 100");
    expect(one({ points: "7,5" })).toBe("boa prática 1: pontos inteiros de 0 a 100");
    expect(one({ points: "0" })).toBeNull();
    expect(one({ points: "100" })).toBeNull();
    expect(one({ schedule: "proportional", anchor: "rolling" })).toBe("boa prática 1: cronograma proporcional não vale com janela móvel");
    expect(one({ schedule: "proportional", anchor: "enrollment" })).toBeNull();
    expect(one({ extra: { window_start_days: 30 }, anchor: "rolling" })).toBe("boa prática 1: início da janela não vale com janela móvel");
    expect(one({ extra: { window_start_days: 180 }, anchor: "lmp" })).toBe("boa prática 1: o início da janela vem antes do fim");
    expect(one({ extra: { window_start_days: 30 }, anchor: "lmp" })).toBeNull();
    const two = [ [ { source: "consultation" } ], [ { source: "exam:0202010503" } ] ];
    expect(one({ extra: { all_of: two }, schedule: "proportional", anchor: "enrollment" }))
      .toBe("boa prática 1: cronograma proporcional não vale com mais de um grupo em “todos de”");
    expect(one({ extra: { all_of: two }, minCount: "2" })).toBe("boa prática 1: com mais de um grupo em “todos de”, a quantidade é 1");
    expect(one({ extra: { all_of: [ [ { source: "consultation", window_days: 30 } ] ] }, anchor: "enrollment" }))
      .toBe("boa prática 1: janela própria em “todos de” só vale com janela móvel");
    expect(one({ extra: { all_of: two } })).toBeNull();
    expect(one({ extra: { code_filter: { ciap2: [ "T90" ] } }, sourceKind: "procedure", sigtap: "0301080232" }))
      .toBe("boa prática 1: filtro de código só vale em consulta");
    expect(one({ baseCbo: [ "251" ], doctorOrNurse: true })).toBe("boa prática 1: CBO de 4 a 6 dígitos");
    expect(one({ baseCbo: [ "2515101" ], doctorOrNurse: true })).toBe("boa prática 1: CBO de 4 a 6 dígitos");
    expect(one({ baseCbo: [ "25151" ], doctorOrNurse: true })).toBeNull();
    expect(one({ baseCbo: [ "251510" ], doctorOrNurse: true })).toBeNull();
    expect(one({}, { practices: Array.from({ length: 21 }, () => ({ ...emptyPractice(), label: "x" })) })).toBe("no máximo 20 boas práticas");
    expect(customLineProblem(filled({ practices: [
      { ...emptyPractice(), label: "A", key: "mesma" }, { ...emptyPractice(), label: "B", key: "mesma" } ] })))
      .toBe("boa prática 2: chave repetida");
  });

  it("critério obrigatório: problema, idade, sexo ou condição declarada (D-01)", () => {
    const bare = { ...filled(), declaredCondition: "" as const, ciap: "", cid10: "", ageMinYears: "", ageMaxYears: "", sex: "" as const };
    const msg = "escolha ao menos um critério: problema, idade, sexo ou condição declarada";
    expect(customLineProblem(bare)).toBe(msg);
    expect(customLineProblem({ ...bare, sex: "female" })).toBeNull();
    expect(customLineProblem({ ...bare, ageMaxYears: "12" })).toBeNull();
    expect(customLineProblem({ ...bare, cid10: "E11" })).toBeNull();
    expect(customLineProblem({ ...bare, declaredCondition: "diabetes" })).toBeNull();
    expect(customLineProblem({ ...bare, extra: { age_min_days: 0, age_max_days: 365 } })).toBeNull();
  });

  it("corpo: nunca manda lista vazia nem problems sem código (D-01)", () => {
    const body = customLineBody({ ...filled(), declaredCondition: "", ciap: "", cid10: "", ageMinYears: "18", sex: "female" });
    expect(body.eligibility).toEqual({ age_min_years: 18, age_max_years: null, sex: "female", requires_anchor: null });
    expect("problems" in body.eligibility).toBe(false);
    expect("declared" in body.eligibility).toBe(false);
    const onlyCid = customLineBody({ ...filled(), ciap: "", cid10: "f32" });
    expect(onlyCid.eligibility.problems).toEqual({ cid10: [ "F32" ] });
  });

  it("campos avançados (início de janela, filtros, all_of, pontos, idade em dias) voltam iguais na edição (D-02)", () => {
    const seed = cityLine({
      source: "custom", template_key: null, template_version: null, indicator: null, name: "Saúde mental", declared_condition: "mental_health",
      eligibility: { exclude_problems: { ciap2: [ "P99" ] }, age_min_days: 6570, gender_identities_excluded: [ "trans_man" ],
        declared: [ "mental_health" ] },
      practices: [
        { key: "consulta", label: "Consulta", citizen_label: "consulta com a equipe", source: "consultation", window_start_days: 30,
          window_days: 180, min_count: 2, schedule: "end_of_window", anchor: "enrollment", cbo_filter: [ "251510" ], points: 12,
          code_filter: { ciap2: [ "P76" ] }, applies_to: { age_min_years: 18, sex: "female" },
          all_of: [ [ { source: "consultation" }, { source: "exam:0202010503" } ] ] },
        { key: "vacina", label: "Vacina", source: "vaccine:9", window_days: 365, min_count: 1, schedule: "end_of_window", anchor: "rolling",
          cbo_filter: null }
      ]
    });
    const draft = draftOfLine(seed);
    expect(draft.ciap).toBe("");
    expect(draft.cid10).toBe("");
    expect(draft.practices[0].doctorOrNurse).toBe(true);
    expect(customLineProblem(draft)).toBeNull();
    const body = customLineBody(draft);
    expect(body.practices).toEqual(seed.practices);
    expect(body.eligibility).toMatchObject({ exclude_problems: { ciap2: [ "P99" ] }, age_min_days: 6570,
      gender_identities_excluded: [ "trans_man" ], declared: [ "mental_health" ] });
    expect("problems" in body.eligibility).toBe(false);
    expect(body.declared_condition).toBe("mental_health");
  });

  // Forma que o api grava (Rules normaliza: práticas com todos os campos, nulos explícitos; elegibilidade sem nulos nem terminologia vazia).
  const SEED_MENTAL = () => cityLine({
    source: "custom", template_key: null, template_version: null, indicator: null, name: "Saúde mental — acompanhamento",
    declared_condition: "mental_health",
    eligibility: { problems: { ciap2: [ "P74", "P76" ], cid10: [ "F32", "F33", "F41" ] }, declared: [ "mental_health" ] },
    practices: [ { key: "sm_a", label: "Consulta de acompanhamento a cada 3 meses", citizen_label: "Consulta de acompanhamento",
      source: "consultation", anchor: "rolling", window_start_days: 0, window_days: 92, min_count: 1, schedule: "end_of_window",
      cbo_filter: [ "2251", "2235", "251510" ], code_filter: null, applies_to: null, all_of: null, points: null } ]
  });

  it("linha de saúde mental da semente (forma do Rules): ida e volta sem perder o CBO 251510 (D-02)", () => {
    const seed = SEED_MENTAL();
    const draft = draftOfLine(seed);
    expect(customLineProblem(draft)).toBeNull();
    const body = customLineBody(draft);
    expect(body.practices[0].cbo_filter).toEqual([ "2251", "2235", "251510" ]);
    expect(body.practices[0]).toEqual({
      key: "sm_a", label: "Consulta de acompanhamento a cada 3 meses", citizen_label: "Consulta de acompanhamento", source: "consultation",
      anchor: "rolling", window_start_days: 0, window_days: 92, min_count: 1, schedule: "end_of_window", cbo_filter: [ "2251", "2235", "251510" ]
    });
    expect(body.eligibility).toEqual({ problems: { ciap2: [ "P74", "P76" ], cid10: [ "F32", "F33", "F41" ] }, declared: [ "mental_health" ],
      age_min_years: null, age_max_years: null, sex: null, requires_anchor: null });
    expect(body.declared_condition).toBe("mental_health");
  });

  it("limpar a condição declarada na edição manda declared_condition null e nenhum declared", () => {
    const draft = { ...draftOfLine(SEED_MENTAL()), declaredCondition: "" as const };
    expect(customLineProblem(draft)).toBeNull();
    const body = customLineBody(draft);
    expect(body.declared_condition).toBeNull();
    expect("declared" in body.eligibility).toBe(false);
  });

  it("declared: troca só a condição editada e preserva as outras e o critério sem declared_condition", () => {
    const base = SEED_MENTAL();
    const many = draftOfLine({ ...base, eligibility: { ...base.eligibility, declared: [ "hypertension", "mental_health" ] } });
    expect(customLineBody(many).eligibility.declared).toEqual([ "hypertension", "mental_health" ]);
    expect(customLineBody({ ...many, declaredCondition: "" }).eligibility.declared).toEqual([ "hypertension" ]);
    expect(customLineBody({ ...many, declaredCondition: "diabetes" }).eligibility.declared).toEqual([ "hypertension", "diabetes" ]);
    expect(customLineBody({ ...many, declaredCondition: "hypertension" }).eligibility.declared).toEqual([ "hypertension" ]);
    // linha com `declared` e sem `declared_condition`: o critério sobrevive à edição
    const loose = draftOfLine({ ...base, declared_condition: null, eligibility: { declared: [ "pregnancy" ] } });
    expect(loose.declaredCondition).toBe("");
    const body = customLineBody(loose);
    expect(body.eligibility.declared).toEqual([ "pregnancy" ]);
    expect(body.declared_condition).toBeNull();
    expect(customLineProblem(loose)).toBeNull(); // o critério declarado basta
    // nova linha: a condição escolhida entra sozinha
    expect(customLineBody({ ...emptyCustomLine(), name: "x", declaredCondition: "diabetes" }).eligibility.declared).toEqual([ "diabetes" ]);
  });

  it("a caixa 'só médico ou enfermeiro' só troca o CBO quando mexem nela", () => {
    const seed = cityLine({ source: "custom", template_key: null, template_version: null, indicator: null,
      practices: [ { key: "c", label: "C", source: "consultation", window_days: 90, min_count: 1, schedule: "end_of_window", anchor: "rolling",
        cbo_filter: [ "251510" ] } ] });
    const draft = draftOfLine(seed);
    expect(customLineBody(draft).practices[0].cbo_filter).toEqual([ "251510" ]);
    const off = { ...draft, practices: [ { ...draft.practices[0], doctorOrNurse: false } ] };
    expect(customLineBody(off).practices[0].cbo_filter).toBeNull();
    const switched = { ...draft, practices: [ { ...draft.practices[0], sourceKind: "procedure", sigtap: "0301080232" } ] };
    expect(customLineBody(switched).practices[0]).toMatchObject({ source: "procedure:0301080232", cbo_filter: null });
    const fresh = customLineBody({ ...filled(), practices: [ { ...emptyPractice(), label: "Nova", doctorOrNurse: false } ] });
    expect(fresh.practices[0].cbo_filter).toBeNull();
  });

  it("pontos digitados entram no corpo como inteiro", () => {
    const body = customLineBody(filled({ practices: [ { ...emptyPractice(), label: "Consulta", points: "25" } ] }));
    expect(body.practices[0].points).toBe(25);
    expect("points" in customLineBody(filled()).practices[0]).toBe(false);
  });

  it("editar: o rascunho da linha guarda as chaves e volta ao mesmo corpo", () => {
    const line = cityLine({ source: "custom", template_key: null, template_version: null, indicator: null, ...customLineBody(filled()) });
    const draft = draftOfLine(line);
    expect(draft.ageMinYears).toBe("18");
    expect(draft.practices.map((p) => p.key)).toEqual([ "consulta_de_acompanhamento", "consulta_de_acompanhamento_2" ]);
    expect(customLineBody(draft)).toEqual(customLineBody(filled()));
  });
});

describe("consultas e recusas", () => {
  it("nominal nunca relê sozinha; contador relê por minuto", () => {
    expect(NOMINAL_QUERY).toMatchObject({ refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, gcTime: 0 });
    expect(COUNT_QUERY.refetchInterval).toBe(60_000);
  });

  it("knownCareLineError: frase só de código conhecido; o resto é null", () => {
    const refusal = (status: number, error: string, extra: object = {}) => new ApiError(status, { error, ...extra }, "x");
    expect(knownCareLineError(refusal(422, "duplicate_template"))).toBe("esta linha do catálogo já foi adotada pela cidade");
    expect(knownCareLineError(refusal(403, "feature_disabled", { feature: "care_lines" }))).toBe(CARE_DISABLED);
    expect(knownCareLineError(refusal(401, "unauthenticated"))).toBeNull();
    expect(knownCareLineError(refusal(403, "operator_read_only"))).toBeNull();
    expect(knownCareLineError(refusal(415, "json_required"))).toBeNull();
    expect(knownCareLineError(refusal(422, "constructor"))).toBeNull();
    expect(knownCareLineError(new ApiError(500, "", "x"))).toBeNull();
    expect(knownCareLineError(new TypeError("fetch"))).toBeNull();
  });

  it("frases das recusas; código novo cru; stale relê", () => {
    const refusal = (status: number, error: string, extra: object = {}) => new ApiError(status, { error, ...extra }, "x");
    expect(careLineError(refusal(403, "feature_disabled", { feature: "care_lines" }))).toBe(CARE_DISABLED);
    expect(careLineError(refusal(403, "missing_role"))).toBe(CARE_NO_ROLE);
    expect(careLineError(refusal(403, "cbo_not_allowed"))).toBe("só médico ou enfermeiro confirma a inscrição");
    expect(careLineError(refusal(422, "anchor_required"))).toBe("informe a DUM para inscrever na linha da gestante");
    expect(careLineError(refusal(409, "already_enrolled"))).toBe("a pessoa já está inscrita nesta linha");
    expect(careLineError(refusal(409, "citizen_not_verified"))).toBe("o cadastro desta pessoa ainda não foi validado no posto — valide na recepção");
    expect(careLineError(refusal(422, "duplicate_template"))).toBe("esta linha do catálogo já foi adotada pela cidade");
    expect(careLineError(refusal(422, "brand_new_code"))).toBe("brand_new_code");
    expect(careLineError(new ApiError(404, "", "x"))).toBe("registro não encontrado — atualize a tela");
    expect(careLineError(new TypeError("fetch"))).toBe("sem conexão com o servidor — tente de novo");
    expect(careLineError(refusal(403, "out_of_scope"))).toBe("você não tem vínculo ativo na unidade desta equipe");
    expect(careLineError(refusal(429, "too_many_requests"))).toBe("muitas buscas seguidas — espere um minuto");
    expect(careLineError(refusal(422, "invalid_cpf"))).toBe("CPF inválido");
    expect(careLineError(refusal(404, "person_not_found"))).toBe("nenhum cidadão com este CPF na cidade");
    expect(careLineError(refusal(409, "already_scheduled"))).toBe("já há horário marcado para esta pessoa");
    expect(careLineError(refusal(422, "invalid_unit"))).toBe("a unidade desta equipe não está ativa para agendar — fale com a recepção");
    expect(careLineError(refusal(503, "catalog_not_loaded"))).toBe("o catálogo de linhas ainda não foi carregado — fale com o suporte");
    expect(careLineError(refusal(401, "mfa_required"))).toBe("confirme sua identidade com o código do autenticador e tente de novo");
    expect(careLineError(refusal(422, "invalid_condition"))).toBe("condição declarada desconhecida — atualize a tela");
    expect(careLineError(refusal(422, "no_open_slot_unit"))).toBe("no_open_slot_unit");
    expect(careLineError(new ApiError(500, null, "x"))).toBe("não foi possível concluir (500) — tente de novo");
    expect(careLineError(refusal(422, "invalid_anchor"))).toBe("DUM fora do prazo (até 48 semanas atrás) ou em linha que não pede DUM");
    expect(isStaleCare(refusal(409, "invalid_transition"))).toBe(true);
    expect(isStaleCare(refusal(404, "not_found"))).toBe(true);
    expect(isStaleCare(refusal(409, "already_enrolled"))).toBe(false);
  });
});
