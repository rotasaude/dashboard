// src/modules/SignatureOverview.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getSignatureOverview: vi.fn() };
});

import * as api from "../lib/api";
import { SignatureOverview } from "./SignatureOverview";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW19B, overview, signer } from "../test/signatureFixtures";
import { SIGNATURE_DISABLED, SIMULATED_NOTICE } from "../lib/signature";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const valueOf = (label: string) => screen.getByText(label).parentElement?.textContent?.replace(label, "");

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("SignatureOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW19B));
    mocked(api.fetchCurrentSession).mockResolvedValue(signer([ "municipal_admin" ]));
    mocked(api.getSignatureOverview).mockResolvedValue(overview());
  });

  it("pede os últimos 30 dias e resume os profissionais", async () => {
    renderWithProviders(<SignatureOverview />);
    await waitFor(() => expect(api.getSignatureOverview).toHaveBeenCalledWith({ from: "2026-09-08", to: "2026-10-08" }));
    await screen.findByText("Com certificado");
    expect(valueOf("Com certificado")).toBe("2");
    expect(valueOf("Sem certificado")).toBe("1");
    expect(valueOf("Vencendo em 30 dias")).toBe("1");
    expect(valueOf("Pendentes há mais de 24 h")).toBe("1");
  });

  it("tabela de profissionais: certificado, validade, pendentes e a mais antiga atrasada", async () => {
    renderWithProviders(<SignatureOverview />);
    const panel = await screen.findByRole("region", { name: "Profissionais" });
    await within(panel).findByText("Lúcia Prado");
    expect(within(panel).getByText("vence em até 30 dias")).not.toBeNull();
    expect(within(panel).getByText("20/10/2026")).not.toBeNull();
    expect(within(panel).getByText("06/10/2026, 16:00")).not.toBeNull();
    expect(within(panel).getByText("há mais de 24 h")).not.toBeNull();
    expect(within(panel).getByText("sem certificado")).not.toBeNull();
    expect(within(panel).getByText("ativo")).not.toBeNull();
  });

  it("documentos por modo e assinaturas inválidas ou indeterminadas", async () => {
    renderWithProviders(<SignatureOverview />);
    const modes = await screen.findByRole("region", { name: "Documentos por modo" });
    await within(modes).findByText("42");
    expect(within(modes).getByText("17")).not.toBeNull();
    expect(within(modes).getByText("3")).not.toBeNull();
    const invalid = screen.getByRole("region", { name: "Assinaturas inválidas ou indeterminadas" });
    expect(within(invalid).getByText("adendo")).not.toBeNull();
    expect(within(invalid).getByText("Lúcia Prado")).not.toBeNull();
    expect(within(invalid).getByText("indeterminada")).not.toBeNull();
    expect(within(invalid).getByText("08/10/2026, 08:00")).not.toBeNull();
  });

  it("nenhuma inválida: diz", async () => {
    mocked(api.getSignatureOverview).mockResolvedValue(overview({ invalid_or_indeterminate: [] }));
    renderWithProviders(<SignatureOverview />);
    expect(await screen.findByText("nenhuma assinatura inválida ou indeterminada no período")).not.toBeNull();
  });

  it("início depois do fim: avisa e não consulta", async () => {
    renderWithProviders(<SignatureOverview />);
    await waitFor(() => expect(api.getSignatureOverview).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-09" } });
    expect(await screen.findByText("a data inicial vem depois da final")).not.toBeNull();
    expect(api.getSignatureOverview).toHaveBeenCalledTimes(1);
  });

  it("muda o período e consulta de novo", async () => {
    renderWithProviders(<SignatureOverview />);
    await waitFor(() => expect(api.getSignatureOverview).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(api.getSignatureOverview).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-10-08" }));
  });

  it("sem a funcionalidade, ou sem ser admin: não consulta", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(signer([ "municipal_admin" ], { features: [] }));
    renderWithProviders(<SignatureOverview />);
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
    expect(await screen.findByText(SIGNATURE_DISABLED)).not.toBeNull();
    expect(api.getSignatureOverview).not.toHaveBeenCalled();
  });

  it("profissional (mesmo com a funcionalidade) e operador: não consultam e dizem o motivo", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(signer([ "health_professional" ]));
    renderWithProviders(<SignatureOverview />);
    expect(await screen.findByText("só o administrador municipal vê este painel")).not.toBeNull();
    expect(api.getSignatureOverview).not.toHaveBeenCalled();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(signer([ "municipal_admin" ], { operator: true }));
    renderWithProviders(<SignatureOverview />);
    expect(await screen.findByText("só o administrador municipal vê este painel")).not.toBeNull();
    expect(api.getSignatureOverview).not.toHaveBeenCalled();
  });

  it("data apagada: pede as duas datas, sem carregando e sem consultar", async () => {
    renderWithProviders(<SignatureOverview />);
    await waitFor(() => expect(api.getSignatureOverview).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "" } });
    expect(await screen.findByText("informe as duas datas")).not.toBeNull();
    expect(screen.queryByText("carregando…")).toBeNull();
    expect(api.getSignatureOverview).toHaveBeenCalledTimes(1);
  });

  it("api omite not_after, oldest_pending_at e expires_in_days: mostra — e os dias quando vêm", async () => {
    mocked(api.getSignatureOverview).mockResolvedValue(overview({
      professionals: [
        { user_id: "u1", name: "Sem Campos", certificate_status: "none", pending_count: 0 },
        { user_id: "u2", name: "Com Dias", certificate_status: "expiring", not_after: "2026-10-20T23:59:59-03:00", expires_in_days: 12, pending_count: 1 }
      ]
    }));
    renderWithProviders(<SignatureOverview />);
    const panel = await screen.findByRole("region", { name: "Profissionais" });
    await within(panel).findByText("Sem Campos");
    expect(within(panel).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(within(panel).getByText("20/10/2026")).not.toBeNull();
    expect(within(panel).getByText("12 dias")).not.toBeNull();
  });

  it("valores desconhecidos do api aparecem crus", async () => {
    mocked(api.getSignatureOverview).mockResolvedValue(overview({
      professionals: [ { user_id: "u1", name: "Nova Pessoa", certificate_status: "suspended" as never, pending_count: 0 } ],
      invalid_or_indeterminate: [ { signature_id: "s1", document_type: "consultation", signer_name: "Fulano", verification: "revoked" as never, verified_at: "2026-10-08T08:00:00-03:00", simulated: false } ]
    }));
    renderWithProviders(<SignatureOverview />);
    expect(await screen.findByText("suspended")).not.toBeNull();
    expect(screen.getByText("revoked")).not.toBeNull();
  });

  it("422 invalid_period e 403 missing_role têm frase", async () => {
    mocked(api.getSignatureOverview).mockRejectedValue(new api.ApiError(422, { error: "invalid_period" }, "x"));
    renderWithProviders(<SignatureOverview />);
    expect(await screen.findByText("o período informado não é válido")).not.toBeNull();
    cleanup();
    mocked(api.getSignatureOverview).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "x"));
    renderWithProviders(<SignatureOverview />);
    expect(await screen.findByText("seu papel não permite esta ação")).not.toBeNull();
  });

  it("PSC simulado: aviso no topo e nas linhas simuladas; ausente sem o interruptor", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(signer([ "municipal_admin" ], { features: [ "digital_signature", "signature_psc_mock" ] }));
    mocked(api.getSignatureOverview).mockResolvedValue(overview({
      invalid_or_indeterminate: [ { signature_id: "s1", document_type: "consultation", signer_name: "Fulano", verification: "invalid", verified_at: "2026-10-08T08:00:00-03:00", simulated: true } ]
    }));
    renderWithProviders(<SignatureOverview />);
    const invalid = await screen.findByRole("region", { name: "Assinaturas inválidas ou indeterminadas" });
    await within(invalid).findByText("Fulano");
    expect(within(invalid).getByText(SIMULATED_NOTICE)).not.toBeNull();
    expect(screen.getAllByText(SIMULATED_NOTICE).length).toBe(2);
  });

  it("sem simulação: nenhum aviso", async () => {
    renderWithProviders(<SignatureOverview />);
    await screen.findByText("Com certificado");
    expect(screen.queryByText(SIMULATED_NOTICE)).toBeNull();
  });

  it("linha simulada marca mesmo sem o interruptor na sessão", async () => {
    mocked(api.getSignatureOverview).mockResolvedValue(overview({
      invalid_or_indeterminate: [ { signature_id: "s1", document_type: "consultation", signer_name: "Fulano", verification: "invalid", verified_at: "2026-10-08T08:00:00-03:00", simulated: true } ]
    }));
    renderWithProviders(<SignatureOverview />);
    await screen.findByText("Fulano");
    expect(screen.getAllByText(SIMULATED_NOTICE).length).toBe(1);
  });
});
