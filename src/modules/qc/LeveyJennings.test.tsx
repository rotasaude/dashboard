import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { LeveyJennings } from "./LeveyJennings";
import { SizedResizeObserver, qcChart } from "../../test/qcFixtures";

beforeEach(() => { vi.stubGlobal("ResizeObserver", SizedResizeObserver); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("LeveyJennings", () => {
  it("±1/2/3 dp e média, pontos coloridos pelo desfecho", async () => {
    const { container } = render(<LeveyJennings chart={qcChart()} label="Levey-Jennings · glicose" />);
    await waitFor(() => expect(container.querySelectorAll("[data-outcome]").length).toBe(6));
    expect(container.querySelectorAll('[data-outcome="reject"]').length).toBe(1);
    expect(container.querySelectorAll('[data-outcome="warning"]').length).toBe(1);
    expect(screen.getByRole("figure", { name: "Levey-Jennings · glicose" })).not.toBeNull();
  });

  it("duas versões: linha vertical na troca e aviso na legenda", async () => {
    const { container } = render(<LeveyJennings chart={qcChart()} label="LJ" />);
    // 7 horizontais (−3…+3 dp) + 1 vertical na troca da v1 para a v2.
    await waitFor(() => expect(container.querySelectorAll(".recharts-reference-line-line").length).toBe(8));
    expect(screen.getByText("Referência vigente v2 (laboratório): média 98 · dp 2,5")).not.toBeNull();
    expect(screen.getByText("há pontos avaliados contra outra versão da referência — o eixo é em desvios-padrão, cada ponto contra a sua versão")).not.toBeNull();
    const bands = screen.getByRole("list", { name: "faixas da referência vigente" });
    expect(within(bands).getByText("+2 dp: 103,0")).not.toBeNull();
  });

  it("tabela acessível dos pontos com regra disparada", () => {
    render(<LeveyJennings chart={qcChart()} label="LJ" />);
    const table = screen.getByRole("region", { name: "Pontos com regra disparada" });
    expect(within(table).getByText("2-2s")).not.toBeNull();
    expect(within(table).getByText("1-2s (aviso)")).not.toBeNull();
    expect(within(table).getByText("+2,4")).not.toBeNull();
    expect(within(table).getByText("104")).not.toBeNull();
  });

  it("uma versão só: sem linha vertical nem aviso; sem pontos: a frase", async () => {
    const one = qcChart({ points: qcChart().points.slice(4) });
    const { container, unmount } = render(<LeveyJennings chart={one} label="LJ" />);
    await waitFor(() => expect(container.querySelectorAll(".recharts-reference-line-line").length).toBe(7));
    expect(screen.queryByText(/outra versão da referência/)).toBeNull();
    unmount();
    render(<LeveyJennings chart={qcChart({ points: [] })} label="LJ" />);
    expect(screen.getByText("nenhum ponto no período")).not.toBeNull();
  });

  it("sem referência vigente: avisa e não quebra", () => {
    render(<LeveyJennings chart={qcChart({ target: null })} label="LJ" />);
    expect(screen.getByText("sem referência vigente para esta chave — o eixo segue em desvios-padrão da referência de cada ponto")).not.toBeNull();
    expect(screen.queryByRole("list", { name: "faixas da referência vigente" })).toBeNull();
  });
});
