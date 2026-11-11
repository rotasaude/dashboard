// Aprazamento e checagem da medicação na UPA (módulo 32b, F-32.8; api-shapes §3–§5): leitura só sob demanda (grava trilha), horários
// com estado por texto, checagem com confirmação forte, estoque (lote FEFO e quantidade) só com a baixa utilizável e a falta como aviso.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()), getMedicationSchedule: vi.fn(), recordAdministration: vi.fn(),
  getUrgencyQueue: vi.fn(), getUrgencyObservation: vi.fn(), getUrgencyEncounter: vi.fn()
}));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { UPA, inCareRow, queue, urgencyUser } from "../../test/urgencyFixtures";
import {
  NOW32B, TECH_LINK, administration, observationMap, prescriptionItem, schedule, scheduleItem
} from "../../test/urgencyObservationFixtures";
import { MedicationPanel } from "./MedicationPanel";
import { UrgencyDesk } from "./UrgencyDesk";

const LABEL = "Dipirona 500 mg/mL solução injetável";
const CHECK_14 = `Checar 14:00 — ${LABEL}`;
const TARGET = { encounterId: "en3", ticket: "U-038", patientName: "João Reis" };

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  for (const f of [ api.getMedicationSchedule, api.recordAdministration, api.getUrgencyQueue, api.getUrgencyObservation, api.getUrgencyEncounter ]) {
    vi.mocked(f).mockReset();
  }
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function mountPanel(props: Partial<React.ComponentProps<typeof MedicationPanel>> = {}) {
  const onClose = vi.fn(); const onEncounterClosed = vi.fn();
  render(<QueryClientProvider client={client()}>
    <MedicationPanel target={TARGET} now={NOW32B} onClose={onClose} onEncounterClosed={onEncounterClosed} {...props} />
  </QueryClientProvider>);
  return { onClose, onEncounterClosed };
}
const scheduleCalls = () => vi.mocked(api.getMedicationSchedule).mock.calls.length;
const apiError = (status: number, body: unknown) => new ApiError(status, body, "x");

async function openCheck(name = CHECK_14) {
  fireEvent.click(await screen.findByRole("button", { name }));
}

describe("MedicationPanel (F-32.8)", () => {
  it("aprazamento lido sob demanda, sem polling; horários com estado por texto", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule());
    mountPanel();
    const item = await screen.findByRole("region", { name: LABEL });
    expect(within(item).getByText("08:00 · administrado por Ana Souza às 08:05")).not.toBeNull();
    expect(within(item).getByRole("button", { name: CHECK_14 })).not.toBeNull();
    expect(within(item).queryByRole("button", { name: /Checar 20:00/ })).toBeNull();
    expect(within(item).getByText("20:00 · a seguir")).not.toBeNull();
    expect(screen.getByText(/lido às \d{2}:\d{2}/)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Medicação — U-038" })).not.toBeNull();
    expect(scheduleCalls()).toBe(1);
  });

  it("horário passado sem checagem diz 'pendente desde' e ainda pode ser checado; 'Atualizar' relê uma vez", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule());
    mountPanel({ now: new Date("2026-11-10T15:00:00-03:00") });
    expect(await screen.findByText("pendente desde 14:00")).not.toBeNull();
    expect(screen.getByRole("button", { name: CHECK_14 })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(scheduleCalls()).toBe(2));
  });

  it("sem prescrição ativa diz de quem é a prescrição", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue({ prescription_id: null, stock_deduction: false, items: [] });
    mountPanel();
    expect(await screen.findByText("Sem prescrição ativa — a prescrição é do médico")).not.toBeNull();
  });

  it("última dose de versão anterior aparece como tal", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule({ items: [ scheduleItem({
      slots: [ { scheduled_at: "2026-11-10T14:00:00-03:00", administration: null } ],
      last_administration: administration({ id: "old", scheduled_at: "2026-11-10T12:00:00-03:00", administered_at: "2026-11-10T12:10:00-03:00" })
    }) ] }));
    mountPanel();
    expect(await screen.findByText("última dose: 12:10 (versão anterior)")).not.toBeNull();
  });

  it("checar: confirmação forte, uma chamada só, relê depois", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule());
    vi.mocked(api.recordAdministration).mockResolvedValue({ administration: administration({ id: "ad2", scheduled_at: "2026-11-10T14:00:00-03:00" }), shortfall: null });
    mountPanel();
    await openCheck();
    fireEvent.click(screen.getByRole("radio", { name: "Administrado" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    expect(screen.getByText("A checagem não pode ser alterada. Confirmar?")).not.toBeNull();
    const yes = screen.getByRole("button", { name: "Confirmar" });
    fireEvent.click(yes); fireEvent.click(yes);
    await waitFor(() => expect(vi.mocked(api.recordAdministration).mock.calls).toEqual([ [ {
      prescription_item_id: "pi1", scheduled_at: "2026-11-10T14:00:00-03:00", status: "administered" } ] ]));
    await waitFor(() => expect(scheduleCalls()).toBe(2));
    expect(await screen.findByText("Checagem registrada.")).not.toBeNull();
  });

  it("não administrado e recusado exigem motivo de 10 caracteres", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule());
    vi.mocked(api.recordAdministration).mockResolvedValue({ administration: administration({ status: "refused", reason: "paciente não quis tomar" }), shortfall: null });
    mountPanel();
    await openCheck();
    fireEvent.click(screen.getByRole("radio", { name: "Recusado" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "não quis" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    expect(screen.getByText("o motivo tem de 10 a 500 caracteres")).not.toBeNull();
    expect(screen.queryByText("A checagem não pode ser alterada. Confirmar?")).toBeNull();
    expect(api.recordAdministration).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "  paciente não quis tomar  " } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.recordAdministration).mock.calls).toEqual([ [ {
      prescription_item_id: "pi1", scheduled_at: "2026-11-10T14:00:00-03:00", status: "refused", reason: "paciente não quis tomar" } ] ]));
  });

  it("a confirmação nomeia o item e o horário", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule());
    mountPanel();
    await openCheck();
    expect(screen.getByText(`Checando ${LABEL} das 14:00`)).not.toBeNull();
  });

  it("slot_taken relê e mostra quem checou; encounter_closed fecha o painel", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValueOnce(schedule()).mockResolvedValue(schedule({ items: [ scheduleItem({
      slots: [
        { scheduled_at: "2026-11-10T08:00:00-03:00", administration: administration() },
        { scheduled_at: "2026-11-10T14:00:00-03:00", administration: administration({ id: "ad9", scheduled_at: "2026-11-10T14:00:00-03:00",
          administered_at: "2026-11-10T14:02:00-03:00", by: { name: "Bia Lopes", cbo_code: "322205" } }) }
      ] }) ] }));
    vi.mocked(api.recordAdministration).mockRejectedValueOnce(apiError(409, { error: "slot_taken" }));
    const { onEncounterClosed } = mountPanel();
    await openCheck();
    fireEvent.click(screen.getByRole("radio", { name: "Administrado" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("este horário já foi checado — a tela foi atualizada")).not.toBeNull();
    await waitFor(() => expect(scheduleCalls()).toBe(2));
    expect(await screen.findByText("14:00 · administrado por Bia Lopes às 14:02")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar checagem" })).toBeNull();

    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule());
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    vi.mocked(api.recordAdministration).mockRejectedValueOnce(apiError(409, { error: "encounter_closed" }));
    await openCheck();
    fireEvent.click(screen.getByRole("radio", { name: "Administrado" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(onEncounterClosed).toHaveBeenCalledTimes(1));
  });

  it("se necessário: sem horário, quantas ainda cabem; max_per_day_reached", async () => {
    const asNeeded = (remaining: number) => schedule({ items: [ scheduleItem({
      ...prescriptionItem({ id: "pi2", frequency: { kind: "if_needed", interval_hours: null, max_per_day: 3 },
        catalog_item: { ...prescriptionItem().catalog_item!, name: "Ondansetrona 2 mg/mL" } }),
      item_id: "pi2", slots: [], remaining,
      recent: [ administration({ id: "ad5", scheduled_at: null, administered_at: "2026-11-10T11:00:00-03:00" }) ], last_administration: null }) ] });
    vi.mocked(api.getMedicationSchedule).mockResolvedValueOnce(asNeeded(2));
    vi.mocked(api.recordAdministration).mockResolvedValue({ administration: administration({ scheduled_at: null }), shortfall: null });
    mountPanel();
    expect(await screen.findByText("Se necessário, até 3 por dia · ainda cabem 2 nas últimas 24 h")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar dose — Ondansetrona 2 mg/mL" }));
    fireEvent.click(screen.getByRole("radio", { name: "Administrado" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(asNeeded(0));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.recordAdministration).mock.calls).toEqual([ [ {
      prescription_item_id: "pi2", status: "administered" } ] ]));
    expect(await screen.findByText("já foram dadas todas as doses permitidas nas últimas 24 h")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar dose/ })).toBeNull();
  });

  const lots = [
    { id: "lot-a", lot_number: "A123", expires_on: "2026-12-01", balance: "3" },
    { id: "lot-b", lot_number: "B456", expires_on: "2027-03-01", balance: "10" }
  ];
  async function stockForm() {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule({ stock_deduction: true, items: [ scheduleItem({ lots }) ] }));
    mountPanel();
    await openCheck();
    fireEvent.click(screen.getByRole("radio", { name: "Administrado" }));
  }

  it("estoque ligado: lote FEFO e quantidade; só o que mudou vai no corpo; falta é aviso, não erro", async () => {
    vi.mocked(api.recordAdministration).mockResolvedValue({ administration: administration(), shortfall: { cause: "insufficient_balance" } });
    await stockForm();
    const select = screen.getByLabelText("Lote") as HTMLSelectElement;
    expect(select.value).toBe("lot-a");
    expect(within(select).getByText("A123 · vence 01/12/2026 (o que vence primeiro)")).not.toBeNull();
    expect((screen.getByLabelText("Quantidade (ampola)") as HTMLInputElement).value).toBe("1.00");
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.recordAdministration).mock.calls[0][0]).toEqual({
      prescription_item_id: "pi1", scheduled_at: "2026-11-10T14:00:00-03:00", status: "administered" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Checagem registrada. O estoque ficou com pendência para a farmácia (saldo insuficiente).");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("estoque ligado: lote e quantidade mudados vão no corpo", async () => {
    vi.mocked(api.recordAdministration).mockResolvedValue({ administration: administration(), shortfall: null });
    await stockForm();
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot-b" } });
    fireEvent.change(screen.getByLabelText("Quantidade (ampola)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.recordAdministration).mock.calls[0][0]).toEqual({
      prescription_item_id: "pi1", scheduled_at: "2026-11-10T14:00:00-03:00", status: "administered", stock_lot_id: "lot-b", stock_quantity: "2" }));
  });

  it("estoque desligado: nenhum campo de lote e nada de stock_* no corpo", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule({ stock_deduction: false }));
    vi.mocked(api.recordAdministration).mockResolvedValue({ administration: administration(), shortfall: null });
    mountPanel();
    await openCheck();
    fireEvent.click(screen.getByRole("radio", { name: "Administrado" }));
    expect(screen.queryByLabelText("Lote")).toBeNull();
    expect(screen.queryByLabelText(/^Quantidade/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(Object.keys(vi.mocked(api.recordAdministration).mock.calls[0][0]).sort()).toEqual([ "prescription_item_id", "scheduled_at", "status" ]));
  });

  it("lot_invalid relê a tela e mantém o resto do formulário", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] }); vi.setSystemTime(NOW32B);
    vi.mocked(api.recordAdministration).mockRejectedValue(apiError(422, { error: "lot_invalid", path: "stock_lot_id" }));
    await stockForm();
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot-b" } });
    fireEvent.change(screen.getByLabelText("Horário da administração"), { target: { value: "2026-11-10T13:50" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar checagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/^lote inválido para esta checagem/)).not.toBeNull();
    await waitFor(() => expect(scheduleCalls()).toBe(2));
    expect((screen.getByRole("radio", { name: "Administrado" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Horário da administração") as HTMLInputElement).value).toBe("2026-11-10T13:50");
  });

  it("Escape fora dos campos fecha e devolve o foco a quem abriu; ler/gravar não deixa rastro no armazenamento", async () => {
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule());
    const opener = document.createElement("button");
    document.body.appendChild(opener); opener.focus();
    const { onClose } = mountPanel();
    await screen.findByRole("region", { name: LABEL });
    fireEvent.keyDown(screen.getByRole("heading", { name: "Medicação — U-038" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("o técnico abre pelo mapa; o painel não lê o detalhe do encontro", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ awaiting_classification: [], by_color: [], in_care: [] }));
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap({ waiting_bed: [] }));
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule());
    render(<QueryClientProvider client={client()}>
      <UrgencyDesk unit={UPA} user={urgencyUser([ "health_professional" ])} links={[ TECH_LINK ]} />
    </QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Medicação de U-038" }));
    expect(await screen.findByRole("heading", { name: "Medicação — U-038" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: LABEL })).not.toBeNull();
    expect(api.getUrgencyEncounter).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("heading", { name: "Medicação — U-038" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Medicação — U-038" })).toBeNull());
  });

  it("o técnico abre pela fila, em 'Em atendimento'", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ awaiting_classification: [], by_color: [], in_care: [ inCareRow() ] }));
    vi.mocked(api.getUrgencyObservation).mockResolvedValue({ beds: [], waiting_bed: [] });
    vi.mocked(api.getMedicationSchedule).mockResolvedValue(schedule());
    render(<QueryClientProvider client={client()}>
      <UrgencyDesk unit={UPA} user={urgencyUser([ "health_professional" ])} links={[ TECH_LINK ]} />
    </QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Medicação U-038" }));
    expect(await screen.findByRole("heading", { name: "Medicação — U-038" })).not.toBeNull();
    expect(api.getUrgencyEncounter).not.toHaveBeenCalled();
  });
});
