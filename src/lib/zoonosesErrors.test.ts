import { describe, expect, it } from "vitest";
import { OMBUDSMAN_ERRORS } from "./ombudsman";
import {
  ANIMAL_STAY_OPEN, FORWARDING_ALREADY_PENDING, ZOONOSES_DISABLED, ZOONOSES_ERROR_CODES, ZOONOSES_ERRORS, ZOONOSES_OMBUDSMAN_DISABLED
} from "./zoonosesErrors";

describe("frases do 35b", () => {
  it("cada código tem uma frase e só uma; sem código sobrando na tabela", () => {
    expect(Object.keys(ZOONOSES_ERRORS).sort()).toEqual([ ...ZOONOSES_ERROR_CODES ].sort());
    expect(new Set(ZOONOSES_ERROR_CODES).size).toBe(ZOONOSES_ERROR_CODES.length);
  });
  it("frases distintas, sem sublinhado e com mais de 10 caracteres", () => {
    const phrases = ZOONOSES_ERROR_CODES.map((code) => ZOONOSES_ERRORS[code]);
    expect(new Set(phrases).size).toBe(phrases.length);
    for (const p of phrases) {
      expect(p.includes("_")).toBe(false);
      expect(p.length).toBeGreaterThan(10);
    }
  });
  it("cobre todo código que o api devolve nas rotas do 35b (api-shapes §3)", () => {
    for (const code of [
      "mfa_required", "feature_disabled", "missing_role", "veterinarian_required", "not_found", "person_not_found", "animal_changed",
      "animal_not_active", "campaign_changed", "campaign_already_open", "survey_changed", "collar_changed", "invalid_transition", "demand_changed",
      "forwarding_changed", "observation_changed", "test_changed", "stay_changed", "stay_already_open", "already_euthanized", "parameters_changed",
      "reserved_subject", "citizen_not_verified", "invalid_request", "expected_version_required", "date_out_of_range", "microchip_taken",
      "registry_number_taken", "already_vaccinated_in_campaign", "campaign_not_open", "survey_not_open", "animal_not_dog", "observation_not_finished",
      "elisa_without_reactive_dpp", "household_not_in_survey", "invalid_parameter", "invalid_cursor", "invalid_limit", "invalid_cpf", "invalid_cns",
      "already_extended", "invalid_form", "forwarding_already_pending", "too_many_requests", "cbo_not_allowed", "out_of_scope"
    ]) expect(ZOONOSES_ERROR_CODES as readonly string[]).toContain(code);
  });
  it("cobre os códigos de rejeição dos itens do field-sync (animal, vacina, leish_collection, coleira)", () => {
    for (const code of [
      "tutor_not_found", "product_not_allowed", "feature_disabled", "cbo_not_allowed", "out_of_scope", "not_found", "client_uuid_conflict",
      "invalid_request", "animal_not_active", "animal_not_dog", "microchip_taken", "registry_number_taken", "date_out_of_range",
      "already_vaccinated_in_campaign", "campaign_not_open", "survey_not_open", "elisa_without_reactive_dpp", "household_not_in_survey",
      "expected_version_required", "invalid_transition", "missing_role", "animal_changed", "test_changed"
    ]) expect(ZOONOSES_ERROR_CODES as readonly string[]).toContain(code);
    expect(ZOONOSES_ERRORS.tutor_not_found).toBe("o tutor deste animal não foi encontrado — confira o cadastro do tutor");
    expect(ZOONOSES_ERRORS.product_not_allowed).toBe("este produto não vale para esta finalidade");
  });
  it("veterinarian_required exige papel, CRMV e vínculo na unidade de vigilância ambiental", () => {
    for (const part of [ "papel", "CRMV", "vínculo", "vigilância ambiental" ]) expect(ZOONOSES_ERRORS.veterinarian_required).toContain(part);
  });
  it("não inventa o que o api não manda (tutor_required, euthanasia_required)", () => {
    expect(ZOONOSES_ERROR_CODES as readonly string[]).not.toContain("tutor_required");
    expect(ZOONOSES_ERROR_CODES as readonly string[]).not.toContain("euthanasia_required");
  });
  it("frases fixadas pelo coordenador, letra por letra", () => {
    expect(ZOONOSES_ERRORS.feature_disabled).toBe(ZOONOSES_DISABLED);
    expect(ZOONOSES_ERRORS.forwarding_already_pending).toBe("Já existe um encaminhamento pendente para este destino.");
    expect(FORWARDING_ALREADY_PENDING).toBe("Já existe um encaminhamento pendente para este destino.");
    expect(ZOONOSES_OMBUDSMAN_DISABLED).toBe("A ouvidoria está desligada nesta cidade.");
    expect(ANIMAL_STAY_OPEN).toBe("Feche a estada no canil antes de mudar a situação");
  });
  it("forwarding_changed e already_extended são as do 33", () => {
    expect(ZOONOSES_ERRORS.forwarding_changed).toBe(OMBUDSMAN_ERRORS.forwarding_changed);
    expect(ZOONOSES_ERRORS.already_extended).toBe(OMBUDSMAN_ERRORS.already_extended);
  });
});
