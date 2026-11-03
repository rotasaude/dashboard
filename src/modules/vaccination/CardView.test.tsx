// src/modules/vaccination/CardView.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CATALOG29, NOW29, ROOM, card, cardItem, cardPatient, immunization, vacUser } from "../../test/vaccinationFixtures";
import * as api from "../../lib/api";
import { VaccinationRoom } from "../VaccinationRoom";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listMyVaccineLocations: vi.fn(),
  getVaccinationCatalog: vi.fn(), lookupVaccinationPerson: vi.fn(), findVaccinationDuplicates: vi.fn(), getVaccinationCard: vi.fn(),
  confirmCardComplete: vi.fn() }));
beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
  vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
  vi.mocked(api.getVaccinationCatalog).mockResolvedValue(CATALOG29);
  vi.mocked(api.lookupVaccinationPerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null,
    has_cpf: true, cns_masked: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });

async function openCard() {
  renderWithProviders(<VaccinationRoom now={NOW29} />);
  fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "123.456.789-09" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
  fireEvent.click(await screen.findByRole("button", { name: "Abrir a caderneta de Joana Lima" }));
}

describe("caderneta na sala (F-29.2)", () => {
  it("abre pela busca, uma leitura só, foco no nome; blocos e ação de registrar", async () => {
    vi.mocked(api.getVaccinationCard).mockResolvedValue(card());
    await openCard();
    const title = await screen.findByRole("heading", { name: "Joana Lima" });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(api.getVaccinationCard).toHaveBeenCalledTimes(1);
    expect(api.getVaccinationCard).toHaveBeenCalledWith("r1", { patient_id: "pa1" });
    expect(screen.getByText("nasceu depois do início — conferida desde o nascimento")).not.toBeNull();
    const today = screen.getByRole("region", { name: "Devidas hoje" });
    expect(within(today).getByRole("button", { name: "Registrar Penta (DTP/HepB/Hib) — 2ª dose" })).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "Próximas" })).getByText("3ª dose")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "Doses registradas" })).getByText("PNT2611")).not.toBeNull();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).toBe("{}");
  });

  it("caderneta não conferida nunca mostra atraso; confirmar completa relê", async () => {
    vi.mocked(api.getVaccinationCard).mockResolvedValue(card({ checked: null, items: [ cardItem({ status: "overdue", due_on: "2026-09-01" }) ] }));
    vi.mocked(api.confirmCardComplete).mockResolvedValue(card({ checked: { mode: "confirmed_complete", at: "2026-11-02T10:00:00-03:00", by_name: "Ana" },
      items: [ cardItem({ status: "overdue", due_on: "2026-09-01" }) ] }));
    await openCard();
    expect(await screen.findByText(/Caderneta não conferida/)).not.toBeNull();
    expect(screen.queryByText(/atraso/i)).toBeNull();
    expect(screen.getByRole("region", { name: "Não conferidas" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar caderneta completa" }));
    expect(api.confirmCardComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sim, a caderneta está completa" }));
    await waitFor(() => expect(api.confirmCardComplete).toHaveBeenCalledWith("r1", "pa1"));
    expect(await screen.findByRole("region", { name: "Em atraso" })).not.toBeNull();
    expect(screen.getByText("conferida: caderneta completa")).not.toBeNull();
  });

  it("dose cancelada aparece com o motivo; código de vacina novo aparece cru", async () => {
    vi.mocked(api.getVaccinationCard).mockResolvedValue(card({ immunizations: [ immunization({ status: "cancelled", cancel_reason: "lote errado digitado na sala" }),
      immunization({ id: "im3", immunobiological: { code: "999", name: "999" } }) ] }));
    await openCard();
    const list = await screen.findByRole("region", { name: "Doses registradas" });
    expect(within(list).getByText("cancelada: lote errado digitado na sala")).not.toBeNull();
    expect(within(list).getByText("999")).not.toBeNull();
  });

  it("recém-nascido sem cadastro: pessoa nova vai no corpo da caderneta", async () => {
    vi.mocked(api.lookupVaccinationPerson).mockRejectedValue(new api.ApiError(404, { error: "person_not_found" }, "404"));
    vi.mocked(api.getVaccinationCard).mockResolvedValue(card({ checked: { mode: "born_after_go_live", at: "2026-11-01T00:00:00-03:00", by_name: null } }));
    renderWithProviders(<VaccinationRoom now={NOW29} />);
    fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "123.456.789-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Davi Lima" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "male" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir a caderneta" }));
    await waitFor(() => expect(api.getVaccinationCard).toHaveBeenCalledWith("r1",
      { new_patient: { full_name: "Davi Lima", birth_date: "2026-11-01", sex: "male", cpf: "12345678909" } }));
  });

  it("fora da equipe da sala: frase, nada de caderneta", async () => {
    vi.mocked(api.getVaccinationCard).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "403"));
    await openCard();
    expect(await screen.findByText("você não está na equipe desta sala")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Joana Lima" })).toBeNull();
  });
  it("409 duplicate_suspected volta à busca de duplicados já feita; outra pessoa vai com duplicates_reviewed", async () => {
    vi.mocked(api.lookupVaccinationPerson).mockRejectedValue(new api.ApiError(404, { error: "person_not_found" }, "404"));
    vi.mocked(api.findVaccinationDuplicates).mockResolvedValue([ { patient_id: "pa7", display_name: "Davi Lima", birth_date: "2026-11-01",
      has_cpf: false, registration_id: null } ]);
    vi.mocked(api.getVaccinationCard).mockRejectedValueOnce(new api.ApiError(409, { error: "duplicate_suspected" }, "409"))
      .mockResolvedValueOnce(card());
    renderWithProviders(<VaccinationRoom now={NOW29} />);
    fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "123.456.789-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Davi Lima" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "male" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir a caderneta" }));
    await waitFor(() => expect(api.findVaccinationDuplicates).toHaveBeenCalledWith("r1", { full_name: "Davi Lima", birth_date: "2026-11-01" }));
    const found = await screen.findByRole("region", { name: "Possíveis duplicados" });
    fireEvent.click(within(found).getByRole("button", { name: "Criar pessoa nova com o CPF" }));
    fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "male" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir a caderneta" }));
    await waitFor(() => expect(api.getVaccinationCard).toHaveBeenLastCalledWith("r1",
      { new_patient: { full_name: "Davi Lima", birth_date: "2026-11-01", sex: "male", cpf: "12345678909" }, duplicates_reviewed: true }));
    await screen.findByRole("heading", { name: "Joana Lima" });
    fireEvent.click(screen.getByRole("button", { name: "Outro cidadão" }));
    expect(await screen.findByLabelText("CPF")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Joana Lima" })).toBeNull();
  });

  it("caderneta de outra busca que chega atrasada é ignorada", async () => {
    let late: (c: ReturnType<typeof card>) => void = () => undefined;
    vi.mocked(api.getVaccinationCard).mockReturnValueOnce(new Promise((resolve) => { late = resolve; }));
    await openCard();
    await waitFor(() => expect(api.getVaccinationCard).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Outro cidadão" })).toBeNull();
    // A busca é remontada (Cancelar recomeça) — a resposta antiga não pode abrir a caderneta depois de trocar de cidadão.
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    late(card());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("heading", { name: "Joana Lima" })).toBeNull();
  });
  it("confirmação atrasada da pessoa A não troca a caderneta já aberta da pessoa B", async () => {
    let late: (c: ReturnType<typeof card>) => void = () => undefined;
    vi.mocked(api.getVaccinationCard).mockResolvedValueOnce(card({ checked: null }))
      .mockResolvedValueOnce(card({ patient: cardPatient({ id: "pa2", display_name: "Bruno Reis" }) }));
    vi.mocked(api.confirmCardComplete).mockReturnValueOnce(new Promise((resolve) => { late = resolve; }));
    await openCard();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar caderneta completa" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, a caderneta está completa" }));
    await waitFor(() => expect(api.confirmCardComplete).toHaveBeenCalledWith("r1", "pa1"));
    fireEvent.click(screen.getByRole("button", { name: "Outro cidadão" }));
    fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "123.456.789-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir a caderneta de Joana Lima" }));
    expect(await screen.findByRole("heading", { name: "Bruno Reis" })).not.toBeNull();
    late(card({ checked: { mode: "confirmed_complete", at: "2026-11-02T10:00:00-03:00", by_name: "Ana" } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("heading", { name: "Bruno Reis" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Joana Lima" })).toBeNull();
  });

  it("transcrever aparece também na caderneta conferida", async () => {
    vi.mocked(api.getVaccinationCard).mockResolvedValue(card());
    await openCard();
    await screen.findByRole("heading", { name: "Joana Lima" });
    expect(screen.getByRole("button", { name: "Transcrever caderneta" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar caderneta completa" })).toBeNull();
  });
});
