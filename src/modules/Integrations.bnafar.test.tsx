// src/modules/Integrations.bnafar.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { bnafarCredential } from "../test/bnafarFixtures";
import * as api from "../lib/api";
import { Integrations } from "./Integrations";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
  getIntegrations: vi.fn(), putBnafarCredential: vi.fn(), setBnafarCredential: vi.fn(), checkBnafarCredential: vi.fn(),
  checkIntegrationCredential: vi.fn(), setIntegrationCredential: vi.fn() }));

const base = (cred: api.IntegrationCredential, features: api.CityFeatureState[] = []) => ({
  record_mode: "record" as const, pec_url_set: true, ibge_code_set: true, credentials: [ cred ], features });
const ROW = "BNAFAR (SI-BNAFAR)";

beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ]));
  vi.mocked(api.getIntegrations).mockResolvedValue(base(bnafarCredential("production", { set: false, set_at: null, set_by: null, last_check_at: null, last_check_status: null })));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("credencial BNAFAR (27b, Q9)", () => {
  it("uma linha, com o rótulo do ambiente em uso", async () => {
    vi.mocked(api.getIntegrations).mockResolvedValue(base(bnafarCredential("homologation")));
    renderWithProviders(<Integrations />);
    expect(await screen.findByRole("button", { name: `Trocar — ${ROW} — homologação` })).not.toBeNull();
    expect(screen.getAllByText(`${ROW} — homologação`)).toHaveLength(1);
    expect(screen.getByText("e-SUS PEC · CADSUS · RNDS · BNAFAR")).not.toBeNull();
  });

  it("produção: rótulo sem sufixo", async () => {
    renderWithProviders(<Integrations />);
    expect(await screen.findByRole("button", { name: `Cadastrar — ${ROW}` })).not.toBeNull();
  });

  it("Cadastrar: senha mascarada, ambiente da linha, nada no cache nem na tela", async () => {
    vi.mocked(api.getIntegrations).mockResolvedValue(base(bnafarCredential("homologation", { set: false })));
    vi.mocked(api.setBnafarCredential).mockResolvedValue(bnafarCredential("homologation"));
    const { client } = renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: `Cadastrar — ${ROW} — homologação` }));
    const password = (await screen.findByLabelText("Senha")) as HTMLInputElement;
    expect(password.type).toBe("password");
    expect(screen.queryByLabelText(/ambiente/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Usuário do Portal de Serviços"), { target: { value: "  maria.farm " } });
    fireEvent.change(password, { target: { value: "  Sup3r senha  " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar credencial" }));
    await waitFor(() => expect(api.setBnafarCredential).toHaveBeenCalledWith("maria.farm", "  Sup3r senha  ", "homologation"));
    expect(await screen.findByText("Credencial da BNAFAR salva. Teste a conexão para conferir.")).not.toBeNull();
    expect(screen.queryByLabelText("Senha")).toBeNull();
    expect(document.body.textContent).not.toContain("Sup3r");
    expect(document.body.textContent).not.toContain("maria.farm");
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.queryKey))).not.toContain("Sup3r");
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain("Sup3r");
    expect(api.setIntegrationCredential).not.toHaveBeenCalled();
  });

  it("janela de step-up fechada: pede o código antes de gravar", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ], { mfa_verified_at: null }));
    vi.mocked(api.stepUpMfa).mockResolvedValue(undefined);
    vi.mocked(api.setBnafarCredential).mockResolvedValue(bnafarCredential("production"));
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: `Cadastrar — ${ROW}` }));
    fireEvent.change(await screen.findByLabelText("Usuário do Portal de Serviços"), { target: { value: "u" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "p" } });
    fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar credencial" }));
    await waitFor(() => expect(api.stepUpMfa).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(api.setBnafarCredential).toHaveBeenCalledWith("u", "p", "production"));
  });

  it("recusas do api viram frase da tela", async () => {
    vi.mocked(api.setBnafarCredential).mockRejectedValue(new api.ApiError(422, { error: "environment_not_allowed" }, "422"));
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: `Cadastrar — ${ROW}` }));
    fireEvent.change(await screen.findByLabelText("Usuário do Portal de Serviços"), { target: { value: "u" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar credencial" }));
    expect(await screen.findByText("este ambiente não está disponível nesta instalação")).not.toBeNull();
  });

  it("Testar conexão: chamada sem corpo de ambiente (api ignora), resultado e releitura", async () => {
    vi.mocked(api.checkBnafarCredential).mockResolvedValue(bnafarCredential("homologation", { last_check_status: "unauthorized" }));
    vi.mocked(api.getIntegrations).mockResolvedValue(base(bnafarCredential("homologation")));
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: `Testar conexão — ${ROW} — homologação` }));
    expect(await screen.findByText(`Teste de conexão — ${ROW} — homologação: usuário ou senha recusados`)).not.toBeNull();
    expect(vi.mocked(api.checkBnafarCredential).mock.calls[0]).toEqual([]);
    expect(api.checkIntegrationCredential).not.toHaveBeenCalled();
    await waitFor(() => expect(api.getIntegrations).toHaveBeenCalledTimes(2));
  });

  it("409 credential_missing no teste vira frase", async () => {
    vi.mocked(api.getIntegrations).mockResolvedValue(base(bnafarCredential("production")));
    vi.mocked(api.checkBnafarCredential).mockRejectedValue(new api.ApiError(409, { error: "credential_missing" }, "409"));
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: `Testar conexão — ${ROW}` }));
    expect(await screen.findByText("cadastre a credencial antes de testar")).not.toBeNull();
  });

  it("pendências da funcionalidade, com as frases", async () => {
    vi.mocked(api.getIntegrations).mockResolvedValue(base(bnafarCredential("production", { set: false }), [
      { key: "bnafar_vector_supplies", enabled: false, usable: false, missing: [ "vector_supplies_disabled", "credential_missing:bnafar" ] },
      { key: "bnafar", enabled: true, usable: false, missing: [ "credential_unauthorized:bnafar", "bnafar_disabled" ] }
    ]));
    renderWithProviders(<Integrations />);
    const vec = within(await screen.findByRole("region", { name: "BNAFAR: endemias e zoonoses" }));
    expect(vec.getByText("ligue antes: Vigilância ambiental (endemias) ou Centro de zoonoses")).not.toBeNull();
    expect(vec.getByText(`cadastre a credencial do ${ROW}, no quadro Credenciais`)).not.toBeNull();
    const env = within(screen.getByRole("region", { name: "Envio à BNAFAR" }));
    expect(env.getByText(`a credencial do ${ROW} foi recusada — troque o usuário e a senha e teste de novo`)).not.toBeNull();
    expect(env.getByText("ligue antes: Envio à BNAFAR")).not.toBeNull();
  });
});
