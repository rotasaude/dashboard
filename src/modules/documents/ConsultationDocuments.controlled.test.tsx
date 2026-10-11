// src/modules/documents/ConsultationDocuments.controlled.test.tsx
// Módulo 19d: a aba Documentos com `controlled_prescriptions` — Notificação de
// papel, frase depois de emitir pelo que o api devolveu (número ou motivo do
// papel), categoria/número/motivo na lista e o cancelamento da receita numerada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listConsultationDocuments: vi.fn(), issueDocument: vi.fn(), recordNotification: vi.fn(),
    cancelDocument: vi.fn(), getPrescriptionRenewal: vi.fn(), fetchDocumentPdf: vi.fn(), searchMedications: vi.fn(), searchTerminology: vi.fn(),
    listNursingProtocols: vi.fn(), getProfessionalContact: vi.fn(), getSncrStock: vi.fn(), getCurrentCertificate: vi.fn(),
    getLastPatientIdentification: vi.fn() };
});

import * as api from "../../lib/api";
import type { ClinicalDocument } from "../../lib/api";
import { MEDICATIONS_KEY } from "../../lib/clinicalDocuments";
import { SNCR_NO_CANCEL_NOTE, SNCR_SIMULATED_NOTICE, SNCR_STOCK_KEY } from "../../lib/controlled";
import { ConsultationDocuments } from "./ConsultationDocuments";
import { renderWithProviders } from "../../test/campaignFixtures";
import { prescriptionDoc, prescriptionItem, sickNoteDoc } from "../../test/documentFixtures";
import { certificate } from "../../test/signatureFixtures";
import {
  CLONAZEPAM_B1, NOW19D, SERTRALINE_REF, contact, controlledUser, notificationDoc, rceDoc, retDoc, stock
} from "../../test/controlledFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const SIMULATED_RCE = { sncr: { kind: "rce" as const, number: "2610.1-41.0001234", simulated: true } };
const ADDRESS_BODY = { street: "Rua Marechal Deodoro", number: "630", district: "Centro", city: "Curitiba", uf: "PR", zip: "80010010" };

function renderDocs(cboCode = "225142") {
  return renderWithProviders(
    <ConsultationDocuments consultationId="cs1" searchDelayMs={0}
      issue={{ cboCode, unitId: "u1", patientCpfMasked: "***.533.447-**" }} />
  );
}

function fillAddress() {
  const w = within(screen.getByRole("group", { name: "Identificação do paciente" }));
  fireEvent.change(w.getByLabelText("Logradouro"), { target: { value: "Rua Marechal Deodoro" } });
  fireEvent.change(w.getByLabelText("Número"), { target: { value: "630" } });
  fireEvent.change(w.getByLabelText("Bairro"), { target: { value: "Centro" } });
  fireEvent.change(w.getByLabelText("Cidade"), { target: { value: "Curitiba" } });
  fireEvent.change(w.getByLabelText("UF"), { target: { value: "PR" } });
  fireEvent.change(w.getByLabelText("CEP"), { target: { value: "80010010" } });
}

async function renewSertraline() {
  mocked(api.getPrescriptionRenewal).mockResolvedValue([ prescriptionItem({ catalog_item: SERTRALINE_REF, quantity: 60,
    dosage_instructions: "1 comprimido pela manhã", duration_days: 60, continuous: true }) ]);
  fireEvent.click(await screen.findByRole("button", { name: "Renovar receita" }));
  await screen.findByRole("group", { name: "Identificação do paciente" });
  fillAddress();
}

// Abre a Notificação e preenche um B1 válido (o tipo B e a UF PR vêm sozinhos).
async function fillNotification() {
  mocked(api.searchMedications).mockResolvedValue([ CLONAZEPAM_B1 ]);
  fireEvent.click(await screen.findByRole("button", { name: "Notificação (papel)" }));
  const form = screen.getByRole("form", { name: "Notificação de papel" });
  fireEvent.change(within(form).getByLabelText("Buscar medicamento (listas A e B)"), { target: { value: "clona" } });
  fireEvent.click(await within(form).findByRole("button", { name: CLONAZEPAM_B1.label }));
  fireEvent.change(within(form).getByLabelText("Número do talão"), { target: { value: "PR0012345" } });
  fireEvent.change(within(form).getByLabelText("Quantidade"), { target: { value: "30" } });
  fireEvent.change(within(form).getByLabelText("Via"), { target: { value: "oral" } });
  fireEvent.change(within(form).getByLabelText("Duração em dias"), { target: { value: "30" } });
  fireEvent.change(within(form).getByLabelText("Posologia"), { target: { value: "1 comprimido à noite" } });
  return form;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ConsultationDocuments — controlado e SNCR (19d)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW19D));
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser());
    mocked(api.listConsultationDocuments).mockResolvedValue([]);
    mocked(api.listNursingProtocols).mockResolvedValue([]);
    mocked(api.getProfessionalContact).mockResolvedValue(contact());
    mocked(api.getSncrStock).mockResolvedValue(stock());
    mocked(api.getCurrentCertificate).mockResolvedValue(certificate());
    mocked(api.getLastPatientIdentification).mockResolvedValue(null);
  });

  it("lista: RCE com título, número e faixa de simulado; Notificação sem Imprimir nem 'emitir outro'", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([ rceDoc({}, SIMULATED_RCE), notificationDoc() ]);
    renderDocs();
    expect(await screen.findByText("Receita de controle especial")).not.toBeNull();
    expect(screen.getByText("RCE nº 2610.1-41.0001234")).not.toBeNull();
    expect(screen.getByText(SNCR_SIMULATED_NOTICE)).not.toBeNull();
    expect(screen.getByText("Notificação de receita (papel)")).not.toBeNull();
    expect(await screen.findByRole("button", { name: /^Cancelar Notificação de receita \(papel\) de/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Imprimir Notificação/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancelar e emitir outro: Notificação/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Imprimir Receita de/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Cancelar e emitir outro: Receita de/ })).not.toBeNull();
  });

  it("lista: RET sem simulado não tem a faixa; o número aparece", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([ retDoc() ]);
    renderDocs();
    expect(await screen.findByText("Receita de antimicrobiano")).not.toBeNull();
    expect(screen.getByText("RET nº 2610.2-41.0000501")).not.toBeNull();
    expect(screen.queryByText(SNCR_SIMULATED_NOTICE)).toBeNull();
  });

  it("coluna Modo: o motivo do papel em atestado e receita comum; papel com paper_reason null mostra só 'papel'", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([
      sickNoteDoc({ id: "s1", issue_mode: "paper", paper_reason: "signature_unavailable", signature: null }),
      prescriptionDoc({ id: "p1", short_code: "P1AAA-11111", issue_mode: "paper", paper_reason: "signature_unavailable", signature: null }),
      rceDoc({ id: "p2", short_code: "P2BBB-22222", issue_mode: "paper", paper_reason: null, signature: null }, { sncr: null }),
      prescriptionDoc({ id: "p3", short_code: "P3CCC-33333", issue_mode: "paper", paper_reason: "motivo_novo", signature: null })
    ]);
    renderDocs();
    const reason = "a assinatura digital não está disponível na cidade";
    expect((await screen.findAllByText(reason)).length).toBe(2);
    const rows = screen.getAllByRole("row");
    const row = (code: string) => rows.find((r) => r.textContent?.includes(code))!;
    expect(row("P1AAA-11111").textContent).toContain(reason);
    // Voltou ao papel: só "papel", sem motivo nem "—" extra.
    const back = within(row("P2BBB-22222")).getAllByRole("cell").map((c) => c.textContent);
    expect(back).toContain("papel");
    expect(row("P2BBB-22222").textContent).not.toContain(reason);
    // Valor desconhecido aparece cru.
    expect(row("P3CCC-33333").textContent).toContain("motivo_novo");
  });

  it("renovar a RCE: emite digital, diz o número (simulado) e relê o estoque", async () => {
    mocked(api.issueDocument).mockResolvedValue(rceDoc({}, SIMULATED_RCE));
    const { client } = renderDocs();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renewSertraline();
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    expect(await screen.findByText("Receita de controle especial emitida em modo digital com o número SNCR RCE nº 2610.1-41.0001234 " +
      "(numeração simulada — sem validade): a assinatura entra na sua fila; o PDF assinado sai depois dela.")).not.toBeNull();
    expect(api.issueDocument).toHaveBeenCalledWith("cs1", { kind: "prescription", content: {
      items: [ { catalog_item: { id: "ci10" }, quantity: 60, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido pela manhã", duration_days: 60, continuous: true } ],
      patient_identification: { address: ADDRESS_BODY }
    } }, undefined);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ SNCR_STOCK_KEY ] });
  });

  it("previsão digital, mas o api devolve papel (no_sncr_number): diz o motivo e manda imprimir 2 vias", async () => {
    mocked(api.issueDocument).mockResolvedValue(rceDoc({ issue_mode: "paper", paper_reason: "no_sncr_number", signature: null }, { sncr: null }));
    const { client } = renderDocs();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renewSertraline();
    await waitFor(() => expect(api.getSncrStock).toHaveBeenCalled());
    expect(screen.queryByRole("note", { name: "vai sair em papel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    const notice = await screen.findByText("Receita de controle especial emitida em modo papel (sem número SNCR no seu estoque — " +
      "obtenha números em Conta → SNCR): imprima as 2 vias e assine à mão.");
    expect(notice.textContent).not.toMatch(/assinatura entra na sua fila/);
    expect(screen.getByText("sem número SNCR no seu estoque — obtenha números em Conta → SNCR")).not.toBeNull();
    // Receita numerada (mesmo em papel): o estoque é relido.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ SNCR_STOCK_KEY ] });
  });

  it("texto livre antimicrobiano: o api devolve papel free_text_items e a frase diz o motivo", async () => {
    mocked(api.issueDocument).mockResolvedValue(retDoc({ issue_mode: "paper", paper_reason: "free_text_items", signature: null }));
    renderDocs();
    fireEvent.click(await screen.findByRole("button", { name: "Receita" }));
    fireEvent.click(screen.getByRole("button", { name: "Incluir em texto livre" }));
    fireEvent.change(screen.getByLabelText("Medicamento 1 (texto livre)"), { target: { value: "amoxicilina 500 mg" } });
    fireEvent.change(screen.getByLabelText("Unidade 1"), { target: { value: "cápsula" } });
    const li = screen.getByRole("listitem", { name: "item 1" });
    fireEvent.change(within(li).getByLabelText("Quantidade 1"), { target: { value: "21" } });
    fireEvent.change(within(li).getByLabelText("Via 1"), { target: { value: "oral" } });
    fireEvent.change(within(li).getByLabelText("Duração em dias 1"), { target: { value: "7" } });
    fireEvent.change(within(li).getByLabelText("Posologia 1"), { target: { value: "1 cápsula de 8 em 8 horas" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    expect(await screen.findByText("Receita de antimicrobiano emitida em modo papel (itens digitados à mão — sai em papel): " +
      "imprima as 2 vias e assine à mão.")).not.toBeNull();
    expect(screen.queryByText(/assinatura entra na sua fila/)).toBeNull();
    // E a coluna Modo da linha nova diz o mesmo motivo.
    expect(screen.getByText("itens digitados à mão — sai em papel")).not.toBeNull();
  });

  it("Notificação (papel): registra, diz e relê os medicamentos em uso", async () => {
    mocked(api.recordNotification).mockResolvedValue(notificationDoc());
    const { client } = renderDocs();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const form = await fillNotification();
    fireEvent.click(within(form).getByRole("button", { name: "Registrar Notificação" }));

    await waitFor(() => expect(api.recordNotification).toHaveBeenCalledWith("cs1", {
      notification_type: "B", paper_number: "PR0012345", numbering_uf: "PR",
      item: { catalog_item: { id: "ci3" }, quantity: 30, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido à noite", duration_days: 30 }
    }));
    expect(await screen.findByText("Notificação de papel registrada: o medicamento entra na lista de medicamentos em uso. " +
      "Guarde o talão; nada é impresso aqui.")).not.toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ MEDICATIONS_KEY ] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: [ SNCR_STOCK_KEY ] });
    expect(screen.queryByRole("form", { name: "Notificação de papel" })).toBeNull();
    // A linha nova: código "—", sem Imprimir.
    expect(screen.getByText("Notificação de receita (papel)")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Imprimir Notificação/ })).toBeNull();
  });

  it("Notificação: a recusa do api aparece no formulário, que fica aberto e preenchido", async () => {
    mocked(api.recordNotification).mockRejectedValue(new api.ApiError(422, { error: "item_not_in_notification_list" }, "422"));
    renderDocs();
    const form = await fillNotification();
    fireEvent.click(within(form).getByRole("button", { name: "Registrar Notificação" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("o medicamento não é de Notificação (listas A ou B)");
    expect(screen.getByRole("form", { name: "Notificação de papel" })).not.toBeNull();
    expect((within(form).getByLabelText("Número do talão") as HTMLInputElement).value).toBe("PR0012345");
  });

  it("Notificação: dois envios num único act chamam o api uma vez", async () => {
    let resolve: (d: ClinicalDocument) => void = () => {};
    mocked(api.recordNotification).mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderDocs();
    const form = await fillNotification();
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(api.recordNotification).toHaveBeenCalledTimes(1));
    expect((within(form).getByRole("button", { name: /Registrar Notificação|Registrando/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolve(notificationDoc()); });
    expect(api.recordNotification).toHaveBeenCalledTimes(1);
  });

  it("Notificação em voo: a trava da aba barra abrir outro documento no mesmo act (o formulário não fecha)", async () => {
    let resolve: (d: ClinicalDocument) => void = () => {};
    mocked(api.recordNotification).mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderDocs();
    const form = await fillNotification();
    const group = screen.getByRole("group", { name: "emitir documento" });
    const sickNote = within(group).getByRole("button", { name: "Atestado" });
    act(() => { fireEvent.submit(form); fireEvent.click(sickNote); });
    expect(screen.getByRole("form", { name: "Notificação de papel" })).toBe(form);
    expect(screen.queryByRole("form", { name: "Atestado" })).toBeNull();
    expect((within(group).getByRole("button", { name: "Atestado" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(group).getByRole("button", { name: "Notificação (papel)" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolve(notificationDoc()); });
    expect(api.recordNotification).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("form", { name: "Notificação de papel" })).toBeNull();
  });

  it("sem o interruptor, ou para a enfermagem: sem 'Notificação (papel)'", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([ prescriptionDoc() ]);
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser([ "health_professional" ], { features: [ "clinical_record", "clinical_documents" ] }));
    renderDocs();
    // O "Cancelar" da autora só aparece com a sessão carregada.
    expect(await screen.findByRole("button", { name: /^Cancelar Receita de/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Notificação (papel)" })).toBeNull();
    cleanup();

    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser());
    renderDocs("223565");
    expect(await screen.findByRole("button", { name: /^Cancelar Receita de/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Notificação (papel)" })).toBeNull();
  });

  it("dentista (2232) com o interruptor: tem 'Notificação (papel)'", async () => {
    renderDocs("223208");
    expect(await screen.findByRole("button", { name: "Notificação (papel)" })).not.toBeNull();
  });

  it("cancelar RCE: avisa que o SNCR não cancela e relê o estoque", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([ rceDoc() ]);
    mocked(api.cancelDocument).mockResolvedValue(rceDoc({ status: "cancelled", cancelled_at: "2026-10-10T10:00:00-03:00",
      cancel_reason: "dose errada na receita" }));
    const { client } = renderDocs();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: /^Cancelar Receita de/ }));
    expect(await screen.findByText(SNCR_NO_CANCEL_NOTE)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dose errada na receita" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(() => expect(api.cancelDocument).toHaveBeenCalledWith("doc20", "dose errada na receita"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: [ SNCR_STOCK_KEY ] }));
  });

  it("cancelar RCE: dois envios num único act chamam cancelDocument uma vez (a ref, não só o botão desligado)", async () => {
    let resolve: (d: ClinicalDocument) => void = () => {};
    mocked(api.listConsultationDocuments).mockResolvedValue([ rceDoc() ]);
    mocked(api.cancelDocument).mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderDocs();
    fireEvent.click(await screen.findByRole("button", { name: /^Cancelar Receita de/ }));
    fireEvent.change(await screen.findByLabelText("Motivo do cancelamento"), { target: { value: "dose errada na receita" } });
    const form = screen.getByLabelText("Motivo do cancelamento").closest("form") as HTMLFormElement;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(api.cancelDocument).toHaveBeenCalledTimes(1));
    await act(async () => { resolve(rceDoc({ status: "cancelled", cancelled_at: "2026-10-10T10:00:00-03:00", cancel_reason: "dose errada na receita" })); });
    expect(api.cancelDocument).toHaveBeenCalledTimes(1);
  });

  it("cancelar receita comum: sem a nota do SNCR e sem reler o estoque", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([ prescriptionDoc() ]);
    mocked(api.cancelDocument).mockResolvedValue(prescriptionDoc({ status: "cancelled", cancelled_at: "2026-10-10T10:00:00-03:00",
      cancel_reason: "dose errada na receita" }));
    const { client } = renderDocs();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: /^Cancelar Receita de/ }));
    await screen.findByLabelText("Motivo do cancelamento");
    expect(screen.queryByText(SNCR_NO_CANCEL_NOTE)).toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dose errada na receita" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await screen.findByText("Documento cancelado.");
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: [ SNCR_STOCK_KEY ] });
  });
});
