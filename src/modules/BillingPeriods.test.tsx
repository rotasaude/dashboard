// src/modules/BillingPeriods.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listBillingPeriods: vi.fn(), getPeriodPending: vi.fn() };
});

import * as api from "../lib/api";
import { BillingPeriods } from "./BillingPeriods";
import { renderWithProviders } from "../test/campaignFixtures";
import { LAB_EST, TODAY22, billingUser, pending, period } from "../test/billingFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const CLOSED_LAB = period({
  id: "bp2", establishment: LAB_EST, status: "closed", version: 1, closed_at: "2026-10-05T09:00:00-03:00", closed_by: "Rita Faturista",
  summary: { bpa_i_lines: 0, bpa_c_lines: 40, not_billable: {}, pending: 0 }
});
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.listBillingPeriods, api.getPeriodPending ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "billing_clerk" ]));
  mocked(api.listBillingPeriods).mockResolvedValue([ period(), CLOSED_LAB ]);
  mocked(api.getPeriodPending).mockResolvedValue([
    pending(),
    pending({ procedure_id: "pp5", fix: "patient", reasons: [ "missing_patient_id" ], patient: { id: "pa2", display_name: "Caio Souza" } }),
    pending({ procedure_id: "pp6", fix: "procedure", reasons: [ "habilitation_missing" ] })
  ]);
});

describe("BillingPeriods", () => {
  it("abre na competência anterior, com o resumo por estabelecimento", async () => {
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    expect(await screen.findByText("UPA Boa Vista · CNES 2384299")).not.toBeNull();
    expect(api.listBillingPeriods).toHaveBeenCalledWith("202609");
    expect(screen.getByText("Laboratório Municipal · CNES 7654321")).not.toBeNull();
    expect(screen.getByText("aberta")).not.toBeNull();
    expect(screen.getByText("fechada · versão 1")).not.toBeNull();
    expect(screen.getByText("3 — CBO do profissional não permitido para o procedimento: 2; profissional sem CNS no cadastro: 1")).not.toBeNull();
    expect(screen.getByText("nenhum")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "202608" } });
    await waitFor(() => expect(api.listBillingPeriods).toHaveBeenLastCalledWith("202608"));
  });

  it("pendências: só no clique, agrupadas por correção, motivo novo cru; Conferir de novo relê", async () => {
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    await screen.findByText("UPA Boa Vista · CNES 2384299");
    expect(api.getPeriodPending).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Pendências" })[0]);
    const box = await screen.findByRole("region", { name: "Pendências de 09/2026 · UPA Boa Vista" });
    await within(box).findByText("Cadastro do profissional · 1");
    expect(api.getPeriodPending).toHaveBeenCalledWith("bp1");
    expect(within(box).getAllByText(/^(Cadastro|Regra)[^·]+ · \d+$/).map((e) => e.textContent)).toEqual([
      "Cadastro do profissional · 1", "Cadastro do paciente · 1", "Regra da SIGTAP · 1"
    ]);
    const professional = within(box).getByRole("region", { name: "Cadastro do profissional" });
    expect(within(professional).getByText("CNS ou CBO do profissional — a administração corrige em Equipe → Profissionais")).not.toBeNull();
    expect(within(professional).getByText("profissional sem CNS no cadastro")).not.toBeNull();
    expect(within(professional).getByText("Enf. Lúcia Prado")).not.toBeNull();
    expect(within(box).getByText("paciente sem CPF nem CNS")).not.toBeNull();
    expect(within(box).getByText("habilitation_missing")).not.toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Conferir de novo" }));
    await waitFor(() => expect(api.getPeriodPending).toHaveBeenCalledTimes(2));
    await within(box).findByRole("button", { name: "Conferir de novo" });
    fireEvent.click(within(box).getByRole("button", { name: "Fechar pendências" }));
    expect(screen.queryByRole("region", { name: "Pendências de 09/2026 · UPA Boa Vista" })).toBeNull();
    expect(api.listBillingPeriods).toHaveBeenCalledTimes(1);
  });

  it("filtro abertas: lista as abertas de qualquer mês, sem competência", async () => {
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    await screen.findByText("UPA Boa Vista · CNES 2384299");
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "open" } });
    await waitFor(() => expect(api.listBillingPeriods).toHaveBeenLastCalledWith(null, "open"));
  });

  it("procedimento atrasado leva a etiqueta; ordem dos grupos e correção desconhecida crua", async () => {
    mocked(api.getPeriodPending).mockResolvedValue([
      pending({ procedure_id: "pp7", fix: "newfix", reasons: [ "novo_motivo" ], late: true }),
      pending({ procedure_id: "pp8", fix: "establishment", reasons: [ "missing_establishment_cnes" ] }),
      pending({ procedure_id: "pp9", fix: "patient", reasons: [ "missing_patient_id" ] }),
      pending({ procedure_id: "pp10", fix: "professional", reasons: [ "missing_professional_cns" ] })
    ]);
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    await screen.findByText("UPA Boa Vista · CNES 2384299");
    fireEvent.click(screen.getAllByRole("button", { name: "Pendências" })[0]);
    const box = await screen.findByRole("region", { name: "Pendências de 09/2026 · UPA Boa Vista" });
    await within(box).findByText("newfix · 1");
    expect(within(box).getAllByText(/ · 1$/).map((e) => e.textContent)).toEqual([
      "Cadastro do profissional · 1", "Cadastro do paciente · 1", "Cadastro do estabelecimento · 1", "newfix · 1"
    ]);
    expect(within(box).getByText("novo_motivo")).not.toBeNull();
    const unknown = within(box).getByRole("region", { name: "newfix" });
    expect(within(unknown).getByText("apresentação em atraso")).not.toBeNull();
    expect(within(box).getAllByText("apresentação em atraso")).toHaveLength(1);
  });

  it("sem pendência: estado vazio; o municipal_admin também lê", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "municipal_admin" ]));
    mocked(api.getPeriodPending).mockResolvedValue([]);
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Pendências" }))[1]);
    expect(await screen.findByText("nenhuma pendência nesta competência")).not.toBeNull();
    expect(api.getPeriodPending).toHaveBeenCalledWith("bp2");
  });

  it("competência sem produção: estado vazio; recusa da lista vira frase", async () => {
    mocked(api.listBillingPeriods).mockResolvedValueOnce([]);
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    expect(await screen.findByText("nenhum estabelecimento com produção nesta competência")).not.toBeNull();
    cleanup();
    mocked(api.listBillingPeriods).mockRejectedValueOnce(new api.ApiError(403, { error: "feature_disabled", feature: "procedure_billing" }, "x"));
    renderWithProviders(<BillingPeriods today={TODAY22} />);
    expect((await screen.findByRole("alert")).textContent).toBe("o faturamento de procedimentos está desligado nesta cidade");
  });
});
