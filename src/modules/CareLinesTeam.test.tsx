// src/modules/CareLinesTeam.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getCareContext: vi.fn(), listCareEnrollments: vi.fn(), countOverdueEnrollments: vi.fn(),
    countCareSuggestions: vi.fn(), listCareSuggestions: vi.fn(), getCareEnrollment: vi.fn(), lookupCarePerson: vi.fn()
  };
});

import * as api from "../lib/api";
import { CareLinesTeam } from "./CareLinesTeam";
import { CARE_NO_ROLE, UNTRACKED_TEXT } from "../lib/careLines";
import { renderWithProviders } from "../test/campaignFixtures";
import { TEAM_A, TEAM_B, TODAY23, careContext, careUser, enrollment, suggestion } from "../test/careLineFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getCareContext, api.listCareEnrollments, api.countOverdueEnrollments,
    api.countCareSuggestions, api.listCareSuggestions, api.getCareEnrollment ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(careUser());
  mocked(api.getCareContext).mockResolvedValue(careContext());
  mocked(api.listCareEnrollments).mockResolvedValue({ enrollments: [ enrollment() ], next_before: null });
  mocked(api.countOverdueEnrollments).mockResolvedValue(12);
  mocked(api.countCareSuggestions).mockResolvedValue(3);
  mocked(api.listCareSuggestions).mockResolvedValue({ suggestions: [], next_before: null });
  mocked(api.getCareEnrollment).mockResolvedValue(enrollment());
});

const NAME = "Maria das Dores · 58 anos";
const itemOf = (label: string) => screen.getByText(label, { selector: "strong" }).closest("li") as HTMLElement;

describe("CareLinesTeam — painel nominal", () => {
  it("abre na busca ativa da primeira equipe; situação da pessoa e de cada boa prática", async () => {
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    expect(await screen.findByText(NAME)).not.toBeNull();
    expect(api.listCareEnrollments).toHaveBeenCalledTimes(1);
    expect(api.listCareEnrollments).toHaveBeenCalledWith({ teamId: "tm1", careLineId: undefined, status: "overdue", before: null });
    expect(itemOf("Hemoglobina glicada").textContent).toBe("Hemoglobina glicada: vencida · última em 20/08/2025 · venceu em 20/08/2026");
    expect(itemOf("Peso e altura").textContent).toBe("Peso e altura: vence em até 30 dias · última em 12/11/2025 · vence em 12/11/2026");
    expect(screen.getByText("vencida")).not.toBeNull();
    expect(screen.getByText("nenhum")).not.toBeNull();
  });

  it("visita do ACS aparece como não acompanhada, em tom neutro", async () => {
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    await screen.findByText(NAME);
    const acs = itemOf("Visita do ACS");
    expect(acs.textContent).toBe(`Visita do ACS: ${UNTRACKED_TEXT}`);
    expect((acs.querySelector("span") as HTMLElement).style.color).toBe("var(--ink3)");
    expect(acs.textContent).not.toMatch(/vencida/);
  });

  it("troca de equipe, linha e aba relê com os filtros; contador na aba", async () => {
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    await screen.findByText(NAME);
    expect(await screen.findByRole("button", { name: "Busca ativa (12)" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Equipe"), { target: { value: "tm2" } });
    await waitFor(() => expect(api.listCareEnrollments).toHaveBeenLastCalledWith({ teamId: "tm2", careLineId: undefined, status: "overdue", before: null }));
    await waitFor(() => expect(api.countOverdueEnrollments).toHaveBeenCalledWith("tm2"));
    fireEvent.change(screen.getByLabelText("Linha"), { target: { value: "cl3" } });
    await waitFor(() => expect(api.listCareEnrollments).toHaveBeenLastCalledWith({ teamId: "tm2", careLineId: "cl3", status: "overdue", before: null }));
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    await waitFor(() => expect(api.listCareEnrollments).toHaveBeenLastCalledWith({ teamId: "tm2", careLineId: "cl3", status: "all", before: null }));
    expect(screen.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("volta à aba e passa o tempo: a lista não relê; os contadores usam COUNT_QUERY", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    await screen.findByText(NAME);
    await act(async () => {
      focusManager.setFocused(false); focusManager.setFocused(true);
      onlineManager.setOnline(false); onlineManager.setOnline(true);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
    expect(api.listCareEnrollments).toHaveBeenCalledTimes(1);
    expect(mocked(api.countOverdueEnrollments).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("Carregar mais pede a próxima página pelo cursor e não relê as anteriores", async () => {
    mocked(api.listCareEnrollments)
      .mockResolvedValueOnce({ enrollments: [ enrollment() ], next_before: "c2" })
      .mockResolvedValueOnce({ enrollments: [ enrollment({ id: "en2", person: { patient_id: "pa9", citizen_id: null, display_name: "Rosa Lima", age: 71 } }) ], next_before: null });
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    await screen.findByText(NAME);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Rosa Lima · 71 anos")).not.toBeNull();
    expect(api.listCareEnrollments).toHaveBeenLastCalledWith({ teamId: "tm1", careLineId: undefined, status: "overdue", before: "c2" });
    expect(api.listCareEnrollments).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("página curta com next_before (L6): diz que há mais e só carrega no clique, sem laço", async () => {
    mocked(api.listCareEnrollments)
      .mockResolvedValueOnce({ enrollments: [], next_before: "c5" })
      .mockResolvedValueOnce({ enrollments: [ enrollment() ], next_before: null });
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    expect(await screen.findByText("Nada nesta parte da lista; carregue mais para continuar a busca.")).not.toBeNull();
    expect(screen.queryByText("ninguém nesta lista")).toBeNull();
    expect(api.listCareEnrollments).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText(NAME)).not.toBeNull();
    expect(api.listCareEnrollments).toHaveBeenLastCalledWith({ teamId: "tm1", careLineId: undefined, status: "overdue", before: "c5" });
  });

  it("sem equipe com vínculo: diz isso e não lê lista nem contador", async () => {
    mocked(api.getCareContext).mockResolvedValue(careContext({ teams: [] }));
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    expect(await screen.findByText("você não está em nenhuma equipe com vínculo ativo na unidade")).not.toBeNull();
    expect(api.listCareEnrollments).not.toHaveBeenCalled();
    expect(api.countOverdueEnrollments).not.toHaveBeenCalled();
  });

  it("403 out_of_scope vira frase; admin sem papel de profissional não vê o painel", async () => {
    mocked(api.listCareEnrollments).mockRejectedValue(new api.ApiError(403, { error: "out_of_scope" }, "x"));
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    expect((await screen.findByRole("alert")).textContent).toBe("você não tem vínculo ativo na unidade desta equipe");
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "municipal_admin" ]));
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    expect(await screen.findByText(CARE_NO_ROLE)).not.toBeNull();
  });

  it("lista vazia na busca ativa: ninguém para procurar", async () => {
    mocked(api.listCareEnrollments).mockResolvedValue({ enrollments: [], next_before: null });
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    const list = await screen.findByRole("region", { name: "Pessoas da equipe" });
    expect(await within(list).findByText("ninguém nesta lista")).not.toBeNull();
  });

  it("ao entrar na aba Sugestões fecha o detalhe aberto e não relê a lista de inscrições", async () => {
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Maria das Dores" }));
    expect(await screen.findByRole("region", { name: "Inscrição de Maria das Dores" })).not.toBeNull();
    mocked(api.listCareEnrollments).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^Sugestões/ }));
    await screen.findByRole("region", { name: "Sugestões a confirmar" });
    expect(screen.queryByRole("region", { name: "Inscrição de Maria das Dores" })).toBeNull();
    expect(api.listCareEnrollments).toHaveBeenCalledTimes(0);
  });
});

describe("CareLinesTeam — equipes do painel (P22)", () => {
  // Secretário médico: o api devolve todas as equipes, mas só a dele abre o painel nominal.
  const teamsOf = (panels: Record<string, boolean | undefined>) => ({
    ...careContext(), teams: [ TEAM_B, TEAM_A ].map((t) => ({ ...t, panel: panels[t.id] }))
  });
  const optionsOf = (el: HTMLElement) => Array.from((el as HTMLSelectElement).options).map((o) => o.value);

  it("o painel oferece só as equipes com panel: seletor, equipe padrão, inscrição manual e aceite", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "health_professional", "municipal_admin" ]));
    mocked(api.getCareContext).mockResolvedValue(teamsOf({ tm2: false, tm1: true }));
    mocked(api.listCareSuggestions).mockResolvedValue({ suggestions: [ suggestion() ], next_before: null });
    mocked(api.lookupCarePerson).mockResolvedValue({
      patient_id: null, citizen_id: "ci3", display_name: "Benedita Ramos", cpf_masked: "***.982.247-**", verified: true
    });
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    await screen.findByText(NAME);
    expect(optionsOf(screen.getByLabelText("Equipe"))).toEqual([ "tm1" ]);
    expect(api.listCareEnrollments).toHaveBeenCalledWith({ teamId: "tm1", careLineId: undefined, status: "overdue", before: null });
    fireEvent.click(screen.getByRole("button", { name: "Inscrever pessoa" }));
    const manual = screen.getByRole("region", { name: "Inscrever pessoa" });
    fireEvent.change(within(manual).getByLabelText("CPF da pessoa"), { target: { value: "529.982.247-25" } });
    fireEvent.click(within(manual).getByRole("button", { name: "Buscar" }));
    await within(manual).findByText("Benedita Ramos · CPF ***.982.247-**");
    expect(optionsOf(within(manual).getByLabelText("Equipe de referência"))).toEqual([ "tm1" ]);
    fireEvent.click(within(manual).getByRole("button", { name: "Fechar" }));
    fireEvent.click(screen.getByRole("button", { name: /^Sugestões/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Aceitar sugestão de João Batista" }));
    const accept = screen.getByRole("region", { name: "Aceitar João Batista em Pessoa com diabetes" });
    expect(optionsOf(within(accept).getByLabelText("Equipe de referência"))).toEqual([ "tm1" ]);
  });

  it("api sem o campo panel: todas as equipes, como antes", async () => {
    mocked(api.getCareContext).mockResolvedValue(teamsOf({}));
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    await screen.findByText(NAME);
    expect(optionsOf(screen.getByLabelText("Equipe"))).toEqual([ "tm2", "tm1" ]);
  });

  it("nenhuma equipe com panel: estado vazio, sem leitura nominal", async () => {
    mocked(api.getCareContext).mockResolvedValue(teamsOf({ tm2: false, tm1: false }));
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    expect(await screen.findByText("você não está em nenhuma equipe com vínculo ativo na unidade")).not.toBeNull();
    expect(api.listCareEnrollments).not.toHaveBeenCalled();
  });
});
