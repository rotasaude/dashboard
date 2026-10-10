// src/modules/documents/PrescriptionForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, searchMedications: vi.fn(), listNursingProtocols: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError, type PrescriptionInput } from "../../lib/api";
import { ANTIMICROBIAL_NOTE, NO_PROTOCOL, itemFromProtocolItem, type PrescriptionDraft } from "../../lib/clinicalDocuments";
import { PrescriptionForm } from "./PrescriptionForm";
import { AMOXICILLIN, CLONAZEPAM, DIPYRONE_REF, TODAY19C, nursingProtocol, searchItem } from "../../test/documentFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const EMPTY: PrescriptionDraft = { items: [], protocolVersionId: "" };

function renderIt(cboCode: string, onSubmit: (c: PrescriptionInput) => Promise<void> = vi.fn(async () => {}), initial: PrescriptionDraft = EMPTY) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<PrescriptionForm cboCode={cboCode} unitId="u1" today={TODAY19C} initial={initial} onSubmit={onSubmit} onCancel={vi.fn()}
    searchDelayMs={0} />, { wrapper });
  return onSubmit;
}

async function pick(term: string, name: string) {
  fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: term } });
  const list = await screen.findByRole("list", { name: "resultados: Buscar medicamento" });
  fireEvent.click(within(list).getByRole("button", { name }));
}

function fill(n: number, values: { quantity?: string; unit?: string; route?: string; dosage?: string; duration?: string }) {
  if (values.quantity !== undefined) fireEvent.change(screen.getByLabelText(`Quantidade ${n}`), { target: { value: values.quantity } });
  if (values.unit !== undefined) fireEvent.change(screen.getByLabelText(`Unidade ${n}`), { target: { value: values.unit } });
  if (values.route !== undefined) fireEvent.change(screen.getByLabelText(`Via ${n}`), { target: { value: values.route } });
  if (values.dosage !== undefined) fireEvent.change(screen.getByLabelText(`Posologia ${n}`), { target: { value: values.dosage } });
  if (values.duration !== undefined) fireEvent.change(screen.getByLabelText(`Duração em dias ${n}`), { target: { value: values.duration } });
}

describe("PrescriptionForm", () => {
  beforeEach(() => {
    mocked(api.searchMedications).mockReset();
    mocked(api.listNursingProtocols).mockReset();
    mocked(api.searchMedications).mockResolvedValue([ searchItem(), AMOXICILLIN, CLONAZEPAM ]);
    mocked(api.listNursingProtocols).mockResolvedValue([ nursingProtocol() ]);
  });

  it("médica: inclui do catálogo (REMUME marcada) e em texto livre, e manda a receita", async () => {
    const onSubmit = renderIt("225142");
    await pick("metf", "Metformina, cloridrato 850 mg, comprimido");
    const first = screen.getByRole("listitem", { name: "item 1" });
    expect(within(first).getByText("na rede")).not.toBeNull();
    expect((screen.getByLabelText("Unidade 1") as HTMLInputElement).value).toBe("comprimido");
    fill(1, { quantity: "60", route: "oral", dosage: "1 comprimido após o café e 1 após o jantar", duration: "30" });
    fireEvent.click(screen.getByLabelText("Uso contínuo 1"));
    fireEvent.click(screen.getByRole("button", { name: "Incluir em texto livre" }));
    fireEvent.change(screen.getByLabelText("Medicamento 2 (texto livre)"), { target: { value: "Soro fisiológico 0,9%" } });
    fill(2, { quantity: "1", unit: "frasco", route: "nasal", dosage: "2 jatos em cada narina 3 vezes ao dia" });
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ items: [
      { catalog_item: { id: "ci1" }, quantity: 60, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido após o café e 1 após o jantar", duration_days: 30, continuous: true },
      { free_text: "Soro fisiológico 0,9%", quantity: 1, quantity_unit: "frasco", route: "nasal",
        dosage_instructions: "2 jatos em cada narina 3 vezes ao dia", continuous: false }
    ] }));
    expect(api.searchMedications).toHaveBeenCalledWith("metf", "u1");
    expect(api.listNursingProtocols).not.toHaveBeenCalled();
  });

  it("controlado não entra: o botão vem desligado com o aviso do 19d", async () => {
    renderIt("225142");
    fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: "clon" } });
    const list = await screen.findByRole("list", { name: "resultados: Buscar medicamento" });
    fireEvent.click(within(list).getByRole("button", { name: "Clonazepam 2 mg, comprimido" }));
    expect(screen.queryByRole("listitem", { name: "item 1" })).toBeNull();
    expect(within(list).getByText("receita de controle especial — 19d")).not.toBeNull();
  });

  it("antimicrobiano: avisa papel, 2 vias e 10 dias antes de emitir", async () => {
    renderIt("225142");
    expect(screen.queryByRole("note")).toBeNull();
    await pick("amox", "Amoxicilina 500 mg, cápsula");
    expect(screen.getByRole("note").textContent).toBe(ANTIMICROBIAL_NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Remover item 1" }));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("faltando campo: lista o que falta por item e não manda", async () => {
    const onSubmit = renderIt("225142");
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    expect((await screen.findByRole("alert")).textContent).toBe("inclua ao menos um medicamento");
    fireEvent.click(screen.getByRole("button", { name: "Incluir em texto livre" }));
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    const items = within(await screen.findByRole("alert")).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain("item 1: escolha um medicamento do catálogo ou escreva em texto livre");
    expect(items).toContain("item 1: escolha a via");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("enfermeira: escolhe o protocolo vigente, só itens dele, sem texto livre; acima da dose máxima não manda", async () => {
    const onSubmit = renderIt("223565");
    const select = await screen.findByLabelText("Protocolo de enfermagem");
    expect(screen.queryByLabelText("Buscar medicamento")).toBeNull();
    expect(screen.queryByRole("button", { name: "Incluir em texto livre" })).toBeNull();
    fireEvent.change(select, { target: { value: "npv1" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir Dipirona sódica 500 mg/mL, solução oral" }));
    expect(screen.getByText("protocolo: até 2 frasco")).not.toBeNull();
    fill(1, { quantity: "3", unit: "frasco", route: "oral", dosage: "20 gotas até de 6 em 6 horas" });
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    const problems = within(await screen.findByRole("alert")).getAllByRole("listitem").map((li) => li.textContent);
    expect(problems).toEqual([ "item 1: acima da dose máxima do protocolo (até 2 frasco)" ]);
    expect(onSubmit).not.toHaveBeenCalled();
    fill(1, { quantity: "1" });
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      items: [ { catalog_item: { id: "ci4" }, quantity: 1, quantity_unit: "frasco", route: "oral", dosage_instructions: "20 gotas até de 6 em 6 horas", continuous: false } ],
      nursing_protocol: { version_id: "npv1" }
    }));
  });

  it("enfermeira reemitindo com versão de protocolo que não está mais vigente: zera a versão e os itens e não manda o id velho", async () => {
    const protocolItem = nursingProtocol().current_version!.items[0];
    const onSubmit = renderIt("223565", vi.fn(async () => {}), { items: [ itemFromProtocolItem(protocolItem) ], protocolVersionId: "npv0" });
    expect(await screen.findByRole("status")).not.toBeNull();
    expect(screen.getByRole("status").textContent)
      .toBe("a versão do protocolo do documento anterior não está mais vigente — escolha o protocolo e os itens de novo");
    expect((screen.getByLabelText("Protocolo de enfermagem") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("nenhum medicamento na receita")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    const problems = within(await screen.findByRole("alert")).getAllByRole("listitem").map((li) => li.textContent);
    expect(problems).toContain("escolha o protocolo de enfermagem");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Protocolo de enfermagem"), { target: { value: "npv1" } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("enfermeira reemitindo com versão ainda vigente: mantém a versão e os itens", async () => {
    const protocolItem = nursingProtocol().current_version!.items[0];
    renderIt("223565", vi.fn(async () => {}), { items: [ itemFromProtocolItem(protocolItem) ], protocolVersionId: "npv1" });
    await screen.findByRole("list", { name: "itens do protocolo" });
    expect((screen.getByLabelText("Protocolo de enfermagem") as HTMLSelectElement).value).toBe("npv1");
    expect(screen.getByRole("list", { name: "itens da receita" })).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("enfermeira sem protocolo vigente: diz que não prescreve sem ele", async () => {
    mocked(api.listNursingProtocols).mockResolvedValue([
      nursingProtocol({ current_version: { id: "npv0", version: 0, valid_from: "2024-01-01", valid_until: "2025-12-31", items: [] } })
    ]);
    renderIt("223565");
    expect((await screen.findByRole("alert")).textContent).toBe(NO_PROTOCOL);
    expect(screen.queryByLabelText("Protocolo de enfermagem")).toBeNull();
  });

  it("CNPJ da cidade faltando: a frase diz quem resolve e o formulário fica preenchido", async () => {
    renderIt("223565", vi.fn(async () => { throw new ApiError(422, { error: "city_cnpj_missing" }, "422"); }));
    fireEvent.change(await screen.findByLabelText("Protocolo de enfermagem"), { target: { value: "npv1" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir Dipirona sódica 500 mg/mL, solução oral" }));
    fill(1, { quantity: "1", unit: "frasco", route: "oral", dosage: "20 gotas" });
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("a cidade ainda não cadastrou o CNPJ — sem ele a receita de enfermagem não sai; avise o administrador da cidade");
    expect((screen.getByLabelText("Quantidade 1") as HTMLInputElement).value).toBe("1");
  });

  it("enfermeira: item de protocolo antimicrobiano avisa papel, 2 vias e 10 dias antes de emitir", async () => {
    mocked(api.listNursingProtocols).mockResolvedValue([ nursingProtocol({
      current_version: { id: "npv1", version: 1, valid_from: "2025-03-01", valid_until: null, items: [
        { catalog_item: { ...DIPYRONE_REF, antimicrobial: false, controlled: false }, max_dose: { quantity: 2, unit: "frasco" } },
        { catalog_item: { id: "ci2", catmat_code: 267621, label: "Amoxicilina 500 mg, cápsula", active_ingredient: "amoxicilina", strength: "500 mg", dosage_form: "cápsula", antimicrobial: true, controlled: false }, max_dose: { quantity: 21, unit: "cápsula" } }
      ] }
    }) ]);
    renderIt("223565");
    fireEvent.change(await screen.findByLabelText("Protocolo de enfermagem"), { target: { value: "npv1" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir Dipirona sódica 500 mg/mL, solução oral" }));
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Incluir Amoxicilina 500 mg, cápsula" }));
    expect(screen.getByRole("note").textContent).toBe(ANTIMICROBIAL_NOTE);
    expect(screen.getByText("antimicrobiano")).not.toBeNull();
  });

  it("quantidade com até 2 casas decimais é aceita e vai como número", async () => {
    const onSubmit = renderIt("223565");
    fireEvent.change(await screen.findByLabelText("Protocolo de enfermagem"), { target: { value: "npv1" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir Dipirona sódica 500 mg/mL, solução oral" }));
    fill(1, { quantity: "1,5", unit: "frasco", route: "oral", dosage: "20 gotas" });
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((onSubmit as ReturnType<typeof vi.fn>).mock.calls[0][0].items[0].quantity).toBe(1.5);
  });

  it("recusa do api por item: aparece no formulário com o índice e o campo, e o formulário continua preenchido", async () => {
    renderIt("225142", vi.fn(async () => { throw new ApiError(422, { error: "invalid_item", index: 1, field: "quantity" }, "422"); }));
    await pick("metf", "Metformina, cloridrato 850 mg, comprimido");
    fill(1, { quantity: "60", route: "oral", dosage: "1 comprimido por dia" });
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    expect((await screen.findByRole("alert")).textContent).toBe("item 2: confira quantidade");
    expect((screen.getByLabelText("Posologia 1") as HTMLTextAreaElement).value).toBe("1 comprimido por dia");
  });

  it("duplo clique: manda uma vez só e trava os botões enquanto a requisição está em voo", async () => {
    let finish: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderIt("225142", onSubmit);
    await pick("metf", "Metformina, cloridrato 850 mg, comprimido");
    fill(1, { quantity: "60", route: "oral", dosage: "1 comprimido por dia" });
    const form = screen.getByRole("form", { name: "Receita" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Emitir receita" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() => expect((screen.getByRole("button", { name: "Emitir receita" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("busy de fora desliga os botões e não deixa enviar", async () => {
    const client = new QueryClient();
    const onSubmit = vi.fn(async () => {});
    render(<QueryClientProvider client={client}>
      <PrescriptionForm cboCode="225142" today={TODAY19C} busy onSubmit={onSubmit} onCancel={vi.fn()} searchDelayMs={0}
        initial={{ items: [], protocolVersionId: "" }} />
    </QueryClientProvider>);
    expect((screen.getByRole("button", { name: "Emitir receita" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Receita" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
