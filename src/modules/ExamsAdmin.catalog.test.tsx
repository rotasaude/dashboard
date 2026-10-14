// src/modules/ExamsAdmin.catalog.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listCatalogItems: vi.fn(), createCatalogItem: vi.fn(), updateCatalogItem: vi.fn(),
    listExamProviders: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ExamsAdmin } from "./ExamsAdmin";
import { renderWithProviders } from "../test/campaignFixtures";
import { HEMOGRAM_FIELDS, examCatalogItem, examUser } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

async function catalogPanel() { return screen.findByRole("region", { name: "Catálogo de exames" }); }

describe("ExamsAdmin — catálogo", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listCatalogItems, api.createCatalogItem, api.updateCatalogItem, api.listExamProviders ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "municipal_admin" ], { id: "ad1" }));
    mocked(api.listCatalogItems).mockResolvedValue([ examCatalogItem() ]);
    mocked(api.createCatalogItem).mockResolvedValue(examCatalogItem({ id: "ci2" }));
    mocked(api.updateCatalogItem).mockResolvedValue(examCatalogItem());
    mocked(api.listExamProviders).mockResolvedValue([]);
  });

  it("lista com política, prazos efetivos, campos e situação", async () => {
    renderWithProviders(<ExamsAdmin />);
    const panel = await catalogPanel();
    const row = (await within(panel).findAllByRole("row"))[1];
    expect(within(row).getByText("0202020380")).not.toBeNull();
    expect(within(row).getByText("Depois da ciência")).not.toBeNull();
    expect(within(row).getByText("15 · 15 · 30 · 10 · 15")).not.toBeNull();
    expect(within(row).getByText("2")).not.toBeNull();
    expect(within(row).getByText("ativo")).not.toBeNull();
  });

  it("inclui um exame: valida, pede step-up e manda o corpo do contrato", async () => {
    renderWithProviders(<ExamsAdmin />);
    const panel = await catalogPanel();
    fireEvent.click(await within(panel).findByRole("button", { name: "Novo exame" }));
    const form = within(panel).getByRole("form", { name: "Novo exame" });
    fireEvent.change(within(form).getByLabelText("Código SIGTAP"), { target: { value: "02020" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("o código SIGTAP tem 10 dígitos");
    fireEvent.change(within(form).getByLabelText("Código SIGTAP"), { target: { value: "0202010503" } });
    fireEvent.click(within(form).getByLabelText("Exige autorização (entra na fila de regulação)"));
    fireEvent.click(within(form).getByLabelText(/^Imediata/));
    fireEvent.change(within(form).getByLabelText("Prazo de resultado"), { target: { value: "7" } });
    fireEvent.click(within(form).getByRole("button", { name: "Adicionar campo" }));
    const field = within(form).getByRole("group", { name: "Campo 1" });
    fireEvent.change(within(field).getByLabelText("Chave"), { target: { value: "hba1c" } });
    fireEvent.change(within(field).getByLabelText("Nome"), { target: { value: "HbA1c" } });
    fireEvent.change(within(field).getByLabelText("Unidade"), { target: { value: "%" } });
    fireEvent.change(within(field).getByLabelText("LOINC"), { target: { value: "4548-4" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    const confirm = screen.getByRole("region", { name: "Incluir o exame 0202010503" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Salvar exame" }));
    await waitFor(() => expect(api.createCatalogItem).toHaveBeenCalledWith({
      sigtap_code: "0202010503", requires_authorization: true, release_policy: "immediate",
      deadlines: { authorize: null, schedule: null, collect: null, result: 7, acknowledge: null },
      result_fields: [ { key: "hba1c", label: "HbA1c", unit: "%", loinc: "4548-4" } ], active: true
    }));
    expect(await within(panel).findByText("Catálogo atualizado.")).not.toBeNull();
    await waitFor(() => expect(api.listCatalogItems).toHaveBeenCalledTimes(2));
  });

  it("SIGTAP fora da competência: a frase na confirmação e o rascunho volta intacto", async () => {
    mocked(api.createCatalogItem).mockRejectedValue(new ApiError(422, { error: "sigtap_unknown" }, "x"));
    renderWithProviders(<ExamsAdmin />);
    const panel = await catalogPanel();
    fireEvent.click(await within(panel).findByRole("button", { name: "Novo exame" }));
    const form = within(panel).getByRole("form", { name: "Novo exame" });
    fireEvent.change(within(form).getByLabelText("Código SIGTAP"), { target: { value: "0999999999" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    const confirm = screen.getByRole("region", { name: "Incluir o exame 0999999999" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Salvar exame" }));
    expect((await within(confirm).findByRole("alert")).textContent).toBe("código SIGTAP não encontrado na competência vigente");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    expect((within(panel).getByLabelText("Código SIGTAP") as HTMLInputElement).value).toBe("0999999999");
  });

  it("edita: SIGTAP travado; PATCH com o prazo novo e os campos de antes", async () => {
    renderWithProviders(<ExamsAdmin />);
    const panel = await catalogPanel();
    fireEvent.click(await within(panel).findByRole("button", { name: "Editar Hemograma completo" }));
    const form = within(panel).getByRole("form", { name: "Editar Hemograma completo" });
    expect((within(form).getByLabelText("Código SIGTAP") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText("Prazo de coleta"), { target: { value: "20" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Salvar Hemograma completo" })).getByRole("button", { name: "Salvar exame" }));
    await waitFor(() => expect(api.updateCatalogItem).toHaveBeenCalledWith("ci1", {
      sigtap_code: "0202020380", requires_authorization: false, release_policy: "after_acknowledgement",
      deadlines: { authorize: null, schedule: null, collect: 20, result: 10, acknowledge: null },
      result_fields: HEMOGRAM_FIELDS, active: true
    }));
  });

  it("só o admin municipal", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "exam_regulator" ]));
    renderWithProviders(<ExamsAdmin />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.listCatalogItems).not.toHaveBeenCalled();
  });
});
