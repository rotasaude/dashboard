import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  getRiskDeadlines: vi.fn(), updateRiskDeadlines: vi.fn(), listNurseItems: vi.fn(), addNurseItem: vi.fn(), removeNurseItem: vi.fn(),
  searchRegulationTargets: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { RegulationSettings } from "./RegulationSettings";
import { renderWithProviders } from "../test/campaignFixtures";
import { CARDIO, ECO, deadlines, nurseItem, regUser } from "../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("RegulationSettings", () => {
  beforeEach(() => {
    for (const fn of [ api.updateRiskDeadlines, api.addNurseItem, api.removeNurseItem, api.getRiskDeadlines, api.listNurseItems, api.searchRegulationTargets ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "municipal_admin" ]));
    mocked(api.getRiskDeadlines).mockResolvedValue(deadlines());
    mocked(api.listNurseItems).mockResolvedValue([ nurseItem({ target_type: "specialty", target_code: "225275", name: "Ginecologia" }) ]);
    mocked(api.searchRegulationTargets).mockImplementation(async (_q: string, type: string) => (type === "procedure" ? [ ECO ] : [ CARDIO ]));
    mocked(api.updateRiskDeadlines).mockImplementation(async (d) => d);
    mocked(api.addNurseItem).mockResolvedValue(nurseItem());
  });

  it("prazos: ordem conferida antes; o corpo com inteiros", async () => {
    renderWithProviders(<RegulationSettings />);
    expect((await screen.findByLabelText("Vermelho (dias)") as HTMLInputElement).value).toBe("7");
    text("Amarelo (dias)", "5");
    fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o prazo do amarelo não pode ser menor que o do vermelho");
    text("Amarelo (dias)", "20");
    fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.updateRiskDeadlines)).toHaveBeenCalledWith({ red: 7, yellow: 20, green: 90, blue: 180 }));
  });

  it("lista do enfermeiro: acrescentar pela busca, retirar pelo tipo e código; duplicado fica na tela", async () => {
    renderWithProviders(<RegulationSettings />);
    expect(await screen.findByRole("row", { name: /Ginecologia/ })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar item" }));
    fireEvent.click(screen.getByLabelText("Procedimento"));
    text("Especialidade ou procedimento", "eco");
    fireEvent.click(await screen.findByRole("button", { name: /0205010032 — Ecocardiografia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.addNurseItem)).toHaveBeenCalledWith({ target_type: "procedure", target_code: "0205010032" }));
    fireEvent.click(within(screen.getByRole("row", { name: /Ginecologia/ })).getByRole("button", { name: "Retirar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.removeNurseItem)).toHaveBeenCalledWith({ target_type: "specialty", target_code: "225275" }));
    expect(mocked(api.searchRegulationTargets)).toHaveBeenCalledWith("eco", "procedure");
    mocked(api.addNurseItem).mockClear();
    mocked(api.addNurseItem).mockRejectedValue(new ApiError(409, { error: "duplicate_item" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar item" }));
    fireEvent.click(screen.getByLabelText("Especialidade"));
    text("Especialidade ou procedimento", "cardio");
    fireEvent.click(await screen.findByRole("button", { name: /225120 — Cardiologia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("este item já está na lista")).not.toBeNull();
    expect(mocked(api.addNurseItem)).toHaveBeenCalledWith({ target_type: "specialty", target_code: "225120" });
  });

  it("invalid_deadlines do api: a frase aparece e os campos ficam como digitados", async () => {
    mocked(api.updateRiskDeadlines).mockRejectedValue(new ApiError(422, { error: "invalid_deadlines" }, "x"));
    renderWithProviders(<RegulationSettings />);
    await screen.findByLabelText("Vermelho (dias)");
    text("Amarelo (dias)", "20");
    fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("o prazo de uma cor menos grave não pode ser menor que o de uma mais grave")).not.toBeNull();
    for (const [ label, value ] of [ [ "Vermelho (dias)", "7" ], [ "Amarelo (dias)", "20" ], [ "Verde (dias)", "90" ], [ "Azul (dias)", "180" ] ]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(value);
    }
  });

  it("retirar: depois do DELETE a lista é relida e o item some", async () => {
    renderWithProviders(<RegulationSettings />);
    fireEvent.click(within(await screen.findByRole("row", { name: /Ginecologia/ })).getByRole("button", { name: "Retirar" }));
    const reads = mocked(api.listNurseItems).mock.calls.length;
    mocked(api.listNurseItems).mockResolvedValue([]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.removeNurseItem)).toHaveBeenCalledWith({ target_type: "specialty", target_code: "225275" }));
    await waitFor(() => expect(mocked(api.listNurseItems).mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(screen.queryByRole("row", { name: /Ginecologia/ })).toBeNull());
    expect(screen.getByText("a lista está vazia: o enfermeiro não pede nada")).not.toBeNull();
  });

  describe("step-up exigido (sem autenticador, aponta para a Segurança)", () => {
    beforeEach(() => {
      mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "municipal_admin" ], { mfa_enrolled: false, mfa_verified_at: null }));
    });

    it("prazos", async () => {
      const onGoToSecurity = vi.fn();
      renderWithProviders(<RegulationSettings onGoToSecurity={onGoToSecurity} />);
      await screen.findByLabelText("Vermelho (dias)");
      fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
      expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
      fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));
      expect(onGoToSecurity).toHaveBeenCalledTimes(1);
      expect(mocked(api.updateRiskDeadlines)).not.toHaveBeenCalled();
    });

    it("acrescentar à lista", async () => {
      const onGoToSecurity = vi.fn();
      renderWithProviders(<RegulationSettings onGoToSecurity={onGoToSecurity} />);
      await screen.findByRole("row", { name: /Ginecologia/ });
      fireEvent.click(screen.getByRole("button", { name: "Acrescentar item" }));
      text("Especialidade ou procedimento", "cardio");
      fireEvent.click(await screen.findByRole("button", { name: /225120 — Cardiologia/ }));
      fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
      expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
      fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));
      expect(onGoToSecurity).toHaveBeenCalledTimes(1);
      expect(mocked(api.addNurseItem)).not.toHaveBeenCalled();
    });

    it("retirar da lista", async () => {
      const onGoToSecurity = vi.fn();
      renderWithProviders(<RegulationSettings onGoToSecurity={onGoToSecurity} />);
      fireEvent.click(within(await screen.findByRole("row", { name: /Ginecologia/ })).getByRole("button", { name: "Retirar" }));
      expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
      fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));
      expect(onGoToSecurity).toHaveBeenCalledTimes(1);
      expect(mocked(api.removeNurseItem)).not.toHaveBeenCalled();
    });
  });
});
