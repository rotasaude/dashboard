import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { renderWithProviders } from "../../test/campaignFixtures";
import { DEST_CURITIBA, DEST_NEAR, tfdCase, tfdRow, trUser } from "../../test/transportFixtures";
import { TfdRequestForm } from "./TfdRequestForm";
import { TfdMyCases } from "../TfdMyCases";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getTfdOptions: vi.fn(), getTfdPrefill: vi.fn(),
  createTfdCase: vi.fn(), updateTfdCase: vi.fn(), submitTfdCase: vi.fn(), listMyTfdCases: vi.fn(), readTfdCase: vi.fn(), searchSigtap: vi.fn(), searchTerminology: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const OPTIONS = { destinations: [ DEST_CURITIBA, DEST_NEAR ], providers: [ { id: "cp1", name: "Hospital de Olhos", ibge_code: "4106902" } ], min_distance_km: 50 };

function mountForm(onDone: (c: api.TfdCase, text: string) => void = () => {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "health_professional" ]));
  vi.mocked(api.getTfdOptions).mockResolvedValue(OPTIONS);
  vi.mocked(api.getTfdPrefill).mockResolvedValue({ patient_id: "pt1", cid10: "H25.1", sigtap_code: "0405050372" });
  return renderWithProviders(<TfdRequestForm source={{ consultationId: "co1" }} searchDelayMs={0} onDone={onDone} onCancel={() => {}} />);
}

describe("pedir TFD a partir da consulta", () => {
  it("abre pré-preenchido; destino perto recusa antes de enviar", async () => {
    mountForm();
    const form = await screen.findByRole("form", { name: "Laudo de TFD" });
    expect(api.getTfdPrefill).toHaveBeenCalledWith("co1");
    expect(within(form).getByText("H25.1")).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("Cidade de destino"), { target: { value: "t2" } });
    fireEvent.change(within(form).getByLabelText("Justificativa"), { target: { value: "Sem oftalmologia cirúrgica no município." } });
    fireEvent.click(within(form).getByRole("button", { name: "Enviar à comissão" }));
    expect(screen.getByText("destino a menos de 50 km da sede — não cabe TFD")).not.toBeNull();
    expect(api.createTfdCase).not.toHaveBeenCalled();
  });
  it("salvar e enviar: cria o rascunho e envia; CID e justificativa só no corpo", async () => {
    vi.mocked(api.createTfdCase).mockResolvedValue(tfdCase({ status: "draft" }));
    vi.mocked(api.submitTfdCase).mockResolvedValue(tfdCase({ status: "submitted" }));
    const onDone = vi.fn();
    mountForm(onDone);
    const form = await screen.findByRole("form", { name: "Laudo de TFD" });
    fireEvent.change(within(form).getByLabelText("Cidade de destino"), { target: { value: "t1" } });
    fireEvent.change(within(form).getByLabelText("Justificativa"), { target: { value: "Sem oftalmologia cirúrgica no município." } });
    fireEvent.click(within(form).getByRole("button", { name: "Enviar à comissão" }));
    await waitFor(() => expect(api.submitTfdCase).toHaveBeenCalledWith("c1"));
    expect(vi.mocked(api.createTfdCase).mock.calls[0][0]).toMatchObject({ patient_id: "pt1", consultation_id: "co1", destination_id: "t1",
      report: { cid10: "H25.1", sigtap_code: "0405050372", transport_mode: "fleet", companion_indicated: false } });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: "submitted" }), "Pedido de TFD enviado à comissão."));
    // O laudo só no corpo: nada na URL de quem chama (as funções do cliente recebem só ids).
    expect(vi.mocked(api.getTfdPrefill).mock.calls[0]).toEqual([ "co1" ]);
  });
  it("recusa do envio mostra todas as frases", async () => {
    vi.mocked(api.createTfdCase).mockResolvedValue(tfdCase({ status: "draft" }));
    vi.mocked(api.submitTfdCase).mockRejectedValue(new ApiError(422, { error: "invalid", problems: [ { path: "report.sigtap_code", error: "primary_care_procedure" } ] }, "422"));
    mountForm();
    const form = await screen.findByRole("form", { name: "Laudo de TFD" });
    fireEvent.change(within(form).getByLabelText("Cidade de destino"), { target: { value: "t1" } });
    fireEvent.change(within(form).getByLabelText("Justificativa"), { target: { value: "Sem oftalmologia cirúrgica no município." } });
    fireEvent.click(within(form).getByRole("button", { name: "Enviar à comissão" }));
    expect(await screen.findByText("procedimento da atenção básica — não cabe TFD")).not.toBeNull();
    expect(screen.getByText("O rascunho ficou salvo em Meus pedidos de TFD.")).not.toBeNull();
  });
  it("depois do rascunho criado, um novo envio vai pelo PATCH, sem criar outro", async () => {
    vi.mocked(api.createTfdCase).mockResolvedValue(tfdCase({ status: "draft" }));
    vi.mocked(api.submitTfdCase).mockRejectedValueOnce(new ApiError(422, { error: "invalid", problems: [ { path: "destination_id", error: "metropolitan_destination" }, { path: "report.cid10", error: "cid_required" } ] }, "422"));
    vi.mocked(api.updateTfdCase).mockResolvedValue(tfdCase({ status: "draft" }));
    vi.mocked(api.submitTfdCase).mockResolvedValueOnce(tfdCase({ status: "submitted" }));
    mountForm();
    const form = await screen.findByRole("form", { name: "Laudo de TFD" });
    fireEvent.change(within(form).getByLabelText("Cidade de destino"), { target: { value: "t1" } });
    fireEvent.change(within(form).getByLabelText("Justificativa"), { target: { value: "Sem oftalmologia cirúrgica no município." } });
    fireEvent.click(within(form).getByRole("button", { name: "Enviar à comissão" }));
    expect(await screen.findByText("destino na mesma região metropolitana — não cabe TFD")).not.toBeNull();
    expect(screen.getByText("informe o CID-10")).not.toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Enviar à comissão" }));
    await waitFor(() => expect(api.submitTfdCase).toHaveBeenCalledTimes(2));
    expect(api.createTfdCase).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.updateTfdCase).mock.calls[0][0]).toBe("c1");
  });
  it("rascunho incompleto salva sem enviar", async () => {
    vi.mocked(api.createTfdCase).mockResolvedValue(tfdCase({ status: "draft" }));
    const onDone = vi.fn();
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "health_professional" ]));
    vi.mocked(api.getTfdOptions).mockResolvedValue(OPTIONS);
    vi.mocked(api.getTfdPrefill).mockResolvedValue({ patient_id: "pt1", cid10: null, sigtap_code: null });
    renderWithProviders(<TfdRequestForm source={{ consultationId: "co1" }} searchDelayMs={0} onDone={onDone} onCancel={() => {}} />);
    const form = await screen.findByRole("form", { name: "Laudo de TFD" });
    fireEvent.change(within(form).getByLabelText("Cidade de destino"), { target: { value: "t1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }), "Rascunho de TFD salvo."));
    expect(vi.mocked(api.createTfdCase).mock.calls[0][0].report).toMatchObject({ cid10: null, sigtap_code: null, justification: null });
    expect(api.submitTfdCase).not.toHaveBeenCalled();
  });
  it("motivo do acompanhante só aparece e só vai com a indicação", async () => {
    vi.mocked(api.createTfdCase).mockResolvedValue(tfdCase({ status: "draft" }));
    mountForm();
    const form = await screen.findByRole("form", { name: "Laudo de TFD" });
    expect(within(form).queryByLabelText("Motivo da indicação")).toBeNull();
    fireEvent.click(within(form).getByLabelText("Indicação de acompanhante"));
    fireEvent.change(within(form).getByLabelText("Motivo da indicação"), { target: { value: "curto" } });
    fireEvent.change(within(form).getByLabelText("Cidade de destino"), { target: { value: "t1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar rascunho" }));
    expect(screen.getByText("explique por que o paciente precisa de acompanhante (10 a 500 caracteres)")).not.toBeNull();
    expect(api.createTfdCase).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Motivo da indicação"), { target: { value: "paciente idoso, não anda só" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.createTfdCase).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createTfdCase).mock.calls[0][0].report).toMatchObject({ companion_indicated: true, companion_reason: "paciente idoso, não anda só" });
  });
  it("prestadores da cidade de destino vêm primeiro; o escolhido vai no corpo", async () => {
    vi.mocked(api.createTfdCase).mockResolvedValue(tfdCase({ status: "draft" }));
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "health_professional" ]));
    vi.mocked(api.getTfdOptions).mockResolvedValue({ ...OPTIONS, providers: [ { id: "cp9", name: "Clínica Ponta Grossa", ibge_code: "4119905" }, ...OPTIONS.providers ] });
    vi.mocked(api.getTfdPrefill).mockResolvedValue({ patient_id: "pt1", cid10: "H25.1", sigtap_code: "0405050372" });
    renderWithProviders(<TfdRequestForm source={{ consultationId: "co1" }} searchDelayMs={0} onDone={() => {}} onCancel={() => {}} />);
    const form = await screen.findByRole("form", { name: "Laudo de TFD" });
    fireEvent.change(within(form).getByLabelText("Cidade de destino"), { target: { value: "t1" } });
    const provider = within(form).getByLabelText("Prestador") as HTMLSelectElement;
    expect([ ...provider.options ].map((o) => o.value)).toEqual([ "", "cp1", "cp9" ]);
    fireEvent.change(provider, { target: { value: "cp1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.createTfdCase).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createTfdCase).mock.calls[0][0].provider_id).toBe("cp1");
  });
  it("médico sem vínculo 225: a frase do cbo_not_allowed", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "health_professional" ]));
    vi.mocked(api.getTfdOptions).mockRejectedValue(new ApiError(403, { error: "cbo_not_allowed" }, "403"));
    vi.mocked(api.getTfdPrefill).mockRejectedValue(new ApiError(403, { error: "cbo_not_allowed" }, "403"));
    renderWithProviders(<TfdRequestForm source={{ consultationId: "co1" }} searchDelayMs={0} onDone={() => {}} onCancel={() => {}} />);
    expect(await screen.findByText("só médico (CBO 225) pede TFD")).not.toBeNull();
    expect(screen.queryByRole("form", { name: "Laudo de TFD" })).toBeNull();
  });
  it("editar o devolvido: PATCH com o processo inteiro, inclusive o prestador", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "health_professional" ]));
    vi.mocked(api.getTfdOptions).mockResolvedValue(OPTIONS);
    vi.mocked(api.updateTfdCase).mockResolvedValue(tfdCase({ status: "returned" }));
    const onDone = vi.fn();
    renderWithProviders(<TfdRequestForm source={{ tfdCase: tfdCase({ status: "returned" }) }} searchDelayMs={0} onDone={onDone} onCancel={() => {}} />);
    const form = await screen.findByRole("form", { name: "Laudo de TFD" });
    expect(api.getTfdPrefill).not.toHaveBeenCalled();
    expect(within(form).getByText("0405050372 — FACOEMULSIFICACAO")).not.toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.updateTfdCase).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTfdCase).mock.calls[0]).toEqual([ "c1", {
      patient_id: "pt1", consultation_id: "co1", destination_id: "t1", provider_id: "cp1",
      report: { sigtap_code: "0405050372", cid10: "H25.1", justification: "Sem oftalmologia cirúrgica no município.", companion_indicated: false,
        companion_reason: null, transport_mode: "fleet" } } ]);
    expect(api.createTfdCase).not.toHaveBeenCalled();
  });
});

describe("meus pedidos de TFD", () => {
  it("lista sem dado clínico; devolvido abre pela leitura e permite editar", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "health_professional" ]));
    vi.mocked(api.listMyTfdCases).mockResolvedValue([ tfdRow({ status: "returned" }) ]);
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase({ status: "returned", events: [ { kind: "returned", at: "2026-11-03T09:00:00-03:00", by_name: "Comissão", reason: "falta o exame de vista" } ] }));
    vi.mocked(api.getTfdOptions).mockResolvedValue(OPTIONS);
    renderWithProviders(<TfdMyCases />);
    expect(await screen.findByText("devolvido para complementar")).not.toBeNull();
    expect(screen.queryByText("H25.1")).toBeNull();
    expect(api.readTfdCase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Abrir o pedido de Maria da Silva" }));
    expect(await screen.findByText("falta o exame de vista")).not.toBeNull();
    expect(api.readTfdCase).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("form", { name: "Laudo de TFD" })).not.toBeNull();
  });
  it("pedido já enviado abre só para leitura", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "health_professional" ]));
    vi.mocked(api.listMyTfdCases).mockResolvedValue([ tfdRow({ status: "submitted" }) ]);
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase({ status: "submitted" }));
    renderWithProviders(<TfdMyCases />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o pedido de Maria da Silva" }));
    const laudo = await screen.findByRole("region", { name: "Laudo do pedido" });
    expect(within(laudo).getByText("H25.1")).not.toBeNull();
    expect(screen.queryByRole("form", { name: "Laudo de TFD" })).toBeNull();
    expect(api.getTfdOptions).not.toHaveBeenCalled();
  });
  it("sem vínculo 225 a lista mostra a frase do cbo_not_allowed", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "health_professional" ]));
    vi.mocked(api.listMyTfdCases).mockRejectedValue(new ApiError(403, { error: "cbo_not_allowed" }, "403"));
    renderWithProviders(<TfdMyCases />);
    expect(await screen.findByText("só médico (CBO 225) pede TFD")).not.toBeNull();
  });
});
