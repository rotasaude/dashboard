// src/modules/signature/SignatureDetail.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getSignature: vi.fn(), verifySignature: vi.fn(), fetchSignatureFile: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { SignatureDetail } from "./SignatureDetail";
import { Tag } from "../../components/Tag";
import { SIMULATED_NOTICE } from "../../lib/signature";
import { signatureDetail, signer } from "../../test/signatureFixtures";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
let downloads: string[];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const admin = (over = {}) => sessionWith([ "municipal_admin" ], { id: "ad1", features: [ "clinical_record", "digital_signature" ], ...over });

describe("SignatureDetail", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getSignature, api.verifySignature, api.fetchSignatureFile ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(signer());
    mocked(api.getSignature).mockResolvedValue(signatureDetail());
    downloads = [];
    // O jsdom não tem createObjectURL/revokeObjectURL nem navega no clique do <a>.
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:file-1") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  });

  it("mostra quem assinou, quando, a política, a validação e o conteúdo", async () => {
    renderWithProviders(<SignatureDetail id="sg1" />);
    const section = await screen.findByRole("region", { name: "O que foi assinado" });
    expect(within(section).getByText("Helena Prado")).not.toBeNull();
    expect(within(section).getByText("***.456.789-**")).not.toBeNull();
    expect(within(section).getByText("07/10/2026, 10:21")).not.toBeNull();
    expect(within(section).getByText("AD-RB")).not.toBeNull();
    expect(within(section).getByText("válida")).not.toBeNull();
    expect(within(section).getByText("verificada em 08/10/2026, 09:00")).not.toBeNull();
    expect(within(section).getByLabelText("conteúdo assinado").textContent).toMatch(/"assessment": "Diabetes descompensado\."/);
    expect(within(section).queryByText(SIMULATED_NOTICE)).toBeNull();
    expect(api.getSignature).toHaveBeenCalledWith("sg1");
  });

  it("validação desconhecida (api mais novo): o valor cru aparece, nunca 'válida'", async () => {
    mocked(api.getSignature).mockResolvedValue(signatureDetail({ verification: "revoked_later" as never }));
    renderWithProviders(<SignatureDetail id="sg1" />);
    const section = await screen.findByRole("region", { name: "O que foi assinado" });
    const tag = within(section).getByText("revoked_later");
    const { container } = render(<Tag tone="warn">referência</Tag>);
    expect(tag.getAttribute("style")).toBe(container.firstElementChild?.getAttribute("style"));
    expect(within(section).queryByText("válida")).toBeNull();
  });

  it("Revalidar avisa o marcador e invalida só a consulta dona", async () => {
    mocked(api.verifySignature).mockResolvedValue(signatureDetail({ verification: "invalid" }));
    const onVerified = vi.fn();
    const { client } = renderWithProviders(<SignatureDetail id="sg1" consultationId="cs1" onVerified={onVerified} />);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Revalidar" }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(expect.objectContaining({ verification: "invalid" })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ "consultation", "cs1" ] });
  });

  it("assinatura simulada: o aviso aparece", async () => {
    mocked(api.getSignature).mockResolvedValue(signatureDetail({ simulated: true, provider: "simulated" }));
    renderWithProviders(<SignatureDetail id="sg1" />);
    const section = await screen.findByRole("region", { name: "O que foi assinado" });
    expect(within(section).getByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("baixa com o nome dado pelo api (PDF e pacote)", async () => {
    mocked(api.fetchSignatureFile)
      .mockResolvedValueOnce({ blob: new Blob([ "x" ]), filename: "documento-assinado.pdf" })
      .mockResolvedValueOnce({ blob: new Blob([ "x" ]), filename: "documento-assinado.zip" });
    renderWithProviders(<SignatureDetail id="sg1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Baixar PDF assinado" }));
    await waitFor(() => expect(downloads).toEqual([ "documento-assinado.pdf" ]));
    expect(api.fetchSignatureFile).toHaveBeenCalledWith("sg1", "pdf");

    fireEvent.click(screen.getByRole("button", { name: "Baixar .p7s" }));
    await waitFor(() => expect(downloads).toEqual([ "documento-assinado.pdf", "documento-assinado.zip" ]));
    expect(api.fetchSignatureFile).toHaveBeenLastCalledWith("sg1", "package");
  });

  it("pacote simulado mantém o nome do api (documento-assinado-simulado.zip)", async () => {
    mocked(api.fetchSignatureFile).mockResolvedValue({ blob: new Blob([ "x" ]), filename: "documento-assinado-simulado.zip" });
    renderWithProviders(<SignatureDetail id="sg1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Baixar .p7s" }));
    await waitFor(() => expect(downloads).toEqual([ "documento-assinado-simulado.zip" ]));
  });

  it("sem nome do api: cai no nome pelo id, nunca o nome do paciente", async () => {
    mocked(api.fetchSignatureFile).mockResolvedValue({ blob: new Blob([ "x" ]), filename: null });
    renderWithProviders(<SignatureDetail id="sg1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Baixar PDF assinado" }));
    await waitFor(() => expect(downloads).toEqual([ "assinatura-sg1.pdf" ]));
    fireEvent.click(screen.getByRole("button", { name: "Baixar .p7s" }));
    await waitFor(() => expect(downloads).toEqual([ "assinatura-sg1.pdf", "assinatura-sg1.zip" ]));
  });

  it("Revalidar devolve indeterminada: o estado muda na tela", async () => {
    mocked(api.verifySignature).mockResolvedValue(
      signatureDetail({ verification: "indeterminate", verification_reasons: [ "revocation_unknown" ], verified_at: "2026-10-08T10:05:00-03:00" }));
    renderWithProviders(<SignatureDetail id="sg1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Revalidar" }));
    expect(await screen.findByText("revalidada: indeterminada")).not.toBeNull();
    const section = screen.getByRole("region", { name: "O que foi assinado" });
    expect(within(section).getByText("indeterminada")).not.toBeNull();
    expect(within(section).getByText("motivos: revocation_unknown")).not.toBeNull();
    expect(within(section).getByText("verificada em 08/10/2026, 10:05")).not.toBeNull();
    expect(api.verifySignature).toHaveBeenCalledWith("sg1");
  });

  it("fora do contexto: diz o caminho", async () => {
    mocked(api.getSignature).mockRejectedValue(new ApiError(403, { error: "out_of_context" }, "403"));
    renderWithProviders(<SignatureDetail id="sg1" />);
    expect((await screen.findByRole("alert")).textContent)
      .toBe("fora do atendimento, abra o prontuário com motivo para ver o que foi assinado");
  });

  it("abertura justificada vencida: avisa quem abriu", async () => {
    mocked(api.getSignature).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    const onOpeningRequired = vi.fn();
    renderWithProviders(<SignatureDetail id="sg1" onOpeningRequired={onOpeningRequired} />);
    await waitFor(() => expect(onOpeningRequired).toHaveBeenCalled());
  });

  describe("leitura administrativa (readOnly)", () => {
    it("passa pelo step-up e mostra só o conteúdo, sem baixar nem revalidar", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(admin());
      renderWithProviders(<SignatureDetail id="sg1" readOnly onClose={vi.fn()} />);
      const confirm = await screen.findByRole("button", { name: "Ver o conteúdo" });
      expect(api.getSignature).not.toHaveBeenCalled();
      fireEvent.click(confirm);
      const section = await screen.findByRole("region", { name: "O que foi assinado" });
      expect(within(section).getByText("Helena Prado")).not.toBeNull();
      expect(within(section).getByLabelText("conteúdo assinado").textContent).toMatch(/Diabetes descompensado/);
      expect(api.getSignature).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Baixar PDF assinado" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Baixar .p7s" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Revalidar" })).toBeNull();
    });

    it("janela de verificação fechada: pede o código do autenticador", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(admin({ mfa_verified_at: null }));
      renderWithProviders(<SignatureDetail id="sg1" readOnly onClose={vi.fn()} />);
      expect(await screen.findByLabelText("Código do autenticador")).not.toBeNull();
      expect(api.getSignature).not.toHaveBeenCalled();
    });

    it("simulada na leitura administrativa: o aviso aparece", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(admin());
      mocked(api.getSignature).mockResolvedValue(signatureDetail({ simulated: true }));
      renderWithProviders(<SignatureDetail id="sg1" readOnly onClose={vi.fn()} />);
      fireEvent.click(await screen.findByRole("button", { name: "Ver o conteúdo" }));
      const section = await screen.findByRole("region", { name: "O que foi assinado" });
      expect(within(section).getByText(SIMULATED_NOTICE)).not.toBeNull();
    });

    it("cancelar fecha", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(admin());
      const onClose = vi.fn();
      renderWithProviders(<SignatureDetail id="sg1" readOnly onClose={onClose} />);
      await screen.findByRole("button", { name: "Ver o conteúdo" });
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
