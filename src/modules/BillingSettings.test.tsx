// src/modules/BillingSettings.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getBillingSettings: vi.fn(), saveBillingSettings: vi.fn() };
});

import * as api from "../lib/api";
import { BillingSettings } from "./BillingSettings";
import { BILLING_NO_ROLE } from "../lib/billing";
import { renderWithProviders } from "../test/campaignFixtures";
import { SETTINGS, billingUser } from "../test/billingFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const EMPTY = { origin_name: null, origin_acronym: null, origin_cnpj: null, destination_body: null, management: null };
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.getBillingSettings, api.saveBillingSettings ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "municipal_admin" ]));
  mocked(api.getBillingSettings).mockResolvedValue(EMPTY);
  mocked(api.saveBillingSettings).mockResolvedValue(SETTINGS);
});

function fill(form: HTMLElement, over: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    "Nome do órgão de origem": "SMS CURITIBA", "Sigla do órgão de origem": "SMS", "CNPJ de origem": "11.222.333/0001-81",
    "Órgão de destino": "SECRETARIA MUNICIPAL DE SAUDE", "Gestão": "M", ...over
  };
  for (const [ label, value ] of Object.entries(values)) fireEvent.change(within(form).getByLabelText(label), { target: { value } });
}

describe("BillingSettings", () => {
  it("sem configuração: diz que o fechamento não sai até preencher", async () => {
    renderWithProviders(<BillingSettings />);
    expect(await screen.findByText("Sem a configuração completa, o faturista não consegue fechar competência.")).not.toBeNull();
    expect(screen.getAllByText("não preenchido").length).toBe(5);
    expect(screen.getByRole("button", { name: "Configurar faturamento" })).not.toBeNull();
  });

  it("edita, revisa e salva com step-up; CNPJ vai só com dígitos e a tela relê", async () => {
    renderWithProviders(<BillingSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurar faturamento" }));
    const form = screen.getByRole("region", { name: "Editar configuração do faturamento" });
    fill(form);
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar configuração" }));
    await waitFor(() => expect(api.saveBillingSettings).toHaveBeenCalledWith({
      origin_name: "SMS CURITIBA", origin_acronym: "SMS", origin_cnpj: "11222333000181",
      destination_body: "SECRETARIA MUNICIPAL DE SAUDE", management: "M"
    }));
    expect((await screen.findByRole("status")).textContent).toBe("Configuração do faturamento salva.");
    await waitFor(() => expect(api.getBillingSettings).toHaveBeenCalledTimes(2));
  });

  it("nome maior que a largura do arquivo é recusado, nunca cortado; CNPJ inválido também", async () => {
    renderWithProviders(<BillingSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurar faturamento" }));
    const form = screen.getByRole("region", { name: "Editar configuração do faturamento" });
    fill(form, { "Nome do órgão de origem": "SECRETARIA MUNICIPAL DE SAUDE CWB" });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    expect(within(form).getByRole("alert").textContent).toBe("nome do órgão de origem com até 30 caracteres (largura do arquivo BPA) — abrevie");
    expect((within(form).getByLabelText("Nome do órgão de origem") as HTMLInputElement).value).toBe("SECRETARIA MUNICIPAL DE SAUDE CWB");
    fill(form, { "CNPJ de origem": "11.222.333/0001-80" });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    expect(within(form).getByRole("alert").textContent).toBe("CNPJ de origem inválido");
    expect(screen.queryByRole("button", { name: "Salvar configuração" })).toBeNull();
  });

  it("configurada: mostra os valores; 422 invalid_cnpj do api vira frase", async () => {
    mocked(api.getBillingSettings).mockResolvedValue(SETTINGS);
    mocked(api.saveBillingSettings).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_cnpj" }, "x"));
    renderWithProviders(<BillingSettings />);
    expect(await screen.findByText("SMS CURITIBA")).not.toBeNull();
    expect(screen.getByText("11.222.333/0001-81")).not.toBeNull();
    expect(screen.getByText("municipal (M)")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editar configuração" }));
    const form = screen.getByRole("region", { name: "Editar configuração do faturamento" });
    expect((within(form).getByLabelText("Sigla do órgão de origem") as HTMLInputElement).value).toBe("SMS");
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar configuração" }));
    expect((await screen.findByRole("alert")).textContent).toBe("CNPJ de origem inválido");
  });

  it("faturista não vê a tela", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "billing_clerk" ]));
    renderWithProviders(<BillingSettings />);
    expect(await screen.findByText(BILLING_NO_ROLE)).not.toBeNull();
    expect(api.getBillingSettings).not.toHaveBeenCalled();
  });

  it("sigla é opcional: salva sem sigla", async () => {
    renderWithProviders(<BillingSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurar faturamento" }));
    const form = screen.getByRole("region", { name: "Editar configuração do faturamento" });
    fill(form, { "Sigla do órgão de origem": "" });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar configuração" }));
    await waitFor(() => expect(api.saveBillingSettings).toHaveBeenCalledWith(expect.objectContaining({ origin_acronym: "" })));
  });

  it("too_long e field_required do api vêm com o campo", async () => {
    mocked(api.saveBillingSettings)
      .mockRejectedValueOnce(new api.ApiError(422, { error: "too_long", field: "destination_body" }, "x"))
      .mockRejectedValueOnce(new api.ApiError(422, { error: "field_required", field: "origin_name" }, "x"));
    renderWithProviders(<BillingSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurar faturamento" }));
    const form = screen.getByRole("region", { name: "Editar configuração do faturamento" });
    fill(form);
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar configuração" }));
    expect((await screen.findByRole("alert")).textContent).toBe("órgão de destino maior que a largura do arquivo BPA — abrevie");
    fireEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));
    expect((await screen.findByRole("alert")).textContent).toBe("preencha: nome do órgão de origem");
  });
});
