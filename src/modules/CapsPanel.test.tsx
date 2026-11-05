// Painel do CAPS (F-31.8; P52, R6, R7): só contagens; de 1 a 4 chega "lt5" e aparece "menos de 5", nunca calculado; a ocupação só
// com noites e leitos-dia em número. O portão não escolhe CAPS (`unit="none"`): o painel lê os CAPS e oferece "Todos os CAPS".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAPS_AD_III, CAPS_II, MONTH31, TODAY31, psyDashboard, psyUser } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { PSY_NO_ROLE } from "../lib/psychosocial";
import { CapsPanel, occupancyText31 } from "./CapsPanel";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn(), getPsyDashboard: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const DASH = psyDashboard({
  enrollments_active: [
    { health_unit_id: CAPS_II.id, name: CAPS_II.name, caps_modality: "caps_ii", count: 37 },
    { health_unit_id: CAPS_AD_III.id, name: CAPS_AD_III.name, caps_modality: "caps_ad_iii", count: "lt5" }
  ],
  new_in_month: "lt5", care_plans_overdue: 8,
  closed_by_destination: { "01": 6, "02": 0, "03": 0, "04": 0, "05": 0, "06": 0, "07": 0 },
  actions_by_instrument: { raas_psi: 410, bpa_c: 12, bpa_i: "lt5" }, bed_occupancy: { nights: 43, bed_days: 60 },
  raas_month: { open: 30, closed: 7, exported: 0, no_actions: "lt5" }
});

beforeEach(() => {
  vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II, CAPS_AD_III ]);
  vi.mocked(api.getPsyDashboard).mockResolvedValue(DASH);
});

function mount(user = psyUser([ "analyst" ])) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(<CapsPanel today={TODAY31} />);
}

describe("painel do CAPS", () => {
  it("só contagens, com menos de 5; nome do CAPS só na linha por unidade", async () => {
    mount();
    expect(await screen.findByText("37")).not.toBeNull();
    // no seletor e na linha por unidade
    expect(screen.getAllByText("CAPS II Centro · CAPS II").length).toBe(2);
    expect(screen.getAllByText("CAPS AD III Boqueirão · CAPS AD III").length).toBe(2);
    // new_in_month, a linha do AD III, bpa_i e no_actions (de 1 a 4 o api manda "lt5")
    expect(screen.getAllByText("menos de 5").length).toBe(4);
    expect(screen.getByText("Alta")).not.toBeNull();
    expect(screen.getByText("Transferência para outro CAPS")).not.toBeNull();
    expect(screen.getByText("RAAS-PSI")).not.toBeNull();
    expect(screen.getByText("410")).not.toBeNull();
    expect(screen.getByText("72%")).not.toBeNull();
    expect(screen.getByText("remessa gerada")).not.toBeNull();
    expect(screen.getByText("Contagens de 1 a 4 aparecem como “menos de 5”.")).not.toBeNull();
    expect(vi.mocked(api.getPsyDashboard).mock.calls[0][0]).toEqual({ month: MONTH31, unitId: null });
  });

  it("filtro por CAPS e por mês vão na consulta; 'Todos os CAPS' volta ao conjunto", async () => {
    mount(psyUser([ "psychosocial_lead" ]));
    const caps = await screen.findByLabelText("CAPS do painel");
    expect(within(caps).getByRole("option", { name: "Todos os CAPS" })).not.toBeNull();
    fireEvent.change(caps, { target: { value: "caps2" } });
    await waitFor(() => expect(vi.mocked(api.getPsyDashboard).mock.calls.at(-1)?.[0]).toEqual({ month: MONTH31, unitId: "caps2" }));
    fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "2026-10" } });
    await waitFor(() => expect(vi.mocked(api.getPsyDashboard).mock.calls.at(-1)?.[0]).toEqual({ month: "2026-10", unitId: "caps2" }));
    fireEvent.change(screen.getByLabelText("CAPS do painel"), { target: { value: "" } });
    await waitFor(() => expect(vi.mocked(api.getPsyDashboard).mock.calls.at(-1)?.[0]).toEqual({ month: "2026-10", unitId: null }));
    const months = within(screen.getByLabelText("Mês")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(months[0]).toBe(MONTH31);
    expect(months.some((m) => m > MONTH31)).toBe(false);
  });

  it("ocupação: só com dois números; nunca calculada com menos de 5; sem leito-dia, 'sem leitos'", () => {
    expect(occupancyText31({ nights: 43, bed_days: 60 })).toBe("72%");
    expect(occupancyText31({ nights: 0, bed_days: 60 })).toBe("0%");
    expect(occupancyText31({ nights: 0, bed_days: 0 })).toBe("sem leitos");
    expect(occupancyText31({ nights: "lt5", bed_days: 60 })).toBe("não calculada");
    expect(occupancyText31({ nights: 12, bed_days: "lt5" })).toBe("não calculada");
  });

  it("noites em 'lt5': a ocupação não é calculada e as noites aparecem como 'menos de 5'", async () => {
    vi.mocked(api.getPsyDashboard).mockResolvedValue(psyDashboard({ bed_occupancy: { nights: "lt5", bed_days: 60 } }));
    mount();
    expect(await screen.findByText("não calculada")).not.toBeNull();
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(screen.getByText("60")).not.toBeNull();
  });

  it("destino e instrumento desconhecidos aparecem crus", async () => {
    vi.mocked(api.getPsyDashboard).mockResolvedValue(psyDashboard({ closed_by_destination: { "01": 3, "88": 1 },
      actions_by_instrument: { raas_psi: 1, bpa_c: 0, bpa_i: 0, apac: 9 } as never }));
    mount();
    expect(await screen.findByText("88")).not.toBeNull();
    expect(screen.getByText("apac")).not.toBeNull();
  });

  it("recusa do api com frase; quem não é coordenação, gestão ou analista não lê", async () => {
    vi.mocked(api.getPsyDashboard).mockRejectedValue(new api.ApiError(403, { error: "not_on_caps_team" }, "403"));
    mount(psyUser([ "psychosocial_lead" ]));
    expect((await screen.findByRole("alert")).textContent).toContain("você não está lotado neste CAPS");
    cleanup();
    mount(psyUser([ "psychosocial_staff", "billing_clerk" ]));
    expect(await screen.findByText(PSY_NO_ROLE)).not.toBeNull();
    expect(api.getPsyDashboard).toHaveBeenCalledTimes(1);
  });
});
