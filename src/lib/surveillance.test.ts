// src/lib/surveillance.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  NEXT, SURVEILLANCE_DISABLED, canSuggestNotification, canUseSurveillance, cboCanNotify, closedWeekProblem, codesOf, epiWeekOf, epiWeekStart,
  existingNotificationId, isStale, localDiseaseProblem, officialNumberProblem, pastDateProblem, previousEpiWeek, reasonProblem, residenceProblem,
  shiftEpiWeek, statusLabel, surveillanceError, surveillanceRoles, symptomsProblem, transitionLabel, weekLabel, weekProblem, weekRangeProblem
} from "./surveillance";

const user = (roles: string[], features: string[] = [ "surveillance" ], operator = false) =>
  ({ operator, memberships: roles.map((role) => ({ role })), features });
const refused = (status: number, body: unknown) => new ApiError(status, body, "x");

describe("portão e papéis", () => {
  it("só com o interruptor e nunca para o operador; a sugestão exige também o prontuário", () => {
    expect(canUseSurveillance(user([ "surveillance" ]))).toBe(true);
    expect(canUseSurveillance(user([ "surveillance" ], []))).toBe(false);
    expect(canUseSurveillance(user([], [ "surveillance" ], true))).toBe(false);
    expect(canSuggestNotification(user([ "health_professional" ], [ "surveillance" ]))).toBe(false);
    expect(canSuggestNotification(user([ "health_professional" ], [ "surveillance", "clinical_record" ]))).toBe(true);
    expect(canSuggestNotification(user([ "citizen_verifier" ], [ "surveillance", "clinical_record" ]))).toBe(false);
    expect(surveillanceRoles(user([ "analyst" ]))).toEqual({ surveillance: false, analyst: true, professional: false, admin: false });
  });
  it("CBO que notifica: médico 225*, enfermeiro 2235*; técnico e dentista não", () => {
    expect(cboCanNotify("225142")).toBe(true);
    expect(cboCanNotify("223505")).toBe(true);
    expect(cboCanNotify("322205")).toBe(false);
    expect(cboCanNotify("223208")).toBe(false);
    expect(cboCanNotify(null)).toBe(false);
  });
});

describe("rótulos e transições (D5)", () => {
  it("código desconhecido aparece cru", () => {
    expect(statusLabel("possible")).toBe("possível notificação não feita");
    expect(statusLabel("entered")).toBe("digitada no sistema oficial");
    expect(statusLabel("reopened")).toBe("reopened");
  });
  it("próximos passos por situação", () => {
    expect(NEXT.possible).toEqual([ "notified" ]);
    expect(NEXT.notified).toEqual([ "investigating" ]);
    expect(NEXT.investigating).toEqual([ "closed" ]);
    expect(NEXT.closed).toEqual([ "entered" ]);
    expect(NEXT.entered).toEqual([]);
    expect(NEXT.dismissed).toEqual([]);
    expect(transitionLabel("entered")).toBe("Registrar número oficial");
  });
});

describe("semana epidemiológica: domingo a sábado, 4 de janeiro, semana 53 (D16)", () => {
  it("datas conhecidas", () => {
    expect(epiWeekOf("2026-10-27")).toBe("2026-43");
    expect(epiWeekOf("2026-10-25")).toBe("2026-43");
    expect(epiWeekOf("2026-10-24")).toBe("2026-42");
    expect(epiWeekOf("2026-01-04")).toBe("2026-01");
    expect(epiWeekOf("2026-01-03")).toBe("2025-53");
    expect(epiWeekOf("2024-12-29")).toBe("2025-01");
    expect(epiWeekOf("2024-12-28")).toBe("2024-52");
    expect(epiWeekOf("2022-01-01")).toBe("2021-52");
    expect(epiWeekOf("2021-01-01")).toBe("2020-53");
  });
  it("início, deslocamento, anterior e rótulo", () => {
    expect(epiWeekStart("2026-43")).toBe("2026-10-25");
    expect(epiWeekStart("2025-53")).toBe("2025-12-28");
    expect(shiftEpiWeek("2026-01", -1)).toBe("2025-53");
    expect(shiftEpiWeek("2025-53", 1)).toBe("2026-01");
    expect(shiftEpiWeek("2026-43", -7)).toBe("2026-36");
    expect(previousEpiWeek("2026-01-05")).toBe("2025-53");
    expect(weekLabel("2026-43")).toBe("semana 43/2026 (25/10 a 31/10)");
  });
  it("formato, semana encerrada e faixa do painel (D7, D8)", () => {
    expect(weekProblem("2026-43", "2026-10-27")).toBeNull();
    expect(weekProblem("2026-54", "2026-10-27")).toBe("semana inválida: use AAAA-SS (ex.: 2026-43)");
    expect(weekProblem("2026-44", "2026-10-27")).toBe("semana no futuro");
    expect(weekProblem("2026-4", "2026-10-27")).toBe("semana inválida: use AAAA-SS (ex.: 2026-43)");
    expect(closedWeekProblem("2026-42", "2026-10-27")).toBeNull();
    expect(closedWeekProblem("2026-43", "2026-10-27")).toBe("a semana ainda não terminou");
    expect(weekRangeProblem("2026-36", "2026-43", "2026-10-27")).toBeNull();
    expect(weekRangeProblem("2026-43", "2026-36", "2026-10-27")).toBe("a semana inicial vem depois da final");
    expect(weekRangeProblem("2025-42", "2026-43", "2026-10-27")).toBe("no máximo 53 semanas por consulta");
    expect(weekRangeProblem("2025-44", "2026-43", "2026-10-27")).toBeNull();
  });
  it("semana 53 só nos anos que a têm", () => {
    expect(weekProblem("2025-53", "2026-10-27")).toBeNull();
    expect(weekProblem("2026-53", "2027-12-31")).toBe("semana inválida: use AAAA-SS (ex.: 2026-43)");
    expect(weekProblem("2026-00", "2026-10-27")).toBe("semana inválida: use AAAA-SS (ex.: 2026-43)");
  });
});

describe("formato: recusar, nunca cortar", () => {
  it("datas", () => {
    expect(symptomsProblem("", "2026-10-27", "2026-10-27")).toBeNull();
    expect(symptomsProblem("2026-10-28", "2026-10-27", "2026-10-27")).toBe("data dos primeiros sintomas depois de hoje");
    expect(symptomsProblem("2026-10-26", "2026-10-25", "2026-10-27")).toBe("primeiros sintomas depois da data da suspeita");
    expect(pastDateProblem("", "data da suspeita", "2026-10-27", true)).toBe("informe a data da suspeita");
    expect(pastDateProblem("", "data da suspeita", "2026-10-27", false)).toBeNull();
    expect(pastDateProblem("27/10/2026", "data da suspeita", "2026-10-27", true)).toBe("data da suspeita inválida");
    expect(pastDateProblem("2026-02-30", "data da suspeita", "2026-10-27", true)).toBe("data da suspeita inválida");
    expect(pastDateProblem("2026-10-28", "data da suspeita", "2026-10-27", true)).toBe("data da suspeita depois de hoje");
    expect(pastDateProblem("2026-10-27", "data da suspeita", "2026-10-27", true)).toBeNull();
  });
  it("número oficial, residência, motivo", () => {
    expect(officialNumberProblem("1234567")).toBeNull();
    expect(officialNumberProblem("")).toBe("informe o número da notificação no sistema oficial");
    expect(officialNumberProblem("2026/0001234-5")).toBeNull();
    expect(officialNumberProblem("12 45")).toBe("número oficial de 1 a 30 caracteres: letras, números, ponto, barra ou hífen");
    expect(officialNumberProblem("1".repeat(31))).toBe("número oficial de 1 a 30 caracteres: letras, números, ponto, barra ou hífen");
    expect(residenceProblem(false, "")).toBeNull();
    expect(residenceProblem(true, "4106902")).toBeNull();
    expect(residenceProblem(true, "410690")).toBe("código IBGE do município de residência com 7 dígitos");
    expect(reasonProblem("", true)).toBe("informe o motivo");
    expect(reasonProblem("ok", true)).toBe("motivo de 3 a 500 caracteres");
    expect(reasonProblem("", false)).toBeNull();
    expect(reasonProblem("x".repeat(501), false)).toBe("motivo com mais de 500 caracteres");
    expect(reasonProblem("ç".repeat(500), true)).toBeNull();
  });
  it("doença local (D4; nome de 1 a 120 depois do trim, A17)", () => {
    const ok = { code: "local_febre_x", name: "Febre X (vigilância estadual)", deadline: "immediate", cid10: "A93.8", ciap2: "", repeat_after_days: "30" };
    expect(codesOf(" a93.8, b05 ;A90 a90")).toEqual([ "A938", "B05", "A90" ]);
    expect(localDiseaseProblem(ok, true)).toBeNull();
    expect(localDiseaseProblem({ ...ok, code: "febre_x" }, true)).toBe("código começa com local_ e segue com letras minúsculas, números ou _ (até 46)");
    expect(localDiseaseProblem({ ...ok, code: "local_Febre" }, true)).toBe("código começa com local_ e segue com letras minúsculas, números ou _ (até 46)");
    expect(localDiseaseProblem({ ...ok, code: "" }, false)).toBeNull();
    expect(localDiseaseProblem({ ...ok, name: "Fe" }, true)).toBeNull();
    expect(localDiseaseProblem({ ...ok, name: "   " }, true)).toBe("nome de 1 a 120 caracteres");
    expect(localDiseaseProblem({ ...ok, name: "x".repeat(121) }, true)).toBe("nome de 1 a 120 caracteres");
    expect(localDiseaseProblem({ ...ok, name: "ç".repeat(120) }, true)).toBeNull();
    expect(localDiseaseProblem({ ...ok, deadline: "" }, true)).toBe("escolha o prazo");
    expect(localDiseaseProblem({ ...ok, cid10: "A9" }, true)).toBe("CID-10 inválido: A9");
    expect(localDiseaseProblem({ ...ok, ciap2: "A7" }, true)).toBe("CIAP-2 inválido: A7");
    expect(localDiseaseProblem({ ...ok, repeat_after_days: "0" }, true)).toBe("janela de repetição de 1 a 36500 dias");
    expect(localDiseaseProblem({ ...ok, repeat_after_days: "30,5" }, true)).toBe("janela de repetição de 1 a 36500 dias");
    expect(localDiseaseProblem({ ...ok, repeat_after_days: "36501" }, true)).toBe("janela de repetição de 1 a 36500 dias");
  });
});

describe("frases das recusas", () => {
  it("códigos do contrato viram frase; nada do enviado volta", () => {
    expect(surveillanceError(refused(403, { error: "feature_disabled", feature: "surveillance" }))).toBe(SURVEILLANCE_DISABLED);
    expect(surveillanceError(refused(409, { error: "already_notified", notification_id: "nt9" })))
      .toBe("já existe notificação desta doença em aberto (ou recente) para o paciente");
    expect(existingNotificationId(refused(409, { error: "already_notified", notification_id: "nt9" }))).toBe("nt9");
    expect(existingNotificationId(refused(409, { error: "already_notified" }))).toBeNull();
    expect(surveillanceError(refused(403, { error: "cbo_not_allowed" }))).toBe("só médico ou enfermeiro notifica pela consulta");
    expect(surveillanceError(refused(422, { error: "classification_required" }))).toBe("escolha a classificação final para encerrar");
    expect(surveillanceError(refused(422, { error: "official_number_required" }))).toBe("informe o número da notificação no sistema oficial");
    expect(surveillanceError(refused(409, { error: "unit_has_notifications" }))).toBe("a unidade tem notificação nesta semana; a negativa não cabe");
    expect(surveillanceError(refused(422, { error: "future_week" }))).toBe("a semana ainda não terminou");
  });
  it("versão velha, transição e ficha travada (A3)", () => {
    expect(isStale(refused(409, { error: "stale_version" }))).toBe(true);
    expect(isStale(refused(422, { error: "invalid_form" }))).toBe(false);
    expect(surveillanceError(refused(409, { error: "stale_version" }))).toMatch(/recarregue/);
    expect(surveillanceError(refused(422, { error: "invalid_transition", path: "form" }))).toBe("ficha travada — recarregue");
    expect(surveillanceError(refused(422, { error: "invalid_transition" }))).toMatch(/situação atual/);
    expect(surveillanceError(refused(422, { error: "invalid_form", path: "form" }))).toBe("a ficha tem dado que o sistema não aceita — confira os campos");
    expect(surveillanceError(refused(422, { error: "invalid_form", path: "form.phone" }))).toBe("confira o campo indicado na ficha");
  });
  it("manual: data da suspeita e unidade por contexto (A13, A14)", () => {
    expect(surveillanceError(refused(422, { error: "invalid_request", field: "suspected_on" }))).toBe("data da suspeita inválida ou no futuro");
    expect(surveillanceError(refused(422, { error: "invalid_request", field: "classification" }))).toMatch(/pedido inválido/);
    expect(surveillanceError(refused(422, { error: "invalid_unit" }), "manual")).toBe("unidade inexistente ou inativa");
    expect(surveillanceError(refused(422, { error: "invalid_unit" }), "negative")).toBe("unidade inexistente, inativa ou não notificadora");
    expect(surveillanceError(refused(422, { error: "invalid_unit" }))).toBe("unidade inexistente, inativa ou não notificadora");
  });
  it("doença local: a frase vem do path (A16)", () => {
    expect(surveillanceError(refused(409, { error: "duplicate_code", path: "code" }))).toBe("já existe doença com este código");
    expect(surveillanceError(refused(409, { error: "duplicate_code", path: "cid10.1" }))).toBe("o CID-10 da posição 2 já pertence a outra doença da lista");
    expect(surveillanceError(refused(409, { error: "duplicate_code", path: "ciap2.0" }))).toBe("o CIAP-2 da posição 1 já pertence a outra doença da lista");
    expect(surveillanceError(refused(422, { error: "invalid_disease", path: "code" }))).toBe("código da doença inválido");
    expect(surveillanceError(refused(422, { error: "invalid_disease", path: "cid10.0" }))).toBe("CID-10 da posição 1 inválido");
    expect(surveillanceError(refused(422, { error: "invalid_disease", path: "ciap2.2" }))).toBe("CIAP-2 da posição 3 inválido");
    expect(surveillanceError(refused(422, { error: "invalid_disease", path: "name" }))).toBe("confira os dados da doença");
    expect(surveillanceError(refused(422, { error: "invalid_disease" }))).toBe("doença fora da lista vigente — recarregue a lista");
  });
  it("403 de interruptor por feature (A18) e códigos do api real (A15)", () => {
    expect(surveillanceError(refused(403, { error: "feature_disabled", feature: "clinical_record" }))).toBe("Prontuário da atenção primária está desligado nesta cidade");
    expect(surveillanceError(refused(403, { error: "feature_disabled" }))).toBe(SURVEILLANCE_DISABLED);
    expect(surveillanceError(refused(403, { error: "missing_role" }))).toMatch(/papel/);
    expect(surveillanceError(refused(403, { error: "not_author" }))).toBe("só quem atendeu a consulta pode notificar por ela");
    expect(surveillanceError(refused(422, { error: "invalid_notifying" }))).toMatch(/notificadora/);
    expect(surveillanceError(refused(422, { error: "invalid_filter" }))).toMatch(/filtro/);
    expect(surveillanceError(refused(422, { error: "invalid_limit" }))).toMatch(/página/);
    expect(surveillanceError(refused(422, { error: "invalid_cursor" }))).toMatch(/recarregue/);
    expect(surveillanceError(refused(422, { error: "invalid_cpf" }))).toMatch(/CPF/);
    expect(surveillanceError(refused(409, { error: "cpf_taken" }))).toMatch(/CPF/);
    expect(surveillanceError(refused(422, { error: "cpf_or_reason_required" }))).toMatch(/CPF/);
    expect(surveillanceError(refused(429, { error: "too_many_requests" }))).toMatch(/aguarde/);
    expect(surveillanceError(refused(422, { error: "person_not_found" }))).toMatch(/nenhuma pessoa/);
    expect(surveillanceError(refused(409, { error: "duplicate_suspected" }))).toMatch(/pessoa/);
  });
  it("nunca devolve código cru nem o texto do corpo enviado", () => {
    const text = surveillanceError(refused(500, { error: "boom_internal" }));
    expect(text).not.toMatch(/boom_internal/);
    expect(surveillanceError(new Error("x"))).toBe("sem conexão com o servidor — tente de novo");
  });
});
