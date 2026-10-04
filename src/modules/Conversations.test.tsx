import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScopeContext } from "../lib/scope";
import type { ConversationsData, Suppressed } from "../lib/types";
import { SUPPRESSED_HINT } from "../lib/smallCount";
import { Conversations } from "./Conversations";

// F-02.9 — painel Conversas: funil dos estados ativos, saídas por desfecho
// terminal e taxa de abandono (GET /admin/api/conversations).

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

function data(overrides: Partial<ConversationsData> = {}): ConversationsData {
  return {
    live: 7,
    funnel: [
      { key: "greeting", label: "greeting", count: 0, tone: "neutral" },
      { key: "awaiting_consent", label: "awaiting_consent", count: 3, tone: "info" },
      { key: "consented", label: "consented", count: 4, tone: "ok" }
    ],
    exits: [
      { key: "completed", label: "completed", count: 10, tone: "ok" },
      { key: "abandoned", label: "abandoned", count: 5, tone: "warn" },
      { key: "declined", label: "declined", count: 2, tone: "neutral" },
      { key: "cancelled", label: "cancelled", count: 0, tone: "neutral" },
      { key: "revoked", label: "revoked", count: 1, tone: "warn" }
    ],
    abandonRate: 20,
    avgToCompleteMin: 6.5,
    liveActive: { awaiting: 3, inProgress: 4 },
    ...overrides
  } as ConversationsData;
}

function envelope(d: ConversationsData) {
  return { data: d, as_of: "2026-09-27T12:00:00Z" };
}

function renderConversations() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScopeContext.Provider value={{ period: "7d", citySlug: "m1", setPeriod: vi.fn() }}>
        <Conversations />
      </ScopeContext.Provider>
    </QueryClientProvider>
  );
}

const callsTo = (fetchMock: ReturnType<typeof vi.fn>, pathname: string) =>
  fetchMock.mock.calls.map((c) => new URL(String((c as unknown[])[0]))).filter((u) => u.pathname === pathname);

describe("Conversations", () => {
  it("busca GET /admin/api/conversations com o período do escopo", async () => {
    const fetchMock = stubFetch(200, envelope(data()));
    renderConversations();

    await screen.findByText("Conversas ativas agora");
    const url = callsTo(fetchMock, "/admin/api/conversations")[0];
    expect(url.pathname).toBe("/admin/api/conversations");
    expect(url.searchParams.get("period")).toBe("7d");
  });

  it("mostra as saídas por desfecho terminal, não só revoked", async () => {
    stubFetch(200, envelope(data()));
    renderConversations();

    const exits = await screen.findByRole("img", {
      name: "completed: 10, abandoned: 5, declined: 2, cancelled: 0, revoked: 1"
    });
    expect(exits).not.toBeNull();
    expect(screen.getByText("desfecho das conversas iniciadas no período")).not.toBeNull();
    expect(screen.queryByText(/revoked como proxy/)).toBeNull();
  });

  it("mostra a taxa de abandono quando há conversas no período", async () => {
    stubFetch(200, envelope(data()));
    renderConversations();

    await screen.findByText("Taxa de abandono");
    expect(screen.getByText(/abandono:/)).not.toBeNull();
  });

  it("sem conversas no período, a taxa de abandono fica em branco", async () => {
    stubFetch(200, envelope(data({ abandonRate: null })));
    renderConversations();

    await screen.findByText("Taxa de abandono");
    expect(screen.queryByText(/abandono:/)).toBeNull();
  });

  it("sem saídas no período mostra 'nenhuma saída registrada'", async () => {
    const empty = data().exits.map((e) => ({ ...e, count: 0 }));
    stubFetch(200, envelope(data({ exits: empty })));
    renderConversations();

    expect(await screen.findByText("nenhuma saída registrada")).not.toBeNull();
  });

  it("500 mostra ErrorState e 'tentar novamente' refaz a busca", async () => {
    const fetchMock = stubFetch(500);
    renderConversations();

    expect(await screen.findByText("Falha ao carregar")).not.toBeNull();
    fireEvent.click(screen.getByText("tentar novamente"));
    await waitFor(() => expect(callsTo(fetchMock, "/admin/api/conversations")).toHaveLength(2));
  });

  it("com bairro: suprimido vira '< 5' e o funil com categoria suprimida vira lista", async () => {
    const s: Suppressed = { suppressed: true };
    stubFetch(200, envelope(data({
      live: s,
      funnel: [
        { key: "greeting", label: "greeting", count: 0, tone: "neutral" },
        { key: "awaiting_consent", label: "awaiting_consent", count: s, tone: "info" }
      ],
      abandonRate: s,
      liveActive: { awaiting: s, inProgress: 7 }
    })));
    renderConversations();

    await screen.findByText("Conversas ativas agora");
    expect(screen.getAllByText("< 5").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("oculto").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTitle(SUPPRESSED_HINT).length).toBeGreaterThanOrEqual(4);
    expect(within(screen.getByRole("region", { name: "Funil FSM" })).getByRole("list", { name: "contagens" })).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("taxa de abandono suprimida com o resto visível: 'oculto', sem NaN nem undefined", async () => {
    stubFetch(200, envelope(data({ abandonRate: { suppressed: true } })));
    renderConversations();

    await screen.findByText("Conversas ativas agora");
    expect(screen.getAllByText("oculto").length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
    expect(within(screen.getByRole("region", { name: "Funil FSM" })).queryByRole("list", { name: "contagens" })).toBeNull();
  });
});
