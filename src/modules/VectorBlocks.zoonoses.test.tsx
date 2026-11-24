// src/modules/VectorBlocks.zoonoses.test.tsx — "Quarteirões e imóveis" numa cidade só com `zoonoses` (módulo 35b, Q8, Q39).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), listPanelNeighborhoods: vi.fn(), listCityBlocks: vi.fn(), listVectorHouseholds: vi.fn(),
    assignHouseholdsBlock: vi.fn(), updateHouseholdProfile: vi.fn(), getVectorDomains: vi.fn(), listVectorMapPoints: vi.fn()
  };
});

import * as api from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { VC_DOMAINS, cityBlock, vcUser, vectorHousehold } from "../test/vectorControlFixtures";
import { zooUser } from "../test/zoonosesFixtures";
import { VectorBlocks } from "./VectorBlocks";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
async function openHouseholds() {
  renderWithProviders(<VectorBlocks />);
  const select = await screen.findByLabelText("Bairro");
  await screen.findByRole("option", { name: "Centro" });
  fireEvent.change(select, { target: { value: "nb1" } });
  fireEvent.click(await screen.findByRole("tab", { name: "Imóveis" }));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of Object.values(api)) if (typeof fn === "function" && "mockReset" in fn) mocked(fn).mockReset();
  mocked(api.listPanelNeighborhoods).mockResolvedValue([ { id: "nb1", name: "Centro", active: true } ]);
  mocked(api.listCityBlocks).mockResolvedValue([ cityBlock() ]);
  mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
  mocked(api.listVectorHouseholds).mockResolvedValue({ items: [ vectorHousehold({ id: "h1", block: null }) ], next_before: null });
});

describe("VectorBlocks só com zoonoses", () => {
  it("Quarteirões e Imóveis, sem Mapa; sem risco nem última visita; domínios do 35a não lidos", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "endemic_coordinator" ]));
    await openHouseholds();
    const table = await screen.findByRole("table", { name: "Imóveis do bairro" });
    expect(screen.queryByRole("tab", { name: "Mapa" })).toBeNull();
    for (const col of [ "Risco", "Última visita trabalhada" ]) expect(within(table).queryByText(col)).toBeNull();
    expect(table.textContent).not.toContain("sem classificação");
    expect(table.textContent).not.toContain("nunca trabalhado");
    expect(api.getVectorDomains).not.toHaveBeenCalled();
  });

  it("vincula o imóvel ao quarteirão: PATCH só com city_block_id, sem chaves de risco", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "endemic_coordinator" ]));
    mocked(api.updateHouseholdProfile).mockResolvedValue(vectorHousehold({ id: "h1" }));
    await openHouseholds();
    fireEvent.click(await screen.findByRole("button", { name: "Editar quarteirão" }));
    expect(screen.queryByLabelText("Risco")).toBeNull();
    fireEvent.change(screen.getByLabelText("Quarteirão do imóvel"), { target: { value: "cb1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await waitFor(() => expect(api.updateHouseholdProfile).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateHouseholdProfile).mock.calls[0]).toEqual([ "h1", { city_block_id: "cb1" } ]);
  });

  it("com vector_control ligado, nada muda: risco, última visita e Mapa", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
    await openHouseholds();
    const table = await screen.findByRole("table", { name: "Imóveis do bairro" });
    expect(within(table).getByText("Risco")).not.toBeNull();
    expect(within(table).getByText("Última visita trabalhada")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Mapa" })).not.toBeNull();
  });
});
