// src/modules/VaccinationAdmin.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { vacUser, vaccineRoom } from "../test/vaccinationFixtures";
import * as api from "../lib/api";
import { VaccinationAdmin } from "./VaccinationAdmin";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listVaccineRooms: vi.fn(),
  createVaccineRoom: vi.fn(), addRoomStaff: vi.fn(), removeRoomStaff: vi.fn(), createColdChainCentral: vi.fn(), getVaccinationSettings: vi.fn(),
  updateVaccinationSettings: vi.fn(), listAllUnits: vi.fn(), listMemberships: vi.fn(), addLocationStaff: vi.fn() }));
const refuse = (error: string) => new api.ApiError(422, { error }, "422");
const CENTRAL_ADMIN = { id: "l9", name: "Rede de frio municipal", kind: "cold_chain_central", health_unit: null, active: true, staff: [] };

beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser([ "municipal_admin" ]));
  vi.mocked(api.listVaccineRooms).mockResolvedValue({ rooms: [ vaccineRoom() ], cold_chain_central: null });
  vi.mocked(api.listAllUnits).mockResolvedValue([ { id: "u1", name: "UBS Centro", active: true }, { id: "u2", name: "UBS Norte", active: true } ] as never);
  vi.mocked(api.listMemberships).mockResolvedValue([
    { id: "m1", user: { id: "us7", email_address: "enf.bia@curitiba.demo" }, role: "health_professional" },
    { id: "m2", user: { id: "us8", email_address: "farm@curitiba.demo" }, role: "pharmacist" } ] as never);
  vi.mocked(api.getVaccinationSettings).mockResolvedValue({ go_live_on: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("administração da vacinação (F-29.1)", () => {
  it("nova sala: só unidade sem sala; step-up; relê", async () => {
    vi.mocked(api.createVaccineRoom).mockResolvedValue(vaccineRoom({ id: "r2", name: "Sala UBS Norte", health_unit: { id: "u2", name: "UBS Norte" } }));
    renderWithProviders(<VaccinationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova sala" }));
    const unit = screen.getByLabelText("Unidade") as HTMLSelectElement;
    expect([ ...unit.options ].map((o) => o.value)).toEqual([ "", "u2" ]);
    fireEvent.change(unit, { target: { value: "u2" } });
    fireEvent.change(screen.getByLabelText("Nome da sala"), { target: { value: "Sala UBS Norte" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar sala" }));
    await waitFor(() => expect(api.createVaccineRoom).toHaveBeenCalledWith({ health_unit_id: "u2", name: "Sala UBS Norte", active: true }));
    await waitFor(() => expect(api.listVaccineRooms).toHaveBeenCalledTimes(2));
  });

  it("equipe: só profissional de saúde; recusa do CBO pela frase", async () => {
    vi.mocked(api.addRoomStaff).mockRejectedValue(refuse("room_lead_requires_nurse"));
    renderWithProviders(<VaccinationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Equipe — Sala de vacina UBS Centro" }));
    const staff = screen.getByRole("region", { name: "Equipe da sala" });
    fireEvent.change(within(staff).getByLabelText("Papel na sala"), { target: { value: "room_lead" } });
    const person = within(staff).getByLabelText("Pessoa") as HTMLSelectElement;
    expect([ ...person.options ].map((o) => o.textContent)).toEqual([ "escolha…", "enf.bia@curitiba.demo" ]);
    fireEvent.change(person, { target: { value: "us7" } });
    fireEvent.click(within(staff).getByRole("button", { name: "Vincular" }));
    fireEvent.click(await screen.findByRole("button", { name: "Vincular à sala" }));
    expect(await screen.findByText("o responsável pela sala precisa ser enfermeiro (CBO 2235)")).not.toBeNull();
  });

  it("rede de frio: cria uma vez; depois mostra a equipe só com almoxarife", async () => {
    vi.mocked(api.createColdChainCentral).mockRejectedValueOnce(new api.ApiError(409, { error: "already_exists" }, "409"));
    renderWithProviders(<VaccinationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Criar a rede de frio" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar" }));
    expect(await screen.findByText("a rede de frio da cidade já existe")).not.toBeNull();
    cleanup();
    vi.mocked(api.listVaccineRooms).mockResolvedValue({ rooms: [], cold_chain_central: CENTRAL_ADMIN as never });
    renderWithProviders(<VaccinationAdmin />);
    const role = await screen.findByLabelText("Papel no local") as HTMLSelectElement;
    expect([ ...role.options ].map((o) => o.value)).toEqual([ "", "stock_keeper" ]);
  });

  it("go-live: data com step-up e a explicação", async () => {
    vi.mocked(api.updateVaccinationSettings).mockResolvedValue({ go_live_on: "2026-12-01" });
    renderWithProviders(<VaccinationAdmin />);
    expect(await screen.findByText("Quem nasceu a partir desta data já tem a caderneta conferida desde o nascimento.")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Início da sala de vacina na cidade"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.updateVaccinationSettings).toHaveBeenCalledWith({ go_live_on: "2026-12-01" }));
  });
});
