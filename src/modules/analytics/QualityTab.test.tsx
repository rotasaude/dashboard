// src/modules/analytics/QualityTab.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QualityTab } from "./QualityTab";
import { DEFAULT_RANGE } from "../../lib/analytics";
import {
  NOW, U1, U2, envelope, paramsOf, qualityData, renderWithQuery, rowWith, stubAnalyticsApi
} from "../../test/analyticsFixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const region = (name: string) => screen.getByRole("region", { name });
const totals = (name: string) => within(region(name)).getByRole("group", { name: "Totais do período" });

describe("QualityTab", () => {
  it("só tem o recorte de unidade, e manda período e agrupamento", async () => {
    const fn = stubAnalyticsApi({ "/analytics/quality": envelope<"quality">(qualityData()) });
    renderWithQuery(<QualityTab range={{ granularity: "month", count: 6 }} />);
    await screen.findByText("dados até 29/09");
    expect(Object.fromEntries(paramsOf(fn, "/analytics/quality")[0])).toEqual({
      from: "2026-04-01", to: "2026-09-29", granularity: "month"
    });
    expect(screen.queryByLabelText("Bairro")).toBeNull();
    expect(screen.queryByLabelText("Protocolo")).toBeNull();
    expect(screen.getByLabelText("Unidade")).toBeTruthy();
  });

  it("faixas de espera nas cinco linhas, na ordem da API, com rótulo", async () => {
    stubAnalyticsApi({ "/analytics/quality": envelope<"quality">(qualityData()) });
    renderWithQuery(<QualityTab range={DEFAULT_RANGE} />);
    await screen.findByText("dados até 29/09");
    const rows = within(totals("Espera até a chamada")).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual([ "até 15 min14", "15 a 30 min12", "30 a 60 min0", "1 a 2 h0", "mais de 2 hoculto" ]);
  });

  it("taxas: uma casa e sem dado", async () => {
    // Tudo visível: com parte oculta a taxa também some (teste abaixo).
    const visible = qualityData();
    stubAnalyticsApi({ "/analytics/quality": envelope<"quality">(qualityData({
      wait: {
        buckets: [
          { bucket: "0-15", series: [ 8, 6, 0 ], total: 14 },
          { bucket: "15-30", series: [ 7, 5, 0 ], total: 12 },
          { bucket: "30-60", series: [ 5, 0, 0 ], total: 5 },
          { bucket: "60-120", series: [ 0, 0, 0 ], total: 0 },
          { bucket: "120+", series: [ 0, 0, 0 ], total: 0 }
        ],
        within_30_pct: [ 75, 100, null ],
        within_30_pct_total: 83.9
      },
      appointments: visible.appointments.map((a) => a.status === "no_show" ? { ...a, series: [ 6, 5, 0 ], total: 11 } : a),
      no_show_pct: [ 37.5, 35.7, null ],
      no_show_pct_total: 36.7,
      attendance_outcomes: visible.attendance_outcomes.map((o) => o.outcome === "left" ? { ...o, series: [ 5, 0, 0 ], total: 5 } : o),
      left_pct: [ 35.7, 0, null ],
      left_pct_total: 18.5
    })) });
    renderWithQuery(<QualityTab range={DEFAULT_RANGE} />);
    await screen.findByText("dados até 29/09");
    expect(rowWith(totals("Chamados em até 30 min"), "até 30 min")).toBe("até 30 min83,9%");
    expect(rowWith(within(region("Chamados em até 30 min")).getByRole("table", { name: "Chamados em até 30 min por período" }), "28/09"))
      .toBe("28/09sem dado");
    expect(rowWith(totals("Faltas"), "faltas")).toBe("faltas36,7%");
    expect(rowWith(totals("Saiu sem atendimento"), "saiu sem atendimento")).toBe("saiu sem atendimento18,5%");
    expect(rowWith(totals("Agendamentos encerrados"), "Faltou")).toBe("Faltou11");
    expect(rowWith(totals("Desfechos dos atendimentos"), "Encaminhado")).toBe("Encaminhado5");
  });

  it("total e taxa ocultos acompanham a parte oculta", async () => {
    stubAnalyticsApi({ "/analytics/quality": envelope<"quality">(qualityData()) });
    renderWithQuery(<QualityTab range={DEFAULT_RANGE} />);
    await screen.findByText("dados até 29/09");
    // 120+ oculto em 14/09: a linha do período mostra "oculto", o total da faixa e a taxa também.
    expect(rowWith(within(region("Espera até a chamada")).getByRole("table", { name: "Espera até a chamada por período" }), "14/09"))
      .toBe("14/09" + "8" + "7" + "0" + "0" + "oculto");
    expect(rowWith(totals("Espera até a chamada"), "mais de 2 h")).toBe("mais de 2 hoculto");
    const within30 = within(region("Chamados em até 30 min")).getByRole("table", { name: "Chamados em até 30 min por período" });
    expect(rowWith(within30, "14/09")).toBe("14/09oculto");
    expect(rowWith(within30, "21/09")).toBe("21/09100,0%");
    expect(rowWith(totals("Chamados em até 30 min"), "até 30 min")).toBe("até 30 minoculto");
    // no_show oculto: o total do estado e a taxa de faltas, inclusive o total da taxa.
    expect(rowWith(totals("Agendamentos encerrados"), "Faltou")).toBe("Faltouoculto");
    expect(rowWith(totals("Faltas"), "faltas")).toBe("faltasoculto");
    expect(rowWith(totals("Saiu sem atendimento"), "saiu sem atendimento")).toBe("saiu sem atendimentooculto");
  });

  it("por unidade: contagem e as três taxas, cada uma como veio", async () => {
    stubAnalyticsApi({ "/analytics/quality": envelope<"quality">(qualityData()) });
    renderWithQuery(<QualityTab range={DEFAULT_RANGE} />);
    await screen.findByText("dados até 29/09");
    expect(rowWith(region("Por unidade"), "UBS Centro")).toBe("UBS Centro2287,5%20,8%oculto");
    expect(rowWith(region("Por unidade"), "UPA Boqueirão")).toBe("UPA Boqueirãoocultoocultosem dadooculto");
  });

  it("unidade: a lista vem de data.units e continua inteira depois de escolher", async () => {
    const fn = stubAnalyticsApi({
      "/analytics/quality": (url: URL) => {
        const unit = url.searchParams.get("health_unit_id");
        const data = qualityData();
        return envelope<"quality">(unit ? { ...data, by_unit: data.by_unit.filter((u) => u.health_unit_id === unit) } : data);
      }
    });
    renderWithQuery(<QualityTab range={DEFAULT_RANGE} />);
    expect(await screen.findByRole("option", { name: "UBS Antiga (inativa)" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: U2 } });
    await waitFor(() => expect(paramsOf(fn, "/analytics/quality").at(-1)!.get("health_unit_id")).toBe(U2));
    await waitFor(() => expect(within(region("Por unidade")).queryByText("UBS Centro")).toBeNull());
    expect(screen.getByRole("option", { name: "UBS Centro" })).toBeTruthy();
  });

  it("unidade: a lista continua inteira enquanto o novo recorte carrega", async () => {
    const stub = stubAnalyticsApi({ "/analytics/quality": envelope<"quality">(qualityData()) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), "http://x").searchParams.has("health_unit_id")) await gate;
      return stub(input, init);
    }));
    renderWithQuery(<QualityTab range={DEFAULT_RANGE} />);
    expect(await screen.findByRole("option", { name: "UPA Boqueirão" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: U1 } });
    // Resposta do recorte ainda pendente: o seletor não pode esvaziar.
    expect(screen.getByRole("option", { name: "UPA Boqueirão" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "UBS Antiga (inativa)" })).toBeTruthy();
    release();
    await screen.findByText("dados até 29/09");
    expect(screen.getByRole("option", { name: "UPA Boqueirão" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "UBS Antiga (inativa)" })).toBeTruthy();
  });
});
