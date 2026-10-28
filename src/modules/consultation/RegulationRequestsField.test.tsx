import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  searchRegulationTargets: vi.fn(), listConsultationRegulationRequests: vi.fn(), createRegulationRequest: vi.fn(), updateRegulationRequest: vi.fn(),
  deleteRegulationRequest: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { RegulationRequestsField } from "./RegulationRequestsField";
import { ADDENDUM_NOTE, NOT_SENT_LABEL, UNSAVED_REQUEST_NOTE } from "../../lib/regulation";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CARDIO, regRequest, regUser } from "../../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const JUST = "Dor torácica aos esforços há 3 meses, teste ergométrico alterado.";
const DRAFT = regRequest({ status: "draft", requested_at: null, due_on: null, version: 1, events: [] });

describe("RegulationRequestsField", () => {
  beforeEach(() => {
    for (const fn of [ api.listConsultationRegulationRequests, api.createRegulationRequest, api.updateRegulationRequest, api.deleteRegulationRequest ])
      mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "health_professional" ]));
    mocked(api.searchRegulationTargets).mockResolvedValue([ CARDIO ]);
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([]);
    mocked(api.createRegulationRequest).mockResolvedValue(DRAFT);
  });
  const mount = (over: Partial<Parameters<typeof RegulationRequestsField>[0]> = {}) => renderWithProviders(
    <RegulationRequestsField consultationId="cs1" cbo="225142" cid10Allowed mode="draft" searchDelayMs={0} {...over} />);
  const fill = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Pedir regulação" }));
    text("Especialidade ou procedimento", "cardio");
    fireEvent.click(await screen.findByRole("button", { name: /Cardiologia/ }));
    text("CID-10", "I209"); text("Justificativa", JUST); text("Cor de risco sugerida", "yellow");
  };

  it("pedir: cria o rascunho e ele aparece na lista com a cor e a situação", async () => {
    mount();
    await fill();
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ DRAFT ]);
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    await waitFor(() => expect(mocked(api.createRegulationRequest)).toHaveBeenCalledWith("cs1",
      { type: "specialty", target_code: "225120", cid10: "I209", justification: JUST, suggested_color: "yellow" }));
    const item = await screen.findByRole("listitem", { name: "Cardiologia" });
    expect(within(item).getByText("amarelo")).not.toBeNull();
    expect(within(item).getByText("rascunho")).not.toBeNull();
    expect(screen.queryByLabelText("Justificativa")).toBeNull();
  });

  it("editar manda o corpo inteiro; retirar pede confirmação", async () => {
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ DRAFT ]);
    mocked(api.updateRegulationRequest).mockResolvedValue(DRAFT);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Editar o pedido de Cardiologia" }));
    text("Cor de risco sugerida", "red");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    await waitFor(() => expect(mocked(api.updateRegulationRequest)).toHaveBeenCalledWith("cs1", "rr1",
      { type: "specialty", target_code: "225120", cid10: "I209", justification: DRAFT.justification, suggested_color: "red" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retirar o pedido de Cardiologia" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.deleteRegulationRequest)).toHaveBeenCalledWith("cs1", "rr1"));
  });

  it("recusa do api e falha da leitura ficam na peça", async () => {
    mocked(api.createRegulationRequest).mockRejectedValue(new ApiError(422, { error: "invalid_target" }, "x"));
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toBe("especialidade ou procedimento inválido");
    cleanup();
    mocked(api.listConsultationRegulationRequests).mockRejectedValue(new ApiError(500, {}, "x"));
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe("não foi possível concluir — tente de novo");
  });

  it("ao finalizar: a conta dos rascunhos e o aviso do não salvo", async () => {
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ DRAFT, regRequest({ id: "rr2", status: "draft", target: { code: "0205010032", name: "Ecocardiografia" } }) ]);
    mount({ finalizing: true });
    expect(await screen.findByText("2 pedidos de regulação vão para a fila da regulação ao finalizar.")).not.toBeNull();
    expect(screen.queryByText(UNSAVED_REQUEST_NOTE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pedir regulação" }));
    text("Justificativa", "algo digitado e não salvo");
    expect(await screen.findByText(UNSAVED_REQUEST_NOTE)).not.toBeNull();
  });

  it("no adendo: o aviso de que vai com o próximo adendo e a situação dos já enviados", async () => {
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ regRequest({ status: "authorized" }) ]);
    const onOpenGuide = vi.fn();
    mount({ mode: "addendum", onOpenGuide });
    expect(await screen.findByText(ADDENDUM_NOTE)).not.toBeNull();
    const item = screen.getByRole("listitem", { name: "Cardiologia" });
    expect(within(item).getByText("autorizado")).not.toBeNull();
    expect(within(item).queryByRole("button", { name: /Editar/ })).toBeNull();
    fireEvent.click(within(item).getByRole("button", { name: "Guia em PDF" }));
    expect(onOpenGuide).toHaveBeenCalledWith("rr1");
  });

  it("no adendo, todo rascunho é 'não enviado' (no lugar de 'rascunho'); o motivo só no que o api devolveu", async () => {
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ DRAFT, regRequest({ id: "rr2", status: "draft", target: { code: "0205010032", name: "Ecocardiografia" } }) ]);
    mount({ mode: "addendum", notSent: [ { index: 0, id: "rr1", error: "cbo_not_allowed", path: "target_code" } ] });
    const item = await screen.findByRole("listitem", { name: "Cardiologia" });
    expect(within(item).getByText(NOT_SENT_LABEL)).not.toBeNull();
    expect(within(item).queryByText("rascunho")).toBeNull();
    expect(within(item).getByText(/^seu CBO não pode pedir este encaminhamento/).tagName).toBe("SMALL");
    expect(within(item).getByRole("button", { name: "Editar o pedido de Cardiologia" })).not.toBeNull();
    expect(within(item).getByRole("button", { name: "Retirar o pedido de Cardiologia" })).not.toBeNull();
    const other = screen.getByRole("listitem", { name: "Ecocardiografia" });
    expect(within(other).getByText(NOT_SENT_LABEL)).not.toBeNull();
    expect(within(other).queryByText(/seu CBO/)).toBeNull();
  });

  it("na consulta (modo rascunho) o rascunho segue 'rascunho', sem 'não enviado'", async () => {
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ DRAFT ]);
    mount({ mode: "draft", notSent: [ { index: 0, id: "rr1", error: "cbo_not_allowed" } ] });
    const item = await screen.findByRole("listitem", { name: "Cardiologia" });
    expect(within(item).getByText("rascunho")).not.toBeNull();
    expect(within(item).queryByText(NOT_SENT_LABEL)).toBeNull();
  });

  it("avisa a peça-mãe de quantos pedidos há (rascunho ou enviado)", async () => {
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ DRAFT, regRequest({ id: "rr2", status: "pending" }) ]);
    const onCount = vi.fn();
    mount({ onCountChange: onCount });
    await screen.findAllByRole("listitem", { name: "Cardiologia" });
    expect(onCount).toHaveBeenLastCalledWith(2);
  });

  it("a falha da guia aparece na própria peça", async () => {
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ regRequest({ status: "authorized" }) ]);
    mount({ mode: "addendum", onOpenGuide: async () => "guia não encontrada" });
    fireEvent.click(await screen.findByRole("button", { name: "Guia em PDF" }));
    expect((await screen.findByRole("alert")).textContent).toBe("guia não encontrada");
  });

  it("a leitura é única: sem polling, e refreshKey relê", async () => {
    const { rerender } = mount({ refreshKey: 0 });
    await screen.findByRole("button", { name: "Pedir regulação" });
    expect(mocked(api.listConsultationRegulationRequests)).toHaveBeenCalledTimes(1);
    rerender(<RegulationRequestsField consultationId="cs1" cbo="225142" cid10Allowed mode="draft" searchDelayMs={0} refreshKey={1} />);
    await waitFor(() => expect(mocked(api.listConsultationRegulationRequests)).toHaveBeenCalledTimes(2));
  });
});
