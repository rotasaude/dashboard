import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listSurveillanceDiseases: vi.fn(), listLocalDiseases: vi.fn(), createLocalDisease: vi.fn(),
    updateLocalDisease: vi.fn() };
});
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { SurveillanceDiseases } from "./SurveillanceDiseases";
import { renderWithProviders } from "../test/campaignFixtures";
import { DENGUE, MEASLES, disease, localDisease, survUser } from "../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("SurveillanceDiseases", () => {
  beforeEach(() => {
    for (const fn of [ api.createLocalDisease, api.updateLocalDisease, api.listSurveillanceDiseases, api.listLocalDiseases ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser());
    mocked(api.listSurveillanceDiseases).mockResolvedValue([ DENGUE, MEASLES, { ...localDisease(), local: true } ]);
    mocked(api.listLocalDiseases).mockResolvedValue([ localDisease() ]);
    mocked(api.createLocalDisease).mockResolvedValue(localDisease({ id: "ld2" }));
    mocked(api.updateLocalDisease).mockResolvedValue(localDisease({ active: false }));
  });

  it("lista nacional só leitura; doenças locais com situação", async () => {
    renderWithProviders(<SurveillanceDiseases />);
    expect(await screen.findByText("Lista nacional (versão 1)")).not.toBeNull();
    expect(screen.getByText("A lista nacional é mantida pela plataforma, a partir da portaria vigente.")).not.toBeNull();
    const sarampo = screen.getByRole("row", { name: /Sarampo/ });
    expect(within(sarampo).getByText("imediata (24 h)")).not.toBeNull();
    expect(within(sarampo).queryByRole("button")).toBeNull();
    expect(within(screen.getByRole("row", { name: /Febre do Oropouche/ })).getByText("ativa")).not.toBeNull();
  });

  it("mostra a nota da doença (sem CID só se notifica à mão) e a doença local não aparece na lista nacional", async () => {
    const note = "Sem CID próprio: só notificação manual.";
    mocked(api.listSurveillanceDiseases).mockResolvedValue([ DENGUE, disease({ code: "raiva", name: "Raiva humana", cid10: [], notes: note }),
      { ...localDisease(), local: true } ]);
    renderWithProviders(<SurveillanceDiseases />);
    expect(await screen.findByText(note)).not.toBeNull();
    // A local está na tabela das locais e só nela.
    expect(screen.getAllByRole("row", { name: /Febre do Oropouche/ })).toHaveLength(1);
  });

  it("a lista nacional vazia não inventa versão", async () => {
    mocked(api.listSurveillanceDiseases).mockResolvedValue([]);
    renderWithProviders(<SurveillanceDiseases />);
    expect(await screen.findByText("Lista nacional")).not.toBeNull();
    expect(await screen.findByText("a plataforma ainda não publicou a lista nacional")).not.toBeNull();
  });

  it("nova doença local: formato antes, step-up e o corpo com códigos normalizados", async () => {
    renderWithProviders(<SurveillanceDiseases />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova doença local" }));
    text("Código", "Febre"); text("Nome", "Febre amarela silvestre"); text("Prazo", "immediate"); text("CID-10", "w57.0, W57.9");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("código começa com local_ e segue com letras minúsculas, números ou _ (até 46)");
    expect(mocked(api.createLocalDisease)).not.toHaveBeenCalled();
    text("Código", "local_febre_amarela_silvestre");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect(screen.getByText(/as consultas passam a sugerir esta doença quando um dos códigos for registrado/i)).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.createLocalDisease).mock.calls[0][0]).toEqual({
      code: "local_febre_amarela_silvestre", name: "Febre amarela silvestre", deadline: "immediate", cid10: [ "W570", "W579" ], ciap2: [], repeat_after_days: 30 }));
  });

  it("manda o nome sem espaços nas pontas e recusa nome só de espaços", async () => {
    renderWithProviders(<SurveillanceDiseases />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova doença local" }));
    text("Código", "local_x"); text("Nome", "   "); text("Prazo", "weekly");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("nome de 1 a 120 caracteres");
    text("Nome", "  Febre X  ");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.createLocalDisease).mock.calls[0][0]).toMatchObject({ name: "Febre X" }));
  });

  it("depois de salvar relê as duas listas e avisa", async () => {
    renderWithProviders(<SurveillanceDiseases />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova doença local" }));
    text("Código", "local_x"); text("Nome", "Febre X"); text("Prazo", "weekly");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.listLocalDiseases)).toHaveBeenCalledTimes(2));
    expect(mocked(api.listSurveillanceDiseases)).toHaveBeenCalledTimes(2);
    expect((await screen.findByRole("status")).textContent).toBe("Doença Febre X salva.");
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
  });

  it("editar: o código não muda e o corpo vai sem código", async () => {
    renderWithProviders(<SurveillanceDiseases />);
    fireEvent.click(within(await screen.findByRole("row", { name: /Febre do Oropouche/ })).getByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("Código") as HTMLInputElement).disabled).toBe(true);
    text("Janela de repetição (dias)", "45");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.updateLocalDisease).mock.calls[0][0]).toBe("ld1"));
    expect(mocked(api.updateLocalDisease).mock.calls[0][1]).toEqual({ name: "Febre do Oropouche", deadline: "immediate", cid10: [ "R17" ], ciap2: [],
      repeat_after_days: 45 });
  });

  it("desativar diz que as notificações ficam e manda active false sem código", async () => {
    renderWithProviders(<SurveillanceDiseases />);
    fireEvent.click(within(await screen.findByRole("row", { name: /Febre do Oropouche/ })).getByRole("button", { name: "Desativar" }));
    expect(screen.getByText(/as notificações já feitas ficam/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.updateLocalDisease).mock.calls[0][0]).toBe("ld1"));
    expect(mocked(api.updateLocalDisease).mock.calls[0][1]).toEqual({ name: "Febre do Oropouche", deadline: "immediate", cid10: [ "R17" ], ciap2: [],
      repeat_after_days: 30, active: false });
  });

  it("reativar manda active true; a colisão com a lista nacional nova diz a posição do código", async () => {
    mocked(api.listLocalDiseases).mockResolvedValue([ localDisease({ active: false }) ]);
    mocked(api.updateLocalDisease).mockRejectedValue(new ApiError(409, { error: "duplicate_code", path: "cid10.0" }, "x"));
    renderWithProviders(<SurveillanceDiseases />);
    const row = await screen.findByRole("row", { name: /Febre do Oropouche/ });
    expect(within(row).getByText("inativa")).not.toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Reativar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("o CID-10 da posição 1 já pertence a outra doença da lista")).not.toBeNull();
    expect(mocked(api.updateLocalDisease).mock.calls[0][1]).toMatchObject({ active: true });
  });

  it("409 duplicate_code fica no formulário", async () => {
    mocked(api.createLocalDisease).mockRejectedValue(new ApiError(409, { error: "duplicate_code", path: "code" }, "x"));
    renderWithProviders(<SurveillanceDiseases />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova doença local" }));
    text("Código", "local_febre_oropouche"); text("Nome", "Febre do Oropouche"); text("Prazo", "weekly");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("já existe doença com este código")).not.toBeNull();
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Febre do Oropouche");
  });

  it("422 invalid_disease com path ciap2.1 diz a posição e mantém o formulário", async () => {
    mocked(api.createLocalDisease).mockRejectedValue(new ApiError(422, { error: "invalid_disease", path: "ciap2.1" }, "x"));
    renderWithProviders(<SurveillanceDiseases />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova doença local" }));
    text("Código", "local_x"); text("Nome", "Febre X"); text("Prazo", "weekly"); text("CIAP-2", "A77, A78");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("CIAP-2 da posição 2 inválido")).not.toBeNull();
    expect((screen.getByLabelText("CIAP-2") as HTMLInputElement).value).toBe("A77, A78");
  });

  it("erro de leitura aparece como frase, sem o corpo", async () => {
    mocked(api.listLocalDiseases).mockRejectedValue(new ApiError(500, { error: "boom" }, "x"));
    renderWithProviders(<SurveillanceDiseases />);
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
  });
});
