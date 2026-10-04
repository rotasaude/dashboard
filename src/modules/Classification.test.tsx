import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScopeContext } from "../lib/scope";
import type { ClassificationData, TrailStep } from "../lib/types";
import { Classification } from "./Classification";
import { kpiRow } from "../test/panelHarness";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const classification: ClassificationData = {
  tiers: [
    { key: "alta", label: "alta", count: 2, tone: "down" },
    { key: "baixa", label: "baixa", count: 5, tone: "info" }
  ],
  tierKeys: [ "alta", "baixa" ],
  urgent: 2,
  urgentMaxPriority: 1,
  urgentTrend: [],
  byProtocol: [ { protocol: "triage-respiratoria · 1", counts: { alta: 2, baixa: 5 } } ],
  byMode: [ { mode: "weighted", label: "weighted", count: 7, share: 100 } ],
  sampleTriages: [
    { id: "t1-0000000000000", tier: "alta", priority: 1, urgent: true, mode: "weighted", protocol: "triage-respiratoria · 1", at: "09:10" }
  ]
};

function stubApi(steps: TrailStep[]) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://x").pathname;
    const body = path.endsWith("/trail")
      ? { data: { triageId: "t1-0000000000000", protocol: "triage-respiratoria · 1", mode: "weighted", steps }, as_of: "2026-09-27T12:00:00Z" }
      : { data: classification, as_of: "2026-09-27T12:00:00Z" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderClassification() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScopeContext.Provider value={{ period: "7d", citySlug: "m1", setPeriod: vi.fn() }}>
        <Classification />
      </ScopeContext.Provider>
    </QueryClientProvider>
  );
}

const at = "2026-09-27T09:10:00Z";

describe("Classification — tiers reais e urgência (F-05.9)", () => {
  it("usa os tiers dos protocolos, a urgência pela régua do alerta e o carimbo nos KPIs", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    stubApi([]);
    renderClassification();

    const row = await kpiRow();
    expect(row.getByText("Tier alta")).toBeTruthy();
    expect(row.getByText("Tier baixa")).toBeTruthy();
    expect(row.getByText("Casos urgentes (priority ≤ 1)")).toBeTruthy();
    expect(row.getByText("dados de 09:00:00")).toBeTruthy();
  });

  it("monta o pivô por protocolo com as colunas dos tiers reais", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    stubApi([]);
    renderClassification();

    const pivot = within(await screen.findByRole("region", { name: "Tier por protocolo" }));
    expect(pivot.getByText("alta")).toBeTruthy();
    expect(pivot.getByText("baixa")).toBeTruthy();
    expect(pivot.getByText("5")).toBeTruthy();
    expect(pivot.queryByText("Low")).toBeNull();
  });

  it("mostra a prioridade como número e marca a urgente", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    stubApi([]);
    renderClassification();

    const sample = within(await screen.findByRole("region", { name: "Amostra de inspeção" }));
    expect(sample.getByText("1 · urgente")).toBeTruthy();
    expect(sample.queryByText("sim")).toBeNull();
  });
});

describe("Classification — trail drawer (F-03.16)", () => {
  it("abre o trail da triagem e mostra só regra, referência e saída", async () => {
    const fetchMock = stubApi([
      { ev: "scored", rule: "weighted", ref: "step:tosse", out: "3", at },
      { ev: "tier_assigned", rule: "threshold", ref: "score:8", out: "alta", at }
    ]);
    renderClassification();

    fireEvent.click(await screen.findByText("t1-000000000…"));

    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("step:tosse");
    expect(within(dialog).getByText("score:8")).toBeTruthy();
    expect(within(dialog).getByText("tier_assigned")).toBeTruthy();
    expect(within(dialog).getByText(/ADR 0009/)).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/admin/api/triages/t1-0000000000000/trail"))).toBe(true);
  });

  it("mostra peso zero como 0, não como vazio", async () => {
    stubApi([ { ev: "scored", rule: "weighted", ref: "step:febre", out: "0", at } ]);
    renderClassification();

    fireEvent.click(await screen.findByText("t1-000000000…"));

    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("step:febre");
    expect(within(dialog).getByText("0")).toBeTruthy();
  });

  it("triagem sem trilha registrada mostra o estado vazio", async () => {
    stubApi([]);
    renderClassification();

    fireEvent.click(await screen.findByText("t1-000000000…"));

    expect(await screen.findByText("sem trilha registrada para esta triagem")).toBeTruthy();
  });
});

describe("Classification — filtro de bairro (módulo 11)", () => {
  const stubData = (d: unknown) => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ data: d, as_of: "2026-09-27T12:00:00Z" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )));
  };

  it("contagem suprimida vira '< 5', a distribuição vira lista e a amostra some", async () => {
    const s = { suppressed: true };
    stubData({
      ...classification,
      tiers: [ { key: "alta", label: "alta", count: s, tone: "down" }, { key: "baixa", label: "baixa", count: 0, tone: "info" } ],
      urgent: s,
      urgentTrend: [ 0, s ],
      byProtocol: [ { protocol: "resp · 1", counts: { alta: s, baixa: 0 } } ],
      byMode: [ { mode: "weighted", label: "weighted", count: s, share: s } ],
      sampleTriages: undefined
    });
    renderClassification();

    const row = await kpiRow();
    expect(row.getAllByText("< 5")).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: "Distribuição de tier" })).getByRole("list", { name: "contagens" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Tier por protocolo" })).getByText("< 5")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Modo de scoring" })).getByRole("list", { name: "contagens" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Amostra de inspeção" })).getByText("amostra oculta")).toBeTruthy();
  });

  it("amostra null com todos os totais visíveis (ponto da série suprimido) continua oculta, sem 'menos de 5' ligado ao total", async () => {
    stubData({ ...classification, urgentTrend: [ 3, { suppressed: true } ], sampleTriages: null });
    renderClassification();

    const sample = within(await screen.findByRole("region", { name: "Amostra de inspeção" }));
    expect(sample.getByText("amostra oculta")).toBeTruthy();
    expect(sample.queryByText("sem amostras")).toBeNull();
    const row = await kpiRow();
    expect(row.getByText("Tier alta")).toBeTruthy();
    expect(row.queryByText("< 5")).toBeNull();
  });

  it("amostra vazia (não oculta) continua 'sem amostras'", async () => {
    stubData({ ...classification, sampleTriages: [] });
    renderClassification();
    expect(await within(await screen.findByRole("region", { name: "Amostra de inspeção" })).findByText("sem amostras")).toBeTruthy();
  });
});
