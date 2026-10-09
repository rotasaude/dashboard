// src/modules/signature/SignatureMarker.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getSignature: vi.fn() };
});

import * as api from "../../lib/api";
import { SignatureMarker } from "./SignatureMarker";
import { SIMULATED_NOTICE } from "../../lib/signature";
import { signatureBlock, signatureDetail, signer } from "../../test/signatureFixtures";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

describe("SignatureMarker", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getSignature ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(signer());
    mocked(api.getSignature).mockResolvedValue(signatureDetail());
  });

  it("digital: estado, quem e quando; abre e fecha o que foi assinado", async () => {
    renderWithProviders(<SignatureMarker label="assinatura da consulta" block={signatureBlock()} />);
    const group = screen.getByRole("group", { name: "assinatura da consulta" });
    expect(within(group).getByText("assinada digitalmente")).not.toBeNull();
    expect(within(group).getByText("Helena Prado · 07/10/2026, 10:21")).not.toBeNull();
    expect(within(group).queryByText(SIMULATED_NOTICE)).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Ver o que foi assinado" }));
    expect(await screen.findByRole("region", { name: "O que foi assinado" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Baixar PDF assinado" })).not.toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Fechar o que foi assinado" }));
    expect(screen.queryByRole("region", { name: "O que foi assinado" })).toBeNull();
  });

  it("digital simulada: o aviso fica visível no marcador", () => {
    renderWithProviders(<SignatureMarker label="assinatura da consulta" block={signatureBlock({ simulated: true })} />);
    const group = screen.getByRole("group", { name: "assinatura da consulta" });
    expect(within(group).getByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("indeterminada aparece com o estado, sem esconder", () => {
    renderWithProviders(<SignatureMarker label="assinatura da consulta" block={signatureBlock({ verification: "indeterminate" })} />);
    expect(screen.getByText("assinatura digital indeterminada")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Ver o que foi assinado" })).not.toBeNull();
  });

  it("pendente e à mão: sem botão de conteúdo", () => {
    renderWithProviders(<SignatureMarker label="assinatura do adendo" block={{ mode: "pending", request_id: "sr2", reason_code: "session_expired" }} />);
    expect(screen.getByText("assinatura pendente")).not.toBeNull();
    expect(screen.getByText("a sessão de assinatura venceu")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ver o que foi assinado" })).toBeNull();
    expect(api.getSignature).not.toHaveBeenCalled();
  });

  it("leitura administrativa: o marcador aparece e o conteúdo passa pelo step-up, sem downloads", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(
      sessionWith([ "municipal_admin" ], { id: "ad1", features: [ "clinical_record", "digital_signature" ] }));
    renderWithProviders(<SignatureMarker label="assinatura da consulta" block={signatureBlock()} readOnly />);
    const group = screen.getByRole("group", { name: "assinatura da consulta" });
    fireEvent.click(within(group).getByRole("button", { name: "Ver o que foi assinado" }));
    expect(api.getSignature).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Ver o conteúdo" }));
    expect(await screen.findByRole("region", { name: "O que foi assinado" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Baixar PDF assinado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revalidar" })).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Fechar o que foi assinado" }));
    expect(screen.queryByRole("region", { name: "O que foi assinado" })).toBeNull();
  });
});
