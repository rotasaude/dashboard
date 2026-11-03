// src/modules/vaccination/Transcription.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CATALOG29, NOW29, ROOM, TODAY29, card, cardPatient, immunization, vacPosition, vacUser } from "../../test/vaccinationFixtures";
import * as api from "../../lib/api";
import { TranscriptionForm } from "./TranscriptionForm";
import { CancelDose } from "./CancelDose";
import { ImmunizationRow } from "./ImmunizationRow";
import { VaccinationRoom } from "../VaccinationRoom";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), recordTranscriptions: vi.fn(),
  cancelImmunization: vi.fn(), listPositions: vi.fn(), listVials: vi.fn(), listMyVaccineLocations: vi.fn(), getVaccinationCatalog: vi.fn(),
  lookupVaccinationPerson: vi.fn(), getVaccinationCard: vi.fn() }));
const refuse = (problems: { path: string; error: string; overridable?: boolean }[]) => new api.ApiError(422, { error: problems[0].error, problems }, "422");
beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
  vi.mocked(api.listPositions).mockResolvedValue({ positions: [ vacPosition() ], next_before: null });
  vi.mocked(api.listVials).mockResolvedValue([]);
});
// reset (não só clear): resposta `Once` não consumida por um teste que falhou não vaza para o seguinte.
afterEach(() => {
  cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  [ api.recordTranscriptions, api.cancelImmunization, api.getVaccinationCard ].forEach((f) => vi.mocked(f).mockReset());
});

describe("transcrição (F-29.3)", () => {
  it("duas doses, fecha a conferência, devolve a caderneta da resposta", async () => {
    const after = card({ checked: { mode: "transcribed", at: "2026-11-02T10:00:00-03:00", by_name: "Ana" } });
    vi.mocked(api.recordTranscriptions).mockResolvedValue({ immunizations: [], card: after });
    const onDone = vi.fn();
    renderWithProviders(<TranscriptionForm room={ROOM} card={card({ checked: null })} catalog={CATALOG29} today={TODAY29} onDone={onDone} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dose" }));
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dose" }));
    const [ l1, l2 ] = screen.getAllByRole("group", { name: /^Dose transcrita/ });
    fireEvent.change(within(l1).getByLabelText("Vacina"), { target: { value: "15" } });
    fireEvent.change(within(l1).getByLabelText("Dose"), { target: { value: "D1" } });
    fireEvent.change(within(l1).getByLabelText("Data da aplicação"), { target: { value: "2026-07-02" } });
    fireEvent.change(within(l2).getByLabelText("Vacina"), { target: { value: "42" } });
    fireEvent.change(within(l2).getByLabelText("Dose"), { target: { value: "D1" } });
    fireEvent.change(within(l2).getByLabelText("Data da aplicação"), { target: { value: "2026-09-01" } });
    fireEvent.change(within(l2).getByLabelText("Lote (opcional)"), { target: { value: "PNT2608" } });
    expect((screen.getByLabelText("Esta caderneta está conferida depois desta transcrição") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Registrar transcrição" }));
    await waitFor(() => expect(api.recordTranscriptions).toHaveBeenCalledWith("r1", { patient_id: "pa1", close_check: true, items: [
      { immunobiological_code: "15", dose_code: "D1", applied_on: "2026-07-02" },
      { immunobiological_code: "42", dose_code: "D1", applied_on: "2026-09-01", lot_number: "PNT2608" } ] }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(after));
    expect(api.getVaccinationCard).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it("data antes do nascimento: recusa na linha, sem enviar", async () => {
    renderWithProviders(<TranscriptionForm room={ROOM} card={card({ checked: null, patient: cardPatient({ birth_date: "2026-07-01" }) })}
      catalog={CATALOG29} today={TODAY29} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dose" }));
    const line = screen.getByRole("group", { name: /^Dose transcrita/ });
    fireEvent.change(within(line).getByLabelText("Vacina"), { target: { value: "15" } });
    fireEvent.change(within(line).getByLabelText("Dose"), { target: { value: "D1" } });
    fireEvent.change(within(line).getByLabelText("Data da aplicação"), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar transcrição" }));
    expect(within(line).getByText("BCG: a data é antes do nascimento")).not.toBeNull();
    expect(api.recordTranscriptions).not.toHaveBeenCalled();
  });

  it("datas limitadas por hoje e pelo nascimento; remover tira a linha", () => {
    renderWithProviders(<TranscriptionForm room={ROOM} card={card({ checked: null })} catalog={CATALOG29} today={TODAY29} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dose" }));
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dose" }));
    const [ l1 ] = screen.getAllByRole("group", { name: /^Dose transcrita/ });
    const date = within(l1).getByLabelText("Data da aplicação") as HTMLInputElement;
    expect([ date.type, date.max, date.min ]).toEqual([ "date", TODAY29, "2026-07-01" ]);
    expect((within(l1).getByLabelText("Lote (opcional)") as HTMLInputElement).maxLength).toBe(40);
    expect((within(l1).getByLabelText("Fabricante (opcional)") as HTMLInputElement).maxLength).toBe(120);
    expect((within(l1).getByLabelText("Local da aplicação (opcional)") as HTMLInputElement).maxLength).toBe(120);
    fireEvent.click(within(l1).getByRole("button", { name: "Remover dose transcrita 1" }));
    expect(screen.getAllByRole("group", { name: /^Dose transcrita/ })).toHaveLength(1);
  });

  it("recusa do api aparece na linha pelo índice; nada é reenviado sozinho", async () => {
    vi.mocked(api.recordTranscriptions).mockRejectedValue(refuse([ { path: "items[1].applied_on", error: "applied_before_birth" } ]));
    renderWithProviders(<TranscriptionForm room={ROOM} card={card({ checked: null })} catalog={CATALOG29} today={TODAY29} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dose" }));
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dose" }));
    const [ l1, l2 ] = screen.getAllByRole("group", { name: /^Dose transcrita/ });
    for (const [ l, code, on ] of [ [ l1, "15", "2026-07-02" ], [ l2, "42", "2026-09-01" ] ] as const) {
      fireEvent.change(within(l).getByLabelText("Vacina"), { target: { value: code } });
      fireEvent.change(within(l).getByLabelText("Dose"), { target: { value: "D1" } });
      fireEvent.change(within(l).getByLabelText("Data da aplicação"), { target: { value: on } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Registrar transcrição" }));
    expect(await within(l2).findByText("Penta (DTP/HepB/Hib): a data da aplicação é antes do nascimento")).not.toBeNull();
    expect(within(l1).queryByText(/antes do nascimento/)).toBeNull();
    expect(api.recordTranscriptions).toHaveBeenCalledTimes(1);
  });

  it("caderneta já conferida: sem a caixa de conferência, close_check false", async () => {
    vi.mocked(api.recordTranscriptions).mockResolvedValue({ immunizations: [], card: card() });
    renderWithProviders(<TranscriptionForm room={ROOM} card={card()} catalog={CATALOG29} today={TODAY29} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Esta caderneta está conferida depois desta transcrição")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar dose" }));
    const line = screen.getByRole("group", { name: /^Dose transcrita/ });
    fireEvent.change(within(line).getByLabelText("Vacina"), { target: { value: "15" } });
    fireEvent.change(within(line).getByLabelText("Dose"), { target: { value: "D1" } });
    fireEvent.change(within(line).getByLabelText("Data da aplicação"), { target: { value: "2026-07-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar transcrição" }));
    await waitFor(() => expect(api.recordTranscriptions).toHaveBeenCalledWith("r1", expect.objectContaining({ close_check: false })));
  });

  it("no máximo 40 doses por transcrição", () => {
    renderWithProviders(<TranscriptionForm room={ROOM} card={card({ checked: null })} catalog={CATALOG29} today={TODAY29} onDone={vi.fn()} onCancel={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Acrescentar dose" }) as HTMLButtonElement;
    for (let i = 0; i < 40; i++) fireEvent.click(add);
    expect(screen.getAllByRole("group", { name: /^Dose transcrita/ })).toHaveLength(40);
    expect(add.disabled).toBe(true);
  });
});

describe("cancelamento (F-29.3)", () => {
  const mount = (imm = immunization(), onDone = vi.fn()) => renderWithProviders(<CancelDose imm={imm} room={ROOM} patient={cardPatient()} catalog={CATALOG29}
    now={NOW29} onDone={onDone} onCancel={vi.fn()} />);

  it("sem permissão de cancelar, nada é oferecido", () => {
    mount(immunization({ can_cancel: false }));
    expect(screen.queryByLabelText("Motivo do cancelamento")).toBeNull();
    expect(screen.getByText("só quem registrou ou o responsável pela sala cancela")).not.toBeNull();
  });

  it("motivo curto recusado; com substituição, uma chamada com o par; step-up", async () => {
    vi.mocked(api.cancelImmunization).mockResolvedValue({ cancelled: immunization({ status: "cancelled" }), replacement: immunization({ id: "im8" }) });
    mount();
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "errado" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect(screen.getByText("o motivo precisa ter de 10 a 500 caracteres")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "lote errado digitado na sala" } });
    fireEvent.click(screen.getByLabelText("Registrar a dose correta agora"));
    fireEvent.change(await screen.findByLabelText("Estratégia"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "1" } });
    await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot9" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar e substituir" }));
    await waitFor(() => expect(api.cancelImmunization).toHaveBeenCalledWith("im1", { reason: "lote errado digitado na sala",
      replacement: expect.objectContaining({ patient_id: "pa1", immunobiological_code: "42", dose_code: "D1", lot_id: "lot9" }) }));
  });

  it("sem substituição: confirma \"Cancelar dose\" e devolve o resultado", async () => {
    const res = { cancelled: immunization({ status: "cancelled" }), replacement: null };
    vi.mocked(api.cancelImmunization).mockResolvedValue(res);
    const onDone = vi.fn();
    mount(immunization(), onDone);
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "registro duplicado na sala" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar dose" }));
    await waitFor(() => expect(api.cancelImmunization).toHaveBeenCalledWith("im1", { reason: "registro duplicado na sala" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(res));
  });

  it("substituição recusada (replacement.*): volta ao formulário com a frase no campo, nada cancelado", async () => {
    vi.mocked(api.cancelImmunization).mockRejectedValue(refuse([ { path: "replacement.lot_id", error: "lot_blocked" } ]));
    const onDone = vi.fn();
    mount(immunization(), onDone);
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "lote errado digitado na sala" } });
    fireEvent.click(screen.getByLabelText("Registrar a dose correta agora"));
    fireEvent.change(await screen.findByLabelText("Estratégia"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Grupo de atendimento"), { target: { value: "1" } });
    await waitFor(() => expect((screen.getByLabelText("Lote") as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot9" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar e substituir" }));
    expect(await screen.findByText("o lote está bloqueado por temperatura fora da faixa até a conduta")).not.toBeNull();
    expect((screen.getByLabelText("Motivo do cancelamento") as HTMLTextAreaElement).value).toBe("lote errado digitado na sala");
    expect((screen.getByLabelText("Lote") as HTMLSelectElement).value).toBe("");
    expect(onDone).not.toHaveBeenCalled();
    expect(api.cancelImmunization).toHaveBeenCalledTimes(1);
  });

  it("dose transcrita: a substituta vai como item de transcrição", async () => {
    vi.mocked(api.cancelImmunization).mockResolvedValue({ cancelled: immunization({ status: "cancelled" }), replacement: immunization({ id: "im8" }) });
    mount(immunization({ transcription: true, room: null, applied_at: "2026-08-01T12:00:00-03:00",
      lot: { id: null, number: "PNT0801", manufacturer: { code: null, name: "Serum" }, expires_on: null } }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dose transcrita com a data errada" } });
    fireEvent.click(screen.getByLabelText("Registrar a dose correta agora"));
    const date = screen.getByLabelText("Data da aplicação") as HTMLInputElement;
    expect(date.value).toBe("2026-08-01");
    fireEvent.change(date, { target: { value: "2026-08-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar e substituir" }));
    await waitFor(() => expect(api.cancelImmunization).toHaveBeenCalledWith("im1", { reason: "dose transcrita com a data errada",
      replacement: { immunobiological_code: "42", dose_code: "D1", applied_on: "2026-08-03", lot_number: "PNT0801", manufacturer_name: "Serum" } }));
  });

  it("transcrita: replacement.applied_on recusado aparece no campo", async () => {
    vi.mocked(api.cancelImmunization).mockRejectedValue(refuse([ { path: "replacement.applied_on", error: "applied_on_in_future" } ]));
    mount(immunization({ transcription: true, lot: { id: null, number: null, manufacturer: { code: null, name: null }, expires_on: null } }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dose transcrita com a data errada" } });
    fireEvent.click(screen.getByLabelText("Registrar a dose correta agora"));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar e substituir" }));
    const line = await screen.findByRole("group", { name: "Dose correta" });
    expect(await within(line).findByText("Penta (DTP/HepB/Hib): a data da aplicação não pode ser futura")).not.toBeNull();
  });
});

describe("botão de cancelar na dose", () => {
  it("só com can_cancel e dose ativa", () => {
    const onCancelDose = vi.fn();
    const { rerender } = renderWithProviders(<ul><ImmunizationRow imm={immunization()} onChanged={vi.fn()} onCancelDose={onCancelDose} /></ul>);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar dose — Penta (DTP/HepB/Hib) 1ª dose" }));
    expect(onCancelDose).toHaveBeenCalledWith(immunization());
    rerender(<ul><ImmunizationRow imm={immunization({ can_cancel: false })} onChanged={vi.fn()} onCancelDose={onCancelDose} /></ul>);
    expect(screen.queryByRole("button", { name: /^Cancelar dose/ })).toBeNull();
    rerender(<ul><ImmunizationRow imm={immunization({ status: "cancelled", can_cancel: true })} onChanged={vi.fn()} onCancelDose={onCancelDose} /></ul>);
    expect(screen.queryByRole("button", { name: /^Cancelar dose/ })).toBeNull();
  });
});

describe("na sala", () => {
  beforeEach(() => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
    vi.mocked(api.getVaccinationCatalog).mockResolvedValue(CATALOG29);
    vi.mocked(api.lookupVaccinationPerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null,
      has_cpf: true, cns_masked: null });
  });
  async function openCard(first: api.VaccinationCard) {
    vi.mocked(api.getVaccinationCard).mockResolvedValueOnce(first);
    renderWithProviders(<VaccinationRoom now={NOW29} />);
    fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "123.456.789-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir a caderneta de Joana Lima" }));
    await screen.findByRole("heading", { name: "Joana Lima" });
  }

  it("transcrição troca a caderneta pela da resposta, sem nova leitura", async () => {
    await openCard(card({ checked: null }));
    vi.mocked(api.recordTranscriptions).mockResolvedValue({ immunizations: [],
      card: card({ checked: { mode: "transcribed", at: "2026-11-02T10:00:00-03:00", by_name: "Ana" } }) });
    fireEvent.click(screen.getByRole("button", { name: "Transcrever caderneta" }));
    fireEvent.click(await screen.findByRole("button", { name: "Acrescentar dose" }));
    const line = screen.getByRole("group", { name: /^Dose transcrita/ });
    fireEvent.change(within(line).getByLabelText("Vacina"), { target: { value: "15" } });
    fireEvent.change(within(line).getByLabelText("Dose"), { target: { value: "D1" } });
    fireEvent.change(within(line).getByLabelText("Data da aplicação"), { target: { value: "2026-07-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar transcrição" }));
    expect((await screen.findByRole("status")).textContent).toBe("Transcrição registrada.");
    expect(screen.queryByText("não conferida")).toBeNull();
    expect(api.getVaccinationCard).toHaveBeenCalledTimes(1);
  });

  it("cancelar pela dose: frase e caderneta relida", async () => {
    await openCard(card());
    vi.mocked(api.cancelImmunization).mockResolvedValue({ cancelled: immunization({ status: "cancelled" }), replacement: null });
    vi.mocked(api.getVaccinationCard).mockResolvedValueOnce(card({ immunizations: [ immunization({ status: "cancelled", can_cancel: false,
      cancel_reason: "registro duplicado na sala" }) ] }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar dose — Penta (DTP/HepB/Hib) 1ª dose" }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "registro duplicado na sala" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar dose" }));
    expect((await screen.findByRole("status")).textContent).toBe("Dose cancelada.");
    expect(api.getVaccinationCard).toHaveBeenCalledTimes(2);
    expect(api.getVaccinationCard).toHaveBeenLastCalledWith("r1", { patient_id: "pa1" });
    expect(await screen.findByText("cancelada: registro duplicado na sala")).not.toBeNull();
  });

  it("cancelamento que responde depois de trocar de cidadão não relê nem anuncia nada", async () => {
    await openCard(card());
    let resolve: (v: { cancelled: api.Immunization; replacement: null }) => void = () => undefined;
    vi.mocked(api.cancelImmunization).mockReturnValue(new Promise((r) => { resolve = r; }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar dose — Penta (DTP/HepB/Hib) 1ª dose" }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "registro duplicado na sala" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar dose" }));
    await waitFor(() => expect(api.cancelImmunization).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Outro cidadão" }));
    resolve({ cancelled: immunization({ status: "cancelled" }), replacement: null });
    expect(await screen.findByLabelText("CPF")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("status")).toBeNull();
    expect(api.getVaccinationCard).toHaveBeenCalledTimes(1);
  });

  it("transcrição que responde depois de trocar de cidadão não abre a caderneta antiga", async () => {
    await openCard(card({ checked: null }));
    let resolve: (v: { immunizations: api.Immunization[]; card: api.VaccinationCard }) => void = () => undefined;
    vi.mocked(api.recordTranscriptions).mockReturnValue(new Promise((r) => { resolve = r; }));
    fireEvent.click(screen.getByRole("button", { name: "Transcrever caderneta" }));
    fireEvent.click(await screen.findByRole("button", { name: "Acrescentar dose" }));
    const line = screen.getByRole("group", { name: /^Dose transcrita/ });
    fireEvent.change(within(line).getByLabelText("Vacina"), { target: { value: "15" } });
    fireEvent.change(within(line).getByLabelText("Dose"), { target: { value: "D1" } });
    fireEvent.change(within(line).getByLabelText("Data da aplicação"), { target: { value: "2026-07-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar transcrição" }));
    await waitFor(() => expect(api.recordTranscriptions).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Outro cidadão" }));
    resolve({ immunizations: [], card: card() });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByLabelText("CPF")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Joana Lima" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
