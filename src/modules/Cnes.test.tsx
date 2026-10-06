// src/modules/Cnes.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getCnes: vi.fn(), applyCnesProposals: vi.fn() };
});

import * as api from "../lib/api";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { cnesFixture, proposal } from "../test/recordModeFixtures";
import { Cnes } from "./Cnes";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const confirmButton = (n: number) => screen.getByRole("button", { name: `Confirmar selecionadas (${n})` }) as HTMLButtonElement;

describe("CNES (módulo 16)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.getCnes, api.applyCnesProposals ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ]));
    m(api.getCnes).mockResolvedValue(cnesFixture());
  });

  it("sem retrato importado: explica quem importa e não mostra listas", async () => {
    m(api.getCnes).mockResolvedValue(cnesFixture({ snapshot: null, proposals: [], divergences: [] }));
    renderWithProviders(<Cnes />);
    expect(await screen.findByText("nenhum retrato do CNES importado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Confirmar selecionadas/ })).toBeNull();
  });

  it("mostra retrato, os dois lados mascarados e as divergências", async () => {
    renderWithProviders(<Cnes />);
    expect(await screen.findByText("09/2026")).not.toBeNull();
    expect(screen.getByText("UBS CENTRO · CNES 2384299")).not.toBeNull();
    expect(screen.getByText("ANA SOUZA · INE 0001234567 · CBO 225142 · CPF ***.982.247-** · CNS 7** **** **** 1234")).not.toBeNull();
    expect(screen.getByText("— (não existe no cadastro)")).not.toBeNull();
    expect(screen.getByText("provável — confira")).not.toBeNull();
    expect(screen.getByText("CBO diferente do CNES")).not.toBeNull();
    expect(screen.getByText("profissional · Bruno Lima")).not.toBeNull();
    expect(screen.getByText("CBO local 225125, CNES 225142")).not.toBeNull();
  });

  it("nada é aplicado sem confirmar: botão travado, seleção, step-up e releitura", async () => {
    m(api.applyCnesProposals).mockResolvedValue({ applied: 2, skipped: [] });
    renderWithProviders(<Cnes />);
    await screen.findByText("UBS CENTRO · CNES 2384299");
    expect(confirmButton(0).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Selecionar todas"));
    fireEvent.click(confirmButton(2));
    expect(screen.getByText(/2 propostas serão aplicadas ao cadastro da cidade/)).not.toBeNull();
    expect(api.applyCnesProposals).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(api.applyCnesProposals).toHaveBeenCalledWith([ "p1", "p2" ]));
    expect(await screen.findByText("2 propostas aplicadas.")).not.toBeNull();
    await waitFor(() => expect(api.getCnes).toHaveBeenCalledTimes(2));
  });

  it("proposta que mudou é pulada e dita; a seleção volta a zero", async () => {
    m(api.applyCnesProposals).mockResolvedValue({ applied: 0, skipped: [ { id: "p1", reason: "stale" } ] });
    renderWithProviders(<Cnes />);
    fireEvent.click(await screen.findByLabelText("Selecionar: UBS CENTRO · CNES 2384299"));
    m(api.getCnes).mockResolvedValue(cnesFixture({ proposals: [ proposal({ id: "p3", cnes: { name: "UBS CENTRO", cnes: "2384299" } }) ] }));
    fireEvent.click(confirmButton(1));
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(api.applyCnesProposals).toHaveBeenCalledWith([ "p1" ]));
    expect(await screen.findByText("Nenhuma proposta aplicada; 1 pulada porque mudou desde a leitura — confira a lista de novo.")).not.toBeNull();
    await waitFor(() => expect(confirmButton(0).disabled).toBe(true));
  });

  it("cancelar não aplica nada e mantém a seleção", async () => {
    renderWithProviders(<Cnes />);
    fireEvent.click(await screen.findByLabelText("Selecionar: UBS CENTRO · CNES 2384299"));
    fireEvent.click(confirmButton(1));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(api.applyCnesProposals).not.toHaveBeenCalled();
    expect(confirmButton(1).disabled).toBe(false);
  });

  it("sem municipal_admin: não chama a API", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "analyst" ]));
    renderWithProviders(<Cnes />);
    expect(await screen.findByText("seu papel não permite ver o CNES")).not.toBeNull();
    expect(api.getCnes).not.toHaveBeenCalled();
  });

  it("seleção inválida (422 invalid_proposals) é dita com a frase da tela", async () => {
    m(api.applyCnesProposals).mockRejectedValue(new api.ApiError(422, { error: "invalid_proposals" }, "422"));
    renderWithProviders(<Cnes />);
    fireEvent.click(await screen.findByLabelText("Selecionar: UBS CENTRO · CNES 2384299"));
    fireEvent.click(confirmButton(1));
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));
    expect(await screen.findByText(/seleção inválida — recarregue a lista e selecione de novo/)).not.toBeNull();
  });
});
