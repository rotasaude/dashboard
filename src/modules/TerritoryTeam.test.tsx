// src/modules/TerritoryTeam.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getTerritoryContext: vi.fn(), listHouseholds: vi.fn(), getHousehold: vi.fn(), listRegistrations: vi.fn() };
});

import * as api from "../lib/api";
import { TerritoryTeam } from "./TerritoryTeam";
import { TERRITORY_DISABLED, TERRITORY_NO_ROLE } from "../lib/territoryRegistry";
import { renderWithProviders } from "../test/campaignFixtures";
import {
  TEAM_EAP, TODAY24, family, household, microArea, profilelessRegistration, registration, territoryContext, territoryUser
} from "../test/territoryFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const JOSE = registration({ id: "rg2", is_responsible: false, status: "expired",
  patient: { id: "pa2", display_name: "José das Dores", full_name: "José das Dores", mother_name: "Maria das Dores", birth_date: "2026-09-30",
    sex: "male", has_cpf: false, no_cpf_reason: "3", cns_masked: "*** **** **** 1234", identity_locked: false } });

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getTerritoryContext, api.listHouseholds, api.getHousehold, api.listRegistrations ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser());
  mocked(api.getTerritoryContext).mockResolvedValue(territoryContext());
  // A lista não traz living_conditions (C6).
  const { living_conditions: _omit, ...listed } = household();
  mocked(api.listHouseholds).mockResolvedValue({ households: [ listed ], next_before: null });
  mocked(api.getHousehold).mockResolvedValue(household());
  mocked(api.listRegistrations).mockResolvedValue([ registration(), JOSE ]);
});

describe("TerritoryTeam", () => {
  it("abre na primeira microárea; domicílio → famílias → moradores com a situação", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText("Rua das Flores, 120")).not.toBeNull();
    expect(api.listHouseholds).toHaveBeenCalledWith({ microAreaId: "ma1", before: null });
    fireEvent.click(screen.getByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByText("José das Dores")).not.toBeNull();
    expect(api.getHousehold).toHaveBeenCalledWith("hh1");
    expect(api.listRegistrations).toHaveBeenCalledWith({ householdId: "hh1" });
    expect(screen.getByText("sem CPF · CNS *** **** **** 1234")).not.toBeNull();
    expect(screen.getByText("com CPF")).not.toBeNull();
    expect(screen.getByText("vencido (24 meses ou mais)")).not.toBeNull();
    expect(screen.getByText("Responsável: Maria das Dores · 3 pessoas")).not.toBeNull();
    expect(screen.getByText("perto da escola")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null|status_tem_diabetes|nu_comodos/);
  });

  it("família de uma pessoa no singular; mudou-se vira marca", async () => {
    mocked(api.getHousehold).mockResolvedValue(household({ families: [
      family({ members_count: 1, moved_out: true }),
      family({ id: "fa2", responsible: { patient_id: "pa4", display_name: null }, members_count: null })
    ] }));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByText("Responsável: Maria das Dores · 1 pessoa")).not.toBeNull();
    expect(screen.getByText("mudou-se")).not.toBeNull();
    expect(screen.getByText("Responsável: pessoa sem nome no cadastro")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("morador sem perfil e domicílio recusado sem endereço não quebram a tela", async () => {
    const refused = household({ id: "hh2", address: {}, refused: true, families: [] });
    mocked(api.listHouseholds).mockResolvedValue({ households: [ refused ], next_before: null });
    mocked(api.getHousehold).mockResolvedValue(refused);
    mocked(api.listRegistrations).mockResolvedValue([ profilelessRegistration({ household_id: "hh2" }) ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText("recusou o cadastro")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir domicílio sem endereço" }));
    expect(await screen.findByText("sem nome no cadastro")).not.toBeNull();
    expect(screen.getByText("nenhuma família")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("só as microáreas em que o profissional cadastra (a de outro ACS não aparece)", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await screen.findByText("Rua das Flores, 120");
    const options = Array.from((screen.getByLabelText("Microárea") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual([ "01 · Vila Verde de cima" ]);
    expect(screen.queryByLabelText("Equipe")).toBeNull();
    expect(api.listHouseholds).toHaveBeenCalledTimes(1);
  });

  it("mais de uma equipe: seletor de equipe; trocar relê a microárea da outra equipe", async () => {
    const base = territoryContext().teams[0];
    mocked(api.getTerritoryContext).mockResolvedValue({ teams: [ base, { ...TEAM_EAP, unit: { id: "u2", name: "UBS Boqueirão" },
      micro_areas: [ { ...microArea({ id: "ma9", code: "07", name: "Boqueirão norte", team: TEAM_EAP }), can_register: true } ] } ] });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await screen.findByText("Rua das Flores, 120");
    fireEvent.change(screen.getByLabelText("Equipe"), { target: { value: "tm2" } });
    expect(await screen.findByRole("option", { name: "07 · Boqueirão norte" })).not.toBeNull();
    expect(api.listHouseholds).toHaveBeenLastCalledWith({ microAreaId: "ma9", before: null });
  });

  it("nenhuma microárea em que cadastra: aviso e nenhuma leitura nominal", async () => {
    const base = territoryContext().teams[0];
    mocked(api.getTerritoryContext).mockResolvedValue({ teams: [ { ...base, micro_areas: base.micro_areas.map((m) => ({ ...m, can_register: false })) } ] });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText("nenhuma microárea em que você cadastre nas suas equipes")).not.toBeNull();
    expect(api.listHouseholds).not.toHaveBeenCalled();
  });

  it("carregar mais repassa o cursor opaco", async () => {
    mocked(api.listHouseholds)
      .mockResolvedValueOnce({ households: [ household() ], next_before: "MjAyNi0wMy0wMlQxMzowMDowMFp8aGgx" })
      .mockResolvedValueOnce({ households: [ household({ id: "hh3", address: { ...household().address, number: null, no_number: true } as api.HouseholdAddress }) ], next_before: null });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await screen.findByText("Rua das Flores, 120");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Rua das Flores, s/n")).not.toBeNull();
    expect(api.listHouseholds).toHaveBeenLastCalledWith({ microAreaId: "ma1", before: "MjAyNi0wMy0wMlQxMzowMDowMFp8aGgx" });
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("volta à aba e reconecta: lista e detalhe não releem", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    await screen.findByText("José das Dores");
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
    expect(api.listHouseholds).toHaveBeenCalledTimes(1);
    expect(api.getHousehold).toHaveBeenCalledTimes(1);
    expect(api.listRegistrations).toHaveBeenCalledTimes(1);
    expect(api.getTerritoryContext).toHaveBeenCalledTimes(1);
  });

  it("detalhe recusado pelo api vira frase; Fechar volta só à lista", async () => {
    mocked(api.getHousehold).mockRejectedValue(new api.ApiError(404, { error: "not_found" }, "404"));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByText("não encontrado — recarregue")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText("não encontrado — recarregue")).toBeNull();
    expect(api.listHouseholds).toHaveBeenCalledTimes(1);
  });

  it("403 feature_disabled vira a frase do interruptor", async () => {
    mocked(api.getTerritoryContext).mockRejectedValue(new api.ApiError(403, { error: "feature_disabled", feature: "territory_registry" }, "403"));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText(TERRITORY_DISABLED)).not.toBeNull();
  });

  it("só o profissional de saúde: o municipal_admin vê o portão e nada é lido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "municipal_admin" ]));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText(TERRITORY_NO_ROLE)).not.toBeNull();
    expect(api.getTerritoryContext).not.toHaveBeenCalled();
    expect(api.listHouseholds).not.toHaveBeenCalled();
  });
});
