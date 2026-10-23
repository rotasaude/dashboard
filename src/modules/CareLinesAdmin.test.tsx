// src/modules/CareLinesAdmin.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), listCareTemplates: vi.fn(), listCityCareLines: vi.fn(),
    adoptCareLine: vi.fn(), updateCareLine: vi.fn(), createCustomCareLine: vi.fn()
  };
});

import * as api from "../lib/api";
import { CareLinesAdmin } from "./CareLinesAdmin";
import { CARE_DISABLED, CARE_NO_ROLE } from "../lib/careLines";
import { renderWithProviders } from "../test/campaignFixtures";
import { DIABETES_TEMPLATE, PREGNANCY_TEMPLATE, careUser, cityLine } from "../test/careLineFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.listCareTemplates, api.listCityCareLines, api.adoptCareLine,
    api.updateCareLine, api.createCustomCareLine ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "municipal_admin" ]));
  mocked(api.listCareTemplates).mockResolvedValue([ PREGNANCY_TEMPLATE, DIABETES_TEMPLATE ]);
  mocked(api.listCityCareLines).mockResolvedValue([ cityLine() ]);
  mocked(api.adoptCareLine).mockResolvedValue(cityLine({ id: "cl3" }));
  mocked(api.updateCareLine).mockResolvedValue(cityLine());
  mocked(api.stepUpMfa).mockResolvedValue(undefined);
});

const templatesTable = () => screen.getByRole("region", { name: "Catálogo-base" });
const linesTable = () => screen.getByRole("region", { name: "Linhas da cidade" });

describe("CareLinesAdmin", () => {
  it("lista o catálogo e as linhas da cidade; adotada mostra a versão e a origem", async () => {
    renderWithProviders(<CareLinesAdmin />);
    expect(await screen.findByText("Gestante e puérpera")).not.toBeNull();
    expect(await within(linesTable()).findByText("catálogo C4 · versão 1")).not.toBeNull();
    expect(within(templatesTable()).getByText("não adotada")).not.toBeNull();
    expect(within(templatesTable()).getByText("adotada · v1")).not.toBeNull();
    expect(within(linesTable()).getByText("diabetes")).not.toBeNull();
    expect(within(linesTable()).getByText("ativa")).not.toBeNull();
  });

  it("adota com step-up: manda a chave e a versão do catálogo e relê as linhas", async () => {
    renderWithProviders(<CareLinesAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Adotar" }));
    const confirm = screen.getByRole("region", { name: "Adotar a linha Gestante e puérpera" });
    expect(confirm.textContent).toMatch(/Nenhuma pessoa é inscrita sem um profissional confirmar/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Adotar linha" }));
    await waitFor(() => expect(api.adoptCareLine).toHaveBeenCalledWith("pregnancy_c3", 1));
    expect((await screen.findByRole("status")).textContent).toBe("Linha Gestante e puérpera adotada.");
    await waitFor(() => expect(api.listCityCareLines).toHaveBeenCalledTimes(2));
  });

  it("versão nova: Adotar versão 2; com a janela fechada pede o código antes", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "municipal_admin" ], { mfa_verified_at: null }));
    renderWithProviders(<CareLinesAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Adotar versão 2" }));
    const confirm = screen.getByRole("region", { name: "Adotar a versão 2 de Pessoa com diabetes" });
    expect(confirm.textContent).toMatch(/passam a ser avaliadas pelas boas práticas da versão nova/);
    fireEvent.change(within(confirm).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Adotar versão" }));
    await waitFor(() => expect(api.stepUpMfa).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(api.updateCareLine).toHaveBeenCalledWith("cl4", { template_version: 2 }));
  });

  it("desativar diz o que acontece com as inscrições, grava e relê as linhas", async () => {
    renderWithProviders(<CareLinesAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Desativar" }));
    const confirm = screen.getByRole("region", { name: "Desativar Pessoa com diabetes" });
    expect(confirm.textContent).toMatch(/as inscrições ficam guardadas/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Desativar linha" }));
    await waitFor(() => expect(api.updateCareLine).toHaveBeenCalledWith("cl4", { active: false }));
    expect((await screen.findByRole("status")).textContent).toBe("Pessoa com diabetes desativada.");
    await waitFor(() => expect(api.listCityCareLines).toHaveBeenCalledTimes(2));
  });

  // C-01: recusa real do PATCH (save_line.rb): reativar linha própria cuja condição declarada outra linha já usa.
  it("ativar linha própria com condição já usada: 422 vira frase e nada muda", async () => {
    const own = cityLine({ id: "cl9", name: "Diabetes da cidade", source: "custom", template_key: null, template_version: null,
      indicator: null, latest_template_version: null, active: false });
    mocked(api.listCityCareLines).mockResolvedValue([ own ]);
    mocked(api.updateCareLine).mockRejectedValueOnce(new api.ApiError(422, { error: "duplicate_declared_condition" }, "x"));
    renderWithProviders(<CareLinesAdmin />);
    const activate = await screen.findByRole("button", { name: "Ativar" });
    expect(within(linesTable()).getByText("própria da cidade")).not.toBeNull();
    expect(within(linesTable()).getByText("inativa")).not.toBeNull();
    fireEvent.click(activate);
    const confirm = screen.getByRole("region", { name: "Ativar Diabetes da cidade" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Ativar linha" }));
    expect((await within(confirm).findByRole("alert")).textContent).toBe("já existe uma linha da cidade para esta condição declarada");
    expect(api.updateCareLine).toHaveBeenCalledWith("cl9", { active: true });
    expect(api.listCityCareLines).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("duplicate_template: a frase da recusa", async () => {
    mocked(api.listCityCareLines).mockResolvedValue([]);
    mocked(api.adoptCareLine).mockRejectedValueOnce(new api.ApiError(422, { error: "duplicate_template" }, "x"));
    renderWithProviders(<CareLinesAdmin />);
    expect(await screen.findByText("nenhuma linha adotada ainda")).not.toBeNull();
    fireEvent.click((await screen.findAllByRole("button", { name: "Adotar" }))[1]);
    fireEvent.click(screen.getByRole("button", { name: "Adotar linha" }));
    expect((await screen.findByRole("alert")).textContent).toBe("esta linha do catálogo já foi adotada pela cidade");
  });

  it("profissional não vê a tela; sem o interruptor, nada é lido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "health_professional" ]));
    renderWithProviders(<CareLinesAdmin />);
    expect(await screen.findByText(CARE_NO_ROLE)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "municipal_admin" ], { features: [ "clinical_record" ] }));
    renderWithProviders(<CareLinesAdmin />);
    expect(await screen.findByText(CARE_DISABLED)).not.toBeNull();
    expect(api.listCareTemplates).not.toHaveBeenCalled();
    expect(api.listCityCareLines).not.toHaveBeenCalled();
  });
});
