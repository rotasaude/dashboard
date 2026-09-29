import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import type { EventsData, HealthData, IngestionData, OverviewData, QueuesData } from "../lib/types";
import { kpiRow, renderPanel, STAMP, stubResizeObserver, stubRoutes } from "../test/panelHarness";
import { Overview } from "./Overview";

// F-05.4 — Overview: os cinco KPIs ao vivo (ADR 0022) e os resumos dos outros
// painéis, cada agregado com o carimbo da sua resposta (F-05.3).

beforeEach(() => stubResizeObserver());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const kpi = (id: string, label: string, value: number, unit = "") =>
  ({ id, label, value, unit, delta: null, tone: "ok", spark: [], source: "live" as const });

const overview: OverviewData = {
  kpis: [
    kpi("done", "Triagens concluídas", 42),
    kpi("active", "Conversas ativas agora", 7),
    kpi("urgent", "Casos urgentes", 3),
    kpi("completion", "Taxa de conclusão", 81.5, "%"),
    kpi("failed", "Jobs falhados abertos", 0)
  ]
};

const ingestion: IngestionData = { inboundSeries: [ 1, 2 ], inboundTotal: 3, ack: [], purge: { pending: 0, oldestH: 0, ttlH: 2160, overTtl: false } };
const queues: QueuesData = { queues: [], oldestPendingS: 0, failedExecutions: [], recurring: [] };
const events: EventsData = { total: 0, retentionMonths: 12, replayAnchor: null, byType: [], stream: [], filters: [] };
const health: HealthData = {
  projections: [ { name: "dashboard_metrics", updatedAt: "2026-09-27T11:50:00Z", driftMin: 10, thresholdMin: 30, status: "ok" } ],
  recurring: [], driftOverall: 10
};
const conversations = { live: 0, funnel: [], exits: [], abandonRate: null, avgToCompleteMin: null, liveActive: { awaiting: 0, inProgress: 0 } };

function routes(extra: Record<string, unknown> = {}) {
  return stubRoutes({ "/overview": overview, "/ingestion": ingestion, "/queues": queues, "/events": events,
                      "/health": health, "/conversations": conversations, ...extra });
}

describe("Overview", () => {
  it("mostra os cinco KPIs da cidade com o carimbo da resposta", async () => {
    routes();
    renderPanel(<Overview />);

    const row = await kpiRow();
    for (const label of [ "Triagens concluídas", "Conversas ativas agora", "Casos urgentes", "Taxa de conclusão", "Jobs falhados abertos" ]) {
      expect(row.getByText(label)).toBeTruthy();
    }
    expect(row.getByText("42")).toBeTruthy();
    expect(row.getByText(STAMP)).toBeTruthy();
  });

  it("carimba o resumo de saúde das projeções", async () => {
    routes();
    renderPanel(<Overview />);

    const panel = await screen.findByRole("region", { name: "Saúde das projeções" });
    expect(await within(panel).findByText(STAMP)).toBeTruthy();
  });

  it("mostra o erro dos KPIs sem derrubar os outros resumos", async () => {
    routes({ "/overview": 500 });
    renderPanel(<Overview />);

    expect(await screen.findByText("tentar novamente")).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Saúde das projeções" })).toBeTruthy();
  });

  it("com bairro: KPI suprimido mostra '< 5' sem o delta; jobs seguem como número", async () => {
    routes({ "/overview": { kpis: [
      { ...kpi("urgent", "Casos urgentes", 0), value: { suppressed: true }, delta: "+2" },
      kpi("failed", "Jobs falhados abertos", 3)
    ] } });
    renderPanel(<Overview />);

    const row = await kpiRow();
    expect(row.getByText("< 5")).toBeTruthy();
    expect(row.queryByText("+2")).toBeNull();
    expect(row.getByText("3")).toBeTruthy();
  });

  it("taxa de conclusão suprimida (unit %) mostra 'oculto' neutro, sem % nem '< 5' nem NaN", async () => {
    routes({ "/overview": { kpis: [
      { ...kpi("done", "Triagens concluídas", 42), spark: [ 1, { suppressed: true }, 3 ] },
      { ...kpi("completion", "Taxa de conclusão", 0, "%"), value: { suppressed: true }, tone: "neutral", delta: null }
    ] } });
    renderPanel(<Overview />);

    const row = await kpiRow();
    expect(row.getByText("42")).toBeTruthy();
    expect(row.getByText("oculto")).toBeTruthy();
    expect(row.queryByText("< 5")).toBeNull();
    expect(row.queryByText("%")).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it("funil de conversas com categoria suprimida vira lista no resumo", async () => {
    routes({ "/conversations": { ...conversations, funnel: [
      { key: "greeting", label: "greeting", count: 4, tone: "neutral" },
      { key: "awaiting_consent", label: "awaiting_consent", count: { suppressed: true }, tone: "info" }
    ] } });
    renderPanel(<Overview />);

    expect(await screen.findByRole("list", { name: "contagens" })).toBeTruthy();
  });
});
