// src/modules/RegistryStatus.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getTerritoryContext: vi.fn(), listRegistryStatus: vi.fn(), countRegistryStatus: vi.fn(),
    createRegistration: vi.fn(), getRegistration: vi.fn(), exitRegistration: vi.fn() };
});

import * as api from "../lib/api";
import type { RegistryStatusQuery, TerritoryContext } from "../lib/api";
import { RegistryStatus } from "./RegistryStatus";
import { COUNT_QUERY, IDENTITY_REVIEW_TEXT, TERRITORY_DISABLED, TERRITORY_NO_ROLE } from "../lib/territoryRegistry";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY24, personRow, registration, territoryContext, territoryUser } from "../test/territoryFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
// Enfermeiro/médico: grava em todas as microáreas da equipe → pode ver a equipe toda.
function nurseContext(): TerritoryContext {
  const base = territoryContext();
  return { teams: base.teams.map((t) => ({ ...t, micro_areas: t.micro_areas.map((m) => ({ ...m, can_register: true })) })) };
}
const MISSING = personRow({ status: "missing", registered_at: null, registration_id: null, patient_id: null, citizen_id: "ci4",
  display_name: null, micro_area_code: null });
const statuses = () => mocked(api.listRegistryStatus).mock.calls.map((c) => (c[0] as RegistryStatusQuery));

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getTerritoryContext, api.listRegistryStatus, api.countRegistryStatus, api.createRegistration,
    api.getRegistration, api.exitRegistration ]) mocked(fn).mockReset();
  mocked(api.createRegistration).mockResolvedValue(registration({ household_id: null, family_id: null, micro_area: null }));
  mocked(api.getRegistration).mockResolvedValue(registration({ id: "rg3" }));
  mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser());
  mocked(api.getTerritoryContext).mockResolvedValue(nurseContext());
  mocked(api.countRegistryStatus).mockResolvedValue({ valid: 120, due_soon: 8, expired: 31, missing: 44, missing_identifier: 5 });
  mocked(api.listRegistryStatus).mockImplementation(async (q: RegistryStatusQuery) =>
    ({ people: [ q.status === "missing" ? MISSING : personRow() ], next_before: null }));
});

describe("RegistryStatus", () => {
  it("equipe toda: contadores (sem trilha) e a lista de vencidos", async () => {
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    expect(await screen.findByRole("tab", { name: "Vencidos (31)" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "A vencer (8)" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Sem identificador (5)" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Sem cadastro (44)" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Recusou" })).not.toBeNull();
    expect(screen.getByText("Válidos")).not.toBeNull();
    expect(screen.getByText("120")).not.toBeNull();
    expect(screen.getByText("Sem identificador (CPF ou CNS)")).not.toBeNull();
    expect(await screen.findByText("Joaquim Ribeiro")).not.toBeNull();
    expect(screen.getByText("71 anos")).not.toBeNull();
    expect(screen.getByText("01/09/2024")).not.toBeNull();
    expect(api.listRegistryStatus).toHaveBeenCalledWith({ teamId: "tm1", microAreaId: undefined, status: "expired", before: null });
    expect(api.countRegistryStatus).toHaveBeenCalledWith("tm1", undefined);
    expect((screen.getByLabelText("Microárea") as HTMLSelectElement).value).toBe("");
  });

  it("troca de aba relê; Cadastrar/Atualizar abrem a ficha na tela; com microárea, 'Sem cadastro' sai e a tela explica", async () => {
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Sem cadastro (44)" }));
    await waitFor(() => expect(api.listRegistryStatus).toHaveBeenLastCalledWith({ teamId: "tm1", microAreaId: undefined, status: "missing", before: null }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa sem nome no cadastro" }));
    const sheet = screen.getByRole("form", { name: "Novo cadastro individual" });
    expect(within(sheet).getByText("validados no posto")).not.toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("form", { name: "Novo cadastro individual" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Microárea"), { target: { value: "ma1" } });
    expect(await screen.findByText(/quem ainda não tem cadastro não tem microárea/)).not.toBeNull();
    expect(screen.queryByRole("tab", { name: /Sem cadastro/ })).toBeNull();
    await waitFor(() => expect(api.listRegistryStatus).toHaveBeenLastCalledWith({ teamId: "tm1", microAreaId: "ma1", status: "expired", before: null }));
    expect(api.countRegistryStatus).toHaveBeenLastCalledWith("tm1", "ma1");
    fireEvent.click(await screen.findByRole("button", { name: "Atualizar Joaquim Ribeiro" }));
    expect(await screen.findByRole("form", { name: "Atualizar cadastro individual" })).not.toBeNull();
    expect(api.getRegistration).toHaveBeenCalledWith("rg3");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("tab", { name: "Recusou" }));
    await waitFor(() => expect(api.listRegistryStatus).toHaveBeenLastCalledWith({ teamId: "tm1", microAreaId: "ma1", status: "refused", before: null }));
    fireEvent.click(screen.getByRole("tab", { name: "Sem identificador (5)" }));
    await waitFor(() => expect(api.listRegistryStatus).toHaveBeenLastCalledWith({ teamId: "tm1", microAreaId: "ma1", status: "missing_identifier", before: null }));
  });

  it("ACS: presa à própria microárea, sem 'todas' nem 'Sem cadastro' (o api daria 403)", async () => {
    mocked(api.getTerritoryContext).mockResolvedValue(territoryContext());
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    expect(await screen.findByText("Joaquim Ribeiro")).not.toBeNull();
    const select = screen.getByLabelText("Microárea") as HTMLSelectElement;
    expect(select.value).toBe("ma1");
    expect(Array.from(select.options).map((o) => o.value)).toEqual([ "ma1" ]);
    expect(screen.queryByRole("tab", { name: /Sem cadastro/ })).toBeNull();
    expect(screen.getByText(/quem ainda não tem cadastro não tem microárea/)).not.toBeNull();
    expect(statuses().every((q) => q.microAreaId === "ma1")).toBe(true);
    expect(mocked(api.countRegistryStatus).mock.calls.every((c) => c[1] === "ma1")).toBe(true);
  });

  it("equipe com uma microárea só: sem 'todas' (pode ser a do ACS)", async () => {
    const base = nurseContext();
    mocked(api.getTerritoryContext).mockResolvedValue({ teams: base.teams.map((t) => ({ ...t, micro_areas: t.micro_areas.slice(0, 1) })) });
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    expect(await screen.findByText("Joaquim Ribeiro")).not.toBeNull();
    expect(Array.from((screen.getByLabelText("Microárea") as HTMLSelectElement).options).map((o) => o.value)).toEqual([ "ma1" ]);
    expect(api.countRegistryStatus).toHaveBeenCalledWith("tm1", "ma1");
  });

  it("equipe sem nome no CNES: 'equipe sem nome', nunca 'null'", async () => {
    const base = nurseContext().teams[0];
    mocked(api.getTerritoryContext).mockResolvedValue({ teams: [ { ...base, name: null }, { ...base, id: "tm2", ine: "0001234575", name: "EAP Boqueirão" } ] });
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    await screen.findByText("Joaquim Ribeiro");
    expect(screen.getByRole("option", { name: "equipe sem nome · INE 0001234567 · UBS Vila Verde" })).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/null/);
  });

  it("identidade atualizada no posto vira marca; nulos viram —", async () => {
    mocked(api.listRegistryStatus).mockResolvedValue({ people: [
      personRow({ identity_review_pending: true }),
      personRow({ patient_id: "pa5", display_name: null, age: null, micro_area_code: null, registered_at: null })
    ], next_before: null });
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    expect(await screen.findByText(IDENTITY_REVIEW_TEXT)).not.toBeNull();
    expect(screen.getByText("pessoa sem nome no cadastro")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Atualizar pessoa sem nome no cadastro" })).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null|NaN/);
  });

  it("sem cadastro e fora de domicílio: a ficha vai com a equipe (team_id), avisa e relê a lista e os números", async () => {
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Sem cadastro (44)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa sem nome no cadastro" }));
    const lists = mocked(api.listRegistryStatus).mock.calls.length;
    const counts = mocked(api.countRegistryStatus).mock.calls.length;
    fireEvent.change(screen.getByLabelText("Raça/cor"), { target: { value: "03" } });
    fireEvent.change(screen.getByLabelText("Município de nascimento (código IBGE, 7 dígitos)"), { target: { value: "4106902" } });
    fireEvent.change(screen.getByLabelText("Celular (DDD + número)"), { target: { value: "41999990000" } });
    fireEvent.click(screen.getByLabelText("Não sabe o nome do pai"));
    fireEvent.click(within(screen.getByRole("group", { name: "Quer informar a orientação sexual?" })).getByLabelText("Não"));
    fireEvent.click(within(screen.getByRole("group", { name: "Quer informar a identidade de gênero?" })).getByLabelText("Não"));
    fireEvent.click(screen.getByLabelText("Não está em situação de rua"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    expect(await screen.findByText("Cadastro salvo. Nova versão enviada ao e-SUS.")).not.toBeNull();
    const body = mocked(api.createRegistration).mock.calls[0][0];
    expect(body).toEqual(expect.objectContaining({ citizen_id: "ci4", team_id: "tm1", is_responsible: false }));
    expect(body).not.toHaveProperty("household_id");
    expect(screen.queryByRole("form", { name: "Novo cadastro individual" })).toBeNull();
    await waitFor(() => expect(mocked(api.listRegistryStatus).mock.calls.length).toBe(lists + 1));
    await waitFor(() => expect(mocked(api.countRegistryStatus).mock.calls.length).toBe(counts + 1));
  });

  it("Atualizar → Registrar saída: a ficha fecha, a tela avisa a saída e relê a lista", async () => {
    mocked(api.exitRegistration).mockResolvedValue(registration({ id: "rg3", status: "exited" }));
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Atualizar Joaquim Ribeiro" }));
    await screen.findByRole("button", { name: "Salvar cadastro" });
    fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
    fireEvent.click(screen.getByLabelText("óbito"));
    fireEvent.change(screen.getByLabelText("Data da saída"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("Data do óbito"), { target: { value: "2026-10-19" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(await screen.findByText("Saída registrada. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Salvar cadastro" })).toBeNull();
    await waitFor(() => expect(api.listRegistryStatus).toHaveBeenCalledTimes(2));
  });

  it("Carregar mais segue o next_before", async () => {
    mocked(api.listRegistryStatus)
      .mockResolvedValueOnce({ people: [ personRow() ], next_before: "patient:00000000-0000-0000-0000-0000000000a3" })
      .mockResolvedValueOnce({ people: [ personRow({ patient_id: "pa6", display_name: "Rosa Lima" }) ], next_before: null });
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Rosa Lima")).not.toBeNull();
    expect(api.listRegistryStatus).toHaveBeenLastCalledWith({ teamId: "tm1", microAreaId: undefined, status: "expired",
      before: "patient:00000000-0000-0000-0000-0000000000a3" });
    expect(screen.getByText("Joaquim Ribeiro")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("recusa do api vira frase", async () => {
    mocked(api.listRegistryStatus).mockRejectedValue(new api.ApiError(403, { error: "out_of_scope" }, "403"));
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    expect(await screen.findByText("esta microárea não é da sua equipe")).not.toBeNull();
  });

  it("volta à aba e passa o tempo: a lista não relê; os contadores usam COUNT_QUERY", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    await screen.findByText("Joaquim Ribeiro");
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000); });
    expect(api.listRegistryStatus).toHaveBeenCalledTimes(1);
    expect(mocked(api.countRegistryStatus).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(COUNT_QUERY.refetchInterval).toBe(60_000);
  });

  it("só profissional de saúde: a gestão não lê nada; interruptor desligado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "municipal_admin" ]));
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    expect(await screen.findByText(TERRITORY_NO_ROLE)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "health_professional" ], { features: [ "clinical_record" ] }));
    renderWithProviders(<RegistryStatus today={TODAY24} />);
    expect(await screen.findByText(TERRITORY_DISABLED)).not.toBeNull();
    expect(api.getTerritoryContext).not.toHaveBeenCalled();
    expect(api.listRegistryStatus).not.toHaveBeenCalled();
    expect(api.countRegistryStatus).not.toHaveBeenCalled();
  });
});
