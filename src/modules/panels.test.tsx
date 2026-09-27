import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ConsentData, EventsData, HealthData, QueuesData, TriagesData } from "../lib/types";
import { kpiRow, renderPanel, STAMP, stubResizeObserver, stubRoutes } from "../test/panelHarness";
import { Consent } from "./Consent";
import { Triages } from "./Triages";
import { Queues } from "./Queues";
import { Events } from "./Events";
import { Health } from "./Health";

// Módulo 05 — telas de leitura: cada painel busca o seu endpoint, mostra os
// números da resposta e carimba a linha de KPIs e cada agregado com o as_of
// (F-05.3, ADR 0022).

beforeEach(() => stubResizeObserver());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const consent: ConsentData = {
  given: 12, revoked: 3, declined: null,
  byVersion: [ { version: "v2", given: 9, share: 75 }, { version: "v1", given: 3, share: 25 } ],
  revocationsSeries: [ 0, 1, 2 ]
};

const triages: TriagesData = {
  series: [ 1, 2, 3 ], started: 8, completed: 6, completionRate: 75,
  byProtocol: [ { version: "resp · 2", count: 6, share: 75, status: "active" } ]
};

const queues: QueuesData = {
  queues: [
    { name: "urgent", urgent: true, depth: 2, oldestS: 90, running: 0, scheduled: 0, failed: 0, tone: "down" },
    { name: "reports", urgent: false, depth: 3, oldestS: 5, running: 1, scheduled: 0, failed: 1, tone: "warn" }
  ],
  oldestPendingS: 90,
  failedExecutions: [ { jobClass: "GenerateReportJob", queue: "reports", error: "boom", attempts: null, at: "10:00", ref: null } ],
  recurring: []
};

const events: EventsData = {
  total: 4, retentionMonths: 12, replayAnchor: { seq: "evt_id=1", at: "2026-09-01T00:00:00Z" },
  byType: [ { name: "triage.completed", count: 4 } ],
  stream: [ { at: "2026-09-27T11:00:00Z", name: "triage.completed", actor: "sistema", ref: "triage_id=t-1", muni: null } ],
  filters: [ "todos", "triage.*" ]
};

const health: HealthData = {
  projections: [ { name: "dashboard_metrics", updatedAt: "2026-09-27T11:50:00Z", driftMin: 10, thresholdMin: 30, status: "ok" } ],
  recurring: [], driftOverall: 10
};

describe("Consent (F-05.7)", () => {
  it("mostra concedidos e revogados, recusa sem registro na web, e carimba os KPIs", async () => {
    stubRoutes({ "/consent": consent });
    renderPanel(<Consent />);

    const row = await kpiRow();
    expect(row.getByText("12")).toBeTruthy();
    expect(row.getByText("3")).toBeTruthy();
    expect(row.getByText("sem registro na web")).toBeTruthy();
    expect(row.getByText(STAMP)).toBeTruthy();
    expect(screen.getByText("v2")).toBeTruthy();
  });
});

describe("Triages (F-05.8)", () => {
  it("mostra iniciadas, concluídas e taxa, com a quebra por versão e o carimbo", async () => {
    const fetchMock = stubRoutes({ "/triages": triages });
    renderPanel(<Triages />);

    const row = await kpiRow();
    expect(row.getByText("8")).toBeTruthy();
    expect(row.getByText("6")).toBeTruthy();
    expect(row.getByText(STAMP)).toBeTruthy();
    expect(screen.getByText("resp · 2")).toBeTruthy();
    expect(new URL(String((fetchMock.mock.calls[0] as unknown[])[0])).searchParams.get("period")).toBe("7d");
  });

  it("mostra o erro da API sem quebrar a tela", async () => {
    stubRoutes({ "/triages": 500 });
    renderPanel(<Triages />);

    expect(await screen.findByRole("button", { name: /tentar/i })).toBeTruthy();
  });
});

describe("Queues (F-05.11)", () => {
  it("soma profundidade e falhas das filas e carimba os KPIs", async () => {
    stubRoutes({ "/queues": queues });
    renderPanel(<Queues />);

    const row = await kpiRow();
    expect(row.getByText("5")).toBeTruthy();
    expect(row.getByText("1")).toBeTruthy();
    expect(row.getByText(STAMP)).toBeTruthy();
    expect(screen.getByText("GenerateReportJob")).toBeTruthy();
  });
});

describe("Events (F-05.12)", () => {
  it("mostra o total, a retenção e o stream só com referências, com o carimbo", async () => {
    stubRoutes({ "/events": events });
    renderPanel(<Events />);

    const row = await kpiRow();
    expect(row.getByText("4")).toBeTruthy();
    expect(row.getByText("12")).toBeTruthy();
    expect(row.getByText(STAMP)).toBeTruthy();
    expect(screen.getByText("triage_id=t-1")).toBeTruthy();
  });
});

describe("Health", () => {
  it("mostra o drift da projeção e carimba os KPIs", async () => {
    stubRoutes({ "/health": health });
    renderPanel(<Health />);

    const row = await kpiRow();
    expect(row.getByText("10")).toBeTruthy();
    expect(row.getByText(STAMP)).toBeTruthy();
    expect(screen.getByText("dashboard_metrics")).toBeTruthy();
  });
});
