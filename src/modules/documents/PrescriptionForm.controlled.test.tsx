// src/modules/documents/PrescriptionForm.controlled.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, searchMedications: vi.fn(), listNursingProtocols: vi.fn(), getProfessionalContact: vi.fn(), getSncrStock: vi.fn(),
    getCurrentCertificate: vi.fn(), getLastPatientIdentification: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError, type MedicationSearchItem, type PrescriptionInput } from "../../lib/api";
import { ANTIMICROBIAL_NOTE, CONTROLLED_BLOCKED, reissueDraft, type PrescriptionDraft } from "../../lib/clinicalDocuments";
import { CATEGORY_NOTE, MIXED_CATEGORIES, PRESCRIBER_MISSING, SNCR_SIMULATED_NOTICE } from "../../lib/controlled";
import { PrescriptionForm, type ControlledContext } from "./PrescriptionForm";
import { DIPYRONE, DIPYRONE_REF, nursingProtocol } from "../../test/documentFixtures";
import { certificate } from "../../test/signatureFixtures";
import {
  AMITRIPTYLINE, AMOXICILLIN_19D, CARBAMAZEPINE, CLONAZEPAM_B1, FLUOXETINE, ISOTRETINOIN, MORPHINE, SERTRALINE, TODAY19D,
  address, contact, rceDoc, stock
} from "../../test/controlledFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const EMPTY: PrescriptionDraft = { items: [], protocolVersionId: "" };
const CONTEXT: ControlledContext = { userId: "us1", simulated: false, signatureOn: true, consultationId: "cs1", patientCpfMasked: "***.533.447-**" };
const PAPER = "vai sair em papel";
const NURSE = "223565";

function renderForm(opts: {
  controlled?: ControlledContext | null; onSubmit?: (c: PrescriptionInput) => Promise<void>; initial?: PrescriptionDraft; cboCode?: string;
} = {}) {
  const onSubmit = opts.onSubmit ?? vi.fn(async (_c: PrescriptionInput) => {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PrescriptionForm cboCode={opts.cboCode ?? "225142"} unitId="u1" today={TODAY19D} initial={opts.initial ?? EMPTY} onSubmit={onSubmit}
        onCancel={vi.fn()} searchDelayMs={0} controlled={opts.controlled === null ? undefined : (opts.controlled ?? CONTEXT)} />
    </QueryClientProvider>
  );
  return onSubmit as ReturnType<typeof vi.fn>;
}

async function pick(med: MedicationSearchItem) {
  mocked(api.searchMedications).mockResolvedValueOnce([ med ]);
  fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: med.label.slice(0, 6) } });
  fireEvent.click(await screen.findByRole("button", { name: med.label }));
}

function fillItem(n: number, days: string) {
  const li = screen.getByRole("listitem", { name: `item ${n}` });
  fireEvent.change(within(li).getByLabelText(`Quantidade ${n}`), { target: { value: "30" } });
  fireEvent.change(within(li).getByLabelText(`Via ${n}`), { target: { value: "oral" } });
  fireEvent.change(within(li).getByLabelText(`Duração em dias ${n}`), { target: { value: days } });
  fireEvent.change(within(li).getByLabelText(`Posologia ${n}`), { target: { value: "1 comprimido ao dia" } });
}

function addFreeText(n: number, text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Incluir em texto livre" }));
  fireEvent.change(screen.getByLabelText(`Medicamento ${n} (texto livre)`), { target: { value: text } });
  fireEvent.change(screen.getByLabelText(`Unidade ${n}`), { target: { value: "comprimido" } });
  fillItem(n, "7");
}

function fillAddress() {
  const w = within(screen.getByRole("group", { name: "Identificação do paciente" }));
  fireEvent.change(w.getByLabelText("Logradouro"), { target: { value: "Rua Marechal Deodoro" } });
  fireEvent.change(w.getByLabelText("Número"), { target: { value: "630" } });
  fireEvent.change(w.getByLabelText("Bairro"), { target: { value: "Centro" } });
  fireEvent.change(w.getByLabelText("Cidade"), { target: { value: "Curitiba" } });
  fireEvent.change(w.getByLabelText("UF"), { target: { value: "PR" } });
  fireEvent.change(w.getByLabelText("CEP"), { target: { value: "80010-010" } });
}

const emit = () => fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
const alertText = () => screen.getByRole("alert").textContent;
const ADDRESS_BODY = { street: "Rua Marechal Deodoro", number: "630", district: "Centro", city: "Curitiba", uf: "PR", zip: "80010010" };
const MIXED_AT = (n: number) => `item ${n}: ${MIXED_CATEGORIES}`;

afterEach(cleanup);

describe("PrescriptionForm — controlado e antimicrobiano (19d)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.searchMedications).mockReset();
    mocked(api.listNursingProtocols).mockResolvedValue([]);
    mocked(api.getProfessionalContact).mockResolvedValue(contact());
    mocked(api.getSncrStock).mockResolvedValue(stock());
    mocked(api.getCurrentCertificate).mockResolvedValue(certificate());
    mocked(api.getLastPatientIdentification).mockResolvedValue({ cpf: "39053344705", address: address() });
  });

  it("controle especial: categoria, regras, CPF do cadastro mascarado, endereço do paciente e o corpo sem CPF", async () => {
    const onSubmit = renderForm();
    await pick(SERTRALINE);
    fillItem(1, "60");
    expect((await screen.findByRole("status", { name: "categoria da receita" })).textContent).toBe("categoria: receita de controle especial");
    expect(screen.getByRole("note", { name: "regras da categoria" }).textContent).toBe(CATEGORY_NOTE.special_control);
    expect(within(screen.getByRole("listitem", { name: "item 1" })).getByText("lista C1")).not.toBeNull();
    const id = screen.getByRole("group", { name: "Identificação do paciente" });
    expect(within(id).getByText("***.533.447-**")).not.toBeNull();
    expect(await within(screen.getByRole("group", { name: "prescritor" }))
      .findByText("Rua Ouvidor Pardinho, 28 · Rebouças · Curitiba/PR · 80230-040 · (41) 3350-1234")).not.toBeNull();

    emit();
    expect(alertText()).toContain("endereço do paciente: informe o logradouro");
    expect(onSubmit).not.toHaveBeenCalled();

    fillAddress();
    emit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // Igualdade exata: a identificação leva só o endereço (o CPF nunca vai no corpo).
    expect(onSubmit.mock.calls[0][0]).toEqual({
      items: [ { catalog_item: { id: "ci10" }, quantity: 30, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido ao dia", duration_days: 60, continuous: false } ],
      patient_identification: { address: ADDRESS_BODY }
    });
  });

  it("antimicrobiano: categoria e regra do 19d, sem identificação do paciente e sem o aviso de papel do 19c", async () => {
    const onSubmit = renderForm();
    await pick(AMOXICILLIN_19D);
    fillItem(1, "7");
    expect((await screen.findByRole("status", { name: "categoria da receita" })).textContent).toBe("categoria: receita de antimicrobiano");
    expect(screen.getByRole("note", { name: "regras da categoria" }).textContent).toBe(CATEGORY_NOTE.antimicrobial);
    expect(screen.queryByText(ANTIMICROBIAL_NOTE)).toBeNull();
    expect(screen.queryByRole("group", { name: "Identificação do paciente" })).toBeNull();
    await waitFor(() => expect(api.getCurrentCertificate).toHaveBeenCalled());
    emit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("patient_identification");
  });

  it("mistura controle especial e antimicrobiano: diz para separar e não manda", async () => {
    const onSubmit = renderForm();
    await pick(SERTRALINE);
    await pick(AMOXICILLIN_19D);
    fillItem(1, "60");
    fillItem(2, "7");
    expect(screen.getByRole("status", { name: "categoria da receita" }).textContent).toBe("categoria: misturada — separe em duas receitas");
    emit();
    expect(alertText()).toBe(MIXED_AT(2));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("comum + antimicrobiano: misturada, separe (o item comum vai numa receita comum)", async () => {
    const onSubmit = renderForm();
    await pick(DIPYRONE);
    await pick(AMOXICILLIN_19D);
    fillItem(1, "5");
    fillItem(2, "7");
    expect(screen.getByRole("status", { name: "categoria da receita" }).textContent).toBe("categoria: misturada — separe em duas receitas");
    emit();
    expect(alertText()).toBe(MIXED_AT(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("C1 + texto livre: misturada (a de controle especial só aceita itens do catálogo)", async () => {
    const onSubmit = renderForm();
    await pick(SERTRALINE);
    fillItem(1, "30");
    addFreeText(2, "chá de camomila");
    expect(screen.getByRole("status", { name: "categoria da receita" }).textContent).toBe("categoria: misturada — separe em duas receitas");
    expect(screen.queryByRole("group", { name: "Identificação do paciente" })).toBeNull();
    emit();
    expect(alertText()).toBe(MIXED_AT(2));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("só texto livre: comum para a tela, com o aviso de que antimicrobiano digitado à mão sai em papel", async () => {
    const onSubmit = renderForm();
    addFreeText(1, "amoxicilina 500 mg");
    expect(screen.getByRole("status", { name: "categoria da receita" }).textContent).toBe("categoria: receita comum");
    expect(screen.getByRole("note", { name: "itens digitados à mão" }).textContent)
      .toBe("Receita só com itens digitados à mão: se algum for antimicrobiano, ela sai em papel (itens digitados à mão — sai em papel).");
    emit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("patient_identification");
    expect(api.getSncrStock).not.toHaveBeenCalled();
  });

  it("quatro itens C1: diz o limite e não manda", async () => {
    const onSubmit = renderForm();
    for (const med of [ SERTRALINE, AMITRIPTYLINE, FLUOXETINE, CARBAMAZEPINE ]) await pick(med);
    [ 1, 2, 3, 4 ].forEach((n) => fillItem(n, "30"));
    fillAddress();
    emit();
    expect(alertText()).toBe("no máximo 3 substâncias da lista C1 por receita");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("duração acima de 60 dias, e de 180 no anticonvulsivante", async () => {
    const onSubmit = renderForm();
    await pick(SERTRALINE);
    await pick(CARBAMAZEPINE);
    fillItem(1, "90");
    fillItem(2, "120");
    fillAddress();
    emit();
    expect(alertText()).toBe("item 1: duração acima de 60 dias");
    fillItem(1, "60");
    fillItem(2, "200");
    emit();
    expect(alertText()).toBe("item 2: duração acima de 180 dias (anticonvulsivante)");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("A/B bloqueados com o caminho da Notificação; C2/C3/C4 fora; C1 entra", async () => {
    mocked(api.searchMedications).mockResolvedValue([ MORPHINE, CLONAZEPAM_B1, ISOTRETINOIN, SERTRALINE ]);
    renderForm();
    fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: "ab" } });
    const list = await screen.findByRole("list", { name: "resultados: Buscar medicamento" });
    for (const med of [ MORPHINE, CLONAZEPAM_B1, ISOTRETINOIN ]) {
      expect((within(list).getByRole("button", { name: med.label }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(within(list).getAllByText("Notificação de receita (listas A/B) — registre a de papel em “Notificação (papel)”")).toHaveLength(2);
    expect(within(list).getByText("lista C2 (retinoide, talidomida ou antirretroviral) — fora do Rota Saúde")).not.toBeNull();
    expect((within(list).getByRole("button", { name: SERTRALINE.label }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(list).getByText("controlado · lista C1")).not.toBeNull();
  });

  it("vai sair em papel: sem número, sem certificado, sem assinatura na cidade", async () => {
    mocked(api.getSncrStock).mockResolvedValue(stock({ rce: { free: 0, used: 1000, voided: 0, requests_this_month: 1 } }));
    renderForm();
    await pick(SERTRALINE);
    expect((await screen.findByRole("note", { name: PAPER })).textContent)
      .toBe("Esta receita vai sair em papel: sem número SNCR no seu estoque — obtenha números em Conta → SNCR.");
    cleanup();

    mocked(api.getSncrStock).mockResolvedValue(stock());
    mocked(api.getCurrentCertificate).mockResolvedValue(null);
    renderForm();
    await pick(SERTRALINE);
    expect((await screen.findByRole("note", { name: PAPER })).textContent)
      .toBe("Esta receita vai sair em papel: você não tem certificado digital ativo — vincule em Conta → Assinatura digital.");
    cleanup();

    renderForm({ controlled: { ...CONTEXT, signatureOn: false } });
    await pick(SERTRALINE);
    expect((await screen.findByRole("note", { name: PAPER })).textContent)
      .toBe("Esta receita vai sair em papel: a assinatura digital não está disponível na cidade.");
    // As duas primeiras telas consultaram o certificado; sem assinatura na cidade, a terceira nem consulta.
    expect(api.getCurrentCertificate).toHaveBeenCalledTimes(2);
  });

  it("com certificado e número, não prevê papel", async () => {
    renderForm();
    await pick(SERTRALINE);
    await waitFor(() => expect(api.getSncrStock).toHaveBeenCalled());
    await waitFor(() => expect(api.getCurrentCertificate).toHaveBeenCalled());
    expect(screen.queryByRole("note", { name: PAPER })).toBeNull();
  });

  it("usar a última identificação: preenche o endereço; 200 com null diz que não há anterior; 404 é erro, não 'nenhuma'", async () => {
    renderForm();
    await pick(SERTRALINE);
    fireEvent.click(screen.getByRole("button", { name: "Usar a última identificação" }));
    const id = screen.getByRole("group", { name: "Identificação do paciente" });
    await waitFor(() => expect((within(id).getByLabelText("Logradouro") as HTMLInputElement).value).toBe("Rua Marechal Deodoro"));
    expect((within(id).getByLabelText("CEP") as HTMLInputElement).value).toBe("80010-010");
    expect(api.getLastPatientIdentification).toHaveBeenCalledWith("cs1");
    cleanup();

    mocked(api.getLastPatientIdentification).mockResolvedValue(null);
    renderForm();
    await pick(SERTRALINE);
    fireEvent.click(screen.getByRole("button", { name: "Usar a última identificação" }));
    expect(await screen.findByText("nenhuma receita anterior deste paciente com identificação")).not.toBeNull();
    cleanup();

    mocked(api.getLastPatientIdentification).mockRejectedValue(new ApiError(404, { error: "not_found" }, "404"));
    renderForm();
    await pick(SERTRALINE);
    fireEvent.click(screen.getByRole("button", { name: "Usar a última identificação" }));
    expect(await screen.findByText("não encontramos o que você pediu — pode ter sido removido")).not.toBeNull();
    expect(screen.queryByText("nenhuma receita anterior deste paciente com identificação")).toBeNull();
  });

  it("sem endereço e telefone do prescritor: avisa e não emite (controle especial sempre; antimicrobiano quando sairia digital)", async () => {
    mocked(api.getProfessionalContact).mockResolvedValue({ address: null, phone: null });
    const onSubmit = renderForm();
    await pick(SERTRALINE);
    fillItem(1, "30");
    fillAddress();
    expect(await within(screen.getByRole("group", { name: "prescritor" })).findByText(PRESCRIBER_MISSING)).not.toBeNull();
    emit();
    expect(alertText()).toBe(PRESCRIBER_MISSING);
    expect(onSubmit).not.toHaveBeenCalled();
    cleanup();

    const onSubmitRet = renderForm();
    await pick(AMOXICILLIN_19D);
    fillItem(1, "7");
    expect(await within(screen.getByRole("group", { name: "prescritor" })).findByText(PRESCRIBER_MISSING)).not.toBeNull();
    await waitFor(() => expect(api.getCurrentCertificate).toHaveBeenCalled());
    emit();
    expect(alertText()).toBe(PRESCRIBER_MISSING);
    expect(onSubmitRet).not.toHaveBeenCalled();
    cleanup();

    // Sem certificado a RET já sairia em papel: o api não exige o contato (plano do api, D12) e a tela deixa emitir.
    mocked(api.getCurrentCertificate).mockResolvedValue(null);
    const onSubmitPaper = renderForm();
    await pick(AMOXICILLIN_19D);
    fillItem(1, "7");
    await screen.findByRole("note", { name: PAPER });
    emit();
    await waitFor(() => expect(onSubmitPaper).toHaveBeenCalledTimes(1));
  });

  it("SNCR simulado: faixa sem validade (pela sessão ou pelo estoque)", async () => {
    renderForm({ controlled: { ...CONTEXT, simulated: true } });
    await pick(SERTRALINE);
    expect(await screen.findByText(SNCR_SIMULATED_NOTICE)).not.toBeNull();
    cleanup();

    mocked(api.getSncrStock).mockResolvedValue(stock({ simulated: true }));
    renderForm();
    await pick(SERTRALINE);
    expect(await screen.findByText(SNCR_SIMULATED_NOTICE)).not.toBeNull();
  });

  it.each([
    [ { error: "mixed_categories", index: 0 }, MIXED_AT(1) ],
    [ { error: "too_many_c1_substances" }, "no máximo 3 substâncias da lista C1 por receita" ],
    [ { error: "duration_exceeded", index: 0 },
      "item 1: duração acima do permitido (controle especial: 60 dias, 180 para anticonvulsivante; Notificação A: 30; B: 60)" ],
    [ { error: "patient_identification_required", field: "patient_identification.address" }, "falta na identificação do paciente: endereço" ],
    [ { error: "prescriber_address_missing" }, PRESCRIBER_MISSING ],
    [ { error: "controlled_not_allowed", index: 0 }, "item 1: medicamento controlado não entra em texto livre — escolha o item no catálogo" ],
    [ { error: "invalid_content", field: "patient_identification.address.zip" }, "endereço do paciente: confira o CEP" ]
  ])("recusa do api %j fica no formulário, com o endereço do paciente", async (body, phrase) => {
    renderForm({ onSubmit: vi.fn(async () => { throw new ApiError(422, body, "422"); }) });
    await pick(SERTRALINE);
    fillItem(1, "30");
    fillAddress();
    emit();
    expect((await screen.findByRole("alert")).textContent).toBe(phrase);
    const id = screen.getByRole("group", { name: "Identificação do paciente" });
    expect((within(id).getByLabelText("Logradouro") as HTMLInputElement).value).toBe("Rua Marechal Deodoro");
    expect((within(id).getByLabelText("CEP") as HTMLInputElement).value).toBe("80010-010");
    expect((screen.getByLabelText("Posologia 1") as HTMLTextAreaElement).value).toBe("1 comprimido ao dia");
  });

  it("cancelar e emitir outro: item do documento SEM marcas segue RCE pela categoria do rascunho e leva a identificação", async () => {
    const reissued = reissueDraft(rceDoc());
    if (reissued?.kind !== "prescription") throw new Error("esperava receita");
    expect(reissued.draft.items[0].medication).not.toHaveProperty("controlled_list");
    const onSubmit = renderForm({ initial: reissued.draft });
    const id = await screen.findByRole("group", { name: "Identificação do paciente" });
    expect((within(id).getByLabelText("Complemento") as HTMLInputElement).value).toBe("apto 12");
    expect(screen.getByRole("status", { name: "categoria da receita" }).textContent).toBe("categoria: receita de controle especial");
    await within(screen.getByRole("group", { name: "prescritor" })).findByText(/Rua Ouvidor Pardinho/);
    emit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      items: [ { catalog_item: { id: "ci10" }, quantity: 60, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido pela manhã", duration_days: 60, continuous: true } ],
      patient_identification: { address: { ...ADDRESS_BODY, complement: "apto 12" } }
    });
  });

  it("enfermagem: não prescreve controle especial; antimicrobiano dela é previsto em papel", async () => {
    const SERTRALINE_PROTOCOL = { catalog_item: { ...SERTRALINE }, max_dose: { quantity: 30, unit: "comprimido" } };
    const AMOXICILLIN_PROTOCOL = { catalog_item: { ...AMOXICILLIN_19D }, max_dose: { quantity: 30, unit: "cápsula" } };
    mocked(api.listNursingProtocols).mockResolvedValue([ nursingProtocol({
      current_version: { id: "npv1", version: 1, valid_from: "2025-03-01", valid_until: null, items: [
        { catalog_item: { ...DIPYRONE_REF, antimicrobial: false, controlled: false }, max_dose: { quantity: 2, unit: "frasco" } },
        SERTRALINE_PROTOCOL, AMOXICILLIN_PROTOCOL
      ] }
    }) ]);
    const onSubmit = renderForm({ cboCode: NURSE });
    fireEvent.change(await screen.findByLabelText("Protocolo de enfermagem"), { target: { value: "npv1" } });
    fireEvent.click(screen.getByRole("button", { name: `Incluir ${SERTRALINE.label}` }));
    fillItem(1, "30");
    expect(screen.queryByRole("group", { name: "Identificação do paciente" })).toBeNull();
    emit();
    expect(alertText()).toBe("item 1: a enfermagem não prescreve receita de controle especial");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remover item 1" }));
    fireEvent.click(screen.getByRole("button", { name: `Incluir ${AMOXICILLIN_19D.label}` }));
    fillItem(1, "7");
    expect((await screen.findByRole("note", { name: PAPER })).textContent)
      .toBe("Esta receita vai sair em papel: a receita de antimicrobiano da enfermagem sai sempre em papel.");
    expect(api.getSncrStock).not.toHaveBeenCalled();
    expect(api.getCurrentCertificate).not.toHaveBeenCalled();
    // RET da enfermagem sai sempre em papel: sem contato do prescritor e sem a nota da receita digital.
    expect(api.getProfessionalContact).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "prescritor" })).toBeNull();
    expect(screen.queryByRole("note", { name: "regras da categoria" })).toBeNull();
  });

  it("duplo clique no Emitir receita da de controle especial: manda uma vez só", async () => {
    let finish: () => void = () => {};
    const onSubmit = vi.fn((_c: PrescriptionInput) => new Promise<void>((resolve) => { finish = resolve; }));
    renderForm({ onSubmit });
    await pick(SERTRALINE);
    fillItem(1, "30");
    fillAddress();
    await within(screen.getByRole("group", { name: "prescritor" })).findByText(/Rua Ouvidor Pardinho/);
    const button = screen.getByRole("button", { name: "Emitir receita" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it("sem o 19d (sem contexto): o controlado continua bloqueado como no 19c", async () => {
    mocked(api.searchMedications).mockResolvedValue([ SERTRALINE ]);
    renderForm({ controlled: null });
    fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: "se" } });
    const list = await screen.findByRole("list", { name: "resultados: Buscar medicamento" });
    expect((within(list).getByRole("button", { name: SERTRALINE.label }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(list).getByText(CONTROLLED_BLOCKED)).not.toBeNull();
    expect(screen.queryByRole("status", { name: "categoria da receita" })).toBeNull();
    expect(api.getSncrStock).not.toHaveBeenCalled();
    expect(api.getProfessionalContact).not.toHaveBeenCalled();
  });
});
