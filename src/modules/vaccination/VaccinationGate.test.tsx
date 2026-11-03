import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { COLD_CENTRAL, LEAD_ROOM, ROOM, vacUser } from "../../test/vaccinationFixtures";
import * as api from "../../lib/api";
import { VaccinationGate } from "./VaccinationGate";
import { VaccineLocationPick } from "./VaccineLocationPick";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listMyVaccineLocations: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(user = vacUser(), allow: (a: { vaccinate: boolean }) => boolean = () => true) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(
    <VaccinationGate title="Sala de vacina" sub="caderneta e dose" allow={(r) => r.professional}>
      {() => <VaccineLocationPick allow={allow}>{(loc) => <p>{`dentro de ${loc.name}`}</p>}</VaccineLocationPick>}
    </VaccinationGate>);
}

describe("portão e local da vacinação", () => {
  it("interruptor desligado: frase, sem ler locais", async () => {
    mount(vacUser([ "health_professional" ], { features: [ "clinical_record" ] }));
    expect(await screen.findByText("a sala de vacina está desligada nesta cidade")).not.toBeNull();
    expect(api.listMyVaccineLocations).not.toHaveBeenCalled();
  });
  it("papel errado: frase", async () => {
    mount(vacUser([ "citizen_verifier" ]));
    expect(await screen.findByText("seu papel não permite usar a sala de vacina")).not.toBeNull();
  });
  it("sem local: frase; com dois, seletor e troca remonta", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValueOnce([]);
    mount();
    expect(await screen.findByText(/não está na equipe de nenhuma sala/)).not.toBeNull();
    cleanup();
    vi.mocked(api.listMyVaccineLocations).mockResolvedValueOnce([ ROOM, { ...LEAD_ROOM, id: "l6", name: "Sala UBS Norte", room_id: "r2" }, COLD_CENTRAL ]);
    mount(vacUser(), (a: { vaccinate: boolean }) => a.vaccinate);
    expect(await screen.findByText("dentro de Sala de vacina UBS Centro")).not.toBeNull();
    const select = screen.getByLabelText("Local") as HTMLSelectElement;
    expect([ ...select.options ].map((o) => o.textContent)).toEqual([ "Sala de vacina UBS Centro — Sala de vacina", "Sala UBS Norte — Sala de vacina" ]);
    fireEvent.change(select, { target: { value: "l6" } });
    await waitFor(() => expect(screen.getByText("dentro de Sala UBS Norte")).not.toBeNull());
  });
});
