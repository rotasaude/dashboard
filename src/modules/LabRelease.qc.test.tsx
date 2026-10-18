// src/modules/LabRelease.qc.test.tsx
// Liberação do 21b com o CIQ do 21c (contrato §3; C-E4, C-E19, C-E39;
// pré-voo defeitos 1, 9, 11, 12) e o lote do reagente (contrato §7).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listReleases: vi.fn(), getReleaseRequisition: vi.fn(),
    listUnnotifiedCriticals: vi.fn(), releaseRequisition: vi.fn(), listLabRequisitions: vi.fn(), grantQcException: vi.fn(), rectifyLabReport: vi.fn() };
});

import * as api from "../lib/api";
import { LabRelease } from "./LabRelease";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW21B, labContext, labItem, labReport, labResultRow, labUser, releaseRequisition } from "../test/labFixtures";
import { qcContext, qcException, qcUser } from "../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listReleases, api.getReleaseRequisition, api.listUnnotifiedCriticals,
  api.releaseRequisition, api.listLabRequisitions, api.grantQcException, api.rectifyLabReport ];

const TWO = releaseRequisition({
  items: [
    { ...labItem({ id: "it2", label: "Glicose", sigtap_code: "0202010473", status: "typed" }), restriction_note: null,
      results: [ labResultRow({ reagent_lot: { id: "sl1", lot_number: "R-778" } }) ] },
    { ...labItem({ id: "it3", label: "Hemograma completo", status: "typed" }), restriction_note: null,
      results: [
        labResultRow({ id: "res3", item_id: "it3", analyte_key: "hb", name: "Hemoglobina", value: "13.5", unit: "g/dL", reagent_lot: null }),
        labResultRow({ id: "res4", item_id: "it3", analyte_key: "ht", name: "Hematócrito", value: "41", unit: "%", reagent_lot: null })
      ] }
  ]
});
const GLU_BLOCK = { item_id: "it2", block_id: "qb1", analyte_key: "glicose", instrument_id: "in1", instrument_name: "BS-200" };
const blocked = (items: unknown[]) => new api.ApiError(409, { error: "qc_blocked", items }, "x");
const apiError = (status: number, code: string) => new api.ApiError(status, { error: code }, code);
const EXCEPTION = "paciente internado, médico assistente ciente";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21B));
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_releaser" ]));
  mocked(api.getLabContext).mockResolvedValue(qcContext({ releaser_of: [ "pv9" ], council: "CRF" }));
  mocked(api.listReleases).mockResolvedValue([ TWO ]);
  mocked(api.getReleaseRequisition).mockResolvedValue(TWO);
  mocked(api.listUnnotifiedCriticals).mockResolvedValue({ criticals: [], next_after: null });
  mocked(api.listLabRequisitions).mockResolvedValue({ requisitions: [], next_before: null });
  mocked(api.releaseRequisition).mockRejectedValueOnce(blocked([ GLU_BLOCK ])).mockResolvedValue(labReport());
  mocked(api.grantQcException).mockResolvedValue(qcException());
});

const asLead = () => mocked(api.getLabContext).mockResolvedValue(qcContext({ releaser_of: [ "pv9" ], technical_lead_of: [ "pv9" ], council: "CRF" }));

async function openReview() {
  renderWithProviders(<LabRelease onNavigate={vi.fn()} />);
  const queue = await screen.findByRole("region", { name: "Fila de liberação" });
  fireEvent.click(await within(queue).findByRole("button", { name: "Conferir" }));
  return screen.findByRole("region", { name: "Conferência da requisição 00000123" });
}

async function releaseOnce() {
  const review = await openReview();
  fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
  fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
  return review;
}

async function except(box: HTMLElement, label: string, text = EXCEPTION) {
  const line = within(box).getByText(label).closest("li") as HTMLElement;
  fireEvent.click(within(line).getByRole("button", { name: "Liberar com exceção" }));
  fireEvent.change(within(line).getByLabelText("Justificativa da exceção"), { target: { value: text } });
  fireEvent.click(within(line).getByRole("button", { name: "Registrar exceção" }));
  return line;
}

describe("liberação com o CIQ (contrato §3)", () => {
  it("409 qc_blocked: lista, não libera e desmarca só os bloqueados", async () => {
    const review = await releaseOnce();
    const box = await within(review).findByRole("group", { name: "bloqueado pelo controle de qualidade" });
    expect(within(box).getByText("Glicose · Glicose · BS-200")).not.toBeNull();
    expect(within(review).queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Laudo liberado com assinatura eletrônica avançada.")).toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Liberar sem os bloqueados" }));
    expect((within(review).getByRole("checkbox", { name: /Glicose/ }) as HTMLInputElement).checked).toBe(false);
    expect((within(review).getByRole("checkbox", { name: /Hemograma completo/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "654321" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo parcial (1 de 2)" }));
    await waitFor(() => expect(api.releaseRequisition).toHaveBeenLastCalledWith("rq1", { item_ids: [ "it3" ], signature: "advanced", totp: "654321" }));
  });

  it("RT: exceção com justificativa, step-up e liberação de novo", async () => {
    asLead();
    const review = await releaseOnce();
    const box = await within(review).findByRole("group", { name: "bloqueado pelo controle de qualidade" });
    const line = await except(box, "Glicose · Glicose · BS-200", "curta");
    expect(within(line).getByRole("alert").textContent).toBe("escreva a justificativa da exceção (ao menos 10 caracteres)");
    fireEvent.change(within(line).getByLabelText("Justificativa da exceção"), { target: { value: "x".repeat(1001) } });
    fireEvent.click(within(line).getByRole("button", { name: "Registrar exceção" }));
    expect(within(line).getByRole("alert").textContent).toBe("a justificativa da exceção: no máximo 1000 caracteres");
    fireEvent.change(within(line).getByLabelText("Justificativa da exceção"), { target: { value: EXCEPTION } });
    fireEvent.click(within(line).getByRole("button", { name: "Registrar exceção" }));
    expect(api.grantQcException).not.toHaveBeenCalled();
    fireEvent.click(await within(line).findByRole("button", { name: "Confirmar exceção" }));
    await waitFor(() => expect(api.grantQcException).toHaveBeenCalledWith({ block_id: "qb1", item_id: "it2", justification: EXCEPTION }));
    expect(await within(box).findByText("exceção registrada")).not.toBeNull();
    expect(within(box).queryByRole("button", { name: "Liberar sem os bloqueados" })).toBeNull();
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "654321" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    await waitFor(() => expect(api.releaseRequisition).toHaveBeenLastCalledWith("rq1", { item_ids: [ "it2", "it3" ], signature: "advanced", totp: "654321" }));
    expect(await screen.findByText("Laudo liberado com assinatura eletrônica avançada.")).not.toBeNull();
  });

  it("dois bloqueios no mesmo item: o item só sai de pendente com as duas exceções; 409 conflict conta como registrada", async () => {
    asLead();
    mocked(api.releaseRequisition).mockReset().mockRejectedValueOnce(blocked([
      { item_id: "it3", block_id: "qb2", analyte_key: "hb", instrument_id: "in2", instrument_name: "XN-350" },
      { item_id: "it3", block_id: "qb3", analyte_key: "ht", instrument_id: "in2", instrument_name: "XN-350" }
    ])).mockResolvedValue(labReport());
    mocked(api.grantQcException).mockResolvedValueOnce(qcException({ block_id: "qb2", item_id: "it3" })).mockRejectedValueOnce(apiError(409, "conflict"));
    const review = await releaseOnce();
    const box = await within(review).findByRole("group", { name: "bloqueado pelo controle de qualidade" });
    const first = await except(box, "Hemograma completo · Hemoglobina · XN-350");
    fireEvent.click(await within(first).findByRole("button", { name: "Confirmar exceção" }));
    expect(await within(first).findByText("exceção registrada")).not.toBeNull();
    // Ainda há um bloqueio do item sem exceção: pular desmarca o Hemograma.
    expect(within(box).getByRole("button", { name: "Liberar sem os bloqueados" })).not.toBeNull();
    const second = await except(box, "Hemograma completo · Hematócrito · XN-350");
    fireEvent.click(await within(second).findByRole("button", { name: "Confirmar exceção" }));
    await waitFor(() => expect(api.grantQcException).toHaveBeenLastCalledWith({ block_id: "qb3", item_id: "it3", justification: EXCEPTION }));
    expect(await within(second).findByText("exceção registrada")).not.toBeNull();
    expect(within(box).queryByRole("button", { name: "Liberar sem os bloqueados" })).toBeNull();
    expect(within(box).getByText("exceções registradas — confira e libere de novo")).not.toBeNull();
  });

  it("not_blocked na exceção = o bloqueio fechou: resolvido", async () => {
    asLead();
    mocked(api.grantQcException).mockReset().mockRejectedValue(apiError(422, "not_blocked"));
    const review = await releaseOnce();
    const box = await within(review).findByRole("group", { name: "bloqueado pelo controle de qualidade" });
    const line = await except(box, "Glicose · Glicose · BS-200");
    fireEvent.click(await within(line).findByRole("button", { name: "Confirmar exceção" }));
    expect(await within(line).findByText("exceção registrada")).not.toBeNull();
  });

  it("quem não é RT não vê o botão da exceção e sabe a quem pedir", async () => {
    const review = await releaseOnce();
    const box = await within(review).findByRole("group", { name: "bloqueado pelo controle de qualidade" });
    expect(within(box).queryByRole("button", { name: "Liberar com exceção" })).toBeNull();
    expect(within(box).getByText("peça a exceção ao responsável técnico ou ao substituto, ou aguarde a corrida aprovada depois da ação corretiva")).not.toBeNull();
  });

  it("RT de outro laboratório não vê o botão", async () => {
    mocked(api.getLabContext).mockResolvedValue(qcContext({ releaser_of: [ "pv9" ], technical_lead_of: [ "pv8" ], council: "CRF" }));
    const review = await releaseOnce();
    const box = await within(review).findByRole("group", { name: "bloqueado pelo controle de qualidade" });
    expect(within(box).queryByRole("button", { name: "Liberar com exceção" })).toBeNull();
  });

  it("lote do reagente em cada valor; null = sem rastreio", async () => {
    const review = await openReview();
    expect(within(review).getByText("lote R-778")).not.toBeNull();
    expect(within(review).getAllByText("sem rastreio de reagente").length).toBe(2);
  });

  it("retificação bloqueada (C-E19): o RT registra a exceção e emite de novo", async () => {
    asLead();
    const released = releaseRequisition({
      items: [ { ...labItem({ id: "it2", label: "Glicose", sigtap_code: "0202010473", status: "released" }), restriction_note: null,
        results: [ labResultRow({ reagent_lot: { id: "sl1", lot_number: "R-778" } }) ] } ],
      reports: [ labReport() ]
    });
    mocked(api.listReleases).mockResolvedValue([ released ]);
    mocked(api.getReleaseRequisition).mockResolvedValue(released);
    mocked(api.rectifyLabReport).mockRejectedValueOnce(blocked([ GLU_BLOCK ])).mockResolvedValue(labReport({ id: "lr2", version: 2, replaces_report_id: "lr1" }));
    const review = await openReview();
    fireEvent.click(within(review).getByRole("button", { name: "Retificar" }));
    const form = within(review).getByRole("region", { name: "Retificar laudo v1" });
    fireEvent.change(within(form).getByLabelText("Motivo da retificação"), { target: { value: "valor de glicose digitado trocado" } });
    fireEvent.click(within(form).getByRole("button", { name: "Incluir contato" }));
    const contact = within(form).getByRole("group", { name: "Contato 1" });
    fireEvent.change(within(contact).getByLabelText("Quem foi avisado"), { target: { value: "Dra. Ana" } });
    fireEvent.change(within(contact).getByLabelText("Como"), { target: { value: "telefone" } });
    fireEvent.change(within(contact).getByLabelText("Quando"), { target: { value: "2026-10-15T09:00" } });
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    const box = await within(form).findByRole("group", { name: "bloqueado pelo controle de qualidade" });
    expect(within(form).queryByRole("alert")).toBeNull();
    // Na retificação o item bloqueado mudou: desmarcá-lo daria rectify_items_mismatch — não há "sem os bloqueados".
    expect(within(box).queryByRole("button", { name: "Liberar sem os bloqueados" })).toBeNull();
    const line = await except(box, "Glicose · Glicose · BS-200");
    fireEvent.click(await within(line).findByRole("button", { name: "Confirmar exceção" }));
    await waitFor(() => expect(api.grantQcException).toHaveBeenCalledWith({ block_id: "qb1", item_id: "it2", justification: EXCEPTION }));
    expect(await within(box).findByText("exceção registrada")).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "654321" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    expect(await screen.findByText("Laudo retificado liberado com assinatura eletrônica avançada.")).not.toBeNull();
    expect(mocked(api.rectifyLabReport).mock.calls[1][1]).toMatchObject({ item_ids: [ "it2" ], totp: "654321" });
  });

  it("retificação bloqueada, quem não é RT: lista e a quem pedir", async () => {
    const released = releaseRequisition({
      items: [ { ...labItem({ id: "it2", label: "Glicose", sigtap_code: "0202010473", status: "released" }), restriction_note: null, results: [ labResultRow() ] } ],
      reports: [ labReport() ]
    });
    mocked(api.listReleases).mockResolvedValue([ released ]);
    mocked(api.getReleaseRequisition).mockResolvedValue(released);
    mocked(api.rectifyLabReport).mockRejectedValueOnce(blocked([ GLU_BLOCK ]));
    const review = await openReview();
    fireEvent.click(within(review).getByRole("button", { name: "Retificar" }));
    const form = within(review).getByRole("region", { name: "Retificar laudo v1" });
    fireEvent.change(within(form).getByLabelText("Motivo da retificação"), { target: { value: "valor de glicose digitado trocado" } });
    fireEvent.click(within(form).getByRole("button", { name: "Incluir contato" }));
    const contact = within(form).getByRole("group", { name: "Contato 1" });
    fireEvent.change(within(contact).getByLabelText("Quem foi avisado"), { target: { value: "Dra. Ana" } });
    fireEvent.change(within(contact).getByLabelText("Como"), { target: { value: "telefone" } });
    fireEvent.change(within(contact).getByLabelText("Quando"), { target: { value: "2026-10-15T09:00" } });
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    const box = await within(form).findByRole("group", { name: "bloqueado pelo controle de qualidade" });
    expect(within(box).queryByRole("button", { name: "Liberar com exceção" })).toBeNull();
    expect(within(box).getByText(/peça a exceção ao responsável técnico/)).not.toBeNull();
  });
});

describe("sem os interruptores do 21c, o 21b fica igual", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_releaser" ]));
    mocked(api.getLabContext).mockResolvedValue(labContext({ releaser_of: [ "pv9" ], council: "CRF" }));
    mocked(api.releaseRequisition).mockReset().mockResolvedValue(labReport());
  });

  it("sem lote nos valores, sem painel do CIQ, mesmo corpo da liberação", async () => {
    const review = await openReview();
    expect(within(review).queryByText(/lote |sem rastreio/)).toBeNull();
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    await waitFor(() => expect(api.releaseRequisition).toHaveBeenCalledWith("rq1", { item_ids: [ "it2", "it3" ], signature: "advanced", totp: "123456" }));
    expect(await screen.findByText("Laudo liberado com assinatura eletrônica avançada.")).not.toBeNull();
    expect(screen.queryByRole("group", { name: "bloqueado pelo controle de qualidade" })).toBeNull();
    expect(api.grantQcException).not.toHaveBeenCalled();
  });
});
