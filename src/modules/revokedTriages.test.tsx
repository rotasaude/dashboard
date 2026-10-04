import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { ClassificationData, EventsData, HealthData, IngestionData, OverviewData, QueuesData, SmallCount } from "../lib/types";
import { kpiRow, renderPanel, stubResizeObserver, stubRoutes } from "../test/panelHarness";
import { Overview } from "./Overview";
import { Classification } from "./Classification";

// api#34: triagem revogada pelo cidadão não entra nas concluídas nem nos
// tiers; os painéis mostram só a contagem do período, à parte, sem linha.

beforeEach(() => stubResizeObserver());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const kpi = (id: string, label: string, value: number, unit = "") =>
  ({ id, label, value, unit, delta: null, tone: "ok", spark: [], source: "live" as const });

function overview(revoked?: SmallCount): OverviewData {
  return {
    kpis: [
      kpi("done", "Triagens concluídas", 42),
      kpi("active", "Conversas ativas agora", 7),
      kpi("urgent", "Casos urgentes", 3),
      kpi("completion", "Taxa de conclusão", 81.5, "%"),
      kpi("failed", "Jobs falhados abertos", 0)
    ],
    ...(revoked === undefined ? {} : { revoked })
  };
}

const ingestion: IngestionData = { inboundSeries: [], inboundTotal: 0, ack: [], purge: { pending: 0, oldestH: 0, ttlH: 2160, overTtl: false } };
const queues: QueuesData = { queues: [], oldestPendingS: 0, failedExecutions: [], recurring: [] };
const events: EventsData = { total: 0, retentionMonths: 12, replayAnchor: null, byType: [], stream: [], filters: [] };
const health: HealthData = { projections: [], recurring: [], driftOverall: 0 };
const conversations = { live: 0, funnel: [], exits: [], abandonRate: null, avgToCompleteMin: null, liveActive: { awaiting: 0, inProgress: 0 } };

function renderOverview(revoked?: SmallCount) {
  stubRoutes({ "/overview": overview(revoked), "/ingestion": ingestion, "/queues": queues, "/events": events,
               "/health": health, "/conversations": conversations });
  renderPanel(<Overview />);
}

function classification(revoked?: SmallCount): ClassificationData {
  return {
    tiers: [ { key: "alta", label: "alta", count: 7, tone: "down" } ],
    tierKeys: [ "alta" ],
    urgent: 7,
    urgentMaxPriority: 1,
    urgentTrend: [],
    byProtocol: [],
    byMode: [],
    sampleTriages: [],
    ...(revoked === undefined ? {} : { revoked })
  };
}

function renderClassification(revoked?: SmallCount) {
  stubRoutes({ "/classification": classification(revoked) });
  renderPanel(<Classification />);
}

describe("Visão geral — revogadas à parte (api#34)", () => {
  it("mostra a contagem de revogadas do período junto do card de concluídas", async () => {
    renderOverview(6);
    const row = await kpiRow();
    expect(row.getByText("Revogadas no período: 6")).toBeTruthy();
  });

  it("contagem suprimida aparece com o marcador de contagem oculta", async () => {
    renderOverview({ suppressed: true });
    const row = await kpiRow();
    expect(row.getByText("Revogadas no período: < 5")).toBeTruthy();
  });

  it("api antiga, sem o campo: nada de revogadas, e o painel não quebra", async () => {
    renderOverview();
    const row = await kpiRow();
    expect(row.getByText("Triagens concluídas")).toBeTruthy();
    expect(row.queryByText(/Revogadas no período/)).toBeNull();
  });
});

describe("Classificação — revogadas à parte (api#34)", () => {
  const HINT = "Triagens revogadas pelo cidadão não entram nas concluídas nem nos tiers.";

  it("mostra a contagem de revogadas do período com a explicação", async () => {
    renderClassification(6);
    const row = await kpiRow();
    expect(row.getByText("Revogadas no período")).toBeTruthy();
    expect(row.getByText("6")).toBeTruthy();
    expect(row.getByText(HINT)).toBeTruthy();
  });

  it("contagem suprimida aparece com o marcador de contagem oculta", async () => {
    renderClassification({ suppressed: true });
    const row = await kpiRow();
    expect(row.getByText("Revogadas no período")).toBeTruthy();
    expect(row.getByText("< 5")).toBeTruthy();
  });

  it("api antiga, sem o campo: nada de revogadas, e o painel não quebra", async () => {
    renderClassification();
    const row = await kpiRow();
    expect(row.getByText("Tier alta")).toBeTruthy();
    expect(row.queryByText("Revogadas no período")).toBeNull();
  });
});
