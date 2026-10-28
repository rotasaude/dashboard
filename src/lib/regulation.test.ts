// src/lib/regulation.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  actionsFor, allowedTypes, canRequestRegulation, canUseRegulation, ciap2Problem, cnesProblem, colorLabel, colorTone, currentMonth,
  deadlinesProblem, diagnosisRule, draftFromRequest, draftsNote, dueText, EMPTY_DRAFT, exportFilename, externalNumberProblem, guideFilename,
  monthLabel, monthProblem, normalizeCiap2, returnReason, notesProblem, notSentReason, parseQuantity, placeProblem, providerKindLabel, providerNameProblem,
  quantityProblem, reasonProblem, regulationError, regulationFinalizeError, regulationRoles, requestBody, requestProblem, requesterKind,
  scheduleAtProblem, statusLabel, statusTone, systemLabel, targetsFor, targetTermProblem, typeLabel, waitDays, waitText,
  QUOTA_EXHAUSTED_TEXT, REGULATION_DISABLED, REGULATION_REQUIRED_TEXT, STALE_TEXT, type RequestDraft
} from "./regulation";
import { attendanceError } from "./attendance";
import { CARDIO, ECO, ENDO, TODAY26, regRequest, regUser } from "../test/regulationFixtures";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => new ApiError(status, { error, ...extra }, "x");

describe("portão e quem pede", () => {
  it("interruptor, operador e o prontuário para pedir", () => {
    expect(canUseRegulation(regUser())).toBe(true);
    expect(canUseRegulation(regUser([ "care_regulator" ], { features: [] }))).toBe(false);
    expect(canUseRegulation(regUser([ "care_regulator" ], { operator: true }))).toBe(false);
    expect(canRequestRegulation(regUser([ "health_professional" ]))).toBe(true);
    expect(canRequestRegulation(regUser([ "health_professional" ], { features: [ "care_regulation" ] }))).toBe(false);
    expect(canRequestRegulation(regUser([ "care_regulator" ]))).toBe(false);
  });
  it("papéis", () => {
    expect(regulationRoles(regUser([ "care_regulator", "municipal_admin" ]))).toEqual({ regulator: true, admin: true, professional: false });
    expect(regulationRoles(regUser([ "health_professional" ]))).toEqual({ regulator: false, admin: false, professional: true });
    expect(regulationRoles(null)).toEqual({ regulator: false, admin: false, professional: false });
  });
  it.each([
    [ "225142", "physician", [ "specialty", "procedure" ] ], [ "225120", "physician", [ "specialty", "procedure" ] ],
    [ "223505", "nurse", [ "specialty", "procedure" ] ], [ "223208", "dentist", [ "specialty" ] ],
    [ "322205", null, [] ], [ "", null, [] ], [ null, null, [] ]
  ])("CBO %s → %s", (cbo, kind, types) => {
    expect(requesterKind(cbo)).toBe(kind);
    expect(allowedTypes(cbo)).toEqual(types);
  });
  it("alvos que cada CBO vê na busca (o api recusa de novo)", () => {
    const all = [ CARDIO, ECO, ENDO ];
    expect(targetsFor("225142", all)).toEqual(all);
    expect(targetsFor("223505", all)).toEqual([ ECO ]);
    expect(targetsFor("223208", all)).toEqual([ ENDO ]);
    expect(targetsFor(null, all)).toEqual(all);
  });
});

describe("rótulos: código novo aparece cru", () => {
  it("cores e situações", () => {
    expect([ colorLabel("red"), colorTone("red"), colorLabel("blue"), colorTone("blue"), colorLabel("purple"), colorTone("purple") ])
      .toEqual([ "vermelho", "down", "azul", "info", "purple", "neutral" ]);
    expect([ statusLabel("returned"), statusLabel("closed"), statusLabel("external"), statusLabel("archived") ])
      .toEqual([ "devolvido para complementar", "encerrado (segunda falta)", "regulado pelo estado", "archived" ]);
    expect([ statusTone("pending"), statusTone("returned"), statusTone("authorized"), statusTone("scheduled"), statusTone("completed"),
      statusTone("denied"), statusTone("closed"), statusTone("missed"), statusTone("archived") ])
      .toEqual([ "warn", "warn", "info", "info", "ok", "down", "down", "neutral", "neutral" ]);
  });
  it("tipo, prestador e sistema", () => {
    expect([ typeLabel("specialty"), typeLabel("procedure"), typeLabel("x") ]).toEqual([ "consulta especializada", "procedimento", "x" ]);
    expect([ providerKindLabel("own"), providerKindLabel("contracted"), providerKindLabel("consortium"), providerKindLabel("ppi"), providerKindLabel("y") ])
      .toEqual([ "rede própria", "contratado", "consórcio", "PPI", "y" ]);
    expect([ systemLabel("sisreg"), systemLabel("care"), systemLabel("cross"), systemLabel("other"), systemLabel("z") ])
      .toEqual([ "SISREG", "CARE", "CROSS", "outro", "z" ]);
  });
});

describe("ações por situação (D13, D16)", () => {
  const own = { offer_id: "of1", provider: { id: "pr1", name: "Ambulatório", kind: "own" }, month: "2026-10", skip_reason: null,
    at: "2026-10-20T10:00:00-03:00", by: { name: "Regulador" } };
  const contracted = { ...own, provider: { id: "pr2", name: "Clínica do Coração", kind: "contracted" } };
  it.each([
    [ "pending", null, false, { authorize: true, returnBack: true, deny: true, cancel: true, schedule: false, outcome: false, external: true } ],
    [ "returned", null, false, { authorize: false, returnBack: false, deny: true, cancel: true, schedule: false, outcome: false, external: false } ],
    [ "authorized", own, false, { authorize: false, returnBack: false, deny: false, cancel: true, schedule: false, outcome: false, external: false } ],
    [ "authorized", contracted, false, { authorize: false, returnBack: false, deny: false, cancel: true, schedule: true, outcome: false, external: false } ],
    [ "scheduled", contracted, false, { authorize: false, returnBack: false, deny: false, cancel: true, schedule: true, outcome: true, external: false } ],
    [ "scheduled", own, false, { authorize: false, returnBack: false, deny: false, cancel: false, schedule: false, outcome: false, external: false } ],
    [ "external", null, true, { authorize: false, returnBack: false, deny: false, cancel: true, schedule: true, outcome: false, external: true } ],
    // G12 #7: o número externo só onde o api aceita (pending e external).
    [ "scheduled", null, true, { authorize: false, returnBack: false, deny: false, cancel: true, schedule: true, outcome: true, external: false } ],
    [ "completed", own, false, { authorize: false, returnBack: false, deny: false, cancel: false, schedule: false, outcome: false, external: false } ],
    [ "archived", null, false, { authorize: false, returnBack: false, deny: false, cancel: false, schedule: false, outcome: false, external: false } ]
  ])("%s (%#)", (status, authorization, stateRegulated, expected) => {
    expect(actionsFor(regRequest({ status, authorization, state_regulated: stateRegulated }))).toEqual(expected);
  });
});

describe("espera e prazo no dia da cidade", () => {
  it("espera conta do dia do pedido, no fuso da cidade", () => {
    expect(waitDays("2026-10-08T10:00:00-03:00", TODAY26)).toBe(20);
    // 01h30 UTC do dia 28 ainda é dia 27 em São Paulo.
    expect(waitDays("2026-10-28T01:30:00Z", TODAY26)).toBe(1);
    expect([ waitText(0), waitText(1), waitText(20) ]).toEqual([ "hoje", "1 dia", "20 dias" ]);
  });
  it("prazo da cor", () => {
    expect(dueText("2026-11-07", false, TODAY26)).toBe("até 07/11");
    expect(dueText("2026-10-28", false, TODAY26)).toBe("vence hoje");
    expect(dueText("2026-10-25", true, TODAY26)).toBe("vencido há 3 dias");
    expect(dueText("2026-10-27", true, TODAY26)).toBe("vencido há 1 dia");
    expect(dueText("2027-02-01", false, TODAY26)).toBe("até 01/02/2027");
    expect(dueText(null, false, TODAY26)).toBe("—");
    expect(monthLabel("2026-10")).toBe("outubro de 2026");
    expect(currentMonth(TODAY26)).toBe("2026-10");
  });
});

describe("formato: recusar, nunca cortar", () => {
  const draft = (over: Partial<RequestDraft> = {}): RequestDraft => ({ type: "specialty", target: CARDIO, cid10: "i20.9", ciap2: "",
    justification: "Dor torácica aos esforços há 3 meses.", color: "yellow", stateRegulated: false, ...over });
  it("pedido: alvo, CID, justificativa e cor, nesta ordem", () => {
    expect(requestProblem(draft({ target: null }), "225142", true)).toEqual({ field: "target", text: "escolha a especialidade ou o procedimento" });
    expect(requestProblem(draft({ cid10: "" }), "225142", true)).toEqual({ field: "cid10", text: "informe o CID-10" });
    expect(requestProblem(draft({ cid10: "I2" }), "225142", true)?.field).toBe("cid10");
    expect(requestProblem(draft({ justification: "  curta   " }), "225142", true))
      .toEqual({ field: "justification", text: "a justificativa precisa de pelo menos 10 caracteres" });
    expect(requestProblem(draft({ justification: "x".repeat(2001) }), "225142", true))
      .toEqual({ field: "justification", text: "a justificativa passa de 2000 caracteres" });
    expect(requestProblem(draft({ justification: "x".repeat(2000) }), "225142", true)).toBeNull();
    expect(requestProblem(draft({ color: "" }), "225142", true)).toEqual({ field: "color", text: "escolha a cor sugerida" });
  });
  it("diagnóstico pela regra do CBO (G10; G12: dentista segue o enfermeiro)", () => {
    // Dentista não pode CID-10 hoje (physicians_only): sem CID-10 e sem CIAP-2, pede o CIAP-2.
    expect(requestProblem(draft({ cid10: "" }), "223208", false)).toEqual({ field: "ciap2", text: "informe o CIAP-2" });
    expect(requestProblem(draft({ cid10: "", ciap2: "" }), "223505", false)).toEqual({ field: "ciap2", text: "informe o CIAP-2" });
    expect(requestProblem(draft({ cid10: "", ciap2: "" }), "223505", true)).toEqual({ field: "ciap2", text: "informe o CID-10 ou o CIAP-2" });
    expect(requestProblem(draft({ cid10: "", ciap2: "K8" }), "223505", false)).toEqual({ field: "ciap2", text: "use um código CIAP-2, ex.: K86" });
    expect(requestProblem(draft({ cid10: "", ciap2: "k86" }), "223505", false)).toBeNull();
    expect(requestProblem(draft({ cid10: "", ciap2: "k86" }), "223505", true)).toBeNull();
    expect(requestProblem(draft({ cid10: "i20.9", ciap2: "" }), "223505", true)).toBeNull();
    // CID-10 escondido: o que sobrou no rascunho não vale nem é conferido.
    expect(requestProblem(draft({ cid10: "lixo", ciap2: "K86" }), "223505", false)).toBeNull();
    // Sem CBO (regulador ou admin) pede como médico; CIAP-2 opcional, mas conferido se vier.
    expect(requestProblem(draft({ cid10: "" }), null, true)).toEqual({ field: "cid10", text: "informe o CID-10" });
    expect(requestProblem(draft({ ciap2: "99" }), "225142", true)?.field).toBe("ciap2");
  });
  it("regra e CIAP-2", () => {
    expect([ diagnosisRule("225142", true), diagnosisRule("225142", false), diagnosisRule(null, false) ]).toEqual([ "cid10", "cid10", "cid10" ]);
    expect([ diagnosisRule("223505", true), diagnosisRule("223505", false), diagnosisRule("223208", true), diagnosisRule("223208", false) ])
      .toEqual([ "either", "ciap2", "either", "ciap2" ]);
    expect([ normalizeCiap2(" k.86 "), ciap2Problem(""), ciap2Problem("K86"), ciap2Problem("k86"), ciap2Problem("K8"), ciap2Problem("86K"), ciap2Problem("K861") ])
      .toEqual([ "K86", null, null, null, "use um código CIAP-2, ex.: K86", "use um código CIAP-2, ex.: K86", "use um código CIAP-2, ex.: K86" ]);
  });
  it("corpo: CID normalizado, sem CID para quem não usa, estado só quando marcado", () => {
    expect(requestBody(draft(), "225142", true)).toEqual({ type: "specialty", target_code: "225120", cid10: "I209",
      justification: "Dor torácica aos esforços há 3 meses.", suggested_color: "yellow" });
    expect(requestBody(draft({ stateRegulated: true, ciap2: "k86" }), "223505", false)).toEqual({ type: "specialty", target_code: "225120",
      ciap2: "K86", justification: "Dor torácica aos esforços há 3 meses.", suggested_color: "yellow", state_regulated: true });
    expect(requestBody(draft({ ciap2: "K86" }), "225142", true)).toMatchObject({ cid10: "I209", ciap2: "K86" });
    // Nunca corta: só tira os espaços das pontas.
    expect(requestBody(draft({ justification: `  ${"x".repeat(2000)}  ` }), "225142", true).justification).toBe("x".repeat(2000));
    // Enfermeiro com os dois: manda os dois; sem CID-10 preenchido, não manda a chave.
    expect(requestBody(draft({ cid10: "", ciap2: "K86" }), "223505", true)).not.toHaveProperty("cid10");
  });
  it("complemento com CID-10 já no pedido (G12): satisfaz o diagnóstico e o corpo o omite", () => {
    // Enfermeiro/dentista sem CID-10 não é obrigado a dar CIAP-2 se o médico já pôs o CID-10; o api guarda o dele.
    expect(requestProblem(draft({ cid10: "I209", ciap2: "" }), "223505", false, true)).toBeNull();
    expect(requestProblem(draft({ cid10: "I209", ciap2: "" }), "223208", false, true)).toBeNull();
    expect(requestProblem(draft({ cid10: "I209", ciap2: "" }), "223505", true, true)).toBeNull();
    // Sem o CID-10 guardado, nada muda.
    expect(requestProblem(draft({ cid10: "", ciap2: "" }), "223505", false, false)).toEqual({ field: "ciap2", text: "informe o CIAP-2" });
    // O CIAP-2 digitado ainda é conferido.
    expect(requestProblem(draft({ cid10: "I209", ciap2: "K8" }), "223505", false, true)).toEqual({ field: "ciap2", text: "use um código CIAP-2, ex.: K86" });
    // Médico (regra cid10): o CID-10 continua editável e obrigatório.
    expect(requestProblem(draft({ cid10: "", ciap2: "" }), "225142", true, true)).toEqual({ field: "cid10", text: "informe o CID-10" });
    expect(requestProblem(draft({ cid10: "I209", ciap2: "" }), "225142", true, true)).toBeNull();
    // Corpo: quem não é médico não manda o CID-10 guardado; o médico manda o que está no campo.
    expect(requestBody(draft({ cid10: "I209", ciap2: "" }), "223505", false, true)).not.toHaveProperty("cid10");
    expect(requestBody(draft({ cid10: "I209", ciap2: "k86" }), "223505", true, true)).toMatchObject({ ciap2: "K86" });
    expect(requestBody(draft({ cid10: "I209", ciap2: "k86" }), "223505", true, true)).not.toHaveProperty("cid10");
    expect(requestBody(draft({ cid10: "i20.9" }), "225142", true, true)).toMatchObject({ cid10: "I209" });
  });
  it("motivo da devolução: o do último evento returned", () => {
    const ev = (status: string, reason: string | null) => ({ status, at: "2026-10-20T15:00:00-03:00", by: { name: "Regulador" }, reason });
    expect(returnReason(regRequest({ events: [ ev("pending", null), ev("returned", "primeiro"), ev("pending", null), ev("returned", "segundo") ] }))).toBe("segundo");
    expect(returnReason(regRequest({ events: [ ev("pending", null) ] }))).toBeNull();
    expect(returnReason(regRequest({ events: [ ev("returned", null) ] }))).toBeNull();
    expect(returnReason(regRequest({ events: undefined }))).toBeNull();
  });
  it("rascunho: vazio e vindo do pedido", () => {
    expect(EMPTY_DRAFT("procedure")).toEqual({ type: "procedure", target: null, cid10: "", ciap2: "", justification: "", color: "", stateRegulated: false });
    expect(draftFromRequest(regRequest({ ciap2: "K86", state_regulated: true }))).toEqual({
      type: "specialty", target: { type: "specialty", code: "225120", name: "Cardiologia" }, cid10: "I209", ciap2: "K86",
      justification: "Dor torácica aos esforços há 3 meses, teste ergométrico alterado.", color: "yellow", stateRegulated: true
    });
    expect(draftFromRequest(regRequest({ cid10: null })).ciap2).toBe("");
  });
  it("motivo, número externo, quantidade, data", () => {
    expect([ reasonProblem("curto     "), reasonProblem("motivo ok!"), reasonProblem("x".repeat(501)) ])
      .toEqual([ "o motivo precisa de 10 a 500 caracteres", null, "o motivo precisa de 10 a 500 caracteres" ]);
    expect([ targetTermProblem("ca"), targetTermProblem("car"), targetTermProblem("c".repeat(61)) ])
      .toEqual([ "o termo de busca tem de 3 a 60 caracteres", null, "o termo de busca tem de 3 a 60 caracteres" ]);
    expect([ externalNumberProblem("2026/123456"), externalNumberProblem("SR 12"), externalNumberProblem("1".repeat(31)) ])
      .toEqual([ null, "número inválido: até 30 letras, números, ponto, barra ou hífen", "número inválido: até 30 letras, números, ponto, barra ou hífen" ]);
    expect([ quantityProblem("10"), quantityProblem("0"), quantityProblem("10,5"), quantityProblem("1.0"), quantityProblem("10000"), quantityProblem("") ])
      .toEqual([ null, null, "quantidade é um número inteiro de 0 a 9999", "quantidade é um número inteiro de 0 a 9999",
        "quantidade é um número inteiro de 0 a 9999", "quantidade é um número inteiro de 0 a 9999" ]);
    expect(parseQuantity(" 12 ")).toBe(12);
    expect([ scheduleAtProblem("2026-11-10T14:30"), scheduleAtProblem("2026-13-10T14:30"), scheduleAtProblem("") ])
      .toEqual([ null, "data e hora inválidas", "data e hora inválidas" ]);
    expect([ scheduleAtProblem("2026-02-30T10:00"), scheduleAtProblem("2026-11-10T24:00") ]).toEqual([ "data e hora inválidas", "data e hora inválidas" ]);
  });
  it("local, observação, prestador e mês", () => {
    expect([ placeProblem("UBS Centro"), placeProblem("   "), placeProblem("x".repeat(201)), placeProblem("x".repeat(200)) ])
      .toEqual([ null, "informe o local (até 200 caracteres)", "informe o local (até 200 caracteres)", null ]);
    expect([ notesProblem(""), notesProblem("x".repeat(500)), notesProblem("x".repeat(501)) ]).toEqual([ null, null, "a observação passa de 500 caracteres" ]);
    expect([ cnesProblem("7654321"), cnesProblem("765432"), cnesProblem("76543210"), cnesProblem("765432a") ])
      .toEqual([ null, "CNES tem 7 dígitos", "CNES tem 7 dígitos", "CNES tem 7 dígitos" ]);
    expect([ providerNameProblem("Clínica"), providerNameProblem("ab"), providerNameProblem("x".repeat(121)) ])
      .toEqual([ null, "o nome tem de 3 a 120 caracteres", "o nome tem de 3 a 120 caracteres" ]);
    expect([ monthProblem("2026-10", TODAY26), monthProblem("2026-11", TODAY26), monthProblem("2026-09", TODAY26), monthProblem("2026-13", TODAY26), monthProblem("", TODAY26) ])
      .toEqual([ null, null, "o mês da oferta não pode ser anterior ao corrente", "mês inválido", "mês inválido" ]);
  });
  it("prazos: inteiros de 1 a 365, do mais grave ao menos grave", () => {
    expect(deadlinesProblem({ red: "7", yellow: "30", green: "90", blue: "180" })).toBeNull();
    expect(deadlinesProblem({ red: "7", yellow: "30", green: "90", blue: "366" })).toBe("azul: prazo é um número inteiro de 1 a 365 dias");
    expect(deadlinesProblem({ red: "7,5", yellow: "30", green: "90", blue: "180" })).toBe("vermelho: prazo é um número inteiro de 1 a 365 dias");
    expect(deadlinesProblem({ red: "7", yellow: "5", green: "90", blue: "180" })).toBe("o prazo do amarelo não pode ser menor que o do vermelho");
    expect(deadlinesProblem({ red: "0", yellow: "5", green: "90", blue: "180" })).toBe("vermelho: prazo é um número inteiro de 1 a 365 dias");
  });
});

describe("frases das recusas, sem repetir o que foi enviado", () => {
  it.each([
    [ err(403, "feature_disabled", { feature: "care_regulation" }), REGULATION_DISABLED ],
    [ err(409, "stale_version"), STALE_TEXT ],
    [ err(409, "quota_exhausted"), QUOTA_EXHAUSTED_TEXT ],
    [ err(422, "color_reason_required"), "ao mudar a cor, informe o motivo" ],
    [ err(403, "cbo_not_allowed"), "seu CBO não pode pedir este encaminhamento: médico pede qualquer especialidade ou procedimento; enfermeiro, só os da lista do município; dentista, só especialidades odontológicas" ],
    [ err(422, "invalid_request", { path: "justification" }), "confira o campo: justificativa" ],
    [ err(422, "invalid_request", { path: "ciap2" }), "confira o campo: CIAP-2" ],
    [ err(422, "quantity_below_used", { used: 8 }), "a quantidade não pode ficar abaixo do que já foi autorizado no mês (8)" ],
    [ err(422, "appointment_scheduled"), "a unidade já marcou o horário: o cidadão cancela pelo celular, ou a falta devolve o pedido à regulação" ],
    [ err(409, "citizen_not_verified"), "o paciente não tem cadastro validado no posto, e a rede própria precisa dele para marcar o horário — escolha um prestador externo ou peça a validação" ],
    [ err(422, "invalid_offer"), "esta oferta não serve para este pedido (outro alvo, outro mês ou prestador inativo) — escolha outra" ],
    [ err(422, "invalid_request", { path: "consultation" }), "no máximo 10 pedidos em rascunho por consulta" ],
    [ err(422, "invalid_ciap2"), "CIAP-2 inválido" ],
    [ err(422, "diagnosis_required", { path: "ciap2" }), "informe o CIAP-2 (ou o CID-10, se a sua ocupação usa)" ],
    [ err(422, "diagnosis_required", { path: "cid10" }), "informe o CID-10" ],
    [ err(422, "cid10_not_allowed_for_cbo", { path: "cid10" }), "sua ocupação não pode usar CID-10 — use o CIAP-2" ],
    [ err(422, "invalid_deadlines", { path: "yellow" }), "o prazo de uma cor menos grave não pode ser menor que o de uma mais grave" ],
    [ err(403, "missing_role"), "seu papel não permite usar a regulação municipal" ],
    [ err(404, "not_found"), "pedido não encontrado" ],
    [ err(409, "invalid_transition"), "este pedido mudou de situação — recarregue" ],
    [ err(422, "invalid_target", { hint: "exam_order" }), "este procedimento é exame: peça pelo pedido de exame da consulta" ],
    [ err(422, "invalid_target"), "especialidade ou procedimento inválido" ],
    [ err(422, "skip_reason_required"), "Há pedido mais antigo, de cor igual ou mais grave, esperando nesta especialidade ou procedimento com oferta disponível. Para autorizar este antes, registre o motivo." ],
    [ err(422, "invalid_request", { path: "estranho" }), "confira o campo: estranho" ],
    [ err(500, "boom"), "não foi possível concluir — tente de novo" ],
    [ new TypeError("Failed to fetch"), "sem conexão com o servidor — tente de novo" ]
  ])("%#", (e, text) => expect(regulationError(e)).toBe(text));
  it("recusas da finalização por causa da regulação; e o Encerrar da fila", () => {
    expect(regulationFinalizeError(err(422, "regulation_request_required"))).toBe(REGULATION_REQUIRED_TEXT);
    // G4: a finalização nunca é recusada por rascunho; sem `index` ou com, o cbo_not_allowed é o da consulta.
    expect(regulationFinalizeError(err(403, "cbo_not_allowed", { index: 0, path: "target_code" }))).toBeNull();
    expect(regulationFinalizeError(err(403, "cbo_not_allowed"))).toBeNull();
    expect(regulationFinalizeError(new TypeError("x"))).toBeNull();
    expect(notSentReason({ index: 0, id: "rr1", error: "cbo_not_allowed", path: "target_code" })).toMatch(/^seu CBO não pode pedir/);
    expect(attendanceError(err(422, "regulation_request_required")))
      .toBe("com a regulação ligada, encaminhamento sem unidade de destino é pelo “Pedir regulação” na consulta — escolha a unidade da rede");
  });
  it("arquivos e avisos", () => {
    expect(guideFilename("rr1/../x")).toBe("guia-regulacao-rr1x.pdf");
    expect(exportFilename(TODAY26)).toBe("regulacao-estado-2026-10-28.csv");
    expect([ draftsNote(1), draftsNote(2) ]).toEqual([ "1 pedido de regulação vai para a fila da regulação ao finalizar.",
      "2 pedidos de regulação vão para a fila da regulação ao finalizar." ]);
  });
});
