import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  checkLabel, checkSummary, credentialLabel, featureState, integrationsError, missingPhrase, recordModeLabel, setSummary
} from "./integrations";
import { credential } from "../test/recordModeFixtures";

const apiError = (status: number, body: unknown) => new ApiError(status, body, String(status));

describe("integrações — rótulos", () => {
  it("modo de prontuário e credencial em português; desconhecido sai cru", () => {
    expect(recordModeLabel("off")).toBe("desligado — o Rota Saúde não envia produção");
    expect(recordModeLabel("integrated")).toBe("integrado — o PEC é o prontuário; o Rota Saúde envia o que registra");
    expect(recordModeLabel("record")).toBe("prontuário — o Rota Saúde é o prontuário da cidade");
    expect(recordModeLabel("hybrid")).toBe("hybrid");
    expect(credentialLabel("ledi")).toBe("e-SUS PEC (envio LEDI)");
    expect(credentialLabel("cadsus")).toBe("CADSUS");
    expect(credentialLabel("rnds")).toBe("rnds");
  });

  it("cadastro: quando e por quem; não cadastrada", () => {
    expect(setSummary(credential())).toMatch(/^cadastrada em 01\/10\/2026.*10:00 por admin@curitiba\.demo$/);
    expect(setSummary(credential({ set_by: null }))).not.toContain(" por ");
    expect(setSummary(credential({ set: false, set_at: null, set_by: null }))).toBe("não cadastrada");
  });

  it("último teste: frase e tom por situação", () => {
    expect(checkSummary(credential({ set: false }))).toEqual({ text: "não cadastrada", tone: "neutral" });
    expect(checkSummary(credential({ last_check_status: null, last_check_at: null }))).toEqual({ text: "nunca testada", tone: "neutral" });
    expect(checkSummary(credential()).text).toMatch(/^conexão ok · 02\/10\/2026/);
    expect(checkSummary(credential()).tone).toBe("ok");
    expect(checkSummary(credential({ last_check_status: "unauthorized" })).tone).toBe("down");
    expect(checkSummary(credential({ last_check_status: "unreachable" })).tone).toBe("warn");
    expect(checkSummary(credential({ last_check_status: "error" })).tone).toBe("warn");
    expect(checkLabel(null)).toBe("nunca testada");
    expect(checkLabel("unauthorized")).toBe("usuário ou senha recusados");
  });
});

describe("integrações — o que falta (contratos §2)", () => {
  it("cada código em linguagem simples, dizendo quem resolve", () => {
    expect(missingPhrase("record_mode_off"))
      .toBe("o modo de prontuário da cidade ainda está desligado (quem define é o operador da plataforma)");
    expect(missingPhrase("pec_url_missing")).toBe("falta o endereço do PEC da cidade (quem cadastra é o operador da plataforma)");
    expect(missingPhrase("ibge_code_missing")).toBe("falta o código IBGE da cidade (quem cadastra é o operador da plataforma)");
    expect(missingPhrase("credential_missing:cadsus")).toBe("cadastre a credencial do CADSUS, no quadro Credenciais");
    expect(missingPhrase("credential_unauthorized:ledi"))
      .toBe("a credencial do e-SUS PEC (envio LEDI) foi recusada — troque o usuário e a senha e teste de novo");
  });

  it("código desconhecido nunca some", () => {
    expect(missingPhrase("rnds_certificate_missing")).toBe("pendência não reconhecida: rnds_certificate_missing");
    expect(missingPhrase("credential_missing:rnds")).toBe("cadastre a credencial do rnds, no quadro Credenciais");
  });

  it("estado da funcionalidade: ligada e funcionando, ligada e parada, desligada", () => {
    expect(featureState({ key: "ledi_export", enabled: true, usable: true, missing: [] }))
      .toEqual({ state: "on", label: "ligada e funcionando", tone: "ok" });
    expect(featureState({ key: "ledi_export", enabled: true, usable: false, missing: [ "pec_url_missing" ] }))
      .toEqual({ state: "blocked", label: "ligada, mas parada até resolver o que falta", tone: "warn" });
    expect(featureState({ key: "cadsus_lookup", enabled: false, usable: false, missing: [] }))
      .toEqual({ state: "off", label: "desligada", tone: "neutral" });
  });
});

describe("integrações — erros", () => {
  it("códigos da tela viram frase; o resto segue o padrão das ações", () => {
    expect(integrationsError(apiError(422, { error: "invalid_credential" }))).toBe("preencha usuário e senha");
    expect(integrationsError(apiError(422, { error: "unknown_kind" }))).toBe("tipo de credencial desconhecido — recarregue a página");
    expect(integrationsError(apiError(409, { error: "credential_missing" }))).toBe("cadastre a credencial antes de testar");
    expect(integrationsError(apiError(403, { error: "missing_role" }))).toBe("seu papel não permite esta ação");
    expect(integrationsError(apiError(401, ""))).toBe("sessão expirada — entre de novo");
    expect(integrationsError(new Error("x"))).toBe("não foi possível concluir — tente de novo");
  });
});
