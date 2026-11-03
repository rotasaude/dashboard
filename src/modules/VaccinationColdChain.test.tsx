// src/modules/VaccinationColdChain.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { LEAD_ROOM, NOW29, ROOM, coldStatus, equipment, vacUser } from "../test/vaccinationFixtures";
import * as api from "../lib/api";
import { VaccinationColdChain } from "./VaccinationColdChain";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listMyVaccineLocations: vi.fn(),
  getColdChainStatus: vi.fn(), listEquipments: vi.fn(), recordReading: vi.fn(), decideExcursion: vi.fn(), createEquipment: vi.fn() }));
const reading = { id: "rd1", read_at: "2026-11-02T08:00:00-03:00", current_c: 8.5, min_c: 3, max_c: 9, out_of_range: true, by: { name: "Ana" } };
const excursion = { id: "ex1", equipment_id: "eq1", reading, opened_at: "2026-11-02T08:00:00-03:00",
  lots: [ { lot_id: "lot9", number: "PNT2611", immunobiological: { code: "42", name: "Penta (DTP/HepB/Hib)" }, balance: "20", pending_adjustment_id: null },
    { lot_id: "lot15", number: "BCG2610", immunobiological: { code: "15", name: "BCG" }, balance: "40", pending_adjustment_id: null } ] };

beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
  vi.mocked(api.listEquipments).mockResolvedValue([ equipment() ]);
  vi.mocked(api.getColdChainStatus).mockResolvedValue(coldStatus());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("cadeia de frio (F-29.6)", () => {
  it("leitura fora da faixa abre a conduta", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ LEAD_ROOM ]);
    vi.mocked(api.recordReading).mockResolvedValue({ reading, excursion_id: "ex1", blocked_lots: 2 });
    renderWithProviders(<VaccinationColdChain now={NOW29} />);
    expect(await screen.findByText("leituras de hoje: 0 de 2")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar temperatura — Geladeira 1" }));
    fireEvent.change(screen.getByLabelText("Hora da leitura"), { target: { value: "2026-11-02T08:00" } });
    fireEvent.change(screen.getByLabelText("Temperatura atual"), { target: { value: "8,5" } });
    fireEvent.change(screen.getByLabelText("Mínima"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Máxima"), { target: { value: "9" } });
    expect(screen.getByText("Fora de +2 a +8 °C: ao salvar, os lotes deste local ficam bloqueados até a conduta.")).not.toBeNull();
    vi.mocked(api.getColdChainStatus).mockResolvedValue(coldStatus({ open_excursions: [ excursion ] }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar e bloquear os lotes" }));
    await waitFor(() => expect(api.recordReading).toHaveBeenCalledWith("eq1", { read_at: "2026-11-02T11:00:00.000Z", current_c: 8.5, min_c: 3, max_c: 9 }));
    expect(await screen.findByText("Excursão aberta: 2 lotes bloqueados.")).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Conduta — Geladeira 1" })).not.toBeNull();
  });

  it("mínima acima da atual e duas casas: recusa sem enviar", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
    renderWithProviders(<VaccinationColdChain now={NOW29} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar temperatura — Geladeira 1" }));
    fireEvent.change(screen.getByLabelText("Temperatura atual"), { target: { value: "4,55" } });
    fireEvent.change(screen.getByLabelText("Mínima"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Máxima"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar leitura" }));
    expect(screen.getByText("informe a temperatura atual (ex.: 4,5)")).not.toBeNull();
    expect(api.recordReading).not.toHaveBeenCalled();
  });

  it("conduta: todas as linhas conferidas; vacinador não decide", async () => {
    vi.mocked(api.getColdChainStatus).mockResolvedValue(coldStatus({ open_excursions: [ excursion ] }));
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
    renderWithProviders(<VaccinationColdChain now={NOW29} />);
    expect(await screen.findByText(/aguarda a conduta do responsável/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Revisar" })).toBeNull();
    cleanup();
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ LEAD_ROOM ]);
    vi.mocked(api.decideExcursion).mockResolvedValue({ excursion_id: "ex1", adjustments: [] });
    renderWithProviders(<VaccinationColdChain now={NOW29} />);
    const box = await screen.findByRole("region", { name: "Conduta — Geladeira 1" });
    const [ penta, bcg ] = within(box).getAllByRole("group");
    fireEvent.click(within(penta).getByLabelText("Usar"));
    fireEvent.change(within(penta).getByLabelText("Motivo"), { target: { value: "laudo do fabricante permite uso" } });
    fireEvent.click(within(box).getByRole("button", { name: "Revisar" }));
    expect(within(bcg).getByText("BCG2610: escolha usar ou dar perda")).not.toBeNull();
    fireEvent.click(within(bcg).getByLabelText("Dar perda"));
    fireEvent.change(within(bcg).getByLabelText("Motivo"), { target: { value: "exposição acima do tolerado" } });
    fireEvent.click(within(box).getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar conduta" }));
    await waitFor(() => expect(api.decideExcursion).toHaveBeenCalledWith("ex1", [
      { lot_id: "lot9", decision: "use", reason: "laudo do fabricante permite uso" },
      { lot_id: "lot15", decision: "discard", reason: "exposição acima do tolerado" } ]));
  });

  // V24: o lote com descarte aguardando aprovação não aceita nova conduta e não vai no decide.
  it("V24: descarte pendente fica de fora; excursão já decidida pede Atualizar", async () => {
    const pending = { ...excursion, lots: [ { ...excursion.lots[0], pending_adjustment_id: "adj1" }, excursion.lots[1] ] };
    vi.mocked(api.getColdChainStatus).mockResolvedValue(coldStatus({ open_excursions: [ pending ] }));
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ LEAD_ROOM ]);
    vi.mocked(api.decideExcursion).mockRejectedValue(new api.ApiError(409, { error: "excursion_closed" }, "409"));
    renderWithProviders(<VaccinationColdChain now={NOW29} />);
    const box = await screen.findByRole("region", { name: "Conduta — Geladeira 1" });
    expect(within(box).getByText("PNT2611: aguardando aprovação do descarte")).not.toBeNull();
    const groups = within(box).getAllByRole("group");
    expect(groups).toHaveLength(1);
    fireEvent.click(within(groups[0]).getByLabelText("Dar perda"));
    fireEvent.change(within(groups[0]).getByLabelText("Motivo"), { target: { value: "exposição acima do tolerado" } });
    fireEvent.click(within(box).getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar conduta" }));
    await waitFor(() => expect(api.decideExcursion).toHaveBeenCalledWith("ex1", [
      { lot_id: "lot15", decision: "discard", reason: "exposição acima do tolerado" } ]));
    expect(await screen.findByText("a conduta desta excursão já foi decidida — recarregue")).not.toBeNull();
    const calls = vi.mocked(api.getColdChainStatus).mock.calls.length;
    fireEvent.click(within(screen.getByRole("region", { name: "Conduta — Geladeira 1" })).getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(vi.mocked(api.getColdChainStatus).mock.calls.length).toBeGreaterThan(calls));
  });

  it("equipamento: todas as recusas de uma vez, sem maxLength; depois cria com a faixa", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ LEAD_ROOM ]);
    vi.mocked(api.createEquipment).mockResolvedValue(equipment({ id: "eq2", name: "Câmara 2", kind: "chamber" }));
    renderWithProviders(<VaccinationColdChain now={NOW29} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo equipamento" }));
    const form = screen.getByRole("form", { name: "Novo equipamento" });
    expect(within(form).getByLabelText("Nome").getAttribute("maxlength")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "C" } });
    fireEvent.change(within(form).getByLabelText("Mínima da faixa (°C)"), { target: { value: "8" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar equipamento" }));
    expect(within(form).getByText("o nome precisa ter de 3 a 120 caracteres")).not.toBeNull();
    expect(within(form).getByText("escolha o tipo do equipamento")).not.toBeNull();
    expect(within(form).getByText("a máxima precisa ser maior que a mínima")).not.toBeNull();
    expect(api.createEquipment).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Câmara 2" } });
    fireEvent.change(within(form).getByLabelText("Tipo"), { target: { value: "chamber" } });
    fireEvent.change(within(form).getByLabelText("Mínima da faixa (°C)"), { target: { value: "2,5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar equipamento" }));
    await waitFor(() => expect(api.createEquipment).toHaveBeenCalledWith({ location_id: "l5", name: "Câmara 2", kind: "chamber", min_c: 2.5, max_c: 8, active: true }));
    expect(await screen.findByText("Equipamento salvo.")).toBe(document.activeElement?.firstChild);
  });

  it("depois do meio-dia, menos de 2 leituras: o texto diz o número", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
    vi.mocked(api.getColdChainStatus).mockResolvedValue(coldStatus({ equipments: [ { ...equipment(), last_reading: null, readings_today: 1 } ] }));
    renderWithProviders(<VaccinationColdChain now={new Date("2026-11-02T13:00:00-03:00")} />);
    expect(await screen.findByText("leituras de hoje: 1 de 2")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Equipamentos" })).toBeNull();
  });
});
