// src/modules/Production.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getProduction: vi.fn(), resendFicha: vi.fn(),
    listGenerationFailures: vi.fn(), retryGenerationFailure: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { ficha, productionFixture } from "../test/recordModeFixtures";
import { CORRECTION_PENDING_NOTE } from "../lib/production";
import { Production } from "./Production";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const DISABLED = "o envio da produção ao e-SUS está desligado nesta cidade";
const failure = (over: Partial<api.GenerationFailure> = {}): api.GenerationFailure => ({
  id: "g1", source_type: "Screening", source_id: "sc1", attendance_id: "a1",
  reason_codes: [ "unit_without_cnes", "professional_without_team" ], created_at: "2026-10-07T12:00:00Z", resolved_at: null, ...over
});
const withLedi = (roles: string[]) => sessionWith(roles, { features: [ "ledi_export" ] });

function resetAll() {
  for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.getProduction, api.resendFicha, api.listGenerationFailures,
    api.retryGenerationFailure ]) m(fn).mockReset();
  m(api.listGenerationFailures).mockResolvedValue([]);
}

describe("Produção e-SUS (módulo 16)", () => {
  beforeEach(() => {
    resetAll();
    m(api.fetchCurrentSession).mockResolvedValue(withLedi([ "municipal_admin" ]));
    m(api.getProduction).mockResolvedValue(productionFixture());
  });

  it("analista lê prazo, alerta, motivos e fichas, sem Reenviar", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(withLedi([ "analyst" ]));
    renderWithProviders(<Production />);
    expect(await screen.findByText("prazo em 16/11/2026 · faltam 7 dias úteis")).not.toBeNull();
    expect(screen.getByText("Há fichas pendentes, recusadas ou com falha, e o prazo está perto. Confira a situação abaixo.")).not.toBeNull();
    expect(screen.getAllByText("profissional.cns · invalid").length).toBe(2);
    expect(screen.getByText("recusada")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Reenviar ficha/ })).toBeNull();
    expect(api.getProduction).toHaveBeenCalledWith(null, 1);
  });

  it("prazo vencido e alerta crítico", async () => {
    m(api.getProduction).mockResolvedValue(productionFixture({ business_days_left: -2, alert: "critical" }));
    renderWithProviders(<Production />);
    expect(await screen.findByText("prazo vencido em 16/11/2026")).not.toBeNull();
    expect(screen.getByRole("alert").textContent)
      .toBe("Nenhuma ficha aceita nesta competência, e o prazo está perto. Sem envio, o repasse da cidade fica em risco.");
  });

  it("sem ledi_export na sessão: tela desligada e nenhuma chamada", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ]));
    renderWithProviders(<Production />);
    expect(await screen.findByText(DISABLED)).not.toBeNull();
    expect(api.getProduction).not.toHaveBeenCalled();
  });

  it("403 feature_disabled com a sessão ainda dizendo ligada: mostra desligada e relê a sessão uma vez só", async () => {
    m(api.getProduction).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "ledi_export" }, "403"));
    renderWithProviders(<Production />);
    expect(await screen.findByText(DISABLED)).not.toBeNull();
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.fetchCurrentSession).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("seu papel não permite esta ação")).toBeNull();
  });

  it("paginação: próxima só quando fichas_total passa da página, fixando a competência", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ficha({ id: `f${i}` }));
    m(api.getProduction)
      .mockResolvedValueOnce(productionFixture({ fichas: fifty, fichas_total: 51 }))
      .mockResolvedValueOnce(productionFixture({ fichas: [ ficha({ id: "f50" }) ], fichas_total: 51 }));
    renderWithProviders(<Production />);
    const next = (await screen.findByRole("button", { name: "Próxima página" })) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Página anterior" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(next);
    await waitFor(() => expect(api.getProduction).toHaveBeenLastCalledWith("202610", 2));
    await waitFor(() => expect((screen.getByRole("button", { name: "Próxima página" }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Página anterior" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("municipal_admin reenvia a ficha recusada pelo step-up e relê", async () => {
    m(api.resendFicha).mockResolvedValue(ficha({ id: "f2", status: "pending", attempts: 2 }));
    renderWithProviders(<Production />);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar ficha f2" }));
    expect(screen.queryByRole("button", { name: "Reenviar ficha f1" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(api.resendFicha).toHaveBeenCalledWith("f2"));
    expect(await screen.findByText("Ficha enviada de novo para a fila. A situação muda quando o PEC responder.")).not.toBeNull();
    await waitFor(() => expect(api.getProduction).toHaveBeenCalledTimes(2));
  });

  it("409 not_rejected: frase da tela e a lista é relida", async () => {
    m(api.resendFicha).mockRejectedValue(new ApiError(409, { error: "not_rejected" }, "409"));
    renderWithProviders(<Production />);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar ficha f2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
    expect(await screen.findByText("esta ficha não está mais recusada — a lista foi atualizada")).not.toBeNull();
    await waitFor(() => expect(api.getProduction).toHaveBeenCalledTimes(2));
  });

  it("403 feature_disabled no reenvio: frase de desligada e a lista é relida", async () => {
    m(api.resendFicha).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "ledi_export" }, "403"));
    renderWithProviders(<Production />);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar ficha f2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
    expect(await screen.findByText("esta funcionalidade está desligada para a cidade")).not.toBeNull();
    await waitFor(() => expect(api.getProduction).toHaveBeenCalledTimes(2));
  });

  it("sem counts.sending: não desenha a tela Enviando; com o padrão, desenha", async () => {
    const base = productionFixture();
    m(api.getProduction).mockResolvedValue({ ...base, counts: { accepted: 1, rejected: 0, pending: 2, failed: 0 } });
    renderWithProviders(<Production />);
    expect(await screen.findByText("Pendentes")).not.toBeNull();
    expect(screen.queryByText("Enviando")).toBeNull();
    cleanup();
    m(api.getProduction).mockResolvedValue(base);
    renderWithProviders(<Production />);
    expect(await screen.findByText("Enviando")).not.toBeNull();
  });

  it("422 invalid_competence no reenvio: frase da competência, sem reler", async () => {
    m(api.resendFicha).mockRejectedValue(new ApiError(422, { error: "invalid_competence" }, "422"));
    renderWithProviders(<Production />);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar ficha f2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
    expect(await screen.findByText("competência inválida — escolha outra da lista")).not.toBeNull();
    expect(api.getProduction).toHaveBeenCalledTimes(1);
  });

  it("módulo 18: fichas não geradas com motivo; o analista não gera de novo", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(withLedi([ "analyst" ]));
    m(api.listGenerationFailures).mockResolvedValue([ failure() ]);
    renderWithProviders(<Production />);
    expect(await screen.findByText("unidade sem CNES, profissional sem equipe (INE)")).not.toBeNull();
    expect(screen.getByText("escuta inicial")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Gerar de novo g1" })).toBeNull();
  });

  it("módulo 19: falha de geração de consulta mostra a origem 'consulta'", async () => {
    m(api.listGenerationFailures).mockResolvedValue([ failure({ source_type: "Consultation" }) ]);
    renderWithProviders(<Production />);
    expect(await screen.findByText("consulta")).not.toBeNull();
  });

  it("ficha com correção pendente: situação, aviso e sem Reenviar", async () => {
    m(api.getProduction).mockResolvedValue(productionFixture({
      fichas: [ ficha({ id: "f9", ficha_type: "atendimento_individual", status: "correction_pending", accepted_at: null }) ],
      fichas_total: 1
    }));
    renderWithProviders(<Production />);
    expect(await screen.findByText("correção pendente — não enviada")).not.toBeNull();
    expect(screen.getByText(CORRECTION_PENDING_NOTE)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Reenviar ficha f9" })).toBeNull();
  });

  it("sem correção pendente na página, sem o aviso", async () => {
    renderWithProviders(<Production />);
    await screen.findByText("recusada");
    expect(screen.queryByText(CORRECTION_PENDING_NOTE)).toBeNull();
  });

  it("módulo 18: municipal_admin gera de novo com step-up; ainda faltando, diz o quê", async () => {
    m(api.listGenerationFailures).mockResolvedValue([ failure() ]);
    m(api.retryGenerationFailure).mockResolvedValue(failure({ reason_codes: [ "professional_without_team" ] }));
    renderWithProviders(<Production />);
    fireEvent.click(await screen.findByRole("button", { name: "Gerar de novo g1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gerar de novo" }));
    await waitFor(() => expect(api.retryGenerationFailure).toHaveBeenCalledWith("g1"));
    expect(await screen.findByText("Ainda não foi possível gerar: profissional sem equipe (INE). Corrija na origem e tente de novo."))
      .not.toBeNull();
    await waitFor(() => expect(api.listGenerationFailures).toHaveBeenCalledTimes(2));
  });

  it("módulo 18: resolvida diz que a ficha nasceu; already_resolved relê", async () => {
    m(api.listGenerationFailures).mockResolvedValue([ failure() ]);
    m(api.retryGenerationFailure).mockResolvedValueOnce(failure({ reason_codes: [], resolved_at: "2026-10-07T13:00:00Z" }));
    renderWithProviders(<Production />);
    fireEvent.click(await screen.findByRole("button", { name: "Gerar de novo g1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gerar de novo" }));
    expect(await screen.findByText("Ficha gerada: ela entra na fila de envio.")).not.toBeNull();
    await waitFor(() => expect(api.getProduction).toHaveBeenCalledTimes(2));

    m(api.retryGenerationFailure).mockRejectedValueOnce(new ApiError(409, { error: "already_resolved" }, "409"));
    fireEvent.click(await screen.findByRole("button", { name: "Gerar de novo g1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gerar de novo" }));
    expect(await screen.findByText("esta ficha já foi gerada — a lista foi atualizada")).not.toBeNull();
  });

  it("módulo 18: reenviar ficha de escuta regenera (ficha nova, mensagem neutra)", async () => {
    m(api.resendFicha).mockResolvedValue(ficha({ id: "f3", status: "pending", replaces_outbox_id: "f2" }));
    renderWithProviders(<Production />);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar ficha f2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(api.resendFicha).toHaveBeenCalledWith("f2"));
    expect(await screen.findByText(/^Ficha enviada de novo para a fila\./)).not.toBeNull();
  });

  it("módulo 18: ficha recusada já substituída não oferece Reenviar e mostra 'substituída'", async () => {
    const base = productionFixture();
    m(api.getProduction).mockResolvedValue({ ...base, fichas: [
      ficha({ id: "f2", status: "rejected", accepted_at: null }),
      ficha({ id: "f3", status: "pending", accepted_at: null, replaces_outbox_id: "f2" })
    ] });
    renderWithProviders(<Production />);
    expect(await screen.findByText("substituída")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Reenviar ficha f2" })).toBeNull();
  });

  it("módulo 18: 409 generation_failed no reenvio: frase, relê fichas e a lista de não geradas", async () => {
    m(api.resendFicha).mockRejectedValue(new ApiError(409, { error: "generation_failed" }, "409"));
    renderWithProviders(<Production />);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar ficha f2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
    expect(await screen.findByText('não foi possível gerar a ficha de novo — veja "Fichas que não puderam ser geradas"')).not.toBeNull();
    await waitFor(() => expect(api.getProduction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.listGenerationFailures).toHaveBeenCalledTimes(2));
  });

  it("módulo 18: 409 export_unusable no reenvio: frase própria", async () => {
    m(api.resendFicha).mockRejectedValue(new ApiError(409, { error: "export_unusable" }, "409"));
    renderWithProviders(<Production />);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar ficha f2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
    expect(await screen.findByText("o envio da produção ao e-SUS não está utilizável agora nesta cidade")).not.toBeNull();
  });

  it("papel sem leitura: não chama a API", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(withLedi([ "citizen_verifier" ]));
    renderWithProviders(<Production />);
    expect(await screen.findByText("seu papel não permite ver a produção")).not.toBeNull();
    expect(api.getProduction).not.toHaveBeenCalled();
  });
});

describe("Produção e-SUS — competência no fuso da cidade", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    // 22h30 de 31/10 em São Paulo; em UTC já é 01/11.
    vi.setSystemTime(new Date("2026-11-01T01:30:00Z"));
    resetAll();
    m(api.fetchCurrentSession).mockResolvedValue(withLedi([ "analyst" ]));
    m(api.getProduction).mockResolvedValue(productionFixture());
  });
  afterEach(() => vi.useRealTimers());

  it("às 22h30 de 31/10 a primeira opção é 10/2026, e trocar pede a outra na página 1", async () => {
    renderWithProviders(<Production />);
    await screen.findByText("prazo em 16/11/2026 · faltam 7 dias úteis");
    const select = screen.getByLabelText("Competência") as HTMLSelectElement;
    expect(select.options[0].value).toBe("202610");
    expect(select.value).toBe("202610");
    fireEvent.change(select, { target: { value: "202609" } });
    await waitFor(() => expect(api.getProduction).toHaveBeenLastCalledWith("202609", 1));
  });
});
