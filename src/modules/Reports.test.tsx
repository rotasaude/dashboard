import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScopeContext } from "../lib/scope";
import type { ReportRow } from "../lib/types";
import { Reports } from "./Reports";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () => new Response(
    body !== undefined ? JSON.stringify(body) : "",
    { status, headers: { "Content-Type": "application/json" } }
  ));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function envelope(reports: ReportRow[]) {
  return { data: { reports, total: reports.length }, as_of: "2026-09-26T12:00:00Z" };
}

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "r1", createdAt: "2026-09-20T15:30:00Z", tier: "alta",
    protocol: "resp · 3", expiresAt: "2026-10-20T15:30:00Z", live: true, ...overrides
  };
}

function renderReports() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScopeContext.Provider value={{ period: "7d", municipalityId: "m1", setPeriod: vi.fn() }}>
        <Reports />
      </ScopeContext.Provider>
    </QueryClientProvider>
  );
}

describe("Reports", () => {
  it("busca GET /admin/api/reports com o período do escopo", async () => {
    const fetchMock = stubFetch(200, envelope([]));
    renderReports();

    await screen.findByText("nenhum relatório no período");
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/admin/api/reports");
    expect(url.searchParams.get("period")).toBe("7d");
  });

  it("lista uma linha por relatório com tier, protocolo e status de expiração", async () => {
    stubFetch(200, envelope([
      row({ id: "r1", tier: "alta", protocol: "resp · 3", live: true }),
      row({ id: "r2", tier: null, protocol: "dor · 1", live: false })
    ]));
    renderReports();

    expect(await screen.findByText("resp · 3")).not.toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(3); // cabeçalho + 2
    expect(screen.getByText("dor · 1")).not.toBeNull();
    expect(screen.getByText("alta")).not.toBeNull();
    expect(screen.getByText("—")).not.toBeNull();
    expect(screen.getByText("ativo")).not.toBeNull();
    expect(screen.getByText("expirado")).not.toBeNull();
  });

  it("lista vazia mostra a mensagem de período sem relatórios", async () => {
    stubFetch(200, envelope([]));
    renderReports();

    expect(await screen.findByText("nenhum relatório no período")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("401 mostra ErrorState", async () => {
    stubFetch(401, { error: "unauthorized" });
    renderReports();

    expect(await screen.findByText("Falha ao carregar")).not.toBeNull();
    expect(screen.getByText(/^401 on /)).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("500 mostra ErrorState e 'tentar novamente' refaz a busca", async () => {
    const fetchMock = stubFetch(500);
    renderReports();

    expect(await screen.findByText("Falha ao carregar")).not.toBeNull();
    expect(screen.getByText(/^500 on /)).not.toBeNull();

    fireEvent.click(screen.getByText("tentar novamente"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
