// src/modules/TerritoryMicroAreas.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listTerritoryAdminTeams: vi.fn(), listMicroAreas: vi.fn(), createMicroArea: vi.fn(),
    updateMicroArea: vi.fn(), stepUpMfa: vi.fn() };
});

import * as api from "../lib/api";
import { TerritoryMicroAreas } from "./TerritoryMicroAreas";
import { TERRITORY_DISABLED, TERRITORY_NO_ROLE } from "../lib/territoryRegistry";
import { renderWithProviders } from "../test/campaignFixtures";
import { TEAM_EAP, adminTeam, microArea, territoryUser } from "../test/territoryFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.listTerritoryAdminTeams, api.listMicroAreas, api.createMicroArea, api.updateMicroArea ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "municipal_admin" ]));
  mocked(api.listTerritoryAdminTeams).mockResolvedValue([ adminTeam() ]);
  mocked(api.listMicroAreas).mockResolvedValue([ microArea() ]);
  mocked(api.createMicroArea).mockResolvedValue(microArea({ id: "ma9", code: "02" }));
  mocked(api.updateMicroArea).mockResolvedValue(microArea());
});

const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("TerritoryMicroAreas", () => {
  it("lista as microáreas da equipe com o ACS", async () => {
    renderWithProviders(<TerritoryMicroAreas />);
    expect(await screen.findByText("Vila Verde de cima")).not.toBeNull();
    expect(screen.getByText("Ana Prado")).not.toBeNull();
    expect(api.listMicroAreas).toHaveBeenCalledWith("tm1");
  });

  it("equipe sem nome no CNES: 'equipe sem nome', nunca 'null'", async () => {
    mocked(api.listTerritoryAdminTeams).mockResolvedValue([ adminTeam({ name: null }) ]);
    renderWithProviders(<TerritoryMicroAreas />);
    expect(await screen.findByRole("option", { name: "equipe sem nome · INE 0001234567" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nova microárea" }));
    typeIn("Código", "02");
    typeIn("Nome", "Rua das Flores");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText(/na equipe equipe sem nome\./)).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/null/);
  });

  it("cria com step-up; código ruim é recusado antes de abrir a confirmação", async () => {
    renderWithProviders(<TerritoryMicroAreas />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova microárea" }));
    typeIn("Código", "0");
    typeIn("Nome", "Rua das Flores");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert").textContent).toBe("código de 01 a 99, com dois dígitos");
    typeIn("Código", "02");
    fireEvent.change(screen.getByLabelText("ACS responsável"), { target: { value: "pr1" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar microárea" }));
    await waitFor(() => expect(api.createMicroArea).toHaveBeenCalledWith({ team_id: "tm1", code: "02", name: "Rua das Flores", acs_professional_id: "pr1" }));
    expect((await screen.findByRole("status")).textContent).toBe("Microárea 02 criada.");
  });

  it("ACS sem CNS aparece desabilitado; 409 duplicate_code vira frase e o formulário fica", async () => {
    mocked(api.createMicroArea).mockRejectedValue(new api.ApiError(409, { error: "duplicate_code" }, "409"));
    renderWithProviders(<TerritoryMicroAreas />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova microárea" }));
    expect((screen.getByRole("option", { name: "Bruno Lima (sem CNS)" }) as HTMLOptionElement).disabled).toBe(true);
    typeIn("Código", "01");
    typeIn("Nome", "Repetida");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar microárea" }));
    expect(await screen.findByText("já existe microárea com este código na equipe")).not.toBeNull();
    // Cancelar a confirmação devolve o formulário com o que foi digitado.
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect((screen.getByLabelText("Código") as HTMLInputElement).value).toBe("01");
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Repetida");
  });

  it("sem ACS escolhido, cria sem o campo; nome longo é recusado antes", async () => {
    renderWithProviders(<TerritoryMicroAreas />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova microárea" }));
    typeIn("Código", "03");
    typeIn("Nome", "x".repeat(61));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert").textContent).toBe("nome com mais de 60 caracteres");
    typeIn("Nome", "  Beira-rio  ");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar microárea" }));
    await waitFor(() => expect(api.createMicroArea).toHaveBeenCalledWith({ team_id: "tm1", code: "03", name: "Beira-rio" }));
  });

  it("desativar diz o efeito antes e manda active: false", async () => {
    renderWithProviders(<TerritoryMicroAreas />);
    fireEvent.click(await screen.findByRole("button", { name: "Desativar 01" }));
    expect(screen.getByText("Os domicílios ficam guardados; a microárea some das novas fichas.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Desativar microárea" }));
    await waitFor(() => expect(api.updateMicroArea).toHaveBeenCalledWith("ma1", { active: false }));
    expect((await screen.findByRole("status")).textContent).toBe("Microárea 01 desativada.");
  });

  it("inativa aparece como tal e reativa com active: true", async () => {
    mocked(api.listMicroAreas).mockResolvedValue([ microArea({ active: false, acs: null }) ]);
    renderWithProviders(<TerritoryMicroAreas />);
    expect(await screen.findByText("inativa")).not.toBeNull();
    expect(screen.getByText("sem ACS")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reativar 01" }));
    fireEvent.click(screen.getByRole("button", { name: "Reativar microárea" }));
    await waitFor(() => expect(api.updateMicroArea).toHaveBeenCalledWith("ma1", { active: true }));
    expect((await screen.findByRole("status")).textContent).toBe("Microárea 01 reativada.");
  });

  it("renomeia com o nome sem espaços nas pontas", async () => {
    renderWithProviders(<TerritoryMicroAreas />);
    fireEvent.click(await screen.findByRole("button", { name: "Renomear 01" }));
    expect((screen.getByLabelText("Novo nome") as HTMLInputElement).value).toBe("Vila Verde de cima");
    typeIn("Novo nome", " ");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert").textContent).toBe("informe o nome da microárea");
    typeIn("Novo nome", " Vila Verde alta ");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Renomear microárea" }));
    await waitFor(() => expect(api.updateMicroArea).toHaveBeenCalledWith("ma1", { name: "Vila Verde alta" }));
    expect((await screen.findByRole("status")).textContent).toBe("Microárea 01 renomeada.");
  });

  it("trocar ACS: \"sem ACS\" manda null (tira o responsável)", async () => {
    renderWithProviders(<TerritoryMicroAreas />);
    fireEvent.click(await screen.findByRole("button", { name: "Trocar ACS 01" }));
    expect((screen.getByLabelText("ACS responsável") as HTMLSelectElement).value).toBe("pr1");
    fireEvent.change(screen.getByLabelText("ACS responsável"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trocar ACS" }));
    await waitFor(() => expect(api.updateMicroArea).toHaveBeenCalledWith("ma1", { acs_professional_id: null }));
    expect((await screen.findByRole("status")).textContent).toBe("ACS da microárea 01 trocado.");
  });

  it("acs_not_in_team vira a frase da equipe", async () => {
    mocked(api.updateMicroArea).mockRejectedValue(new api.ApiError(422, { error: "acs_not_in_team" }, "422"));
    renderWithProviders(<TerritoryMicroAreas />);
    fireEvent.click(await screen.findByRole("button", { name: "Trocar ACS 01" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trocar ACS" }));
    expect(await screen.findByText("o ACS escolhido não é agente comunitário ativo desta equipe")).not.toBeNull();
  });

  it("trocar de equipe lê as microáreas dela", async () => {
    mocked(api.listTerritoryAdminTeams).mockResolvedValue([ adminTeam(), adminTeam({ ...TEAM_EAP, kind: "76", acs_candidates: [] }) ]);
    renderWithProviders(<TerritoryMicroAreas />);
    await screen.findByText("Vila Verde de cima");
    expect(screen.getByRole("option", { name: "ESF Vila Verde · INE 0001234567" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Equipe"), { target: { value: "tm2" } });
    await waitFor(() => expect(api.listMicroAreas).toHaveBeenCalledWith("tm2"));
  });

  it("sem a janela de step-up, pede o código antes de gravar", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "municipal_admin" ], { mfa_verified_at: null }));
    renderWithProviders(<TerritoryMicroAreas />);
    fireEvent.click(await screen.findByRole("button", { name: "Renomear 01" }));
    typeIn("Novo nome", "Vila Verde alta");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByLabelText(/código/i)).not.toBeNull();
    expect(api.updateMicroArea).not.toHaveBeenCalled();
  });

  it("só o municipal_admin: o profissional vê o portão; desligado, nada é lido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "health_professional" ]));
    renderWithProviders(<TerritoryMicroAreas />);
    expect(await screen.findByText(TERRITORY_NO_ROLE)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "municipal_admin" ], { features: [ "clinical_record" ] }));
    renderWithProviders(<TerritoryMicroAreas />);
    expect(await screen.findByText(TERRITORY_DISABLED)).not.toBeNull();
    expect(api.listTerritoryAdminTeams).not.toHaveBeenCalled();
    expect(api.listMicroAreas).not.toHaveBeenCalled();
  });
});
