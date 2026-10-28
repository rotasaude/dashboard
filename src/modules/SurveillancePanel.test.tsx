import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getSurveillancePanel: vi.fn(), listSurveillanceDiseases: vi.fn() };
});
import * as api from "../lib/api";
import { SurveillancePanel } from "./SurveillancePanel";
import { SIGNAL_NOTE } from "../lib/surveillance";
import { renderWithProviders } from "../test/campaignFixtures";
import { DENGUE, TODAY25, panel, survUser } from "../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const panelCalls = () => mocked(api.getSurveillancePanel).mock.calls;

describe("SurveillancePanel", () => {
  beforeEach(() => {
    mocked(api.getSurveillancePanel).mockReset();
    mocked(api.listSurveillanceDiseases).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser([ "analyst" ]));
    mocked(api.getSurveillancePanel).mockResolvedValue(panel());
    mocked(api.listSurveillanceDiseases).mockResolvedValue([ DENGUE ]);
  });

  it("analyst vê o painel das 12 semanas anteriores; contagem nula vira < 5 e zero continua 0", async () => {
    renderWithProviders(<SurveillancePanel today={TODAY25} />);
    const unknown = await screen.findByRole("row", { name: /não informado/i });
    expect(within(unknown).getByText("< 5")).not.toBeNull();
    expect(within(unknown).getByText("0")).not.toBeNull();
    // A7: sem doença escolhida, a chave `disease` nem existe na consulta (o cliente não manda `disease=`).
    expect(panelCalls()[0][0]).toEqual({ fromWeek: "2026-31", toWeek: "2026-42", disease: null });
  });

  it("colunas das semanas no formato SS/AAAA e coluna Bairro", async () => {
    renderWithProviders(<SurveillancePanel today={TODAY25} />);
    await screen.findByRole("row", { name: /Centro/ });
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([ "Bairro", "41/2026", "42/2026" ]);
  });

  it("sinal rotulado para avaliar; a palavra surto não aparece e a nota explica as semanas de 1 a 4 casos", async () => {
    renderWithProviders(<SurveillancePanel today={TODAY25} />);
    const centro = await screen.findByRole("row", { name: /Centro/ });
    expect(within(centro).getByText("14")).not.toBeNull();
    expect(within(centro).getAllByText("sinal")).toHaveLength(1);
    expect(screen.getByText(SIGNAL_NOTE)).not.toBeNull();
    expect(SIGNAL_NOTE).toContain("2,5");
    expect(screen.getByText(/Contagens de 1 a 4 aparecem como “< 5”/)).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/surto/i);
  });

  it("faixa de mais de 53 semanas é recusada antes de pedir; doença e semanas aplicadas", async () => {
    renderWithProviders(<SurveillancePanel today={TODAY25} />);
    await screen.findByRole("row", { name: /Centro/ });
    await screen.findByRole("option", { name: "Dengue" });
    fireEvent.change(screen.getByLabelText("De (AAAA-SS)"), { target: { value: "2025-40" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("no máximo 53 semanas por consulta");
    expect(panelCalls()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("De (AAAA-SS)"), { target: { value: "2026-30" } });
    fireEvent.change(screen.getByLabelText("Doença"), { target: { value: "dengue" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(panelCalls().at(-1)![0]).toEqual({ fromWeek: "2026-30", toWeek: "2026-42", disease: "dengue" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Atualizar com os mesmos filtros lê de novo", async () => {
    renderWithProviders(<SurveillancePanel today={TODAY25} />);
    await screen.findByRole("row", { name: /Centro/ });
    expect(panelCalls()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(panelCalls()).toHaveLength(2));
    expect(panelCalls()[1][0]).toEqual(panelCalls()[0][0]);
  });

  it("semana em formato inválido ou no futuro não vai ao api", async () => {
    renderWithProviders(<SurveillancePanel today={TODAY25} />);
    await screen.findByRole("row", { name: /Centro/ });
    fireEvent.change(screen.getByLabelText("Até (AAAA-SS)"), { target: { value: "2026-99" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("semana inválida: use AAAA-SS (ex.: 2026-43)");
    fireEvent.change(screen.getByLabelText("Até (AAAA-SS)"), { target: { value: "2026-44" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("semana no futuro"));
    expect(panelCalls()).toHaveLength(1);
  });

  it("A6: lista de doenças recusada (403) para o papel — o painel aparece sem o filtro de doença", async () => {
    mocked(api.listSurveillanceDiseases).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "403"));
    renderWithProviders(<SurveillancePanel today={TODAY25} />);
    expect(await screen.findByRole("row", { name: /Centro/ })).not.toBeNull();
    await waitFor(() => expect(mocked(api.listSurveillanceDiseases)).toHaveBeenCalled());
    expect(screen.queryByLabelText("Doença")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(panelCalls()[0][0]).toEqual({ fromWeek: "2026-31", toWeek: "2026-42", disease: null });
  });

  it("recusa do api na consulta do painel vira frase, sem tabela", async () => {
    mocked(api.getSurveillancePanel).mockRejectedValue(new api.ApiError(422, { error: "invalid_range" }, "422"));
    renderWithProviders(<SurveillancePanel today={TODAY25} />);
    expect((await screen.findByRole("alert")).textContent).toBe("faixa de semanas inválida");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("papel sem acesso não lê nada", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser([ "health_professional" ]));
    renderWithProviders(<SurveillancePanel today={TODAY25} />);
    expect(await screen.findByText("seu papel não permite usar a vigilância epidemiológica")).not.toBeNull();
    expect(mocked(api.getSurveillancePanel)).not.toHaveBeenCalled();
  });
});
