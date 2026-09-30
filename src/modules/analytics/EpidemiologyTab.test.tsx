// src/modules/analytics/EpidemiologyTab.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EpidemiologyTab } from "./EpidemiologyTab";
import { DEFAULT_RANGE, EPI_HOWTO } from "../../lib/analytics";
import {
  NB1, NOW, envelope, epidemiologyData, paramsOf, renderWithQuery, rowWith, stubAnalyticsApi
} from "../../test/analyticsFixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const lastParams = (fn: ReturnType<typeof stubAnalyticsApi>) => paramsOf(fn, "/analytics/epidemiology").at(-1)!;

describe("EpidemiologyTab", () => {
  it("uma série por opção de cada pergunta marcada, com o total como veio", async () => {
    stubAnalyticsApi({ "/analytics/epidemiology": envelope<"epidemiology">(epidemiologyData()) });
    renderWithQuery(<EpidemiologyTab range={DEFAULT_RANGE} />);
    const fever = within(await screen.findByRole("region", { name: "Teve febre?" }));
    expect(fever.getByRole("list", { name: "legenda" }).textContent).toBe("SimNão");
    const totals = fever.getByRole("group", { name: "Totais do período" });
    expect(rowWith(totals, "Sim")).toBe("Sim12");
    expect(rowWith(totals, "Não")).toBe("Nãooculto");
    expect(within(screen.getByRole("region", { name: "Qual o sintoma principal?" })).getByText("arbovirose · lista")).toBeTruthy();
    expect(fever.getByText("arbovirose · sim/não")).toBeTruthy();
  });

  it("total oculto acompanha a célula oculta da série", async () => {
    stubAnalyticsApi({ "/analytics/epidemiology": envelope<"epidemiology">(epidemiologyData()) });
    renderWithQuery(<EpidemiologyTab range={DEFAULT_RANGE} />);
    const fever = within(await screen.findByRole("region", { name: "Teve febre?" }));
    expect(rowWith(fever.getByRole("table", { name: "Teve febre? por período" }), "14/09")).toBe("14/097oculto");
    expect(rowWith(fever.getByRole("table", { name: "Teve febre? por período" }), "21/09")).toBe("21/0950");
    expect(rowWith(fever.getByRole("group", { name: "Totais do período" }), "Não")).toBe("Nãooculto");
  });

  it("sem pergunta marcada: explica como marcar no editor", async () => {
    stubAnalyticsApi({ "/analytics/epidemiology": envelope<"epidemiology">(epidemiologyData({ questions: [] })) });
    renderWithQuery(<EpidemiologyTab range={DEFAULT_RANGE} />);
    expect(await screen.findByText("nenhuma pergunta marcada para Analytics")).toBeTruthy();
    expect(screen.getByText(EPI_HOWTO)).toBeTruthy();
  });

  it("recortes: bairro, protocolo e versão, com o agrupamento do intervalo", async () => {
    const fn = stubAnalyticsApi({ "/analytics/epidemiology": envelope<"epidemiology">(epidemiologyData()) });
    renderWithQuery(<EpidemiologyTab range={{ granularity: "month", count: 6 }} />);
    await screen.findByRole("option", { name: "Boqueirão" });
    expect(Object.fromEntries(paramsOf(fn, "/analytics/epidemiology")[0])).toEqual({
      from: "2026-04-01", to: "2026-09-29", granularity: "month"
    });
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: NB1 } });
    await waitFor(() => expect(lastParams(fn).get("neighborhood_id")).toBe(NB1));
    await screen.findByRole("option", { name: "arbovirose" });
    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "arbovirose" } });
    await screen.findByRole("option", { name: "versão 2" });
    fireEvent.change(screen.getByLabelText("Versão"), { target: { value: "2" } });
    await waitFor(() => expect(lastParams(fn).get("protocol_version")).toBe("2"));
    expect(lastParams(fn).get("protocol_name")).toBe("arbovirose");
    expect(lastParams(fn).get("neighborhood_id")).toBe(NB1);
  });
});
