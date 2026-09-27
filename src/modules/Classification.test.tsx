import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScopeContext } from "../lib/scope";
import type { ClassificationData, TrailStep } from "../lib/types";
import { Classification } from "./Classification";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const classification: ClassificationData = {
  tiers: [ { key: "high", label: "high", count: 1, tone: "down" } ],
  byProtocol: [],
  priorityTrue: 0,
  priorityTrend: [],
  byMode: [],
  sampleTriages: [
    { id: "t1-0000000000000", tier: "alta", priority: true, mode: "weighted", protocol: "triage-respiratoria · 1", at: "09:10" }
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
      <ScopeContext.Provider value={{ period: "7d", municipalityId: "m1", setPeriod: vi.fn() }}>
        <Classification />
      </ScopeContext.Provider>
    </QueryClientProvider>
  );
}

const at = "2026-09-27T09:10:00Z";

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
