import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listCeoProfiles: vi.fn(), getCeoGoals: vi.fn(), listDentalTeams: vi.fn(), getDentalIndicators: vi.fn() }));
import * as api from "../lib/api";
import { DentalCeoGoals } from "./DentalCeoGoals";
import { DentalIndicators } from "./DentalIndicators";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY28, ceoGoals, ceoProfile, dentalTeam, dentalUser } from "../test/dentalFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("painéis da saúde bucal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser([ "analyst" ]));
    mocked(api.listCeoProfiles).mockResolvedValue([ ceoProfile() ]);
    mocked(api.getCeoGoals).mockResolvedValue(ceoGoals());
    mocked(api.listDentalTeams).mockResolvedValue([ dentalTeam() ]);
    mocked(api.getDentalIndicators).mockResolvedValue({ b1: { numerator: 17, denominator: 40 }, b2: { numerator: 9, denominator: 17 } });
  });

  it("metas: mês corrente, composição, situação, faltas e risco de suspensão", async () => {
    renderWithProviders(<DentalCeoGoals today={TODAY28} />);
    await waitFor(() => expect(mocked(api.getCeoGoals)).toHaveBeenCalledWith("u9", "2026-10"));
    expect(await screen.findByText("Periodontia")).not.toBeNull();
    expect(screen.getByText("restaurações ≥ 50%: 62,0% · ok")).not.toBeNull();
    expect(screen.getByText("dentes com 3+ raízes ≥ 20%: 10,0% · abaixo")).not.toBeNull();
    expect(screen.getByText("1 seguida · 2 no total")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Risco de suspensão do incentivo");
    fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "2026-09" } });
    await waitFor(() => expect(mocked(api.getCeoGoals)).toHaveBeenLastCalledWith("u9", "2026-09"));
  });

  it("sem risco: sem alerta; com history: tabela dos últimos 12 meses", async () => {
    mocked(api.getCeoGoals).mockResolvedValue(ceoGoals({ suspension_risk: false,
      history: [ { month: "2026-09", specialties: [ { key: "periodontics", done: 80, met: false }, { key: "basic", done: 120, met: true } ] } ] }));
    renderWithProviders(<DentalCeoGoals today={TODAY28} />);
    expect(await screen.findByText("Últimos 12 meses")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("80 · ✗")).not.toBeNull();
    expect(screen.getByText("120 · ✓")).not.toBeNull();
  });

  it("perfil sem tipo não lê metas", async () => {
    mocked(api.listCeoProfiles).mockResolvedValue([ ceoProfile({ ceo_type: null }) ]);
    renderWithProviders(<DentalCeoGoals today={TODAY28} />);
    expect(await screen.findByText("Defina o tipo do CEO em CEO e lista do TSB/ASB.")).not.toBeNull();
    expect(mocked(api.getCeoGoals)).not.toHaveBeenCalled();
  });

  it("B1 e B2 por equipe, com vírgula decimal e a nota de estimativa", async () => {
    renderWithProviders(<DentalIndicators today={TODAY28} />);
    await waitFor(() => expect(mocked(api.getDentalIndicators)).toHaveBeenCalledWith("t1", "2026-10"));
    expect(await screen.findByText("42,5%")).not.toBeNull();
    expect(screen.getByText("17 de 40 pessoas")).not.toBeNull();
    expect(screen.getByText("52,9%")).not.toBeNull();
    expect(screen.getByText("9 de 17 primeiras consultas")).not.toBeNull();
    expect(screen.getByText("Estimativa — o valor oficial é calculado pelo SIAPS.")).not.toBeNull();
  });

  it("denominador nulo: traço e aviso; sem equipe: mensagem", async () => {
    mocked(api.getDentalIndicators).mockResolvedValue({ b1: { numerator: 0, denominator: null }, b2: { numerator: 0, denominator: null } });
    renderWithProviders(<DentalIndicators today={TODAY28} />);
    expect((await screen.findAllByText("a eSB não tem equipe associada")).length).toBe(2);
    cleanup();
    mocked(api.listDentalTeams).mockResolvedValue([]);
    renderWithProviders(<DentalIndicators today={TODAY28} />);
    expect(await screen.findByText("Nenhuma equipe de saúde bucal importada do CNES.")).not.toBeNull();
  });
});
