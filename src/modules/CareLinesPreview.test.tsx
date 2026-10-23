// src/modules/CareLinesPreview.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getCareContext: vi.fn(), getCarePreview: vi.fn() };
});

import * as api from "../lib/api";
import { CareLinesPreview } from "./CareLinesPreview";
import { CARE_NO_ROLE, ESTIMATE_NOTICE } from "../lib/careLines";
import { renderWithProviders } from "../test/campaignFixtures";
import { careContext, careUser, preview } from "../test/careLineFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getCareContext, api.getCarePreview ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "analyst" ]));
  mocked(api.getCareContext).mockResolvedValue(careContext({ canConfirm: false }));
  mocked(api.getCarePreview).mockImplementation((_team: string, indicator: string) => Promise.resolve(preview(indicator)));
});

async function calculate() {
  fireEvent.click(await screen.findByRole("button", { name: "Calcular prévia" }));
  await waitFor(() => expect(api.getCarePreview).toHaveBeenCalledTimes(6));
}

describe("CareLinesPreview", () => {
  it("o aviso de estimativa aparece sempre; pontuação com vírgula; fora da conta listado", async () => {
    mocked(api.getCarePreview).mockImplementation((_team: string, indicator: string) =>
      indicator === "C5" ? Promise.reject(new api.ApiError(500, "", "x")) : Promise.resolve(preview(indicator)));
    renderWithProviders(<CareLinesPreview />);
    expect((await screen.findByRole("note", { name: "aviso de estimativa" })).textContent).toBe(ESTIMATE_NOTICE);
    expect(api.getCarePreview).not.toHaveBeenCalled();
    await calculate();
    expect(mocked(api.getCarePreview).mock.calls.map((c) => c[1])).toEqual([ "C2", "C3", "C4", "C5", "C6", "C7" ]);
    expect(mocked(api.getCarePreview).mock.calls.every((c) => c[0] === "tm1")).toBe(true);
    const c4 = await screen.findByRole("region", { name: "C4 — Pessoa com diabetes" });
    expect(await within(c4).findByText("37,5 de 100")).not.toBeNull();
    expect(within(c4).getByText("suficiente")).not.toBeNull();
    expect(within(c4).getByText("41")).not.toBeNull();
    expect(within(c4).getByText("30 de 41")).not.toBeNull();
    expect(within(c4).getByText("25")).not.toBeNull();
    expect(within(c4).getByText("fora da conta — peso redistribuído")).not.toBeNull();
    // C4 só deixa de fora a visita do ACS (P17): o texto vem do indicador, não de uma lista fixa.
    expect(within(c4).getByText("Fora da conta: visita do ACS")).not.toBeNull();
    const c5 = screen.getByRole("region", { name: "C5 — Pessoa com hipertensão" });
    expect((await within(c5).findByRole("alert")).textContent).toBe("não foi possível concluir (500) — tente de novo");
    expect(screen.getByRole("note", { name: "aviso de estimativa" })).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/37\.5|25\.0/);
  });

  it("cada indicador lista as suas famílias fora da conta", async () => {
    mocked(api.getCarePreview).mockImplementation((_team: string, indicator: string) =>
      Promise.resolve(preview(indicator, indicator === "C2" ? { excluded: [ "vaccine", "acs_visit" ] } : {})));
    renderWithProviders(<CareLinesPreview />);
    await calculate();
    const c2 = await screen.findByRole("region", { name: "C2 — Cuidado da criança até 2 anos" });
    expect(await within(c2).findByText("Fora da conta: vacina, visita do ACS")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "C6 — Pessoa idosa" })).getByText("Fora da conta: visita do ACS")).not.toBeNull();
  });

  it("sem pontuação: 'sem dados', nunca 0; prática sem elegível fica fora da conta; a soma dos pesos não aparece", async () => {
    mocked(api.getCarePreview).mockImplementation((_team: string, indicator: string) =>
      Promise.resolve(preview(indicator, {
        score: null, concept: null, denominator: 12,
        practices: [
          { key: "c7_a", label: "Citopatológico em dia", tracked: true, points: 30, weight: "0.0", achieved: 0, denominator: 0 },
          { key: "c7_b", label: "Mamografia", tracked: true, points: 30, weight: "0.0", achieved: 0, denominator: 0 },
          { key: "c7_c", label: "Visitas do ACS", tracked: false, points: 20, weight: "0.0", achieved: 0, denominator: 12 }
        ],
        excluded_practices: [ { key: "c7_a", reason: "no_eligible" }, { key: "c7_b", reason: "no_eligible" }, { key: "c7_c", reason: "untracked" } ]
      })));
    renderWithProviders(<CareLinesPreview />);
    await calculate();
    const c7 = await screen.findByRole("region", { name: "C7 — Prevenção do câncer na mulher" });
    expect(await within(c7).findAllByText("sem dados")).toHaveLength(2); // pontuação e conceito
    expect(within(c7).getAllByText("ninguém elegível ou dentro do prazo")).toHaveLength(2);
    expect(within(c7).getByText("fora da conta — peso redistribuído")).not.toBeNull();
    expect(within(c7).queryByText("0 de 100")).toBeNull();
    expect(within(c7).queryByText("0 de 0")).toBeNull();
    expect(within(c7).queryByText(/soma|total dos pesos/i)).toBeNull();
    expect(screen.getByRole("note", { name: "aviso de estimativa" })).not.toBeNull();
  });

  it("troca de equipe e calcula de novo; nada é lido sem o clique", async () => {
    renderWithProviders(<CareLinesPreview />);
    fireEvent.change(await screen.findByLabelText("Equipe"), { target: { value: "tm2" } });
    expect(api.getCarePreview).not.toHaveBeenCalled();
    await calculate();
    expect(mocked(api.getCarePreview).mock.calls.every((c) => c[0] === "tm2")).toBe(true);
  });

  it("calcular de novo a mesma equipe lê outra vez", async () => {
    renderWithProviders(<CareLinesPreview />);
    await calculate();
    fireEvent.click(screen.getByRole("button", { name: "Calcular prévia" }));
    await waitFor(() => expect(api.getCarePreview).toHaveBeenCalledTimes(12));
  });

  it("recalcular a mesma equipe mostra 'calculando…' enquanto lê, sem perder o resultado anterior", async () => {
    renderWithProviders(<CareLinesPreview />);
    await calculate();
    await waitFor(() => expect(screen.queryAllByText("calculando…")).toHaveLength(0));
    const releases: (() => void)[] = [];
    mocked(api.getCarePreview).mockImplementation((_team: string, indicator: string) =>
      new Promise((resolve) => { releases.push(() => resolve(preview(indicator))); }));
    fireEvent.click(screen.getByRole("button", { name: "Calcular prévia" }));
    expect(await screen.findAllByText("calculando…")).toHaveLength(6);
    expect(screen.getAllByText("Pontuação estimada").length).toBeGreaterThan(0);
    await waitFor(() => expect(releases).toHaveLength(6));
    releases.forEach((release) => release());
    await waitFor(() => expect(screen.queryAllByText("calculando…")).toHaveLength(0));
  });

  it("equipe sem elegíveis: diz que não há população elegível", async () => {
    mocked(api.getCarePreview).mockImplementation((_team: string, indicator: string) =>
      Promise.resolve(preview(indicator, { denominator: 0, score: null, concept: null, practices: [], excluded_practices: [] })));
    renderWithProviders(<CareLinesPreview />);
    fireEvent.click(await screen.findByRole("button", { name: "Calcular prévia" }));
    const c2 = await screen.findByRole("region", { name: "C2 — Cuidado da criança até 2 anos" });
    expect(await within(c2).findByText("nenhuma pessoa elegível nesta equipe")).not.toBeNull();
  });

  it("catálogo não carregado (503) e papel recusado (403) viram frase, nunca o código", async () => {
    mocked(api.getCarePreview).mockImplementation((_team: string, indicator: string) =>
      indicator === "C2" ? Promise.reject(new api.ApiError(503, { error: "catalog_not_loaded" }, "x"))
        : indicator === "C3" ? Promise.reject(new api.ApiError(403, { error: "missing_role" }, "x")) : Promise.resolve(preview(indicator)));
    renderWithProviders(<CareLinesPreview />);
    await calculate();
    const c2 = await screen.findByRole("region", { name: "C2 — Cuidado da criança até 2 anos" });
    expect((await within(c2).findByRole("alert")).textContent).toBe("o catálogo de linhas ainda não foi carregado — fale com o suporte");
    const c3 = screen.getByRole("region", { name: "C3 — Gestante e puérpera" });
    expect((await within(c3).findByRole("alert")).textContent).toBe(CARE_NO_ROLE);
    expect(document.body.textContent).not.toMatch(/catalog_not_loaded|missing_role/);
  });

  it("profissional não vê a prévia; admin vê", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "health_professional" ]));
    renderWithProviders(<CareLinesPreview />);
    expect(await screen.findByText(CARE_NO_ROLE)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "municipal_admin" ]));
    renderWithProviders(<CareLinesPreview />);
    expect(await screen.findByRole("button", { name: "Calcular prévia" })).not.toBeNull();
  });
});
