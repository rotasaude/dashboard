import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  getRiskDeadlines: vi.fn(), updateRiskDeadlines: vi.fn(), listNurseItems: vi.fn(), addNurseItem: vi.fn(), removeNurseItem: vi.fn(),
  searchRegulationTargets: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { RegulationSettings } from "./RegulationSettings";
import { renderWithProviders } from "../test/campaignFixtures";
import { ECO, deadlines, nurseItem, regUser } from "../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("RegulationSettings", () => {
  beforeEach(() => {
    for (const fn of [ api.updateRiskDeadlines, api.addNurseItem, api.removeNurseItem ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "municipal_admin" ]));
    mocked(api.getRiskDeadlines).mockResolvedValue(deadlines());
    mocked(api.listNurseItems).mockResolvedValue([ nurseItem({ target_type: "specialty", target_code: "225275", name: "Ginecologia" }) ]);
    mocked(api.searchRegulationTargets).mockResolvedValue([ ECO ]);
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
    mocked(api.addNurseItem).mockRejectedValue(new ApiError(409, { error: "duplicate_item" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar item" }));
    text("Especialidade ou procedimento", "eco");
    fireEvent.click(await screen.findByRole("button", { name: /0205010032 — Ecocardiografia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("este item já está na lista")).not.toBeNull();
  });
});
