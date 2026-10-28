import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  searchRegulationTargets: vi.fn() }));
import * as api from "../../lib/api";
import { TargetSearch } from "./TargetSearch";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CARDIO, ECO, regUser } from "../../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const type = (value: string) => fireEvent.change(screen.getByLabelText("Especialidade ou procedimento"), { target: { value } });

describe("TargetSearch", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "health_professional" ]));
    mocked(api.searchRegulationTargets).mockReset().mockResolvedValue([ CARDIO, { ...CARDIO, code: "225125", name: "Clínica médica" } ]);
  });

  it("sem CBO não filtra; escolher chama onPick com o alvo e limpa o campo", async () => {
    const onPick = vi.fn();
    renderWithProviders(<TargetSearch type="specialty" cbo={null} delayMs={0} onPick={onPick} />);
    type("cardio");
    expect(await screen.findByRole("button", { name: "225125 — Clínica médica" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "225120 — Cardiologia" }));
    expect(onPick).toHaveBeenCalledWith(CARDIO);
    expect((screen.getByLabelText("Especialidade ou procedimento") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: /Cardiologia/ })).toBeNull();
  });

  it("com CBO de enfermeiro filtra pela lista municipal", async () => {
    mocked(api.searchRegulationTargets).mockResolvedValue([ ECO, { ...ECO, code: "0205010040", name: "Ecografia de abdômen total", nurse_allowed: false } ]);
    renderWithProviders(<TargetSearch type="procedure" cbo="223505" delayMs={0} onPick={vi.fn()} />);
    type("eco");
    expect(await screen.findByRole("button", { name: /Ecocardiografia/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /abdômen/ })).toBeNull();
  });

  it("rótulo próprio, busca sem cache e consulta não repetida sem mudar o termo", async () => {
    renderWithProviders(<TargetSearch type="specialty" label="Alvo da oferta" delayMs={0} onPick={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Alvo da oferta"), { target: { value: "cardio" } });
    await waitFor(() => expect(mocked(api.searchRegulationTargets)).toHaveBeenCalledWith("cardio", "specialty"));
  });

  it("sem resultado e erro do api aparecem sem eco do termo", async () => {
    mocked(api.searchRegulationTargets).mockResolvedValueOnce([]);
    renderWithProviders(<TargetSearch type="specialty" delayMs={0} onPick={vi.fn()} />);
    type("zzzz");
    expect(await screen.findByText("nenhum resultado")).not.toBeNull();
    mocked(api.searchRegulationTargets).mockRejectedValueOnce(new TypeError("fetch"));
    type("yyyy");
    expect((await screen.findByRole("alert")).textContent).toBe("sem conexão com o servidor — tente de novo");
  });
});
