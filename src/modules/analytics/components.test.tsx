import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { useAnalytics } from "../../hooks/useAnalytics";
import { AnalyticsView } from "./AnalyticsView";
import { DataStamp } from "./DataStamp";
import { SeriesBlock } from "./SeriesBlock";
import { chartRows } from "./SeriesChart";
import { CellValue, RateValue } from "./values";
import { FORBIDDEN_TEXT, HIDDEN_HINT } from "../../lib/analytics";
import {
  AS_OF, HIDDEN, PERIODS, demandData, envelope, failWith, renderWithQuery, rowWith, stubAnalyticsApi
} from "../../test/analyticsFixtures";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const QUERY = { from: "2026-07-13", to: "2026-09-29", granularity: "week" as const };

function Probe() {
  const result = useAnalytics("demand", QUERY);
  return <AnalyticsView result={result}>{(data) => <p>{data.periods.length} períodos</p>}</AnalyticsView>;
}

describe("valores", () => {
  it("contagem oculta mostra 'oculto' com a dica", () => {
    render(<CellValue value={HIDDEN} />);
    expect(screen.getByText("oculto").getAttribute("title")).toBe(HIDDEN_HINT);
  });

  it("taxa sem denominador mostra 'sem dado'; taxa com número tem uma casa", () => {
    render(<p><RateValue value={null} /> · <RateValue value={20.8} /></p>);
    expect(screen.getByText("sem dado")).toBeTruthy();
    expect(screen.getByText(/20,8%/)).toBeTruthy();
  });
});

describe("DataStamp", () => {
  it("mostra 'dados até' sem aviso quando está em dia", () => {
    render(<DataStamp asOf={AS_OF} stale={false} />);
    expect(screen.getByText("dados até 29/09")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stale acende 'dados desatualizados'", () => {
    render(<DataStamp asOf={AS_OF} stale />);
    expect(screen.getByRole("status").textContent).toBe("dados desatualizados");
  });

  it("sem as_of não mostra nada", () => {
    const { container } = render(<DataStamp asOf={null} stale />);
    expect(container.textContent).toBe("");
  });
});

describe("AnalyticsView", () => {
  it("com dados: carimbo e conteúdo", async () => {
    stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData()) });
    renderWithQuery(<Probe />);
    expect(await screen.findByText("3 períodos")).toBeTruthy();
    expect(screen.getByText("dados até 29/09")).toBeTruthy();
  });

  it("as_of nulo: estado vazio, sem carimbo e sem conteúdo (nenhum zero na tela)", async () => {
    stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData(), { as_of: null, stale: true }) });
    renderWithQuery(<Probe />);
    expect(await screen.findByText("ainda sem dados consolidados")).toBeTruthy();
    expect(screen.queryByText("3 períodos")).toBeNull();
    expect(screen.queryByText(/dados até/)).toBeNull();
  });

  it("stale com dados: carimbo e aviso", async () => {
    stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData(), { stale: true }) });
    renderWithQuery(<Probe />);
    expect((await screen.findByRole("status")).textContent).toBe("dados desatualizados");
    expect(screen.getByText("3 períodos")).toBeTruthy();
  });

  it("papel revogado no meio da sessão: 403 vira a frase de acesso", async () => {
    stubAnalyticsApi({ "/analytics/demand": failWith(403, { error: "forbidden_role" }) });
    renderWithQuery(<Probe />);
    expect(await screen.findByText(FORBIDDEN_TEXT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "tentar novamente" })).toBeTruthy();
  });

  it("422 invalid_range vira frase, não código", async () => {
    stubAnalyticsApi({ "/analytics/demand": failWith(422, { error: "invalid_range" }) });
    renderWithQuery(<Probe />);
    expect(await screen.findByText("Período inválido — escolha outro intervalo.")).toBeTruthy();
    expect(screen.queryByText(/invalid_range/)).toBeNull();
  });
});

describe("gráfico e bloco de série", () => {
  it("no gráfico, oculto e sem dado viram lacuna com o rótulo do período", () => {
    const rows = chartRows(PERIODS, "week", [
      { key: "a", label: "A", series: [ 12, HIDDEN, 0 ] },
      { key: "b", label: "B", series: [ 50, null, 100 ] }
    ]);
    expect(rows).toEqual([
      { period: "14/09", s0: 12, s1: 50 },
      { period: "21/09", s0: null, s1: null },
      { period: "28/09", s0: 0, s1: 100 }
    ]);
  });

  it("com total: tabela de totais e tabela por período, 'oculto' nas duas", () => {
    renderWithQuery(
      <SeriesBlock title="Por tier" kind="count" periods={PERIODS} granularity="week" lines={[
        { key: "vermelho", label: "vermelho", series: [ 6, HIDDEN, 0 ], total: 8 },
        { key: "verde", label: "verde", series: [ HIDDEN, 0, 0 ], total: HIDDEN }
      ]} />
    );
    const block = within(screen.getByRole("region", { name: "Por tier" }));
    const totals = block.getByRole("group", { name: "Totais do período" });
    expect(rowWith(totals, "vermelho")).toContain("8");
    expect(rowWith(totals, "verde")).toContain("oculto");
    const byPeriod = block.getByRole("table", { name: "Por tier por período" });
    expect(rowWith(byPeriod, "21/09")).toContain("oculto");
    expect(block.getByRole("list", { name: "legenda" }).textContent).toContain("vermelho");
  });

  it("sem total na linha, sem tabela de totais (o cliente não soma)", () => {
    renderWithQuery(
      <SeriesBlock title="Triagens" kind="count" periods={PERIODS} granularity="week"
        lines={[ { key: "started", label: "Iniciadas", series: [ 12, HIDDEN, 0 ] } ]} />
    );
    const block = within(screen.getByRole("region", { name: "Triagens" }));
    expect(block.queryByRole("group", { name: "Totais do período" })).toBeNull();
  });

  it("taxa: 'sem dado' no período sem denominador", () => {
    renderWithQuery(
      <SeriesBlock title="Faltas" kind="rate" periods={PERIODS} granularity="week"
        lines={[ { key: "no_show", label: "faltas", series: [ HIDDEN, 25, null ], total: 20.8 } ]} />
    );
    const block = within(screen.getByRole("region", { name: "Faltas" }));
    expect(rowWith(block.getByRole("group", { name: "Totais do período" }), "faltas")).toContain("20,8%");
    expect(rowWith(block.getByRole("table", { name: "Faltas por período" }), "28/09")).toContain("sem dado");
  });

  it("sem linhas: estado vazio do bloco", () => {
    renderWithQuery(<SeriesBlock title="Pedidos" kind="count" periods={PERIODS} granularity="week" lines={[]} />);
    expect(within(screen.getByRole("region", { name: "Pedidos" })).getByText("sem registros no período")).toBeTruthy();
  });
});
