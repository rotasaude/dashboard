// src/modules/consultation/ConsultationView.signature.test.tsx
// O marcador do 19b dentro da ConsultationView real do 19a.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), fetchConsultationPdf: vi.fn(), getConsultation: vi.fn(),
    addAddendum: vi.fn(), getSignature: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ConsultationLoader, ConsultationView } from "./ConsultationView";
import { SIMULATED_NOTICE } from "../../lib/signature";
import { finalized, options } from "../../test/consultationFixtures";
import { signatureBlock, signatureDetail, signer } from "../../test/signatureFixtures";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

const addendum = { id: "ad1", author_name: "Enf. Lúcia Prado", created_at: "2026-10-07T11:00:00-03:00",
  reason: "correção do plano", text: "Retorno em 15 dias.", changes: null };
const view = (c: ReturnType<typeof finalized>, extra: { readOnly?: boolean; onOpeningRequired?(): void } = {}) =>
  renderWithProviders(<ConsultationView consultation={c} options={options()} patientProblems={[]}
    onAddendumAdded={vi.fn()} onClose={vi.fn()} {...extra} />);

describe("ConsultationView com assinatura digital (19b)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getConsultation, api.getSignature ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(signer());
    mocked(api.getSignature).mockResolvedValue(signatureDetail());
  });

  it("marcador na consulta e em cada adendo; o impresso avisa o caminho do adendo", () => {
    view(finalized({ signature: signatureBlock(), addenda: [
      { ...addendum, signature: { mode: "pending", request_id: "sr2", reason_code: "no_session" } } ] }));
    const consultation = screen.getByRole("group", { name: "assinatura da consulta" });
    expect(within(consultation).getByText("assinada digitalmente")).not.toBeNull();
    const added = screen.getByRole("group", { name: "assinatura do adendo" });
    expect(within(added).getByText("assinatura pendente")).not.toBeNull();
    expect(within(added).getByText("sem sessão de assinatura aberta")).not.toBeNull();
    expect(screen.getByText("com adendo, o impresso é o do prontuário; os documentos assinados estão em “Ver o que foi assinado”"))
      .not.toBeNull();
  });

  it("consulta digital sem adendo: o impresso é o PDF assinado", () => {
    view(finalized({ signature: signatureBlock() }));
    expect(screen.getByText("o impresso é o PDF assinado digitalmente")).not.toBeNull();
  });

  it("consulta simulada: o aviso aparece no marcador; não simulada, não", () => {
    view(finalized({ signature: signatureBlock({ simulated: true }) }));
    expect(within(screen.getByRole("group", { name: "assinatura da consulta" })).getByText(SIMULATED_NOTICE)).not.toBeNull();
    cleanup();
    view(finalized({ signature: signatureBlock() }));
    expect(screen.queryByText(SIMULATED_NOTICE)).toBeNull();
  });

  it("voltou ao papel porque o interruptor foi desligado", () => {
    view(finalized({ signature: { mode: "manual", request_id: "sr1", reason_code: "feature_disabled" } }));
    const group = screen.getByRole("group", { name: "assinatura da consulta" });
    expect(within(group).getByText("assinatura à mão (papel)")).not.toBeNull();
    expect(within(group).getByText("assinatura digital desligada na cidade")).not.toBeNull();
    expect(screen.getByText("o impresso sai com espaço para assinatura à mão")).not.toBeNull();
  });

  it("api sem o 19b (sem o bloco): nada de assinatura na tela", () => {
    view(finalized({ addenda: [ addendum ] }));
    expect(screen.queryByRole("group", { name: "assinatura da consulta" })).toBeNull();
    expect(screen.queryByRole("group", { name: "assinatura do adendo" })).toBeNull();
    expect(screen.queryByText(/o impresso/)).toBeNull();
  });

  it("leitura administrativa: o marcador aparece; ver o conteúdo passa pelo step-up, sem baixar nem revalidar", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(
      sessionWith([ "municipal_admin" ], { id: "ad1", features: [ "clinical_record", "digital_signature" ] }));
    view(finalized({ signature: signatureBlock() }), { readOnly: true });
    const group = screen.getByRole("group", { name: "assinatura da consulta" });
    fireEvent.click(within(group).getByRole("button", { name: "Ver o que foi assinado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver o conteúdo" }));
    const section = await screen.findByRole("region", { name: "O que foi assinado" });
    expect(within(section).getByLabelText("conteúdo assinado").textContent).toMatch(/Diabetes descompensado/);
    expect(api.getSignature).toHaveBeenCalledWith("sg1");
    for (const name of [ "Baixar PDF assinado", "Baixar .p7s", "Revalidar" ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("autora (sem readOnly): o detalhe traz os downloads e Revalidar", async () => {
    view(finalized({ signature: signatureBlock() }));
    fireEvent.click(screen.getByRole("button", { name: "Ver o que foi assinado" }));
    expect(await screen.findByRole("button", { name: "Baixar PDF assinado" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Baixar .p7s" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Revalidar" })).not.toBeNull();
  });

  it("abertura vencida ao ler o que foi assinado: a view repassa onOpeningRequired", async () => {
    mocked(api.getSignature).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    const onOpeningRequired = vi.fn();
    view(finalized({ signature: signatureBlock() }), { onOpeningRequired });
    fireEvent.click(screen.getByRole("button", { name: "Ver o que foi assinado" }));
    await waitFor(() => expect(onOpeningRequired).toHaveBeenCalled());
  });

  it("o Loader repassa o seu onOpeningRequired aos marcadores", async () => {
    mocked(api.getConsultation).mockResolvedValue(finalized({ signature: signatureBlock(), addenda: [
      { ...addendum, signature: signatureBlock({ signature_id: "sg2" }) } ] }));
    mocked(api.getSignature).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    const onOpeningRequired = vi.fn();
    renderWithProviders(<ConsultationLoader id="cs1" options={options()} patientProblems={[]} onClose={vi.fn()}
      onOpeningRequired={onOpeningRequired} />);
    const added = await screen.findByRole("group", { name: "assinatura do adendo" });
    fireEvent.click(within(added).getByRole("button", { name: "Ver o que foi assinado" }));
    await waitFor(() => expect(onOpeningRequired).toHaveBeenCalled());
    expect(api.getSignature).toHaveBeenCalledWith("sg2");
  });
});
