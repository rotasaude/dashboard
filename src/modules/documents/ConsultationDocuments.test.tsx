// src/modules/documents/ConsultationDocuments.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listConsultationDocuments: vi.fn(), issueDocument: vi.fn(), cancelDocument: vi.fn(),
    getPrescriptionRenewal: vi.fn(), fetchDocumentPdf: vi.fn(), searchMedications: vi.fn(), searchTerminology: vi.fn(),
    listNursingProtocols: vi.fn(), getSignature: vi.fn(), verifySignature: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { CANCEL_WARNING, DOCUMENTS_DISABLED, DOCUMENTS_KEY, NO_EXAM_REQUESTS } from "../../lib/clinicalDocuments";
import { SIMULATED_NOTICE } from "../../lib/signature";
import { ConsultationDocuments } from "./ConsultationDocuments";
import { renderWithProviders } from "../../test/campaignFixtures";
import { signatureDetail } from "../../test/signatureFixtures";
import {
  NOW19C, TODAY19C, declarationDoc, docUser, prescriptionDoc, prescriptionItem, renewalItem, sickNoteDoc
} from "../../test/documentFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
let win: { location: { href: string }; close: ReturnType<typeof vi.fn> };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const ISSUE = { cboCode: "225142", unitId: "u1" };
const NURSE = { cboCode: "223565", unitId: "u1" };
const SICK = "Atestado de 09/10/2026, 09:40";
const cancelled = (over = {}) => sickNoteDoc({ status: "cancelled", cancelled_at: "2026-10-09T10:05:00-03:00", cancel_reason: "dias errados no atestado", ...over });

// `null` = sem emissão (Minhas consultas).
function renderIt(issue: typeof ISSUE | null = ISSUE, draft?: boolean) {
  return renderWithProviders(<ConsultationDocuments consultationId="cs1" issue={issue ?? undefined} draft={draft} searchDelayMs={0} />);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("ConsultationDocuments", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW19C));
    for (const fn of [ api.fetchCurrentSession, api.listConsultationDocuments, api.issueDocument, api.cancelDocument,
      api.getPrescriptionRenewal, api.fetchDocumentPdf, api.searchMedications, api.searchTerminology, api.listNursingProtocols,
      api.getSignature, api.verifySignature ]) {
      mocked(fn).mockReset();
    }
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser());
    mocked(api.listConsultationDocuments).mockResolvedValue([ sickNoteDoc() ]);
    mocked(api.listNursingProtocols).mockResolvedValue([]);
    win = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockImplementation(() => win as unknown as Window);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:doc1") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("lista os documentos com modo, assinatura, situação e código; cancelado não imprime nem cancela", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([
      sickNoteDoc(),
      prescriptionDoc({ issue_mode: "digital", signature: { mode: "pending", request_id: "sr1", reason_code: "no_session" } }),
      declarationDoc({ status: "cancelled", cancelled_at: "2026-10-09T09:50:00-03:00" })
    ]);
    renderIt();
    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Atestado")).not.toBeNull();
    expect(within(rows[0]).getByText("papel")).not.toBeNull();
    expect(within(rows[0]).getByText("emitido")).not.toBeNull();
    expect(within(rows[0]).getByText("K7Q2M-9XW4P")).not.toBeNull();
    expect(within(rows[1]).getByText("digital")).not.toBeNull();
    expect(within(rows[1]).getByText("assinatura pendente")).not.toBeNull();
    expect(within(rows[1]).getByText("sem sessão de assinatura aberta")).not.toBeNull();
    expect(within(rows[2]).getByText("cancelado em 09/10/2026, 09:50")).not.toBeNull();
    expect(within(rows[2]).queryByRole("button")).toBeNull();
    expect(api.listConsultationDocuments).toHaveBeenCalledWith("cs1");
  });

  it("assinatura digital simulada: o aviso do 19b aparece na linha", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([
      sickNoteDoc({ issue_mode: "digital", signature: { mode: "digital", signature_id: "sg1", verification: "valid", simulated: true } })
    ]);
    renderIt();
    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(within(rows[0]).getByText("assinada digitalmente")).not.toBeNull();
    expect(within(rows[0]).getByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("PSC simulado ligado na cidade: o aviso aparece na aba", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "health_professional" ], {
      features: [ "clinical_record", "clinical_documents", "digital_signature", "signature_psc_mock" ]
    }));
    renderIt();
    expect(await screen.findByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("documento cancelado com a assinatura ainda na fila: mostra o motivo document_cancelled", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([
      cancelled({ issue_mode: "digital", signature: { mode: "manual", request_id: "sr1", reason_code: "document_cancelled" } })
    ]);
    renderIt();
    expect(await screen.findByText("documento cancelado")).not.toBeNull();
  });

  it("assinatura pendente: a lista relê a cada 15 s; assentada, para", async () => {
    // shouldAdvanceTime: o polling do findBy continua andando com timers falsos;
    // só o intervalo que interessa avança à mão (o refetchInterval de verdade).
    // useRealTimers antes: um segundo useFakeTimers sobre o do beforeEach não troca os timers.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: [ "Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval" ], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(NOW19C));
    const list = mocked(api.listConsultationDocuments);
    list.mockResolvedValue([ prescriptionDoc({ issue_mode: "digital", signature: { mode: "pending", request_id: "sr1" } }) ]);
    renderIt();
    expect(await screen.findByText("assinatura pendente")).not.toBeNull();
    expect(list.mock.calls).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    await waitFor(() => expect(list.mock.calls).toHaveLength(2));
    list.mockResolvedValue([ prescriptionDoc({ issue_mode: "digital", signature: { mode: "digital", signature_id: "sg1", verification: "valid" } }) ]);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(await screen.findByText("assinada digitalmente")).not.toBeNull();
    expect(list.mock.calls).toHaveLength(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(list.mock.calls).toHaveLength(3);
  });

  it("a leitura da lista não fica em cache depois que a aba sai (gcTime 0)", async () => {
    const { client, unmount } = renderIt();
    await screen.findAllByRole("row");
    expect(client.getQueryCache().find({ queryKey: [ DOCUMENTS_KEY, "cs1" ] })?.options.gcTime).toBe(0);
    unmount();
  });

  it("médica: oferece os quatro tipos e Renovar receita; enfermeira não emite atestado nem renova", async () => {
    const { unmount } = renderIt();
    const group = await screen.findByRole("group", { name: "emitir documento" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent))
      .toEqual([ "Atestado", "Declaração", "Receita", "Requisição de exames", "Renovar receita" ]);
    unmount();
    renderIt(NURSE);
    const nurse = await screen.findByRole("group", { name: "emitir documento" });
    expect(within(nurse).getAllByRole("button").map((b) => b.textContent))
      .toEqual([ "Declaração", "Receita", "Requisição de exames" ]);
  });

  it("consulta em rascunho: Requisição de exames desabilitada com a frase; os outros tipos seguem", async () => {
    renderIt(ISSUE, true);
    const group = await screen.findByRole("group", { name: "emitir documento" });
    expect((within(group).getByRole("button", { name: "Requisição de exames" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(group).getByRole("button", { name: "Atestado" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(NO_EXAM_REQUESTS)).not.toBeNull();
  });

  it("consulta finalizada: Requisição de exames habilitada e sem a frase", async () => {
    renderIt(ISSUE, false);
    const group = await screen.findByRole("group", { name: "emitir documento" });
    expect((within(group).getByRole("button", { name: "Requisição de exames" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(NO_EXAM_REQUESTS)).toBeNull();
  });

  it("emite um atestado com o hoje da cidade: a lista ganha o documento e a tela diz como ele sai", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([]);
    mocked(api.issueDocument).mockResolvedValue(sickNoteDoc({ id: "doc7" }));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Atestado" }));
    expect((screen.getByLabelText("Início") as HTMLInputElement).value).toBe(TODAY19C);
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    await waitFor(() => expect(api.issueDocument).toHaveBeenCalledWith("cs1",
      { kind: "sick_note", content: { type: "leave", days: 3, start_on: TODAY19C, cid_authorized: false } }, undefined));
    expect((await screen.findByRole("status")).textContent).toBe("Documento emitido (Atestado) em modo papel: imprima e assine à mão.");
    expect(screen.queryByRole("form", { name: "Atestado" })).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("emitir: duplo clique gera UMA chamada e o botão trava em voo", async () => {
    const pending = deferred<api.ClinicalDocument>();
    mocked(api.issueDocument).mockReturnValue(pending.promise);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Atestado" }));
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    const send = screen.getByRole("button", { name: "Emitir atestado" });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect((screen.getByRole("button", { name: "Emitir atestado" }) as HTMLButtonElement).disabled).toBe(true));
    expect(api.issueDocument).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(sickNoteDoc({ id: "doc7" })); });
    expect(await screen.findByRole("status")).not.toBeNull();
    expect(api.issueDocument).toHaveBeenCalledTimes(1);
  });

  it("emissão em voo: os botões de tipo, Renovar e os Cancelar das linhas ficam travados (trocar o formulário perderia a recusa)", async () => {
    const pending = deferred<api.ClinicalDocument>();
    mocked(api.issueDocument).mockReturnValue(pending.promise);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Atestado" }));
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    await screen.findAllByRole("row");
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    const group = screen.getByRole("group", { name: "emitir documento" });
    await waitFor(() => expect((within(group).getByRole("button", { name: "Receita" }) as HTMLButtonElement).disabled).toBe(true));
    for (const b of within(group).getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: `Cancelar ${SICK}` }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: `Cancelar e emitir outro: ${SICK}` }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(group).getByRole("button", { name: "Receita" }));
    fireEvent.click(screen.getByRole("button", { name: `Cancelar ${SICK}` }));
    expect(screen.getByRole("form", { name: "Atestado" })).not.toBeNull();
    expect(screen.queryByRole("form", { name: "Receita" })).toBeNull();
    expect(api.getPrescriptionRenewal).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(sickNoteDoc({ id: "doc7" })); });
    expect(await screen.findByRole("status")).not.toBeNull();
    expect((within(group).getByRole("button", { name: "Receita" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getAllByRole("button", { name: `Cancelar ${SICK}` }).every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("Revalidar a assinatura de um documento da lista relê a lista de documentos", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([
      sickNoteDoc({ issue_mode: "digital", signature: { mode: "digital", signature_id: "sg1", verification: "valid", simulated: false } })
    ]);
    mocked(api.getSignature).mockResolvedValue(signatureDetail());
    mocked(api.verifySignature).mockResolvedValue(signatureDetail({ verification: "invalid" }));
    const { client } = renderIt();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Ver o que foi assinado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revalidar" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: [ DOCUMENTS_KEY, "cs1" ] }));
    await waitFor(() => expect(mocked(api.listConsultationDocuments).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("Renovar receita: preenche com os contínuos (itens parciais), emite e manda reler os medicamentos em uso", async () => {
    mocked(api.getPrescriptionRenewal).mockResolvedValue([ prescriptionItem(), renewalItem({ position: 2, free_text: "Losartana 50 mg" }) ]);
    mocked(api.issueDocument).mockResolvedValue(prescriptionDoc({ id: "doc8" }));
    const { client } = renderIt();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Renovar receita" }));
    expect((await screen.findByLabelText("Quantidade 1") as HTMLInputElement).value).toBe("60");
    // Item parcial da renovação: o que falta vem vazio (nunca "undefined").
    expect((screen.getByLabelText("Quantidade 2") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Quantidade 2"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Unidade 2"), { target: { value: "comprimido" } });
    fireEvent.change(screen.getByLabelText("Via 2"), { target: { value: "oral" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir receita" }));
    await waitFor(() => expect(api.issueDocument).toHaveBeenCalledWith("cs1", { kind: "prescription", content: { items: [
      { catalog_item: { id: "ci1" }, quantity: 60, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido após o café e 1 após o jantar", duration_days: 30, continuous: true },
      { free_text: "Losartana 50 mg", quantity: 30, quantity_unit: "comprimido", route: "oral", dosage_instructions: "1 cp/dia", continuous: true }
    ] } }, undefined));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: [ "patientMedications" ] }));
  });

  it("Renovar com um controlado: a recusa diz qual item e o formulário fica preenchido", async () => {
    mocked(api.getPrescriptionRenewal).mockResolvedValue([ prescriptionItem() ]);
    mocked(api.issueDocument).mockRejectedValue(new ApiError(422, { error: "controlled_not_allowed", index: 0 }, "422"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Renovar receita" }));
    fireEvent.click(await screen.findByRole("button", { name: "Emitir receita" }));
    const form = screen.getByRole("form", { name: "Receita" });
    expect(await within(form).findByText("item 1: medicamento controlado não entra aqui (receita de controle especial — 19d)")).not.toBeNull();
    expect((within(form).getByLabelText("Quantidade 1") as HTMLInputElement).value).toBe("60");
  });

  it("Renovar sem contínuos ativos: diz que não há o que renovar", async () => {
    mocked(api.getPrescriptionRenewal).mockResolvedValue([]);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Renovar receita" }));
    expect((await screen.findByRole("status")).textContent).toBe("nenhum medicamento de uso contínuo ativo para renovar");
    expect(screen.queryByRole("form", { name: "Receita" })).toBeNull();
  });

  it("Imprimir abre o PDF numa janela nova, pelo id", async () => {
    mocked(api.fetchDocumentPdf).mockResolvedValue({ blob: new Blob([ "%PDF" ], { type: "application/pdf" }), filename: null });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: `Imprimir ${SICK}` }));
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(win.location.href).toBe("blob:doc1"));
    expect(api.fetchDocumentPdf).toHaveBeenCalledWith("doc1");
  });

  it("Imprimir um digital ainda não assinado (409 awaiting_signature): fecha a janela e diz o que fazer", async () => {
    mocked(api.fetchDocumentPdf).mockRejectedValue(new ApiError(409, { error: "awaiting_signature" }, "409"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: `Imprimir ${SICK}` }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("o documento digital ainda não foi assinado — assine (sessão ou lote) ou volte ao papel em Pendentes de assinatura para imprimir");
    expect(win.close).toHaveBeenCalled();
  });

  it("Imprimir um documento que outra aba cancelou (409 already_cancelled): diz e relê a lista", async () => {
    mocked(api.fetchDocumentPdf).mockRejectedValue(new ApiError(409, { error: "already_cancelled" }, "409"));
    const { client } = renderIt();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: `Imprimir ${SICK}` }));
    expect((await screen.findByRole("alert")).textContent).toBe("este documento já estava cancelado — a lista foi atualizada");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ DOCUMENTS_KEY, "cs1" ] });
    await waitFor(() => expect(mocked(api.listConsultationDocuments).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("Imprimir: duplo clique lê UM PDF e os outros Imprimir ficam desligados em voo", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([ sickNoteDoc(), prescriptionDoc() ]);
    const pending = deferred<{ blob: Blob; filename: string | null }>();
    mocked(api.fetchDocumentPdf).mockReturnValue(pending.promise);
    renderIt();
    const first = await screen.findByRole("button", { name: `Imprimir ${SICK}` });
    fireEvent.click(first);
    fireEvent.click(first);
    const other = screen.getByRole("button", { name: "Imprimir Receita de 09/10/2026, 09:40" }) as HTMLButtonElement;
    expect(other.disabled).toBe(true);
    fireEvent.click(other);
    expect(api.fetchDocumentPdf).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ blob: new Blob([ "%PDF" ], { type: "application/pdf" }), filename: null }); });
    await waitFor(() => expect(other.disabled).toBe(false));
    expect(win.location.href).toBe("blob:doc1");
  });

  it("Cancelar pede o motivo (10 ou mais, espaços internos juntados) com step-up e a lista mostra cancelado", async () => {
    mocked(api.cancelDocument).mockResolvedValue(cancelled());
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: `Cancelar ${SICK}` }));
    const dialog = screen.getByRole("region", { name: `Cancelar: ${SICK}` });
    // 10 caracteres só com os espaços internos: o api junta e conta 6.
    fireEvent.change(within(dialog).getByLabelText("Motivo do cancelamento"), { target: { value: "dias     ok" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar cancelamento" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("descreva o motivo com pelo menos 10 caracteres");
    expect(api.cancelDocument).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Motivo do cancelamento"), { target: { value: "  dias errados no atestado " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(() => expect(api.cancelDocument).toHaveBeenCalledWith("doc1", "dias errados no atestado"));
    expect(await screen.findByText("cancelado em 09/10/2026, 10:05")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Documento cancelado.");
    expect(screen.queryByRole("form", { name: "Atestado" })).toBeNull();
  });

  it("Cancelar: motivo acima de 500 caracteres não vai ao api", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: `Cancelar ${SICK}` }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "a".repeat(501) } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o motivo passa de 500 caracteres — resuma");
    expect(api.cancelDocument).not.toHaveBeenCalled();
  });

  it("Cancelar: duplo clique gera UMA chamada e o botão trava em voo", async () => {
    const pending = deferred<api.ClinicalDocument>();
    mocked(api.cancelDocument).mockReturnValue(pending.promise);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: `Cancelar ${SICK}` }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dias errados no atestado" } });
    const confirm = screen.getByRole("button", { name: "Confirmar cancelamento" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect((screen.getByRole("button", { name: "Confirmar cancelamento" }) as HTMLButtonElement).disabled).toBe(true));
    expect(api.cancelDocument).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(cancelled()); });
    expect(await screen.findByText("cancelado em 09/10/2026, 10:05")).not.toBeNull();
    expect(api.cancelDocument).toHaveBeenCalledTimes(1);
  });

  it("receita: o cancelamento avisa que não desfaz medicamento entregue", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([ prescriptionDoc() ]);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar Receita de 09/10/2026, 09:40" }));
    expect(screen.getByText(CANCEL_WARNING)).not.toBeNull();
  });

  it("Cancelar e emitir outro: cancela, abre o atestado preenchido e o novo sai com replaces_document_id", async () => {
    mocked(api.cancelDocument).mockResolvedValue(cancelled());
    mocked(api.issueDocument).mockResolvedValue(sickNoteDoc({ id: "doc9", replaces_document_id: "doc1" }));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: `Cancelar e emitir outro: ${SICK}` }));
    const dialog = screen.getByRole("region", { name: `Cancelar e emitir outro: ${SICK}` });
    fireEvent.change(within(dialog).getByLabelText("Motivo do cancelamento"), { target: { value: "dias errados no atestado" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar e abrir o novo" }));
    const form = await screen.findByRole("form", { name: "Atestado" });
    expect(within(form).getByText("Substitui o documento cancelado.")).not.toBeNull();
    expect((within(form).getByLabelText("Dias de afastamento") as HTMLInputElement).value).toBe("3");
    fireEvent.change(within(form).getByLabelText("Dias de afastamento"), { target: { value: "5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir atestado" }));
    await waitFor(() => expect(api.issueDocument).toHaveBeenCalledWith("cs1",
      { kind: "sick_note", content: { type: "leave", days: 5, start_on: "2026-10-09", cid_authorized: false } }, "doc1"));
  });

  it("outra aba já cancelou (409 already_cancelled) no Cancelar e emitir outro: diz, relê a lista e não abre o novo", async () => {
    mocked(api.cancelDocument).mockRejectedValue(new ApiError(409, { error: "already_cancelled" }, "409"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: `Cancelar e emitir outro: ${SICK}` }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dias errados no atestado" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar e abrir o novo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("este documento já estava cancelado — a lista foi atualizada");
    await waitFor(() => expect(mocked(api.listConsultationDocuments).mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("form", { name: "Atestado" })).toBeNull();
    expect(screen.queryByRole("region", { name: `Cancelar e emitir outro: ${SICK}` })).toBeNull();
  });

  it("outra aba já substituiu (422 invalid_content replaces_document_id): diz, fecha o substituto e relê a lista", async () => {
    mocked(api.cancelDocument).mockResolvedValue(cancelled());
    mocked(api.issueDocument).mockRejectedValue(new ApiError(422, { error: "invalid_content", field: "replaces_document_id" }, "422"));
    const { client } = renderIt();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: `Cancelar e emitir outro: ${SICK}` }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dias errados no atestado" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar e abrir o novo" }));
    const form = await screen.findByRole("form", { name: "Atestado" });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir atestado" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("este documento já foi substituído (ou não pode ser substituído) — a lista foi atualizada");
    expect(screen.queryByRole("form", { name: "Atestado" })).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ DOCUMENTS_KEY, "cs1" ] });
    await waitFor(() => expect(mocked(api.listConsultationDocuments).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("interruptor desligado entre a leitura e o clique: a frase diz e o formulário fica", async () => {
    mocked(api.issueDocument).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "clinical_documents" }, "403"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Atestado" }));
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    expect((await screen.findByRole("alert")).textContent).toBe(DOCUMENTS_DISABLED);
    expect((screen.getByLabelText("Dias de afastamento") as HTMLInputElement).value).toBe("3");
  });

  it("Minhas consultas (sem issue): só a lista, Imprimir e Cancelar", async () => {
    renderIt(null);
    expect(await screen.findByRole("button", { name: `Imprimir ${SICK}` })).not.toBeNull();
    expect(screen.getByRole("button", { name: `Cancelar ${SICK}` })).not.toBeNull();
    expect(screen.queryByRole("group", { name: "emitir documento" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancelar e emitir outro/ })).toBeNull();
  });

  it("documento de outra autora: sem Cancelar", async () => {
    mocked(api.listConsultationDocuments).mockResolvedValue([ sickNoteDoc({ author: { id: "us9", name: "Dr. Outro", council: null, cbo_code: "225142" } }) ]);
    renderIt();
    expect(await screen.findByRole("button", { name: `Imprimir ${SICK}` })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancelar/ })).toBeNull();
  });
});
