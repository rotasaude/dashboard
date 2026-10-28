import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listWeeklyNegatives: vi.fn(), recordWeeklyNegative: vi.fn() };
});
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { SurveillanceNegatives } from "./SurveillanceNegatives";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY25, negatives, survUser } from "../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("SurveillanceNegatives", () => {
  beforeEach(() => {
    for (const fn of [ api.listWeeklyNegatives, api.recordWeeklyNegative ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser());
    mocked(api.listWeeklyNegatives).mockImplementation(async (week: string) => negatives({ week }));
    mocked(api.recordWeeklyNegative).mockResolvedValue(undefined);
  });

  it("abre na semana anterior; registra a negativa da unidade pendente e relê", async () => {
    renderWithProviders(<SurveillanceNegatives today={TODAY25} />);
    expect(await screen.findByText("semana 42/2026 (18/10 a 24/10)")).not.toBeNull();
    expect(mocked(api.listWeeklyNegatives).mock.calls[0][0]).toBe("2026-42");
    const vila = screen.getByRole("row", { name: /UBS Vila Verde/ });
    expect(within(vila).getByText("pendente")).not.toBeNull();
    expect(within(screen.getByRole("row", { name: /UBS Centro/ })).queryByRole("button", { name: "Registrar negativa" })).toBeNull();
    fireEvent.click(within(vila).getByRole("button", { name: "Registrar negativa" }));
    await waitFor(() => expect(mocked(api.recordWeeklyNegative).mock.calls[0]).toEqual([ "u2", "2026-42" ]));
    await waitFor(() => expect(mocked(api.listWeeklyNegatives)).toHaveBeenCalledTimes(2));
    expect((screen.getByRole("button", { name: "Semana seguinte" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("na semana 2026-01, a anterior é 2025-53 e a negativa vai com ela", async () => {
    renderWithProviders(<SurveillanceNegatives today="2026-01-06" />);
    await screen.findByText(/semana 53\/2025/);
    fireEvent.click(within(screen.getByRole("row", { name: /UBS Vila Verde/ })).getByRole("button", { name: "Registrar negativa" }));
    await waitFor(() => expect(mocked(api.recordWeeklyNegative).mock.calls[0]).toEqual([ "u2", "2025-53" ]));
  });

  it("semana em curso digitada é recusada antes de ler; 409 da unidade com casos vira frase", async () => {
    mocked(api.recordWeeklyNegative).mockRejectedValue(new ApiError(409, { error: "unit_has_notifications" }, "x"));
    renderWithProviders(<SurveillanceNegatives today={TODAY25} />);
    await screen.findByText(/semana 42\/2026/);
    fireEvent.change(screen.getByLabelText("Semana (AAAA-SS)"), { target: { value: "2026-43" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver semana" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a semana ainda não terminou");
    expect(mocked(api.listWeeklyNegatives)).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Semana (AAAA-SS)"), { target: { value: "2026-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver semana" }));
    fireEvent.click(within(await screen.findByRole("row", { name: /UBS Vila Verde/ })).getByRole("button", { name: "Registrar negativa" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a unidade tem notificação nesta semana; a negativa não cabe");
  });

  it("Semana anterior lê a semana de antes; a Semana seguinte volta e a unidade com negativa não oferece o botão", async () => {
    mocked(api.listWeeklyNegatives).mockImplementation(async (week: string) =>
      negatives({ week, units: [ { unit: { id: "u2", cnes: "2384302", name: "UBS Vila Verde" }, status: "negative" } ] }));
    renderWithProviders(<SurveillanceNegatives today={TODAY25} />);
    await screen.findByText(/semana 42\/2026/);
    expect(within(screen.getByRole("row", { name: /UBS Vila Verde/ })).getByText("negativa registrada")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar negativa" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Semana anterior" }));
    await screen.findByText(/semana 41\/2026/);
    expect(mocked(api.listWeeklyNegatives).mock.calls[1][0]).toBe("2026-41");
    const next = screen.getByRole("button", { name: "Semana seguinte" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    await screen.findByText(/semana 42\/2026/);
  });

  it("already_recorded vira frase e relê; sem unidade notificadora, a tela diz", async () => {
    mocked(api.recordWeeklyNegative).mockRejectedValue(new ApiError(409, { error: "already_recorded" }, "x"));
    renderWithProviders(<SurveillanceNegatives today={TODAY25} />);
    fireEvent.click(within(await screen.findByRole("row", { name: /UBS Vila Verde/ })).getByRole("button", { name: "Registrar negativa" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a negativa desta unidade e semana já foi registrada");
    await waitFor(() => expect(mocked(api.listWeeklyNegatives)).toHaveBeenCalledTimes(2));
    cleanup();
    mocked(api.listWeeklyNegatives).mockResolvedValue(negatives({ units: [] }));
    renderWithProviders(<SurveillanceNegatives today={TODAY25} />);
    expect(await screen.findByText("nenhuma unidade notificadora cadastrada")).not.toBeNull();
  });

  it("unidade que deixou de ser notificadora: invalid_unit vira a frase da negativa", async () => {
    mocked(api.recordWeeklyNegative).mockRejectedValue(new ApiError(422, { error: "invalid_unit" }, "x"));
    renderWithProviders(<SurveillanceNegatives today={TODAY25} />);
    fireEvent.click(within(await screen.findByRole("row", { name: /UBS Vila Verde/ })).getByRole("button", { name: "Registrar negativa" }));
    expect((await screen.findByRole("alert")).textContent).toBe("unidade inexistente, inativa ou não notificadora");
  });

  it("papel sem vigilância não lê nada", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser([ "analyst" ]));
    renderWithProviders(<SurveillanceNegatives today={TODAY25} />);
    expect(await screen.findByText("seu papel não permite usar a vigilância epidemiológica")).not.toBeNull();
    expect(mocked(api.listWeeklyNegatives)).not.toHaveBeenCalled();
  });
});
