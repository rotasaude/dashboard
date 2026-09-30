// src/modules/analytics/DemandTab.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DemandTab } from "./DemandTab";
import { DEFAULT_RANGE } from "../../lib/analytics";
import {
  NB1, NOW, U1, demandData, envelope, failWith, paramsOf, renderWithQuery, rowWith, stubAnalyticsApi
} from "../../test/analyticsFixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const region = (name: string) => within(screen.getByRole("region", { name }));
const lastParams = (fn: ReturnType<typeof stubAnalyticsApi>) => paramsOf(fn, "/analytics/demand").at(-1)!;

describe("DemandTab", () => {
  it("pede as últimas 12 semanas até ontem, sem recorte, e mostra o carimbo", async () => {
    const fn = stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData()) });
    renderWithQuery(<DemandTab range={DEFAULT_RANGE} />);
    expect(await screen.findByText("dados até 29/09")).toBeTruthy();
    expect(Object.fromEntries(paramsOf(fn, "/analytics/demand")[0])).toEqual({
      from: "2026-07-13", to: "2026-09-29", granularity: "week"
    });
  });

  it("triagens: total do período vem de triages_total, não da soma dos pontos", async () => {
    // Tudo visível: com parte oculta o total também some (teste abaixo).
    // Totais propositalmente diferentes da soma dos pontos, para provar que a tela não soma.
    stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData({
      triages: { started: [ 12, 9, 0 ], completed: [ 10, 6, 0 ], aborted: [ 5, 0, 0 ] },
      triages_total: { started: 25, completed: 17, aborted: 6 },
      by_tier: [ { tier: "vermelho", series: [ 10, 6, 0 ], total: 17 } ],
      by_protocol: [ { protocol_name: "arbovirose", series: [ 10, 6, 0 ], total: 17 } ],
      by_neighborhood: [ { neighborhood_id: NB1, name: "Boqueirão", total: 17 } ]
    })) });
    renderWithQuery(<DemandTab range={DEFAULT_RANGE} />);
    await screen.findByText("dados até 29/09");
    const triages = region("Triagens");
    const totals = triages.getByRole("group", { name: "Totais do período" });
    expect(rowWith(totals, "Iniciadas")).toBe("Iniciadas25");
    expect(rowWith(totals, "Concluídas")).toBe("Concluídas17");
    expect(rowWith(totals, "Interrompidas")).toBe("Interrompidas6");
    expect(rowWith(triages.getByRole("table", { name: "Triagens por período" }), "21/09")).toBe("21/09960");
    expect(triages.getByRole("list", { name: "legenda" }).textContent).toBe("IniciadasConcluídasInterrompidas");
  });

  it("totais por tier, bairro, unidade e pedidos: número ou oculto, como veio", async () => {
    stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData()) });
    renderWithQuery(<DemandTab range={DEFAULT_RANGE} />);
    await screen.findByText("dados até 29/09");
    const tierTotals = region("Triagens concluídas por tier").getByRole("group", { name: "Totais do período" });
    expect(rowWith(tierTotals, "vermelho")).toBe("vermelho11");
    expect(rowWith(tierTotals, "verde")).toBe("verdeoculto");
    expect(rowWith(screen.getByRole("region", { name: "Triagens concluídas por bairro" }), "Sem bairro")).toBe("Sem bairrooculto");
    expect(rowWith(screen.getByRole("region", { name: "Triagens concluídas por bairro" }), "Boqueirão")).toBe("Boqueirão9");
    expect(rowWith(screen.getByRole("region", { name: "Atendimentos por unidade" }), "UPA Boqueirão")).toBe("UPA Boqueirãooculto");
    expect(rowWith(screen.getByRole("region", { name: "Pedidos abertos" }), "Encaminhamento")).toBe("Encaminhamento0");
    expect(rowWith(screen.getByRole("region", { name: "Pedidos encerrados" }), "Atendido")).toBe("Atendido6");
  });

  it("total oculto acompanha a parte oculta: período, tier, protocolo, bairro e unidade", async () => {
    stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData()) });
    renderWithQuery(<DemandTab range={DEFAULT_RANGE} />);
    await screen.findByText("dados até 29/09");
    const triages = region("Triagens");
    const totals = triages.getByRole("group", { name: "Totais do período" });
    expect(rowWith(totals, "Iniciadas")).toBe("Iniciadasoculto");
    expect(rowWith(totals, "Concluídas")).toBe("Concluídasoculto");
    expect(rowWith(totals, "Interrompidas")).toBe("Interrompidasoculto");
    const byPeriod = triages.getByRole("table", { name: "Triagens por período" });
    expect(rowWith(byPeriod, "14/09")).toBe("14/0912ocultooculto");
    expect(rowWith(byPeriod, "21/09")).toBe("21/09oculto50");
    const tier = region("Triagens concluídas por tier");
    expect(rowWith(tier.getByRole("group", { name: "Totais do período" }), "verde")).toBe("verdeoculto");
    expect(rowWith(tier.getByRole("table", { name: "Triagens concluídas por tier por período" }), "14/09")).toBe("14/096oculto");
    expect(rowWith(region("Triagens concluídas por protocolo").getByRole("group", { name: "Totais do período" }), "arbovirose")).toBe("arboviroseoculto");
    expect(rowWith(screen.getByRole("region", { name: "Triagens concluídas por bairro" }), "Sem bairro")).toBe("Sem bairrooculto");
    expect(rowWith(screen.getByRole("region", { name: "Atendimentos por unidade" }), "UPA Boqueirão")).toBe("UPA Boqueirãooculto");
  });

  it("bairro recorta com neighborhood_id; 'Sem bairro' manda none", async () => {
    const fn = stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData()) });
    renderWithQuery(<DemandTab range={DEFAULT_RANGE} />);
    await screen.findByRole("option", { name: "Boqueirão" });
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: NB1 } });
    await waitFor(() => expect(lastParams(fn).get("neighborhood_id")).toBe(NB1));
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "none" } });
    await waitFor(() => expect(lastParams(fn).get("neighborhood_id")).toBe("none"));
  });

  it("protocolo recorta sem versão (a Demanda não tem seletor de versão)", async () => {
    const fn = stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData()) });
    renderWithQuery(<DemandTab range={DEFAULT_RANGE} />);
    await screen.findByRole("option", { name: "arbovirose" });
    expect(screen.queryByLabelText("Versão")).toBeNull();
    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "arbovirose" } });
    await waitFor(() => expect(lastParams(fn).get("protocol_name")).toBe("arbovirose"));
    expect(lastParams(fn).has("protocol_version")).toBe(false);
  });

  it("unidade: a lista vem de data.units e continua inteira depois de escolher", async () => {
    // Com health_unit_id, attendances_by_unit encolhe para a escolhida;
    // data.units continua com todas (contratos §1).
    const fn = stubAnalyticsApi({
      "/analytics/demand": (url: URL) => {
        const unit = url.searchParams.get("health_unit_id");
        const data = demandData();
        return envelope<"demand">(unit
          ? { ...data, attendances_by_unit: data.attendances_by_unit.filter((u) => u.health_unit_id === unit) }
          : data);
      }
    });
    renderWithQuery(<DemandTab range={DEFAULT_RANGE} />);
    // UBS Antiga não tem atendimento no intervalo e mesmo assim é opção.
    expect(await screen.findByRole("option", { name: "UBS Antiga (inativa)" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: U1 } });
    await waitFor(() => expect(lastParams(fn).get("health_unit_id")).toBe(U1));
    await waitFor(() => expect(screen.getByRole("region", { name: "Atendimentos por unidade" }).textContent).not.toContain("UPA Boqueirão"));
    expect(screen.getByRole("option", { name: "UPA Boqueirão" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "UBS Antiga (inativa)" })).toBeTruthy();
  });

  it("unidade: a lista continua inteira enquanto o novo recorte carrega", async () => {
    const stub = stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData()) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), "http://x").searchParams.has("health_unit_id")) await gate;
      return stub(input, init);
    }));
    renderWithQuery(<DemandTab range={DEFAULT_RANGE} />);
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

  it("bairro que não existe na cidade: 422 vira frase", async () => {
    stubAnalyticsApi({
      "/analytics/demand": (url: URL) => url.searchParams.has("neighborhood_id")
        ? failWith(422, { error: "invalid_neighborhood" })
        : envelope<"demand">(demandData())
    });
    renderWithQuery(<DemandTab range={DEFAULT_RANGE} />);
    await screen.findByRole("option", { name: "Xaxim (inativo)" });
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "none" } });
    expect(await screen.findByText("Esse bairro não existe nesta cidade — escolha outro.")).toBeTruthy();
  });
});
