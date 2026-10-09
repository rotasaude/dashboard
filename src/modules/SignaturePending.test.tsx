// src/modules/SignaturePending.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listPendingSignatures: vi.fn(), startSignatureBatch: vi.fn(), returnToPaper: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { SignaturePending } from "./SignaturePending";
import { renderWithProviders } from "../test/campaignFixtures";
import { pendingRequest, signer } from "../test/signatureFixtures";
import { SIMULATED_NOTICE } from "../lib/signature";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(cleanup);

describe("SignaturePending", () => {
  let redirect: ReturnType<typeof vi.fn>;
  let onNavigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    redirect = vi.fn();
    onNavigate = vi.fn();
    mocked(api.fetchCurrentSession).mockResolvedValue(signer());
    mocked(api.listPendingSignatures).mockResolvedValue([
      pendingRequest(),
      pendingRequest({ id: "sr2", document_type: "consultation_addendum", document_id: "ad1", patient_display_name: "Pedro Alves",
        finalized_at: "2026-10-07T15:00:00-03:00", reason_code: "provider_unavailable", attempts: 3 })
    ]);
  });

  const renderIt = () => renderWithProviders(<SignaturePending onNavigate={onNavigate} redirect={redirect} />);

  it("lista paciente, documento, finalização, motivo e tentativas", async () => {
    renderIt();
    const panel = await screen.findByRole("region", { name: "Pendentes" });
    expect(await within(panel).findByText("Joana Lima")).not.toBeNull();
    expect(within(panel).getByText("consulta")).not.toBeNull();
    expect(within(panel).getByText("07/10/2026, 10:20")).not.toBeNull();
    expect(within(panel).getByText("sem sessão de assinatura aberta")).not.toBeNull();
    expect(within(panel).getByText("Pedro Alves")).not.toBeNull();
    expect(within(panel).getByText("adendo")).not.toBeNull();
    expect(within(panel).getByText("o prestador não respondeu")).not.toBeNull();
    expect(within(panel).getByText("3")).not.toBeNull();
  });

  it("Assinar todas: pede o lote sem ids e vai ao prestador", async () => {
    mocked(api.startSignatureBatch).mockResolvedValue({ authorize_url: "https://psc.example/authorize?b=1", count: 2 });
    renderIt();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getByRole("button", { name: "Assinar todas" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://psc.example/authorize?b=1"));
    expect(api.startSignatureBatch).toHaveBeenCalledWith("/signature-pending");
  });

  it("mais de 50: avisa que o lote leva as 50 mais antigas", async () => {
    mocked(api.listPendingSignatures).mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => pendingRequest({ id: `sr${i}`, document_id: `cs${i}` })));
    renderIt();
    expect(await screen.findByText(
      "cada lote assina até 50 documentos, os mais antigos primeiro — depois do retorno, clique de novo para os demais")).not.toBeNull();
  });

  it("nothing_pending relê a lista e diz que não há pendentes", async () => {
    mocked(api.startSignatureBatch).mockRejectedValue(new ApiError(409, { error: "nothing_pending" }, "409"));
    renderIt();
    await screen.findByText("Joana Lima");
    mocked(api.listPendingSignatures).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Assinar todas" }));
    expect(await screen.findByText("não há documentos pendentes — a lista foi atualizada")).not.toBeNull();
    expect(await screen.findByText("nenhum documento esperando a sua assinatura")).not.toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sem certificado: diz e leva à Conta → Assinatura digital", async () => {
    mocked(api.startSignatureBatch).mockRejectedValue(new ApiError(409, { error: "certificate_not_linked" }, "409"));
    renderIt();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getByRole("button", { name: "Assinar todas" }));
    expect((await screen.findByRole("alert")).textContent).toBe("vincule um certificado em Conta → Assinatura digital antes de assinar");
    fireEvent.click(screen.getByRole("button", { name: "Vincular certificado" }));
    expect(onNavigate).toHaveBeenCalledWith("signature");
  });

  it("Voltar ao papel com motivo curto: avisa e não envia", async () => {
    renderIt();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getAllByRole("button", { name: "Voltar ao papel" })[0]);
    const form = screen.getByRole("region", { name: "Voltar ao papel" });
    fireEvent.change(within(form).getByLabelText("Motivo para voltar ao papel"), { target: { value: "  curto  " } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar volta ao papel" }));
    expect(within(form).getByText("descreva o motivo com pelo menos 10 caracteres")).not.toBeNull();
    expect(api.returnToPaper).not.toHaveBeenCalled();
  });

  it("Voltar ao papel: manda o motivo sem espaços das pontas, diz o que fazer e relê", async () => {
    mocked(api.returnToPaper).mockResolvedValue(pendingRequest({ status: "returned_to_paper", reason_code: "user_request" }));
    renderIt();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getAllByRole("button", { name: "Voltar ao papel" })[0]);
    const form = screen.getByRole("region", { name: "Voltar ao papel" });
    fireEvent.change(within(form).getByLabelText("Motivo para voltar ao papel"), { target: { value: "  paciente pediu o papel  " } });
    mocked(api.listPendingSignatures).mockResolvedValue([]);
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar volta ao papel" }));

    await waitFor(() => expect(api.returnToPaper).toHaveBeenCalledWith("sr1", "paciente pediu o papel"));
    expect(await screen.findByText("voltou ao papel — imprima a consulta e assine à mão")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Voltar ao papel" })).toBeNull();
    expect(await screen.findByText("nenhum documento esperando a sua assinatura")).not.toBeNull();
  });

  it("not_pending fecha o formulário, diz e relê a lista", async () => {
    mocked(api.returnToPaper).mockRejectedValue(new ApiError(409, { error: "not_pending" }, "409"));
    renderIt();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getAllByRole("button", { name: "Voltar ao papel" })[0]);
    const form = screen.getByRole("region", { name: "Voltar ao papel" });
    fireEvent.change(within(form).getByLabelText("Motivo para voltar ao papel"), { target: { value: "paciente pediu o papel" } });
    const before = mocked(api.listPendingSignatures).mock.calls.length;
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar volta ao papel" }));

    expect(await screen.findByText("este documento não está mais pendente ou a assinatura está em andamento — a lista foi atualizada")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Voltar ao papel" })).toBeNull();
    await waitFor(() => expect(mocked(api.listPendingSignatures).mock.calls.length).toBeGreaterThan(before));
  });

  it("lista vazia: diz e não oferece lote", async () => {
    mocked(api.listPendingSignatures).mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText("nenhum documento esperando a sua assinatura")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Assinar todas" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("campos nulos aparecem como traço", async () => {
    mocked(api.listPendingSignatures).mockResolvedValue([ pendingRequest({ patient_display_name: null, finalized_at: null, reason_code: null }) ]);
    renderIt();
    const panel = await screen.findByRole("region", { name: "Pendentes" });
    await within(panel).findByText("consulta");
    expect(within(panel).getAllByText("—").length).toBe(3);
  });

  it("authorization_denied no lote: frase e a lista fica, sem ir ao prestador", async () => {
    mocked(api.startSignatureBatch).mockRejectedValue(new ApiError(403, { error: "authorization_denied" }, "403"));
    renderIt();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getByRole("button", { name: "Assinar todas" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("a autorização foi negada no prestador (ou o certificado é de outro prestador) — nada foi alterado");
    expect(screen.getByText("Joana Lima")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Vincular certificado" })).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("professional_cpf_missing e invalid_provider no lote mostram a frase", async () => {
    mocked(api.startSignatureBatch).mockRejectedValueOnce(new ApiError(409, { error: "professional_cpf_missing" }, "409"));
    renderIt();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getByRole("button", { name: "Assinar todas" }));
    expect((await screen.findByRole("alert")).textContent).toBe("seu cadastro está sem CPF — procure a administração da cidade");
    mocked(api.startSignatureBatch).mockRejectedValueOnce(new ApiError(422, { error: "invalid_provider" }, "422"));
    fireEvent.click(screen.getByRole("button", { name: "Assinar todas" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent)
      .toBe("o prestador do certificado não está mais disponível nesta cidade — vincule outro certificado"));
  });

  it("R10: mostra o aviso de PSC simulado só com o interruptor ligado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(signer([ "health_professional" ], { features: [ "clinical_record", "digital_signature", "signature_psc_mock" ] }));
    renderIt();
    await screen.findByText("Joana Lima");
    expect(screen.getByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("R10: sem o interruptor, não há aviso de PSC simulado", async () => {
    renderIt();
    await screen.findByText("Joana Lima");
    expect(screen.queryByText(SIMULATED_NOTICE)).toBeNull();
  });

  it("trocar de linha com o formulário aberto zera o motivo e envia só o da nova linha", async () => {
    mocked(api.returnToPaper).mockResolvedValue(pendingRequest({ id: "sr2", status: "returned_to_paper" }));
    renderIt();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getAllByRole("button", { name: "Voltar ao papel" })[0]);
    fireEvent.change(screen.getByLabelText("Motivo para voltar ao papel"), { target: { value: "motivo da primeira linha" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Voltar ao papel" })[1]);
    const field = screen.getByLabelText("Motivo para voltar ao papel") as HTMLTextAreaElement;
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "motivo da segunda linha" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar volta ao papel" }));
    await waitFor(() => expect(api.returnToPaper).toHaveBeenCalledWith("sr2", "motivo da segunda linha"));
    expect(api.returnToPaper).toHaveBeenCalledTimes(1);
  });

  it("not_author fecha o formulário, diz e relê a lista", async () => {
    mocked(api.returnToPaper).mockRejectedValue(new ApiError(403, { error: "not_author" }, "403"));
    renderIt();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getAllByRole("button", { name: "Voltar ao papel" })[0]);
    fireEvent.change(screen.getByLabelText("Motivo para voltar ao papel"), { target: { value: "paciente pediu o papel" } });
    const before = mocked(api.listPendingSignatures).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Confirmar volta ao papel" }));
    expect(await screen.findByText("só quem escreveu o documento pode assiná-lo ou voltá-lo ao papel")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Voltar ao papel" })).toBeNull();
    await waitFor(() => expect(mocked(api.listPendingSignatures).mock.calls.length).toBeGreaterThan(before));
  });
});
