// src/lib/territoryRegistry.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  IDENTITY_REVIEW_TEXT, STALE_TEXT, TERRITORY_DISABLED, TERRITORY_NO_ROLE, canUseTerritory, cnsProblem, cpfProblem, duplicateQueryProblem, errorPath,
  exitReasonLabel, isStale, microAreaCodeProblem, microAreaNameProblem, registryStatusLabel, registryStatusTone, territoryError, territoryRoles
} from "./territoryRegistry";

const user = (roles: string[], features: string[], operator = false) =>
  ({ operator, memberships: roles.map((role) => ({ role })), features });
const refusal = (status: number, body: unknown) => new ApiError(status, body, `${status}`);

describe("papel e interruptor", () => {
  it("exige territory_registry E clinical_record, e nunca o operador", () => {
    expect(canUseTerritory(user([ "health_professional" ], [ "clinical_record", "territory_registry" ]))).toBe(true);
    expect(canUseTerritory(user([ "health_professional" ], [ "territory_registry" ]))).toBe(false);
    expect(canUseTerritory(user([ "health_professional" ], [ "clinical_record" ]))).toBe(false);
    expect(canUseTerritory(user([], [ "clinical_record", "territory_registry" ], true))).toBe(false);
    expect(canUseTerritory(null)).toBe(false);
    expect(territoryRoles(user([ "municipal_admin" ], []))).toEqual({ professional: false, admin: true });
    expect(territoryRoles(user([ "health_professional" ], []))).toEqual({ professional: true, admin: false });
  });
});

describe("rótulos (contrato §1, L19, L23, L24)", () => {
  it.each([
    [ "valid", "válido", "ok" ], [ "due_soon", "vence em até 60 dias", "warn" ], [ "expired", "vencido (24 meses ou mais)", "down" ],
    [ "missing", "sem cadastro", "down" ], [ "missing_identifier", "sem identificador (CPF ou CNS)", "warn" ],
    [ "refused", "recusou o cadastro", "neutral" ], [ "exited", "saiu do cadastro", "neutral" ], [ "novo_codigo", "novo_codigo", "neutral" ]
  ])("%s → %s (%s)", (code, label, tone) => {
    expect(registryStatusLabel(code)).toBe(label);
    expect(registryStatusTone(code)).toBe(tone);
  });
  it("saída", () => {
    expect(exitReasonLabel("moved")).toBe("mudou de território");
    expect(exitReasonLabel("death")).toBe("óbito");
    expect(exitReasonLabel("x")).toBe("x");
  });
  it("identidade atualizada no posto", () => {
    expect(IDENTITY_REVIEW_TEXT).toBe("identidade atualizada no posto, revisar e salvar");
  });
});

describe("microárea", () => {
  it.each([ [ "01", null ], [ "99", null ], [ "00", "código de 01 a 99, com dois dígitos" ], [ "1", "código de 01 a 99, com dois dígitos" ],
    [ "100", "código de 01 a 99, com dois dígitos" ], [ "a1", "código de 01 a 99, com dois dígitos" ] ])("código %s", (code, problem) => {
    expect(microAreaCodeProblem(code)).toBe(problem);
  });
  it("nome de 1 a 60, recusado (nunca cortado)", () => {
    expect(microAreaNameProblem("  ")).toBe("informe o nome da microárea");
    expect(microAreaNameProblem("x".repeat(60))).toBeNull();
    expect(microAreaNameProblem("x".repeat(61))).toBe("nome com mais de 60 caracteres");
  });
});

describe("busca de duplicados e documentos", () => {
  it("nome com nome e sobrenome, nascimento até hoje; mãe opcional", () => {
    expect(duplicateQueryProblem({ full_name: "Maria", birth_date: "1960-01-01" }, "2026-10-23")).toBe("informe nome e sobrenome");
    expect(duplicateQueryProblem({ full_name: "Maria Silva", birth_date: "" }, "2026-10-23")).toBe("informe a data de nascimento");
    expect(duplicateQueryProblem({ full_name: "Maria Silva", birth_date: "2026-10-24" }, "2026-10-23")).toBe("nascimento depois de hoje");
    expect(duplicateQueryProblem({ full_name: "Maria Silva", birth_date: "2026-10-23" }, "2026-10-23")).toBeNull();
    expect(duplicateQueryProblem({ full_name: "Maria Silva", birth_date: "1960-01-01", mother_name: "Ana" }, "2026-10-23")).toBeNull();
  });
  it("CPF e CNS pelo dígito", () => {
    expect(cpfProblem("529.982.247-25")).toBeNull();
    expect(cpfProblem("529.982.247-24")).toBe("CPF inválido: confira os 11 dígitos");
    expect(cnsProblem("")).toBeNull();
    expect(cnsProblem("123")).toBe("CNS inválido: confira os 15 dígitos");
    expect(cnsProblem("7000 0000 0000 005")).toBeNull();
  });
});

describe("recusas do api (contrato §3–§5; api 17175a8)", () => {
  it.each([
    [ 409, "duplicate_code", "já existe microárea com este código na equipe" ],
    [ 422, "acs_not_in_team", "o ACS escolhido não é agente comunitário ativo desta equipe" ],
    [ 422, "acs_without_cns", "o ACS precisa ter CNS no cadastro de profissionais para ser responsável pela microárea" ],
    [ 422, "team_kind_not_allowed", "só equipes de saúde da família (70) e de atenção primária (76) têm microáreas" ],
    [ 422, "invalid_code", "código de 01 a 99, com dois dígitos" ],
    [ 409, "already_registered", "esta pessoa já tem cadastro individual ativo — abra o cadastro dela para atualizar" ],
    [ 409, "cpf_taken", "este CPF já pertence a outro paciente — confira o número; a junção de pacientes ainda não existe" ],
    [ 409, "cns_taken", "este CNS já pertence a outro paciente — confira o número" ],
    [ 409, "citizen_not_verified", "este CPF tem cadastro declarado pelo cidadão, ainda sem validação presencial — valide a identidade antes" ],
    [ 422, "cpf_or_reason_required", "informe o CPF ou o motivo de não ter CPF" ],
    [ 422, "invalid_cpf", "CPF inválido: confira os 11 dígitos" ],
    [ 422, "invalid_cns", "CNS inválido: confira os 15 dígitos" ],
    [ 422, "identity_locked", "a identidade desta pessoa já foi validada presencialmente — não se altera aqui" ],
    [ 422, "invalid_ethnicity", "etnia só vale com raça/cor indígena" ],
    [ 422, "too_long", "texto maior que o limite do campo destacado" ],
    [ 422, "invalid_transition", "esta ação não vale para a situação atual do cadastro (já saiu ou recusou)" ],
    [ 403, "cbo_not_allowed", "só o ACS da microárea, enfermeiro ou médico da equipe grava o cadastro" ],
    [ 403, "out_of_scope", "esta microárea não é da sua equipe" ],
    [ 403, "missing_role", TERRITORY_NO_ROLE ],
    [ 409, "stale_version", STALE_TEXT ],
    [ 422, "invalid_household", "confira o campo destacado" ],
    [ 422, "invalid_family", "confira o campo destacado" ],
    [ 422, "invalid_registration", "confira o campo destacado" ],
    [ 422, "address_from_household", "o endereço desta pessoa vem do cadastro domiciliar — altere pelo domicílio" ],
    [ 422, "invalid_request", "pedido inválido — recarregue a tela e tente de novo" ],
    [ 422, "invalid_limit", "tamanho de página inválido — recarregue a tela" ],
    [ 422, "invalid_cursor", "a lista mudou — recarregue" ],
    [ 404, "person_not_found", "nenhuma pessoa com este CPF — preencha os dados para cadastrar" ],
    [ 404, "not_found", "não encontrado — recarregue" ],
    [ 429, "too_many_requests", "muitas buscas seguidas — aguarde um minuto" ]
  ])("%s %s", (status, error, text) => {
    expect(territoryError(refusal(status, { error }))).toBe(text);
  });
  it("invalid_micro_area diz o campo", () => {
    expect(territoryError(refusal(422, { error: "invalid_micro_area", field: "name" }))).toBe("nome da microárea inválido: de 1 a 60 caracteres");
    expect(territoryError(refusal(422, { error: "invalid_micro_area", field: "active" }))).toBe("situação da microárea inválida — recarregue");
    expect(territoryError(refusal(422, { error: "invalid_micro_area" }))).toBe("confira o campo destacado");
  });
  it("429 sem corpo, código novo e falha de rede", () => {
    expect(territoryError(refusal(429, null))).toBe("muitas tentativas — aguarde alguns minutos");
    expect(territoryError(refusal(422, { error: "novo_codigo", message: "frase do api" }))).toBe("frase do api");
    expect(territoryError(refusal(500, { error: "boom" }))).toBe("não foi possível concluir — tente de novo");
    expect(territoryError(refusal(502, null))).toBe("não foi possível concluir — tente de novo");
    expect(territoryError(refusal(401, { error: "mfa_required" }))).toBe("não foi possível concluir (401) — tente de novo");
    expect(territoryError(new TypeError("fetch failed"))).toBe("sem conexão com o servidor — tente de novo");
  });
  it("feature_disabled, path, field e stale", () => {
    expect(territoryError(refusal(403, { error: "feature_disabled", feature: "territory_registry" }))).toBe(TERRITORY_DISABLED);
    expect(errorPath(refusal(422, { error: "invalid_registration", path: "health_conditions.status_eh_gestante" })))
      .toBe("health_conditions.status_eh_gestante");
    expect(errorPath(refusal(422, { error: "invalid_micro_area", field: "name" }))).toBe("name");
    expect(errorPath(refusal(422, { error: "invalid_micro_area", path: "p", field: "f" }))).toBe("p");
    expect(errorPath(refusal(422, { error: "invalid_cpf" }))).toBeNull();
    expect(errorPath(new Error("x"))).toBeNull();
    expect(isStale(refusal(409, { error: "stale_version" }))).toBe(true);
    expect(isStale(refusal(409, { error: "cpf_taken" }))).toBe(false);
    expect(isStale(new Error("x"))).toBe(false);
  });
  it("a frase nunca repete o que foi enviado", () => {
    const text = territoryError(refusal(422, { error: "invalid_registration", path: "new_patient.cpf", value: "52998224725", message: "52998224725" }));
    expect(text).not.toMatch(/\d{11}/);
    expect(territoryError(refusal(500, { error: "x", value: "52998224725" }))).not.toMatch(/\d{11}/);
  });
});
