// Prescrição interna da urgência (módulo 32b, F-32.8; api-shapes §3–§5): emitir, alterar em versão nova (mantém a grade da
// primeira dose) e suspender com motivo. Controlado de qualquer lista é aceito, com a marca (P1). Nada clínico fora do corpo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  searchUrgencyMedication: vi.fn(), issueUrgencyPrescription: vi.fn(), suspendUrgencyPrescription: vi.fn()
}));

import * as api from "../../lib/api";
import { ApiError, type UrgencyEncounter, type UrgencyMedicationHit } from "../../lib/api";
import { UPA } from "../../test/urgencyFixtures";
import { catalogItem, observedEncounter, prescription, prescriptionItem } from "../../test/urgencyObservationFixtures";
import { PrescriptionPanel } from "./PrescriptionPanel";

const hit = (o: Partial<UrgencyMedicationHit> = {}): UrgencyMedicationHit => ({
  catalog_item_id: "cat-dipirona", catmat_code: 267501, name: "Dipirona", strength: "500 mg/mL", dosage_form: "solução injetável",
  unit: "mg", controlled_list: null, ...o
});
const DIPIRONA = "Dipirona 500 mg/mL solução injetável";

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  vi.mocked(api.searchUrgencyMedication).mockReset();
  vi.mocked(api.issueUrgencyPrescription).mockReset();
  vi.mocked(api.suspendUrgencyPrescription).mockReset();
});

function mountPanel(encounter: UrgencyEncounter, o: { consultationStarted?: boolean; onChanged?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChanged = o.onChanged ?? vi.fn();
  render(
    <QueryClientProvider client={client}>
      <PrescriptionPanel encounter={encounter} unit={UPA} consultationStarted={o.consultationStarted ?? true} onChanged={onChanged} />
    </QueryClientProvider>
  );
  return { onChanged };
}
async function pickMedication(label: string, term: string, resultName: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: term } });
  fireEvent.click(await screen.findByRole("button", { name: resultName }));
}
const issueCalls = () => vi.mocked(api.issueUrgencyPrescription).mock.calls;

describe("PrescriptionPanel", () => {
  it("sem consulta iniciada, pede a consulta antes; sem prescrição ativa, oferece 'Prescrever'", () => {
    mountPanel(observedEncounter({ consultation_id: null, consultation_status: null, prescription: null }), { consultationStarted: false });
    expect(screen.getByText("inicie a consulta de urgência antes de prescrever")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Prescrever" })).toBeNull();
    cleanup();
    mountPanel(observedEncounter({ prescription: null }));
    expect(screen.getByText("Sem prescrição ativa")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Prescrever" })).not.toBeNull();
  });

  it("lê a versão ativa: item, controlado com a lista, via, frequência e quem prescreveu (nome nulo vira texto)", () => {
    mountPanel(observedEncounter({ prescription: prescription({ version: 3, prescribed_by: { name: null, cbo_code: "225125" }, items: [
      prescriptionItem({ catalog_item: catalogItem({ name: "Morfina 10 mg/mL" }), controlled: true, controlled_list: "A1", dose: "2.5", dose_unit: "mg", route: "subcutaneous",
        frequency: { kind: "if_needed", interval_hours: null, max_per_day: 4 }, instructions: "lento" }) ] }) }));
    const sec = screen.getByRole("region", { name: "Prescrição da urgência" });
    expect(within(sec).getByText(/versão 3/i)).not.toBeNull();
    expect(within(sec).getByText("Morfina 10 mg/mL")).not.toBeNull();
    expect(within(sec).getByText("controlado · lista A1")).not.toBeNull();
    expect(within(sec).getByText(/2\.5 mg/)).not.toBeNull();
    expect(within(sec).getByText(/se necessário, até 4 por dia/)).not.toBeNull();
    expect(within(sec).getByText(/lento/)).not.toBeNull();
    expect(sec.textContent).not.toMatch(/null/);
  });

  it("emitir: mostra todas as recusas locais de uma vez, aceita vírgula na dose e faz uma só chamada", async () => {
    vi.mocked(api.searchUrgencyMedication).mockResolvedValue([ hit() ]);
    vi.mocked(api.issueUrgencyPrescription).mockResolvedValue(prescription());
    mountPanel(observedEncounter({ prescription: null }));
    fireEvent.click(screen.getByRole("button", { name: "Prescrever" }));
    fireEvent.click(screen.getByRole("button", { name: "Emitir prescrição" }));
    expect(screen.getByText("item 1: escolha o medicamento")).not.toBeNull();
    expect(screen.getByText(/item 1: informe a dose/)).not.toBeNull();
    expect(screen.getByText("item 1: escolha a unidade da dose")).not.toBeNull();
    expect(issueCalls()).toHaveLength(0);
    await pickMedication("Medicamento do item 1", "dipi", DIPIRONA);
    fireEvent.change(screen.getByLabelText("Dose do item 1"), { target: { value: "0,5" } });
    fireEvent.change(screen.getByLabelText("Unidade da dose do item 1"), { target: { value: "g" } });
    fireEvent.change(screen.getByLabelText("Via do item 1"), { target: { value: "intravenous" } });
    fireEvent.click(screen.getByRole("radio", { name: "De tantas em tantas horas (item 1)" }));
    fireEvent.change(screen.getByLabelText("Intervalo em horas do item 1"), { target: { value: "6" } });
    const send = screen.getByRole("button", { name: "Emitir prescrição" });
    fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(issueCalls()).toEqual([ [ "en3", [ { catalog_item_id: "cat-dipirona", dose: "0.5", dose_unit: "g",
      route: "intravenous", frequency: { kind: "interval", interval_hours: 6 } } ] ] ]));
    expect(await screen.findByText("Prescrição emitida (versão 1).")).not.toBeNull();
  });

  it("controlado de qualquer lista é aceito, com a marca, sem bloqueio (P1)", async () => {
    vi.mocked(api.searchUrgencyMedication).mockResolvedValue([ hit({ catalog_item_id: "cat-morfina", name: "Morfina", strength: "10 mg/mL", dosage_form: null, controlled_list: "A1" }) ]);
    vi.mocked(api.issueUrgencyPrescription).mockResolvedValue(prescription());
    mountPanel(observedEncounter({ prescription: null }));
    fireEvent.click(screen.getByRole("button", { name: "Prescrever" }));
    fireEvent.change(screen.getByLabelText("Medicamento do item 1"), { target: { value: "morf" } });
    const result = await screen.findByRole("button", { name: "Morfina 10 mg/mL" });
    expect((result as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("controlado · lista A1")).not.toBeNull();
    fireEvent.click(result);
    expect(screen.getByText("controlado · lista A1")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Dose do item 1"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Unidade da dose do item 1"), { target: { value: "mg" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir prescrição" }));
    await waitFor(() => expect(issueCalls()[0][1][0]).toMatchObject({ catalog_item_id: "cat-morfina", dose: "2" }));
  });

  it("alterar abre os itens da ativa, mantém a grade da primeira dose, com fuso explícito, e cria a versão nova", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-11-10T14:20:00-03:00"));
    vi.mocked(api.issueUrgencyPrescription).mockResolvedValue(prescription({ id: "pr2", version: 2, supersedes_id: "pr1" }));
    const { onChanged } = mountPanel(observedEncounter());
    fireEvent.click(screen.getByRole("button", { name: "Alterar prescrição" }));
    expect(screen.getByText("Alterar sempre cria uma versão nova; a anterior fica registrada como está.")).not.toBeNull();
    expect((screen.getByLabelText("Dose do item 1") as HTMLInputElement).value).toBe("1");
    fireEvent.change(screen.getByLabelText("Dose do item 1"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir versão 2" }));
    await waitFor(() => expect(issueCalls()).toHaveLength(1));
    // Original 08:00 de 6 em 6 h; agora 14:20 → o piso é 13:21 → a próxima da grade é 14:00.
    expect(issueCalls()[0][1][0]).toMatchObject({ dose: "2", first_dose_at: "2026-11-10T14:00:00-03:00", catalog_item_id: "cat-dipirona",
      frequency: { kind: "interval", interval_hours: 6 } });
    expect(await screen.findByText("Versão 2 ativa; a versão 1 ficou substituída.")).not.toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it("primeira dose escolhida na tela vai com o fuso do navegador, nunca sem offset", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-11-10T14:20:00-03:00"));
    vi.mocked(api.searchUrgencyMedication).mockResolvedValue([ hit() ]);
    vi.mocked(api.issueUrgencyPrescription).mockResolvedValue(prescription());
    mountPanel(observedEncounter({ prescription: null }));
    fireEvent.click(screen.getByRole("button", { name: "Prescrever" }));
    await pickMedication("Medicamento do item 1", "dipi", DIPIRONA);
    fireEvent.change(screen.getByLabelText("Dose do item 1"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Unidade da dose do item 1"), { target: { value: "g" } });
    const local = new Date("2026-11-10T15:00:00-03:00");
    const pad = (n: number) => String(n).padStart(2, "0");
    fireEvent.change(screen.getByLabelText("Primeira dose (opcional) do item 1"),
      { target: { value: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}` } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir prescrição" }));
    await waitFor(() => expect(issueCalls()).toHaveLength(1));
    const sent = issueCalls()[0][1][0].first_dose_at as string;
    expect(sent).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
    expect(Date.parse(sent)).toBe(Date.parse("2026-11-10T15:00:00-03:00"));
  });

  it("suspender: motivo de 10 a 500 e confirmação; depois chama o api e relê", async () => {
    vi.mocked(api.suspendUrgencyPrescription).mockResolvedValue(prescription({ status: "suspended" }));
    const { onChanged } = mountPanel(observedEncounter());
    fireEvent.click(screen.getByRole("button", { name: "Suspender prescrição" }));
    fireEvent.change(screen.getByLabelText("Motivo da suspensão"), { target: { value: "123456789" } });
    expect(screen.getByText("o motivo tem de 10 a 500 caracteres")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Suspender" }));
    expect(vi.mocked(api.suspendUrgencyPrescription)).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo da suspensão"), { target: { value: "1234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "Suspender" }));
    expect(screen.getByText("A prescrição suspensa não volta; para retomar, prescreva de novo. Confirmar?")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.suspendUrgencyPrescription).mock.calls).toEqual([ [ "pr1", "1234567890" ] ]));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText("Prescrição suspensa.")).not.toBeNull();
  });

  it("prescription_not_active na suspensão mostra a frase e relê o detalhe", async () => {
    vi.mocked(api.suspendUrgencyPrescription).mockRejectedValue(new ApiError(422, { error: "prescription_not_active" }, "x"));
    const { onChanged } = mountPanel(observedEncounter());
    fireEvent.click(screen.getByRole("button", { name: "Suspender prescrição" }));
    fireEvent.change(screen.getByLabelText("Motivo da suspensão"), { target: { value: "reação alérgica leve" } });
    fireEvent.click(screen.getByRole("button", { name: "Suspender" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("esta prescrição não é mais a ativa — a tela foi atualizada")).not.toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it("recusa do api com problems[] mostra cada item, no item certo, sem apagar o que foi digitado", async () => {
    vi.mocked(api.searchUrgencyMedication).mockResolvedValue([ hit() ]);
    vi.mocked(api.issueUrgencyPrescription).mockRejectedValue(new ApiError(422, { error: "catalog_item_invalid", path: "items.0.catalog_item_id", problems: [
      { error: "catalog_item_invalid", path: "items.0.catalog_item_id" }, { error: "invalid_request", path: "items.0.frequency.interval_hours" } ] }, "x"));
    mountPanel(observedEncounter({ prescription: null }));
    fireEvent.click(screen.getByRole("button", { name: "Prescrever" }));
    await pickMedication("Medicamento do item 1", "dipi", DIPIRONA);
    fireEvent.change(screen.getByLabelText("Dose do item 1"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Unidade da dose do item 1"), { target: { value: "g" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir prescrição" }));
    const item = screen.getByRole("group", { name: "Item 1" });
    expect(await within(item).findByText(/este medicamento saiu do catálogo/)).not.toBeNull();
    expect(within(item).getByText("item 1: confira a frequência")).not.toBeNull();
    expect((screen.getByLabelText("Dose do item 1") as HTMLInputElement).value).toBe("1");
  });

  it("consulta_required e encounter_closed do api viram a frase; nada de termo na URL nem em storage", async () => {
    vi.mocked(api.searchUrgencyMedication).mockResolvedValue([ hit() ]);
    vi.mocked(api.issueUrgencyPrescription).mockRejectedValue(new ApiError(422, { error: "consultation_required" }, "x"));
    mountPanel(observedEncounter({ prescription: null }));
    fireEvent.click(screen.getByRole("button", { name: "Prescrever" }));
    await pickMedication("Medicamento do item 1", "dipi", DIPIRONA);
    fireEvent.change(screen.getByLabelText("Dose do item 1"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Unidade da dose do item 1"), { target: { value: "g" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir prescrição" }));
    expect(await screen.findByText("inicie a consulta de urgência antes de prescrever")).not.toBeNull();
    expect(window.location.href).not.toMatch(/dipi/);
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toMatch(/dipi|Dipirona/);
  });

  it("limites: adicionar até 20 itens e remover; o 20º some o 'Adicionar item'", () => {
    mountPanel(observedEncounter({ prescription: null }));
    fireEvent.click(screen.getByRole("button", { name: "Prescrever" }));
    expect(screen.queryByRole("button", { name: "Remover item 1" })).toBeNull();
    for (let i = 1; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Adicionar item" }));
    expect(screen.getAllByRole("group", { name: /^Item \d+$/ })).toHaveLength(20);
    expect(screen.queryByRole("button", { name: "Adicionar item" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remover item 20" }));
    expect(screen.getByRole("button", { name: "Adicionar item" })).not.toBeNull();
  });

  it("o intervalo e o máximo por dia só aparecem no tipo certo", () => {
    mountPanel(observedEncounter({ prescription: null }));
    fireEvent.click(screen.getByRole("button", { name: "Prescrever" }));
    expect(screen.queryByLabelText("Intervalo em horas do item 1")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Se necessário (item 1)" }));
    expect(screen.getByLabelText("Máximo por dia do item 1")).not.toBeNull();
    expect(screen.queryByLabelText("Intervalo em horas do item 1")).toBeNull();
  });
});
