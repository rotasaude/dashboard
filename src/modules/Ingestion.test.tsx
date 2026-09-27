import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScopeContext } from "../lib/scope";
import type { IngestionData } from "../lib/types";
import { Ingestion } from "./Ingestion";

// Recharts (Sparkline/BarMini) usa ResizeObserver, que o jsdom não tem.
class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }

beforeEach(() => { vi.stubGlobal("ResizeObserver", NoopResizeObserver); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () => new Response(
    body !== undefined ? JSON.stringify(body) : "",
    { status, headers: { "Content-Type": "application/json" } }
  ));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function data(overrides: Partial<IngestionData> = {}): IngestionData {
  return {
    inboundSeries: [3, 5, 8],
    inboundTotal: 1234,
    ack: [
      { code: "delivered", label: "entregue", count: 80, tone: "ok" },
      { code: "failed", label: "falhou", count: 20, tone: "down" }
    ],
    // 30 dias de idade contra a retenção real do raw (90 dias).
    purge: { pending: 42, oldestH: 720, ttlH: 2160, overTtl: false },
    ...overrides
  };
}

function envelope(d: IngestionData) {
  return { data: d, as_of: "2026-09-27T12:00:00Z" };
}

function renderIngestion() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScopeContext.Provider value={{ period: "7d", municipalityId: "m1", setPeriod: vi.fn() }}>
        <Ingestion />
      </ScopeContext.Provider>
    </QueryClientProvider>
  );
}

describe("Ingestion", () => {
  it("busca GET /admin/api/ingestion com o período do escopo", async () => {
    const fetchMock = stubFetch(200, envelope(data()));
    renderIngestion();

    await screen.findByText("Mensagens recebidas (WhatsApp)");
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/admin/api/ingestion");
    expect(url.searchParams.get("period")).toBe("7d");
  });

  it("enquanto carrega mostra o esqueleto, sem KPIs", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderIngestion();

    expect(screen.getByText("Volume inbound")).not.toBeNull();
    expect(screen.queryByText("Mensagens recebidas (WhatsApp)")).toBeNull();
    expect(screen.queryByText("Falha ao carregar")).toBeNull();
  });

  it("500 mostra ErrorState e 'tentar novamente' refaz a busca", async () => {
    const fetchMock = stubFetch(500);
    renderIngestion();

    expect(await screen.findByText("Falha ao carregar")).not.toBeNull();
    fireEvent.click(screen.getByText("tentar novamente"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("caminho feliz: volume WhatsApp, ack e purga em dias contra 90 d", async () => {
    stubFetch(200, envelope(data()));
    renderIngestion();

    expect(await screen.findByText("Mensagens recebidas (WhatsApp)")).not.toBeNull();
    expect(screen.getByText("1.234")).not.toBeNull();
    expect(screen.getByText(/só o webhook do WhatsApp/)).not.toBeNull();

    const ack = screen.getByRole("img", { name: "entregue: 80, falhou: 20" });
    expect(ack).not.toBeNull();
    expect(screen.getByText("entregue")).not.toBeNull();
    expect(screen.getByText("falhou")).not.toBeNull();

    expect(screen.getByText("idade do raw mais antigo ainda não purgado vs retenção")).not.toBeNull();
    expect(screen.getByText("30d / 90d")).not.toBeNull();
    expect(screen.getByText("Dentro do TTL configurado")).not.toBeNull();
    expect(screen.queryByText(/purga atrasada/)).toBeNull();
  });

  it("não mostra o tile de Dedup", async () => {
    stubFetch(200, envelope(data()));
    renderIngestion();

    await screen.findByText("Mensagens recebidas (WhatsApp)");
    expect(screen.queryByText(/Dedup/)).toBeNull();
  });

  it("overTtl=true mostra o aviso de purga atrasada", async () => {
    stubFetch(200, envelope(data({ purge: { pending: 7, oldestH: 2400, ttlH: 2160, overTtl: true } })));
    renderIngestion();

    expect(await screen.findByText(/purga atrasada/)).not.toBeNull();
    expect(screen.getByText("100d / 90d")).not.toBeNull();
  });

  it("série vazia mostra 'sem mensagens no período'", async () => {
    stubFetch(200, envelope(data({ inboundSeries: [], inboundTotal: 0 })));
    renderIngestion();

    expect(await screen.findByText("sem mensagens no período")).not.toBeNull();
  });
});
