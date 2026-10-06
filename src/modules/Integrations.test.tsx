// src/modules/Integrations.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
    getIntegrations: vi.fn(), setIntegrationCredential: vi.fn(), checkIntegrationCredential: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { credential, integrationsFixture } from "../test/recordModeFixtures";
import { Integrations } from "./Integrations";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("Integrações (módulo 16)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.getIntegrations, api.setIntegrationCredential, api.checkIntegrationCredential ]) {
      m(fn).mockReset();
    }
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ]));
    m(api.getIntegrations).mockResolvedValue(integrationsFixture());
  });

  it("mostra modo, PEC e IBGE só como estado, sem campo de edição", async () => {
    renderWithProviders(<Integrations />);
    expect(await screen.findByText("integrado — o PEC é o prontuário; o Rota Saúde envia o que registra")).not.toBeNull();
    expect(screen.getAllByText("cadastrado")).toHaveLength(2);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("credenciais: cadastro, último teste e Testar travado sem credencial", async () => {
    renderWithProviders(<Integrations />);
    expect(await screen.findByText(/^cadastrada em 01\/10\/2026.* por admin@curitiba\.demo$/)).not.toBeNull();
    expect(screen.getByText(/^conexão ok · 02\/10\/2026/)).not.toBeNull();
    expect(screen.getAllByText("não cadastrada").length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Testar conexão — CADSUS" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Testar conexão — e-SUS PEC (envio LEDI)" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("funcionalidades: estado e o que falta em linguagem simples", async () => {
    renderWithProviders(<Integrations />);
    const ledi = within(await screen.findByRole("region", { name: "Envio da produção ao e-SUS (LEDI)" }));
    expect(ledi.getByText("ligada e funcionando")).not.toBeNull();
    const cadsus = within(screen.getByRole("region", { name: "Consulta ao CADSUS na validação presencial" }));
    expect(cadsus.getByText("desligada")).not.toBeNull();
    expect(cadsus.getByText("Antes de ligar, falta:")).not.toBeNull();
    expect(cadsus.getByText("cadastre a credencial do CADSUS, no quadro Credenciais")).not.toBeNull();
  });

  it("ligada mas parada: diz o que fazer para voltar a funcionar", async () => {
    m(api.getIntegrations).mockResolvedValue(integrationsFixture({ features: [
      { key: "ledi_export", enabled: true, usable: false, missing: [ "credential_unauthorized:ledi", "pec_url_missing" ] }
    ] }));
    renderWithProviders(<Integrations />);
    const ledi = within(await screen.findByRole("region", { name: "Envio da produção ao e-SUS (LEDI)" }));
    expect(ledi.getByText("ligada, mas parada até resolver o que falta")).not.toBeNull();
    expect(ledi.getByText("Para voltar a funcionar:")).not.toBeNull();
    expect(ledi.getByText("a credencial do e-SUS PEC (envio LEDI) foi recusada — troque o usuário e a senha e teste de novo")).not.toBeNull();
    expect(ledi.getByText("falta o endereço do PEC da cidade (quem cadastra é o operador da plataforma)")).not.toBeNull();
  });

  it("testar conexão chama a API, diz o resultado e relê", async () => {
    m(api.checkIntegrationCredential).mockResolvedValue(credential({ last_check_status: "unauthorized" }));
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Testar conexão — e-SUS PEC (envio LEDI)" }));
    expect(await screen.findByText("Teste de conexão — e-SUS PEC (envio LEDI): usuário ou senha recusados")).not.toBeNull();
    expect(api.checkIntegrationCredential).toHaveBeenCalledWith("ledi");
    await waitFor(() => expect(api.getIntegrations).toHaveBeenCalledTimes(2));
  });

  it("409 credential_missing no teste vira frase", async () => {
    m(api.checkIntegrationCredential).mockRejectedValue(new ApiError(409, { error: "credential_missing" }, "409"));
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Testar conexão — e-SUS PEC (envio LEDI)" }));
    expect(await screen.findByText("cadastre a credencial antes de testar")).not.toBeNull();
  });

  it("cadastrada mostra Trocar; não cadastrada mostra Cadastrar", async () => {
    renderWithProviders(<Integrations />);
    expect(await screen.findByRole("button", { name: "Trocar — e-SUS PEC (envio LEDI)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cadastrar — CADSUS" })).not.toBeNull();
  });

  it("cadastrar: campo de senha mascarado, senha como digitada, formulário fecha e a senha não fica na tela", async () => {
    m(api.setIntegrationCredential).mockResolvedValue(credential({ kind: "cadsus" }));
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar — CADSUS" }));
    const password = (await screen.findByLabelText("Senha")) as HTMLInputElement;
    expect(password.type).toBe("password");
    fireEvent.change(screen.getByLabelText("Usuário"), { target: { value: "  integ.cadsus " } });
    fireEvent.change(password, { target: { value: "  s3nh@ com espaço  " } });
    fireEvent.click(await screen.findByRole("button", { name: "Salvar credencial" }));
    await waitFor(() => expect(api.setIntegrationCredential).toHaveBeenCalledWith("cadsus", "integ.cadsus", "  s3nh@ com espaço  "));
    expect(await screen.findByText("Credencial do CADSUS salva. Teste a conexão para conferir.")).not.toBeNull();
    expect(screen.queryByLabelText("Senha")).toBeNull();
    expect(document.body.textContent).not.toContain("s3nh@");
    await waitFor(() => expect(api.getIntegrations).toHaveBeenCalledTimes(2));
  });

  it("janela de step-up fechada: pede o código antes de gravar", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ], { mfa_verified_at: null }));
    m(api.stepUpMfa).mockResolvedValue(undefined);
    m(api.setIntegrationCredential).mockResolvedValue(credential());
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Trocar — e-SUS PEC (envio LEDI)" }));
    fireEvent.change(await screen.findByLabelText("Usuário"), { target: { value: "integ.pec" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "nova" } });
    fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar credencial" }));
    await waitFor(() => expect(api.stepUpMfa).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(api.setIntegrationCredential).toHaveBeenCalledWith("ledi", "integ.pec", "nova"));
  });

  it("422 invalid_credential vira a frase da tela", async () => {
    m(api.setIntegrationCredential).mockRejectedValue(new ApiError(422, { error: "invalid_credential" }, "422"));
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar — CADSUS" }));
    fireEvent.change(await screen.findByLabelText("Usuário"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "y" } });
    fireEvent.click(await screen.findByRole("button", { name: "Salvar credencial" }));
    expect(await screen.findByText("preencha usuário e senha")).not.toBeNull();
  });

  it("sem municipal_admin: não chama a API", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "analyst" ]));
    renderWithProviders(<Integrations />);
    expect(await screen.findByText("seu papel não permite ver as integrações")).not.toBeNull();
    expect(api.getIntegrations).not.toHaveBeenCalled();
  });
});
