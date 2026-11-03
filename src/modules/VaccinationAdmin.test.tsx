// src/modules/VaccinationAdmin.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { vacUser, vaccineRoom } from "../test/vaccinationFixtures";
import * as api from "../lib/api";
import { VaccinationAdmin } from "./VaccinationAdmin";
import { StaffPanel } from "./pharmacy/StaffPanel";
import { GO_LIVE_RANGE_TEXT, goLiveRange, shiftMonths } from "./vaccination/GoLivePanel";
import { todayInCity } from "../lib/campaigns";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listVaccineRooms: vi.fn(),
  createVaccineRoom: vi.fn(), addRoomStaff: vi.fn(), removeRoomStaff: vi.fn(), createColdChainCentral: vi.fn(), getVaccinationSettings: vi.fn(),
  updateVaccinationSettings: vi.fn(), updateVaccineRoom: vi.fn(), removeLocationStaff: vi.fn(), listAllUnits: vi.fn(), listMemberships: vi.fn(), addLocationStaff: vi.fn() }));
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
    fireEvent.click(await screen.findByRole("button", { name: /Equipe — Sala de vacina UBS Centro/ }));
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

const UNIT_TEXT = "escolha a unidade de saúde da sala";
const NAME_TEXT = "o nome da sala tem de 3 a 120 caracteres";

describe("administração da vacinação — fix round 1", () => {
  it("nome fora de 3 a 120 junto com unidade vazia: as duas recusas de uma vez; 120 passa", async () => {
    renderWithProviders(<VaccinationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova sala" }));
    for (const name of [ "ab", "a".repeat(121) ]) {
      fireEvent.change(screen.getByLabelText("Nome da sala"), { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
      const alertBox = screen.getByRole("alert");
      expect(within(alertBox).getByText(UNIT_TEXT)).not.toBeNull();
      expect(within(alertBox).getByText(NAME_TEXT)).not.toBeNull();
    }
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "u2" } });
    fireEvent.change(screen.getByLabelText("Nome da sala"), { target: { value: "a".repeat(120) } });
    fireEvent.submit(screen.getByLabelText("Nome da sala").closest("form")!);
    expect(await screen.findByRole("button", { name: "Criar sala" })).not.toBeNull();
  });

  it("o foco vai para o primeiro campo ao abrir o formulário e o botão da equipe leva a contagem no nome", async () => {
    renderWithProviders(<VaccinationAdmin />);
    expect(await screen.findByRole("button", { name: "1 pessoa, Equipe — Sala de vacina UBS Centro" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nova sala" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Unidade"));
  });

  it("unit_taken pela frase da sala", async () => {
    vi.mocked(api.createVaccineRoom).mockRejectedValue(refuse("unit_taken"));
    renderWithProviders(<VaccinationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova sala" }));
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "u2" } });
    fireEvent.change(screen.getByLabelText("Nome da sala"), { target: { value: "Sala Norte" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar sala" }));
    expect(await screen.findByText("esta unidade já tem uma sala de vacina")).not.toBeNull();
  });

  it("editar e desativar a sala: unidade travada; location_has_stock pela frase", async () => {
    vi.mocked(api.updateVaccineRoom).mockRejectedValueOnce(refuse("location_has_stock")).mockResolvedValue(vaccineRoom({ active: false }));
    renderWithProviders(<VaccinationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar — Sala de vacina UBS Centro" }));
    expect((screen.getByLabelText("Unidade") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Ativa"));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar sala" }));
    expect(await screen.findByText("a sala ainda tem saldo de vacinas — transfira ou ajuste antes de desativar")).not.toBeNull();
    expect(api.updateVaccineRoom).toHaveBeenCalledWith("r1", { health_unit_id: "u1", name: "Sala de vacina UBS Centro", active: false });
  });

  it("desvincular na sala", async () => {
    vi.mocked(api.removeRoomStaff).mockResolvedValue(undefined);
    renderWithProviders(<VaccinationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: /Equipe — Sala de vacina UBS Centro/ }));
    fireEvent.click(screen.getByRole("button", { name: "Desvincular — Téc. Ana Souza" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar desvínculo" }));
    await waitFor(() => expect(api.removeRoomStaff).toHaveBeenCalledWith("r1", "us1", "vaccinator"));
    await waitFor(() => expect(api.listVaccineRooms).toHaveBeenCalledTimes(2));
  });

  it("vincular repetido: already_linked pela frase", async () => {
    vi.mocked(api.addRoomStaff).mockRejectedValue(refuse("already_linked"));
    renderWithProviders(<VaccinationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: /Equipe — Sala de vacina UBS Centro/ }));
    const staff = screen.getByRole("region", { name: "Equipe da sala" });
    fireEvent.change(within(staff).getByLabelText("Pessoa"), { target: { value: "us7" } });
    fireEvent.submit(within(staff).getByLabelText("Pessoa").closest("form")!);
    fireEvent.click(await screen.findByRole("button", { name: "Vincular à sala" }));
    expect(await screen.findByText("esta pessoa já está na equipe com este papel")).not.toBeNull();
  });

  it("desvincular na rede de frio", async () => {
    vi.mocked(api.removeLocationStaff).mockResolvedValue(undefined as never);
    vi.mocked(api.listVaccineRooms).mockResolvedValue({ rooms: [], cold_chain_central: { ...CENTRAL_ADMIN,
      staff: [ { user_id: "us9", name: "Rita Almox", role: "stock_keeper" } ] } as never });
    renderWithProviders(<VaccinationAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Desvincular Rita Almox" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar desvínculo" }));
    await waitFor(() => expect(api.removeLocationStaff).toHaveBeenCalledWith("l9", "us9", "stock_keeper"));
  });

  it("go-live: fora da faixa recusado no cliente; fronteira aceita; out_of_range do api; limpar envia null", async () => {
    const { min, max } = goLiveRange(todayInCity());
    const day = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    vi.mocked(api.getVaccinationSettings).mockResolvedValue({ go_live_on: "2026-11-01" });
    vi.mocked(api.updateVaccinationSettings).mockRejectedValueOnce(refuse("out_of_range")).mockResolvedValue({ go_live_on: null });
    renderWithProviders(<VaccinationAdmin />);
    const input = await screen.findByLabelText("Início da sala de vacina na cidade");
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("2026-11-01"));
    for (const bad of [ day(min, -1), day(max, 1) ]) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar data" }));
      expect(screen.getByRole("alert").textContent).toBe(GO_LIVE_RANGE_TEXT);
    }
    expect(api.updateVaccinationSettings).not.toHaveBeenCalled();
    for (const ok of [ min, max ]) {
      fireEvent.change(input, { target: { value: ok } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar data" }));
      expect(await screen.findByRole("button", { name: "Salvar" })).not.toBeNull();
      fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" }).at(-1)!);
    }
    fireEvent.click(screen.getByRole("button", { name: "Salvar data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(GO_LIVE_RANGE_TEXT)).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" }).at(-1)!);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.updateVaccinationSettings).toHaveBeenLastCalledWith({ go_live_on: null }));
  });

  it("shiftMonths para no fim do mês", () => {
    expect(shiftMonths("2028-02-29", -24)).toBe("2026-02-28");
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(shiftMonths("2026-11-02", -24)).toBe("2024-11-02");
  });

  it("StaffPanel sem roles oferece os três papéis do 27a", () => {
    renderWithProviders(<StaffPanel location={CENTRAL_ADMIN as never} memberships={[]} onChanged={() => {}} />);
    const role = screen.getByLabelText("Papel no local") as HTMLSelectElement;
    expect([ ...role.options ].map((o) => o.value)).toEqual([ "", "pharmacist", "pharmacy_assistant", "stock_keeper" ]);
  });
});
