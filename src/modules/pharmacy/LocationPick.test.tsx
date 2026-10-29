import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listMyPharmacyLocations: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { LocationPick, type LocationAllow } from "./LocationPick";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CENTRAL, UBS_FARM, phUser } from "../../test/pharmacyFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

const OTHER = { ...UBS_FARM, id: "l3", name: "Farmácia UBS Xaxim", roles: [] as string[] };
const SECOND = { ...UBS_FARM, id: "l4", name: "Farmácia UBS Boqueirão", roles: [ "pharmacy_assistant" ] };

function pick(allow: LocationAllow) {
  return renderWithProviders(<LocationPick allow={allow}>{(loc) => <p>local {loc.name}</p>}</LocationPick>);
}

describe("LocationPick", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockReset();
  });

  it("um local só: sem seletor, com o conteúdo do local", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    pick((r) => r.pharmacist);
    expect(await screen.findByText("local Farmácia UBS Centro")).not.toBeNull();
    expect(screen.queryByLabelText("Local")).toBeNull();
  });

  it("mostra só os ativos que o allow aceita; ação não oferece local sem papel", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL, OTHER, { ...UBS_FARM, id: "l9", name: "Antiga", active: false, roles: [ "pharmacist" ] } ]);
    pick((r) => r.keeper);
    expect(await screen.findByText("local Almoxarifado Central")).not.toBeNull();
    // só o central tem papel: nem o alheio (roles: []) nem o inativo viram opção
    expect(screen.queryByLabelText("Local")).toBeNull();
    expect(screen.queryByText(/Xaxim/)).toBeNull();
    expect(screen.queryByText(/Antiga/)).toBeNull();
  });

  it("consulta (allow sempre verdadeiro) deixa ver o local alheio do almoxarife do central", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL, OTHER ]);
    pick(() => true);
    await screen.findByText("local Almoxarifado Central");
    const select = screen.getByLabelText("Local") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Almoxarifado Central — Almoxarifado central", "Farmácia UBS Xaxim — Farmácia da unidade" ]);
  });

  it("mais de um local: seletor Local, e trocar remonta o conteúdo", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM, SECOND ]);
    pick((r) => r.pharmacist || r.assistant);
    await screen.findByText("local Farmácia UBS Centro");
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "l4" } });
    expect(screen.getByText("local Farmácia UBS Boqueirão")).not.toBeNull();
    expect(screen.queryByText("local Farmácia UBS Centro")).toBeNull();
  });

  it("o conteúdo recebe o local com os papéis dele", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    renderWithProviders(<LocationPick allow={() => true}>{(loc) => <p>{loc.id}:{loc.roles.join(",")}</p>}</LocationPick>);
    expect(await screen.findByText("l2:pharmacist")).not.toBeNull();
  });

  it("nenhum local que sirva: frase de sem local", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ OTHER ]);
    pick((r) => r.pharmacist);
    expect(await screen.findByText("você não está vinculado a nenhum local de estoque — peça ao administrador da cidade")).not.toBeNull();
  });

  it("lista vazia: frase de sem local", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([]);
    pick(() => true);
    expect(await screen.findByText("você não está vinculado a nenhum local de estoque — peça ao administrador da cidade")).not.toBeNull();
  });

  it("erro do api: frase da farmácia, sem reler sozinho", async () => {
    mocked(api.listMyPharmacyLocations).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "pharmacy" }, "403"));
    pick(() => true);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("a farmácia e o almoxarifado estão desligados nesta cidade"));
    expect(api.listMyPharmacyLocations).toHaveBeenCalledTimes(1);
  });

  it("nada em storage", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM, SECOND ]);
    pick(() => true);
    await screen.findByText("local Farmácia UBS Centro");
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "l4" } });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
