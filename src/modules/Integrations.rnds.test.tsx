// src/modules/Integrations.rnds.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import * as api from "../lib/api";
import { missingPhrase } from "../lib/integrations";
import { Integrations } from "./Integrations";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getIntegrations: vi.fn(),
  setRndsCredential: vi.fn(), checkIntegrationCredential: vi.fn() }));
const RNDS = { kind: "rnds" as const, set: false, set_at: null, set_by: null, last_check_at: null, last_check_status: null, last_check_message: null };
const pfx = (name = "secretaria.pfx", size = 3000) => new File([ new Uint8Array(size) ], name, { type: "application/x-pkcs12" });

beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ], { features: [ "vaccination" ] }));
  vi.mocked(api.getIntegrations).mockResolvedValue({ record_mode: "record", pec_url_set: true, ibge_code_set: true, credentials: [ RNDS ],
    features: [ { key: "rnds_immunization", enabled: true, usable: false, missing: [ "credential_missing:rnds", "vaccination_disabled" ] } ] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("credencial RNDS (F-29.1)", () => {
  it("pendências novas em português", () => {
    expect(missingPhrase("record_mode_not_record")).toMatch(/não é o prontuário do Rota Saúde/);
    expect(missingPhrase("vaccination_disabled")).toBe("ligue antes: Sala de vacina");
  });

  it("arquivo e CNES conferidos antes; senha no step-up; nada do segredo volta", async () => {
    vi.mocked(api.setRndsCredential).mockResolvedValue({ ...RNDS, set: true, set_at: "2026-11-02T10:00:00-03:00", set_by: "admin" });
    renderWithProviders(<Integrations />);
    expect(await screen.findByText("ligue antes: Sala de vacina")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar — RNDS — vacinação (certificado A1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("escolha o arquivo do certificado (.pfx ou .p12)")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Certificado A1"), { target: { files: [ pfx("certificado.pdf") ] } });
    fireEvent.change(screen.getByLabelText("CNES solicitante"), { target: { value: "20012" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("o certificado A1 é um arquivo .pfx ou .p12")).not.toBeNull();
    expect(screen.getByText("o CNES solicitante tem 7 dígitos")).not.toBeNull();
    const file = pfx();
    fireEvent.change(screen.getByLabelText("Certificado A1"), { target: { files: [ file ] } });
    fireEvent.change(screen.getByLabelText("CNES solicitante"), { target: { value: "2001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.change(await screen.findByLabelText("Senha do certificado"), { target: { value: "s3nh4" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar certificado" }));
    await waitFor(() => expect(api.setRndsCredential).toHaveBeenCalledWith(file, "s3nh4", "2001234"));
    expect(await screen.findByText(/Certificado da RNDS salvo/)).not.toBeNull();
    expect(screen.queryByText(/s3nh4/)).toBeNull();
    expect(screen.queryByText(/secretaria\.pfx/)).toBeNull();
  });

  it("certificado que não abre: frase da tela", async () => {
    vi.mocked(api.setRndsCredential).mockRejectedValue(new api.ApiError(422, { error: "invalid_certificate" }, "422"));
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar — RNDS — vacinação (certificado A1)" }));
    fireEvent.change(screen.getByLabelText("Certificado A1"), { target: { files: [ pfx() ] } });
    fireEvent.change(screen.getByLabelText("CNES solicitante"), { target: { value: "2001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.change(await screen.findByLabelText("Senha do certificado"), { target: { value: "errada" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar certificado" }));
    expect(await screen.findByText("o certificado não abriu com essa senha — confira o arquivo .pfx e a senha")).not.toBeNull();
  });

  async function openPassword() {
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar — RNDS — vacinação (certificado A1)" }));
    fireEvent.change(screen.getByLabelText("Certificado A1"), { target: { files: [ pfx() ] } });
    fireEvent.change(screen.getByLabelText("CNES solicitante"), { target: { value: "2001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    return await screen.findByLabelText("Senha do certificado");
  }

  it("senha acima de 200 caracteres: recusada na tela, sem enviar", async () => {
    fireEvent.change(await openPassword(), { target: { value: "x".repeat(201) } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar certificado" }));
    expect(await screen.findByText("a senha do certificado tem de 1 a 200 caracteres")).not.toBeNull();
    expect(api.setRndsCredential).not.toHaveBeenCalled();
  });

  it("invalid_credential do api: frase do certificado, não de usuário e senha", async () => {
    vi.mocked(api.setRndsCredential).mockRejectedValue(new api.ApiError(422, { error: "invalid_credential" }, "422"));
    fireEvent.change(await openPassword(), { target: { value: "s3nh4" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar certificado" }));
    expect(await screen.findByText("confira o certificado, a senha e o CNES")).not.toBeNull();
    expect(screen.queryByText(/usuário e senha/)).toBeNull();
  });

  it("teste de conexão recusado: tag fala em certificado", async () => {
    vi.mocked(api.getIntegrations).mockResolvedValue({ record_mode: "record", pec_url_set: true, ibge_code_set: true,
      credentials: [ { ...RNDS, set: true, set_at: "2026-11-02T10:00:00-03:00", last_check_at: "2026-11-02T11:00:00-03:00",
        last_check_status: "unauthorized", last_check_message: "A RNDS recusou o certificado" } ], features: [] });
    renderWithProviders(<Integrations />);
    expect(await screen.findByText(/certificado recusado/)).not.toBeNull();
    expect(screen.queryByText(/usuário ou senha recusados/)).toBeNull();
  });
});
