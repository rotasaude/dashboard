// Montagem comum dos testes de tela dos painéis do módulo 05: fetch por rota,
// envelope { data, as_of } e o escopo da cidade.
import type { ReactElement } from "react";
import { vi } from "vitest";
import { render, within, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScopeContext } from "../lib/scope";

// 12:00Z = 09:00:00 em America/Sao_Paulo (vitest.config.ts fixa o TZ).
export const AS_OF = "2026-09-27T12:00:00Z";
export const STAMP = "dados de 09:00:00";

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }

export function stubResizeObserver() {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
}

// routes: pathname → corpo `data`, ou número de status para erro.
export function stubRoutes(overrides: Record<string, unknown>) {
  // O seletor de bairro busca /neighborhoods em todo painel: lista vazia por padrão.
  const routes: Record<string, unknown> = { "/neighborhoods": { neighborhoods: [] }, ...overrides };
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://x").pathname.replace("/admin/api", "");
    const route = routes[path];
    if (typeof route === "number") return new Response("", { status: route });
    if (route === undefined) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ data: route, as_of: AS_OF }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function renderPanel(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ScopeContext.Provider value={{ period: "7d", citySlug: "m1", setPeriod: vi.fn() }}>
        {element}
      </ScopeContext.Provider>
    </QueryClientProvider>
  );
}

// A linha de KPIs já com os dados (o esqueleto de carregamento também é uma
// grade, sem carimbo). F-05.3: todo agregado mostra o carimbo da resposta.
export async function kpiRow() {
  const group = await waitFor(() => {
    const row = screen.getByRole("group", { name: "indicadores" });
    within(row).getByText(STAMP);
    return row;
  });
  return within(group);
}
