import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderPanel, stubResizeObserver, stubRoutes } from "../test/panelHarness";
import { Overview } from "./Overview";
import { Classification } from "./Classification";
import { Triages } from "./Triages";
import { Reports } from "./Reports";
import { Conversations } from "./Conversations";

// Módulo 11 (spec 2026-09-28 §5; decisão do usuário 2026-09-28): os 5
// painéis com cidadão levam o bairro da URL como neighborhood_id, para
// qualquer papel, e a chave de consulta muda com ele. A lista do seletor
// vem de GET /admin/api/neighborhoods.

const CENTRO = "11111111-1111-4111-8111-111111111111";
const SUMIU = "99999999-9999-4999-8999-999999999999";

const ROUTES = {
  "/neighborhoods": { neighborhoods: [ { id: CENTRO, name: "Centro", active: true } ] },
  "/overview": { kpis: [ { id: "done", label: "Triagens concluídas", value: 9, unit: "", delta: null, tone: "ok", spark: [], source: "live" } ] },
  "/classification": { tiers: [], tierKeys: [], urgent: 0, urgentMaxPriority: 1, urgentTrend: [], byProtocol: [], byMode: [], sampleTriages: [] },
  "/triages": { series: [], started: 0, completed: 0, completionRate: 0, byProtocol: [] },
  "/reports": { reports: [], total: 0 },
  "/conversations": { live: 0, funnel: [], exits: [], abandonRate: null, avgToCompleteMin: null, liveActive: { awaiting: 0, inProgress: 0 } },
  "/ingestion": { inboundSeries: [], inboundTotal: 0, ack: [], purge: { pending: 0, oldestH: 0, ttlH: 2160, overTtl: false } },
  "/queues": { queues: [], oldestPendingS: 0, failedExecutions: [], recurring: [] },
  "/events": { total: 0, retentionMonths: 12, replayAnchor: null, byType: [], stream: [], filters: [] },
  "/health": { projections: [], recurring: [], driftOverall: null }
};

function neighborhoodIds(fetchMock: ReturnType<typeof stubRoutes>, path: string): (string | null)[] {
  return fetchMock.mock.calls
    .map((c) => new URL(String((c as unknown[])[0])))
    .filter((u) => u.pathname === `/admin/api${path}`)
    .map((u) => u.searchParams.get("neighborhood_id"));
}

beforeEach(() => stubResizeObserver());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

const PANELS: Array<[ string, () => ReactElement ]> = [
  [ "/overview", () => <Overview /> ],
  [ "/classification", () => <Classification /> ],
  [ "/triages", () => <Triages /> ],
  [ "/reports", () => <Reports /> ],
  [ "/conversations", () => <Conversations /> ]
];

describe("filtro de bairro nos painéis", () => {
  it.each(PANELS)("%s leva o bairro da URL como neighborhood_id e mostra o seletor", async (path, element) => {
    window.history.replaceState(null, "", `/dashboard/?bairro=${CENTRO}`);
    const fetchMock = stubRoutes(ROUTES);
    renderPanel(element());
    await waitFor(() => expect(neighborhoodIds(fetchMock, path)).toContain(CENTRO));
    expect(await screen.findByLabelText("Bairro")).toBeTruthy();
  });

  it("escolher 'Sem bairro' refaz a busca com neighborhood_id=none", async () => {
    const fetchMock = stubRoutes(ROUTES);
    renderPanel(<Triages />);
    const picker = await screen.findByLabelText("Bairro") as HTMLSelectElement;
    await waitFor(() => expect(picker.disabled).toBe(false));
    fireEvent.change(picker, { target: { value: "none" } });
    await waitFor(() => expect(neighborhoodIds(fetchMock, "/triages")).toContain("none"));
    expect(new URLSearchParams(window.location.search).get("bairro")).toBe("none");
  });

  it("Visão geral: filas, saúde, eventos e ingestão não levam o bairro", async () => {
    window.history.replaceState(null, "", `/dashboard/?bairro=${CENTRO}`);
    const fetchMock = stubRoutes(ROUTES);
    renderPanel(<Overview />);
    await waitFor(() => expect(neighborhoodIds(fetchMock, "/overview")).toContain(CENTRO));
    for (const path of [ "/queues", "/health", "/events", "/ingestion", "/neighborhoods" ]) {
      expect(neighborhoodIds(fetchMock, path).every((id) => id === null)).toBe(true);
    }
  });

  it("bairro desconhecido na URL volta para Todos", async () => {
    window.history.replaceState(null, "", `/dashboard/?bairro=${SUMIU}`);
    const fetchMock = stubRoutes(ROUTES);
    renderPanel(<Triages />);
    await waitFor(() => expect(window.location.search).toBe(""));
    await waitFor(() => expect(neighborhoodIds(fetchMock, "/triages").at(-1)).toBeNull());
  });
});
