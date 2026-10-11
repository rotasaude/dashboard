// src/modules/documents/NotificationRecordForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, searchMedications: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError, type MedicationSearchItem, type NotificationRecordInput } from "../../lib/api";
import { NOTIFICATION_NOTE } from "../../lib/controlled";
import { NotificationRecordForm } from "./NotificationRecordForm";
import { CLONAZEPAM_B1, MORPHINE, SERTRALINE } from "../../test/controlledFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderForm(onSubmit: (c: NotificationRecordInput) => Promise<void> = vi.fn(async () => {}), busy?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotificationRecordForm unitId="u1" defaultUf="PR" onSubmit={onSubmit} onCancel={vi.fn()} searchDelayMs={0} busy={busy} />
    </QueryClientProvider>
  );
  return onSubmit as ReturnType<typeof vi.fn>;
}

async function pick(med: MedicationSearchItem) {
  mocked(api.searchMedications).mockResolvedValueOnce([ med ]);
  fireEvent.change(screen.getByLabelText("Buscar medicamento (listas A e B)"), { target: { value: med.label.slice(0, 6) } });
  fireEvent.click(await screen.findByRole("button", { name: med.label }));
}

function fill(days = "30", quantity = "30") {
  fireEvent.change(screen.getByLabelText("Número do talão"), { target: { value: "PR0012345" } });
  fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: quantity } });
  fireEvent.change(screen.getByLabelText("Via"), { target: { value: "oral" } });
  fireEvent.change(screen.getByLabelText("Duração em dias"), { target: { value: days } });
  fireEvent.change(screen.getByLabelText("Posologia"), { target: { value: "1 comprimido à noite" } });
}

afterEach(cleanup);

describe("NotificationRecordForm", () => {
  beforeEach(() => { vi.clearAllMocks(); mocked(api.searchMedications).mockReset(); });

  it("registra: o tipo vem da lista do item, a UF é a da cidade e o corpo vai certo", async () => {
    const onSubmit = renderForm();
    expect(screen.getByRole("note").textContent).toBe(NOTIFICATION_NOTE);
    await pick(CLONAZEPAM_B1);
    expect((screen.getByLabelText("Tipo da Notificação") as HTMLSelectElement).value).toBe("B");
    expect((screen.getByLabelText("UF da numeração") as HTMLSelectElement).value).toBe("PR");
    expect((screen.getByLabelText("Unidade") as HTMLInputElement).value).toBe("comprimido");
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Registrar Notificação" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      notification_type: "B", paper_number: "PR0012345", numbering_uf: "PR",
      item: { catalog_item: { id: "ci3" }, quantity: 30, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido à noite", duration_days: 30 }
    }));
  });

  it("dosage_form nulo não quebra: a unidade fica vazia para a pessoa preencher", async () => {
    renderForm();
    await pick({ ...CLONAZEPAM_B1, dosage_form: null });
    expect((screen.getByLabelText("Unidade") as HTMLInputElement).value).toBe("");
  });

  it("quantidade decimal vai como número", async () => {
    const onSubmit = renderForm();
    await pick(CLONAZEPAM_B1);
    fill("30", "0,5");
    fireEvent.click(screen.getByRole("button", { name: "Registrar Notificação" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].item.quantity).toBe(0.5);
  });

  it("item fora das listas A/B fica bloqueado na busca", async () => {
    mocked(api.searchMedications).mockResolvedValue([ SERTRALINE, MORPHINE ]);
    renderForm();
    fireEvent.change(screen.getByLabelText("Buscar medicamento (listas A e B)"), { target: { value: "mo" } });
    const list = await screen.findByRole("list", { name: "resultados: Buscar medicamento (listas A e B)" });
    expect((within(list).getByRole("button", { name: SERTRALINE.label }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(list).getByText("não é de Notificação (listas A/B)")).not.toBeNull();
    expect((within(list).getByRole("button", { name: MORPHINE.label }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("tipo que não bate com a lista do item: diz e não manda", async () => {
    const onSubmit = renderForm();
    await pick(CLONAZEPAM_B1);
    fireEvent.change(screen.getByLabelText("Tipo da Notificação"), { target: { value: "A" } });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Registrar Notificação" }));
    expect(screen.getByRole("alert").textContent).toBe("o medicamento é da lista B1: a Notificação é B");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Notificação A até 30 dias", async () => {
    const onSubmit = renderForm();
    await pick(MORPHINE);
    fill("45");
    fireEvent.click(screen.getByRole("button", { name: "Registrar Notificação" }));
    expect(screen.getByRole("alert").textContent).toBe("duração acima de 30 dias para a Notificação A");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    [ "item_not_in_notification_list", "o medicamento não é de Notificação (listas A ou B)" ],
    [ "notification_type_mismatch", "o tipo da Notificação não bate com a lista do medicamento" ],
    [ "duration_exceeded", "duração acima do permitido (controle especial: 60 dias, 180 para anticonvulsivante; Notificação A: 30; B: 60)" ]
  ])("recusa %s do api fica no formulário, que fica preenchido", async (code, phrase) => {
    renderForm(vi.fn(async () => { throw new ApiError(422, { error: code }, "422"); }));
    await pick(CLONAZEPAM_B1);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Registrar Notificação" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(phrase);
    expect((screen.getByLabelText("Número do talão") as HTMLInputElement).value).toBe("PR0012345");
    expect((screen.getByLabelText("Posologia") as HTMLTextAreaElement).value).toBe("1 comprimido à noite");
  });

  it("invalid_content com campo item.* aparece no formulário", async () => {
    renderForm(vi.fn(async () => { throw new ApiError(422, { error: "invalid_content", field: "item.quantity" }, "422"); }));
    await pick(CLONAZEPAM_B1);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Registrar Notificação" }));
    expect((await screen.findByRole("alert")).textContent).toContain("quantidade");
  });

  it("duplo clique: um registro só (estado + ref)", async () => {
    let release!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    renderForm(onSubmit);
    await pick(CLONAZEPAM_B1);
    fill();
    const form = screen.getByRole("form", { name: "Notificação de papel" });
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { release(); });
    expect((screen.getByRole("button", { name: "Registrar Notificação" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("busy externo desliga os botões e não registra", async () => {
    const onSubmit = renderForm(undefined, true);
    expect((screen.getByRole("button", { name: "Registrar Notificação" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Notificação de papel" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trocar o medicamento volta para a busca", async () => {
    renderForm();
    await pick(CLONAZEPAM_B1);
    fireEvent.click(screen.getByRole("button", { name: "Trocar medicamento" }));
    expect(screen.getByLabelText("Buscar medicamento (listas A e B)")).not.toBeNull();
  });
});
