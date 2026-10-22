// src/modules/BillingPeriods.close.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), listBillingPeriods: vi.fn(), getPeriodPending: vi.fn(),
    closeBillingPeriod: vi.fn(), reopenBillingPeriod: vi.fn(), listPeriodExports: vi.fn(), fetchBillingExportFile: vi.fn() };
});

import * as api from "../lib/api";
import { BillingPeriods } from "./BillingPeriods";
import { renderWithProviders } from "../test/campaignFixtures";
import { LAB_EST, TODAY22, billingExport, billingUser, period } from "../test/billingFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.stepUpMfa, api.listBillingPeriods, api.getPeriodPending, api.closeBillingPeriod, api.reopenBillingPeriod,
  api.listPeriodExports, api.fetchBillingExportFile ];
const CLOSED_LAB = period({
  id: "bp2", establishment: LAB_EST, status: "closed", version: 1, closed_at: "2026-10-05T09:00:00-03:00", closed_by: "Rita Faturista",
  summary: { bpa_i_lines: 0, bpa_c_lines: 40, not_billable: {}, pending: 0 }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "billing_clerk" ]));
  mocked(api.stepUpMfa).mockResolvedValue(undefined);
  mocked(api.listBillingPeriods).mockResolvedValue([ period(), CLOSED_LAB ]);
  mocked(api.closeBillingPeriod).mockResolvedValue(undefined);
  mocked(api.reopenBillingPeriod).mockResolvedValue(undefined);
  mocked(api.listPeriodExports).mockResolvedValue([
    billingExport({ id: "ex2", version: 2, generated_at: "2026-10-06T10:00:00-03:00" }), billingExport()
  ]);
  mocked(api.fetchBillingExportFile).mockResolvedValue({ blob: new Blob([ "01#BPA#202609" ]), filename: null });
});

describe("BillingPeriods — fechamento, reabertura e arquivo", () => {
  it("fechar com step-up: descreve, fecha, relê a lista e as versões", async () => {
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fechar e gerar arquivo" }));
    const dialog = screen.getByRole("region", { name: "Fechar 09/2026 · UPA Boa Vista" });
    expect(within(dialog).getByText(/entram 12 linhas de BPA-I e 3 de BPA-C; 1 pendência fica fora do arquivo até ser corrigida/)).not.toBeNull();
    expect(within(dialog).getByText(/reabrir gera uma nova versão/)).not.toBeNull();
    expect(within(dialog).queryByLabelText("Código do autenticador")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar fechamento" }));
    await waitFor(() => expect(api.closeBillingPeriod).toHaveBeenCalledWith("bp1"));
    expect((await screen.findByRole("status")).textContent).toBe("Competência 09/2026 fechada para UPA Boa Vista; o arquivo está em Versões.");
    await waitFor(() => expect(api.listBillingPeriods).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("region", { name: "Fechar 09/2026 · UPA Boa Vista" })).toBeNull();
  });

  it("janela fechada pede o código; 422 settings_missing aponta a configuração e nada muda", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "billing_clerk" ], { mfa_verified_at: null }));
    mocked(api.closeBillingPeriod).mockRejectedValueOnce(new api.ApiError(422, { error: "settings_missing" }, "x"));
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fechar e gerar arquivo" }));
    const dialog = screen.getByRole("region", { name: "Fechar 09/2026 · UPA Boa Vista" });
    fireEvent.change(within(dialog).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar fechamento" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "falta a configuração do faturamento (nome e CNPJ de origem, órgão de destino e gestão) — a administração municipal preenche em Faturamento → Configuração do faturamento"
    );
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
    expect(api.listBillingPeriods).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("409 invalid_transition (outra pessoa fechou antes): frase e a lista relê", async () => {
    mocked(api.closeBillingPeriod).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fechar e gerar arquivo" }));
    const dialog = screen.getByRole("region", { name: "Fechar 09/2026 · UPA Boa Vista" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar fechamento" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("a competência mudou de situação — a tela foi atualizada");
    await waitFor(() => expect(api.listBillingPeriods).toHaveBeenCalledTimes(2));
  });

  it("reabrir: motivo de 10 a 500 caracteres revisado antes do step-up; com motivo, reabre e diz a próxima versão", async () => {
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reabrir" }));
    const form = screen.getByRole("region", { name: "Reabrir 09/2026 · Laboratório Municipal" });
    expect(within(form).getByText(/A versão 1 do arquivo fica no histórico; o próximo fechamento gera a versão 2/)).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("Motivo da reabertura"), { target: { value: "curto" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar" }));
    expect(within(form).getByRole("alert").textContent).toBe("motivo com pelo menos 10 caracteres");
    expect(within(form).queryByRole("button", { name: "Confirmar reabertura" })).toBeNull();
    fireEvent.change(within(form).getByLabelText("Motivo da reabertura"), { target: { value: "CNS do profissional corrigido no cadastro" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar" }));
    const dialog = screen.getByRole("region", { name: "Reabrir 09/2026 · Laboratório Municipal" });
    expect(within(dialog).getByText(/Motivo: CNS do profissional corrigido no cadastro/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar reabertura" }));
    await waitFor(() => expect(api.reopenBillingPeriod).toHaveBeenCalledWith("bp2", "CNS do profissional corrigido no cadastro"));
    expect((await screen.findByRole("status")).textContent).toBe("Competência reaberta. O próximo fechamento gera a versão 2.");
  });

  it("motivo curto não chega a pedir o código do autenticador", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "billing_clerk" ], { mfa_verified_at: null }));
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reabrir" }));
    const form = screen.getByRole("region", { name: "Reabrir 09/2026 · Laboratório Municipal" });
    expect(within(form).queryByLabelText("Código do autenticador")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Motivo da reabertura"), { target: { value: "curto" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar" }));
    expect(within(form).getByRole("alert").textContent).toBe("motivo com pelo menos 10 caracteres");
    expect(screen.queryByLabelText("Código do autenticador")).toBeNull();
    expect(api.stepUpMfa).not.toHaveBeenCalled();
    expect(api.reopenBillingPeriod).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Motivo da reabertura"), { target: { value: "CNS do profissional corrigido no cadastro" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar" }));
    expect(screen.getByLabelText("Código do autenticador")).not.toBeNull();
  });

  it("versões: o faturista baixa com o nome do api ou o de reserva; o admin vê sem baixar", async () => {
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    URL.createObjectURL = vi.fn(() => "blob:bpa");
    URL.revokeObjectURL = vi.fn();
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Versões" }))[1]);
    const box = await screen.findByRole("region", { name: "Versões de 09/2026 · Laboratório Municipal" });
    expect(api.listPeriodExports).toHaveBeenCalledWith("bp2");
    fireEvent.click(await within(box).findByRole("button", { name: "Baixar versão 2" }));
    await waitFor(() => expect(api.fetchBillingExportFile).toHaveBeenCalledWith("ex2"));
    expect((await within(box).findByRole("status")).textContent).toBe("Versão 2 baixada — o download fica registrado na trilha.");
    expect(names).toEqual([ "bpa-7654321-202609-v2.txt" ]);
    mocked(api.fetchBillingExportFile).mockResolvedValueOnce({ blob: new Blob([ "01#BPA#202609" ]), filename: "bpa-7654321-202609-v1.txt" });
    fireEvent.click(within(box).getByRole("button", { name: "Baixar versão 1" }));
    await waitFor(() => expect(names).toEqual([ "bpa-7654321-202609-v2.txt", "bpa-7654321-202609-v1.txt" ]));
    expect(within(box).getByTitle(billingExport().sha256)).not.toBeNull();

    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "municipal_admin" ]));
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Versões" }))[1]);
    const adminBox = await screen.findByRole("region", { name: "Versões de 09/2026 · Laboratório Municipal" });
    expect(await within(adminBox).findByText("versão 2")).not.toBeNull();
    expect(within(adminBox).queryByRole("button", { name: /^Baixar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fechar e gerar arquivo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reabrir" })).toBeNull();
  });

  it("403 missing_role ao baixar vira frase; nada é salvo", async () => {
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    mocked(api.fetchBillingExportFile).mockRejectedValueOnce(new api.ApiError(403, { error: "missing_role" }, "x"));
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Versões" }))[1]);
    const box = await screen.findByRole("region", { name: "Versões de 09/2026 · Laboratório Municipal" });
    fireEvent.click(await within(box).findByRole("button", { name: "Baixar versão 2" }));
    expect((await within(box).findByRole("alert")).textContent).toBe("seu papel não permite esta ação no faturamento");
    expect(names).toEqual([]);
  });
});
