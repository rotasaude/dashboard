import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY30, trUser } from "../test/transportFixtures";
import { TransportPanel, occupancyText30 } from "./TransportPanel";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getTransportDashboard: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const DASH = { month: "2026-11", trips: 42, occupancy_pct: 78, no_shows: "lt5", km: 3150, fuel_cents: 412300, exceptions: "lt5",
  tfd_by_status: { submitted: 6, authorized: "lt5", completed: 12 }, tfd_paid_cents: 98000 };

describe("painel de transporte e TFD", () => {
  it("contagens pequenas como 'menos de 5', nunca somadas; valores em R$", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "municipal_admin" ]));
    vi.mocked(api.getTransportDashboard).mockResolvedValue(DASH as never);
    renderWithProviders(<TransportPanel today={TODAY30} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver painel" }));
    await waitFor(() => expect(api.getTransportDashboard).toHaveBeenCalledWith("2026-11"));
    expect(await screen.findByText("42")).not.toBeNull();
    expect(screen.getAllByText("menos de 5").length).toBe(3);
    expect(screen.getByText("aguardando a comissão")).not.toBeNull();
    expect(screen.queryByText(/Total de processos/)).toBeNull();
    expect(screen.getByText(/R\$\s4\.123,00/)).not.toBeNull();
  });
  it("milhar com ponto em contagens e km; mês por extenso (C2)", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "municipal_admin" ]));
    vi.mocked(api.getTransportDashboard).mockResolvedValue({ ...DASH, trips: 1234 } as never);
    renderWithProviders(<TransportPanel today={TODAY30} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver painel" }));
    expect(await screen.findByText("1.234")).not.toBeNull();
    expect(screen.getByText("3.150")).not.toBeNull();
    expect(screen.getByText("Mês: novembro de 2026")).not.toBeNull();
  });
  it("sem TFD ligado, o bloco do TFD some", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "transport_dispatcher" ], [ "sanitary_transport" ]));
    vi.mocked(api.getTransportDashboard).mockResolvedValue(DASH as never);
    renderWithProviders(<TransportPanel today={TODAY30} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver painel" }));
    expect(await screen.findByText("42")).not.toBeNull();
    expect(screen.queryByText("TFD por situação")).toBeNull();
  });
  it("ocupação: número, ou texto próprio quando não há viagem concluída (nunca 'lt5')", () => {
    expect(occupancyText30(80)).toBe("80%");
    expect(occupancyText30(null)).toBe("sem viagens concluídas");
  });
  it("status sem caso vale 0 e status desconhecido aparece cru", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "tfd_committee" ]));
    vi.mocked(api.getTransportDashboard).mockResolvedValue({ ...DASH, occupancy_pct: null, tfd_by_status: { denied: 0, novo_status: 7 } } as never);
    renderWithProviders(<TransportPanel today={TODAY30} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver painel" }));
    expect(await screen.findByText("novo_status")).not.toBeNull();
    expect(screen.getByText("sem viagens concluídas")).not.toBeNull();
    expect(screen.getByText("recusado")).not.toBeNull();
  });
});
