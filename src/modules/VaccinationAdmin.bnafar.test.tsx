// Módulo 27b (Task 6; F-21): o CNES da rede de frio, pelo PATCH que exige a chave `cnes`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { vacUser, vaccineRoom } from "../test/vaccinationFixtures";
import * as api from "../lib/api";
import { BNAFAR_ERRORS } from "../lib/bnafarErrors";
import { VaccinationAdmin } from "./VaccinationAdmin";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listVaccineRooms: vi.fn(),
  setColdChainCentralCnes: vi.fn(), getVaccinationSettings: vi.fn(), listAllUnits: vi.fn(), listMemberships: vi.fn() }));
const CENTRAL = { id: "l9", name: "Rede de frio municipal", kind: "cold_chain_central", health_unit: null, active: true, staff: [], cnes: null, bnafar_type: null } as never;
const LABEL = "CNES da rede de frio";

beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser([ "municipal_admin" ]));
  vi.mocked(api.listVaccineRooms).mockResolvedValue({ rooms: [ vaccineRoom() ], cold_chain_central: CENTRAL });
  vi.mocked(api.listAllUnits).mockResolvedValue([] as never);
  vi.mocked(api.listMemberships).mockResolvedValue([] as never);
  vi.mocked(api.getVaccinationSettings).mockResolvedValue({ go_live_on: null });
  vi.mocked(api.setColdChainCentralCnes).mockResolvedValue(CENTRAL);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const type = (v: string) => fireEvent.change(screen.getByLabelText(LABEL), { target: { value: v } });

describe("CNES da rede de frio (27b)", () => {
  it("mostra 'sem CNES'; pelo step-up manda { cnes } e relê", async () => {
    renderWithProviders(<VaccinationAdmin />);
    const input = await screen.findByLabelText(LABEL);
    expect(screen.getByText("sem CNES")).not.toBeNull();
    fireEvent.change(input, { target: { value: "1234-567" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar CNES" }));
    expect(api.setColdChainCentralCnes).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar CNES" }));
    await waitFor(() => expect(api.setColdChainCentralCnes).toHaveBeenCalledWith("1234567"));
    await waitFor(() => expect(api.listVaccineRooms).toHaveBeenCalledTimes(2));
  });

  it("vazio manda null (a chave segue no corpo)", async () => {
    vi.mocked(api.listVaccineRooms).mockResolvedValue({ rooms: [], cold_chain_central: { ...(CENTRAL as object), cnes: "1234567" } as never });
    renderWithProviders(<VaccinationAdmin />);
    await screen.findByLabelText(LABEL);
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).value).toBe("1234567");
    type("");
    fireEvent.click(screen.getByRole("button", { name: "Salvar CNES" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar CNES" }));
    await waitFor(() => expect(api.setColdChainCentralCnes).toHaveBeenCalledWith(null));
  });

  it("'123456' é recusado no campo, sem enviar", async () => {
    renderWithProviders(<VaccinationAdmin />);
    await screen.findByLabelText(LABEL);
    type("123456");
    fireEvent.click(screen.getByRole("button", { name: "Salvar CNES" }));
    await waitFor(() => expect(screen.getByLabelText(LABEL).getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("o CNES tem 7 dígitos")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar CNES" })).toBeNull();
    expect(api.setColdChainCentralCnes).not.toHaveBeenCalled();
  });

  it("422 path cnes no campo; 409 cnes_in_use com a frase", async () => {
    vi.mocked(api.setColdChainCentralCnes).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_request", path: "cnes" }, "422"));
    renderWithProviders(<VaccinationAdmin />);
    await screen.findByLabelText(LABEL);
    type("1234567");
    fireEvent.click(screen.getByRole("button", { name: "Salvar CNES" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar CNES" }));
    await waitFor(() => expect(screen.getByLabelText(LABEL).getAttribute("aria-invalid")).toBe("true"));
    cleanup();
    vi.mocked(api.setColdChainCentralCnes).mockRejectedValueOnce(new api.ApiError(409, { error: "cnes_in_use" }, "409"));
    renderWithProviders(<VaccinationAdmin />);
    await screen.findByLabelText(LABEL);
    type("2345678");
    fireEvent.click(screen.getByRole("button", { name: "Salvar CNES" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar CNES" }));
    expect(await screen.findByText(BNAFAR_ERRORS.cnes_in_use)).not.toBeNull();
  });
});
