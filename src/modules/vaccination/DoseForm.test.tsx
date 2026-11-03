// src/modules/vaccination/DoseForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import {
  BCG, BCG_ITEM, CATALOG29, NOW29, ROOM, card, cardItem, cardPatient, immunization, vacLotBalance, vacPosition, vacUser, vial
} from "../../test/vaccinationFixtures";
import * as api from "../../lib/api";
import { DoseForm, STALE_REFUSAL } from "./DoseForm";
import { VaccinationRoom } from "../VaccinationRoom";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPositions: vi.fn(), listVials: vi.fn(),
  openVial: vi.fn(), recordImmunization: vi.fn(), listMyVaccineLocations: vi.fn(), getVaccinationCatalog: vi.fn(), lookupVaccinationPerson: vi.fn(),
  getVaccinationCard: vi.fn() }));
const refuse = (problems: { path: string; error: string; overridable?: boolean }[]) => new api.ApiError(422, { error: problems[0].error, problems }, "422");
const onSaved = vi.fn();

beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
  vi.mocked(api.listPositions).mockResolvedValue({ positions: [ vacPosition() ], next_before: null });
  vi.mocked(api.listVials).mockResolvedValue([]);
});
// reset (não só clear): resposta `Once` não consumida por um teste que falhou não vaza para o seguinte.
afterEach(() => {
  cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  [ api.recordImmunization, api.getVaccinationCard, api.openVial, api.listVials, api.listPositions ].forEach((f) => vi.mocked(f).mockReset());
});

function mount(item: api.CardItem | null = cardItem(), patient = cardPatient()) {
  return renderWithProviders(<DoseForm room={ROOM} patient={patient} catalog={CATALOG29} item={item} now={NOW29} onSaved={onSaved} onCancel={vi.fn()} />);
}
// O api exige a condição maternal para o sexo feminino (maternal_condition_required); a paciente das fixtures é feminina.
async function fill() {
  mount();
  fireEvent.change(await screen.findByLabelText("Estratégia"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Condição maternal"), { target: { value: "N" } });
  await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
  fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot9" } });
}

describe("registro da dose (F-29.3)", () => {
  it("caminho feliz pelo teclado: Enter envia o corpo do contrato", async () => {
    vi.mocked(api.recordImmunization).mockResolvedValue(immunization({ id: "im9", dose: { code: "D2", name: "2ª dose" } }));
    await fill();
    expect((screen.getByLabelText("Via") as HTMLSelectElement).value).toBe("IM");
    expect((screen.getByLabelText("Vacina") as HTMLInputElement).value).toBe("Penta (DTP/HepB/Hib)");
    expect((screen.getByLabelText("Data e hora da aplicação") as HTMLInputElement).max).toBe("2026-11-02T10:00");
    expect(screen.queryByLabelText("Frasco aberto")).toBeNull();
    fireEvent.submit(screen.getByRole("form", { name: "Registrar dose" }));
    await waitFor(() => expect(api.recordImmunization).toHaveBeenCalledWith("r1", { patient_id: "pa1", immunobiological_code: "42", dose_code: "D2",
      strategy: "1", care_group: "1", route: "IM", site: "VLD", maternal_condition: "N", applied_at: "2026-11-02T13:00:00.000Z", lot_id: "lot9" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "im9" })));
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).toBe("{}");
  });

  it("sexo masculino: sem o campo da condição maternal", async () => {
    mount(cardItem(), cardPatient({ sex: "male" }));
    expect(await screen.findByLabelText("Estratégia")).not.toBeNull();
    expect(screen.queryByLabelText("Condição maternal")).toBeNull();
  });

  it("duplo envio registra uma dose só", async () => {
    let resolve!: (v: api.Immunization) => void;
    vi.mocked(api.recordImmunization).mockReturnValue(new Promise((r) => { resolve = r; }));
    await fill();
    const button = screen.getByRole("button", { name: "Registrar dose" });
    fireEvent.click(button); fireEvent.click(button);
    fireEvent.submit(screen.getByRole("form", { name: "Registrar dose" }));
    expect(api.recordImmunization).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    resolve(immunization());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("recusas locais de uma vez: hora futura e lote (mulher de 30 anos: condição maternal exigida, V27)", async () => {
    mount(cardItem(), cardPatient({ birth_date: "1996-05-10" }));
    fireEvent.change(await screen.findByLabelText("Data e hora da aplicação"), { target: { value: "2026-11-02T10:05" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(screen.getByText("a hora da aplicação não pode ser futura")).not.toBeNull();
    expect(screen.getByText("escolha o lote do estoque da sala")).not.toBeNull();
    expect(screen.getByText("informe a estratégia")).not.toBeNull();
    expect(screen.getByText("informe a condição maternal (nenhuma, gestante ou puérpera)")).not.toBeNull();
    expect(api.recordImmunization).not.toHaveBeenCalled();
  });

  it("lot_blocked: relê a posição, limpa o lote e mantém o resto", async () => {
    vi.mocked(api.recordImmunization).mockRejectedValue(refuse([ { path: "lot_id", error: "lot_blocked" } ]));
    await fill();
    vi.mocked(api.listPositions).mockResolvedValue({ positions: [ vacPosition({ lots: [ vacLotBalance({ blocked: true }) ] }) ], next_before: null });
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(await screen.findByText("o lote está bloqueado por temperatura fora da faixa até a conduta")).not.toBeNull();
    await waitFor(() => expect(api.listPositions).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Lote") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Estratégia") as HTMLSelectElement).value).toBe("1");
    expect((screen.getByLabelText("Condição maternal") as HTMLSelectElement).value).toBe("N");
    expect(api.recordImmunization).toHaveBeenCalledTimes(1);
  });

  it("aviso e recusa dura juntos: o motivo não basta", async () => {
    const bcgLot = vacLotBalance({ lot: { ...vacLotBalance().lot, id: "lot15", item: BCG_ITEM, lot_number: "BCG2610" } });
    vi.mocked(api.listPositions).mockResolvedValue({ positions: [ vacPosition({ item: BCG_ITEM, lots: [ bcgLot ] }) ], next_before: null });
    vi.mocked(api.listVials).mockResolvedValue([ vial(), vial({ id: "v2", expires_at: "2026-11-02T18:00:00-03:00" }) ]);
    vi.mocked(api.recordImmunization)
      .mockRejectedValueOnce(refuse([ { path: "dose_code", error: "interval_too_short", overridable: true }, { path: "vial_id", error: "vial_expired" } ]))
      .mockResolvedValueOnce(immunization());
    mount(cardItem({ immunobiological: { code: BCG.code, name: BCG.name }, dose: { code: "D1", name: "1ª dose" } }));
    fireEvent.change(await screen.findByLabelText("Estratégia"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Condição maternal"), { target: { value: "N" } });
    await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot15" } });
    await waitFor(() => expect((screen.getByLabelText("Frasco aberto") as HTMLSelectElement).options.length).toBe(3));
    fireEvent.change(screen.getByLabelText("Frasco aberto"), { target: { value: "v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(await screen.findByText("intervalo menor que o mínimo desde a dose anterior")).not.toBeNull();
    expect(screen.getByText("o frasco venceu — descarte e abra outro")).not.toBeNull();
    await waitFor(() => expect(api.listVials).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Frasco aberto") as HTMLSelectElement).value).toBe("");
    // Motivo vazio com aviso na tela: recusado antes de enviar.
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(screen.getByText("o motivo precisa ter de 10 a 500 caracteres")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo para aplicar mesmo assim"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(screen.getByText("o motivo precisa ter de 10 a 500 caracteres")).not.toBeNull();
    expect(screen.getByText("BCG é multidose: escolha o frasco aberto ou abra um frasco")).not.toBeNull();
    expect(api.recordImmunization).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Motivo para aplicar mesmo assim"), { target: { value: "mãe adiantou a dose por viagem" } });
    fireEvent.change(screen.getByLabelText("Frasco aberto"), { target: { value: "v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    await waitFor(() => expect(api.recordImmunization).toHaveBeenLastCalledWith("r1",
      expect.objectContaining({ vial_id: "v2", override_reason: "mãe adiantou a dose por viagem" })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("lote de outra vacina (V22): relê os lotes e limpa o lote", async () => {
    vi.mocked(api.recordImmunization).mockRejectedValue(refuse([ { path: "lot_id", error: "lot_product_mismatch" } ]));
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(await screen.findByText("o lote é de outra vacina — escolha o lote da vacina da dose")).not.toBeNull();
    await waitFor(() => expect(api.listPositions).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Lote") as HTMLSelectElement).value).toBe("");
  });

  it("multidose sem frasco aberto: abre o frasco do lote e o escolhe", async () => {
    const bcgLot = vacLotBalance({ lot: { ...vacLotBalance().lot, id: "lot15", item: BCG_ITEM, lot_number: "BCG2610" } });
    vi.mocked(api.listPositions).mockResolvedValue({ positions: [ vacPosition({ item: BCG_ITEM, lots: [ bcgLot ] }) ], next_before: null });
    vi.mocked(api.openVial).mockResolvedValue(vial({ id: "v7", doses_used: 0, doses_left: 10 }));
    mount(cardItem({ immunobiological: { code: BCG.code, name: BCG.name }, dose: { code: "D1", name: "1ª dose" } }));
    await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot15" } });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir frasco deste lote" }));
    await waitFor(() => expect(api.openVial).toHaveBeenCalledWith("r1", "lot15"));
    await waitFor(() => expect((screen.getByLabelText("Frasco aberto") as HTMLSelectElement).value).toBe("v7"));
  });

  it("C1: sem `now` fixo, o relógio é lido na hora — a hora real não é futura e o frasco vencido sai", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    try {
      vi.setSystemTime(new Date("2026-11-02T10:00:00-03:00"));
      const bcgLot = vacLotBalance({ lot: { ...vacLotBalance().lot, id: "lot15", item: BCG_ITEM, lot_number: "BCG2610" } });
      vi.mocked(api.listPositions).mockResolvedValue({ positions: [ vacPosition({ item: BCG_ITEM, lots: [ bcgLot ] }) ], next_before: null });
      vi.mocked(api.listVials).mockResolvedValue([ vial(), vial({ id: "v2", expires_at: "2026-11-02T18:00:00-03:00" }) ]);
      vi.mocked(api.recordImmunization).mockResolvedValue(immunization());
      renderWithProviders(<DoseForm room={ROOM} patient={cardPatient()} catalog={CATALOG29} now={undefined}
        item={cardItem({ immunobiological: { code: BCG.code, name: BCG.name }, dose: { code: "D1", name: "1ª dose" } })} onSaved={onSaved} onCancel={vi.fn()} />);
      const at = await screen.findByLabelText("Data e hora da aplicação") as HTMLInputElement;
      expect(at.value).toBe("2026-11-02T10:00");
      vi.setSystemTime(new Date("2026-11-02T15:00:00-03:00")); // o formulário ficou aberto 5 h
      fireEvent.change(at, { target: { value: "2026-11-02T15:00" } });
      expect(at.max).toBe("2026-11-02T15:00");
      fireEvent.change(screen.getByLabelText("Estratégia"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "1" } });
      await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
      fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot15" } });
      // v1 venceu às 14:00: fora da lista
      await waitFor(() => expect((screen.getByLabelText("Frasco aberto") as HTMLSelectElement).options.length).toBe(2));
      fireEvent.change(screen.getByLabelText("Frasco aberto"), { target: { value: "v2" } });
      fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
      expect(screen.queryByText("a hora da aplicação não pode ser futura")).toBeNull();
      await waitFor(() => expect(api.recordImmunization).toHaveBeenCalledWith("r1",
        expect.objectContaining({ applied_at: "2026-11-02T18:00:00.000Z", vial_id: "v2" })));
    } finally {
      vi.useRealTimers();
    }
  });

  it("C1: aberto mais tarde, a hora padrão e o máximo são os da abertura do formulário", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    try {
      vi.setSystemTime(new Date("2026-11-02T16:20:00-03:00"));
      renderWithProviders(<DoseForm room={ROOM} patient={cardPatient()} catalog={CATALOG29} item={cardItem()} onSaved={onSaved} onCancel={vi.fn()} />);
      const at = await screen.findByLabelText("Data e hora da aplicação") as HTMLInputElement;
      expect(at.value).toBe("2026-11-02T16:20");
      expect(at.max).toBe("2026-11-02T16:20");
    } finally {
      vi.useRealTimers();
    }
  });

  it("I1: mudar a hora descarta o aviso do servidor; o reenvio vai sem motivo", async () => {
    vi.mocked(api.recordImmunization)
      .mockRejectedValueOnce(refuse([ { path: "dose_code", error: "age_out_of_range", overridable: true } ]))
      .mockResolvedValueOnce(immunization());
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(await screen.findByText("idade fora da faixa do calendário para esta dose")).not.toBeNull();
    expect(screen.getByLabelText("Motivo para aplicar mesmo assim")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Data e hora da aplicação"), { target: { value: "2026-11-02T09:30" } });
    expect(screen.queryByText("idade fora da faixa do calendário para esta dose")).toBeNull();
    expect(screen.queryByLabelText("Motivo para aplicar mesmo assim")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    await waitFor(() => expect(api.recordImmunization).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.recordImmunization).mock.calls[1][1]).not.toHaveProperty("override_reason");
    expect(vi.mocked(api.recordImmunization).mock.calls[1][1]).toMatchObject({ applied_at: "2026-11-02T12:30:00.000Z" });
  });

  it("I1: trocar a vacina ou a dose também descarta o aviso; trocar o grupo não", async () => {
    vi.mocked(api.recordImmunization).mockRejectedValue(refuse([ { path: "dose_code", error: "interval_too_short", overridable: true } ]));
    mount(null);
    fireEvent.change(await screen.findByLabelText("Vacina"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "D2" } });
    fireEvent.change(screen.getByLabelText("Estratégia"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "1" } });
    await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot9" } });
    const send = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
      expect(await screen.findByText("intervalo menor que o mínimo desde a dose anterior")).not.toBeNull();
    };
    await send();
    fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "2" } });
    expect(screen.getByText("intervalo menor que o mínimo desde a dose anterior")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "D3" } });
    expect(screen.queryByText("intervalo menor que o mínimo desde a dose anterior")).toBeNull();
    await send();
    fireEvent.change(screen.getByLabelText("Vacina"), { target: { value: "42" } });
    expect(screen.queryByText("intervalo menor que o mínimo desde a dose anterior")).toBeNull();
  });

  it("V27: menina de 4 meses envia sem a condição maternal (vai ausente)", async () => {
    vi.mocked(api.recordImmunization).mockResolvedValue(immunization());
    mount();
    fireEvent.change(await screen.findByLabelText("Estratégia"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "1" } });
    expect(screen.getByText("opcional nesta idade (obrigatória de 10 a 49 anos)")).not.toBeNull();
    await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot9" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    await waitFor(() => expect(api.recordImmunization).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.recordImmunization).mock.calls[0][1]).not.toHaveProperty("maternal_condition");
  });

  it("M1: recusa dura de campo que não mudou segura o reenvio só com o motivo", async () => {
    vi.mocked(api.recordImmunization)
      .mockRejectedValueOnce(refuse([ { path: "dose_code", error: "interval_too_short", overridable: true }, { path: "immunobiological_code", error: "sex_not_allowed" } ]));
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(await screen.findByText("esta vacina não é indicada para o sexo do cadastro")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo para aplicar mesmo assim"), { target: { value: "mãe adiantou a dose por viagem" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(screen.getByText(STALE_REFUSAL)).not.toBeNull();
    expect(api.recordImmunization).toHaveBeenCalledTimes(1);
  });

  it("recusa solta (missing_role) vai à lista e não trava o reenvio", async () => {
    vi.mocked(api.recordImmunization).mockRejectedValueOnce(new api.ApiError(403, { error: "missing_role" }, "403")).mockResolvedValueOnce(immunization());
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(await screen.findByText("você não está na equipe desta sala")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    await waitFor(() => expect(api.recordImmunization).toHaveBeenCalledTimes(2));
  });

  it("outra vacina: escolhe vacina e dose; fora da rotina a estratégia muda", async () => {
    vi.mocked(api.recordImmunization).mockRejectedValue(refuse([ { path: "dose_code", error: "dose_not_in_calendar" } ]));
    mount(null);
    fireEvent.change(await screen.findByLabelText("Vacina"), { target: { value: "42" } });
    expect((screen.getByLabelText("Via") as HTMLSelectElement).value).toBe("IM");
    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "REF" } });
    fireEvent.change(screen.getByLabelText("Estratégia"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Condição maternal"), { target: { value: "N" } });
    await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot9" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    expect(await screen.findByText("esta dose não está no calendário de rotina desta vacina — fora da rotina, troque a estratégia")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Estratégia"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose" }));
    await waitFor(() => expect(api.recordImmunization).toHaveBeenLastCalledWith("r1", expect.objectContaining({ dose_code: "REF", strategy: "2" })));
  });
});

describe("dose na sala: aprazamento", () => {
  beforeEach(() => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
    vi.mocked(api.getVaccinationCatalog).mockResolvedValue(CATALOG29);
    vi.mocked(api.lookupVaccinationPerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null,
      has_cpf: true, cns_masked: null });
  });

  async function recordFromCard(reread: api.VaccinationCard, pending = false) {
    vi.mocked(api.getVaccinationCard).mockResolvedValueOnce(card());
    if (pending) vi.mocked(api.getVaccinationCard).mockReturnValueOnce(reread as unknown as Promise<api.VaccinationCard>);
    else vi.mocked(api.getVaccinationCard).mockResolvedValueOnce(reread);
    vi.mocked(api.recordImmunization).mockResolvedValue(immunization({ id: "im9", dose: { code: "D2", name: "2ª dose" } }));
    renderWithProviders(<VaccinationRoom now={NOW29} />);
    fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "123.456.789-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir a caderneta de Joana Lima" }));
    const today = await screen.findByRole("region", { name: "Devidas hoje" });
    fireEvent.click(within(today).getByRole("button", { name: "Registrar Penta (DTP/HepB/Hib) — 2ª dose" }));
    fireEvent.change(await screen.findByLabelText("Estratégia"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Condição maternal"), { target: { value: "N" } });
    await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot9" } });
    fireEvent.submit(screen.getByRole("form", { name: "Registrar dose" }));
  }

  it("relê a caderneta e anuncia a próxima dose com foco", async () => {
    await recordFromCard(card({ items: [ cardItem({ status: "complete", applied: { id: "im9", applied_at: "2026-11-02T10:00:00-03:00", transcription: false } }),
      cardItem({ dose: { code: "D3", name: "3ª dose" }, status: "upcoming", due_on: "2027-01-01" }) ] }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Dose registrada. Próxima dose: Penta (DTP/HepB/Hib) 3ª dose em 01/01/2027");
    await waitFor(() => expect(document.activeElement).toBe(status));
    expect(api.getVaccinationCard).toHaveBeenCalledTimes(2);
    expect(api.getVaccinationCard).toHaveBeenLastCalledWith("r1", { patient_id: "pa1" });
    expect(screen.queryByRole("form", { name: "Registrar dose" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Joana Lima" })).not.toBeNull();
  });

  it("M2: enquanto relê, sem a caderneta velha; falha → Reabrir a caderneta", async () => {
    let fail!: (e: unknown) => void;
    vi.mocked(api.getVaccinationCard).mockReset();
    await recordFromCard(new Promise<api.VaccinationCard>((_, rej) => { fail = rej; }) as unknown as api.VaccinationCard, true);
    expect(await screen.findByText("relendo a caderneta…")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Registrar / })).toBeNull();
    fail(new api.ApiError(500, { error: "boom" }, "500"));
    const reopen = await screen.findByRole("button", { name: "Reabrir a caderneta" });
    expect(screen.getByRole("status").textContent).toBe("Dose registrada.");
    expect(screen.queryByRole("button", { name: /^Registrar / })).toBeNull();
    vi.mocked(api.getVaccinationCard).mockResolvedValueOnce(card({ items: [ cardItem({ status: "complete" }) ] }));
    fireEvent.click(reopen);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Dose registrada. Esquema desta vacina completo no calendário."));
    expect(api.getVaccinationCard).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("heading", { name: "Joana Lima" })).not.toBeNull();
  });

  it("sem próxima dose do imunobiológico: esquema completo", async () => {
    await recordFromCard(card({ items: [ cardItem({ status: "complete", applied: { id: "im9", applied_at: "2026-11-02T10:00:00-03:00", transcription: false } }) ] }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Dose registrada. Esquema desta vacina completo no calendário.");
  });
});
