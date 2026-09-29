import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, previewAudience: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError, type Audience } from "../../lib/api";
import { AudienceCounter, previewAllowsSend, previewText } from "./AudienceCounter";
import { useAudiencePreview } from "./useAudiencePreview";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const byNeighborhoods = (...ids: string[]): Audience =>
  ({ version: 1, geo: { scope: "neighborhoods", neighborhood_ids: ids }, clinical: { all: [] } });

// R-P8: UM QueryClient por teste (cache estável durante o teste todo).
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAudiencePreview", () => {
  beforeEach(() => {
    mocked(api.previewAudience).mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("público incompleto nunca chama a API", () => {
    const { result } = renderHook(() => useAudiencePreview(null, 30), { wrapper });
    expect(result.current).toEqual({ kind: "incomplete" });
    expect(api.previewAudience).not.toHaveBeenCalled();
  });

  it("só a última versão do público vai à API", async () => {
    mocked(api.previewAudience).mockResolvedValue({ citizens: 12, phones: 9 });
    const { result, rerender } = renderHook(({ a }) => useAudiencePreview(a, 30),
      { wrapper, initialProps: { a: byNeighborhoods("n1") } });
    await waitFor(() => expect(result.current).toEqual({ kind: "ok", citizens: 12, phones: 9 }));
    mocked(api.previewAudience).mockClear();

    rerender({ a: byNeighborhoods("n1", "n2") });
    rerender({ a: byNeighborhoods("n1", "n2", "n3") });
    await waitFor(() => expect(result.current.kind).toBe("ok"));
    expect(api.previewAudience).toHaveBeenCalledTimes(1);
    expect(api.previewAudience).toHaveBeenCalledWith(byNeighborhoods("n1", "n2", "n3"));
  });

  it("público mudou depois da contagem: volta a calculando até a nova chave assentar", async () => {
    mocked(api.previewAudience).mockResolvedValue({ citizens: 12, phones: 9 });
    const { result, rerender } = renderHook(({ a }) => useAudiencePreview(a, 30),
      { wrapper, initialProps: { a: byNeighborhoods("n1") } });
    await waitFor(() => expect(result.current.kind).toBe("ok"));

    rerender({ a: byNeighborhoods("n1", "n2") });
    expect(result.current).toEqual({ kind: "loading" });
    expect(previewAllowsSend(result.current)).toBe(false);
  });

  it("below_minimum e erro da API", async () => {
    mocked(api.previewAudience).mockResolvedValueOnce({ below_minimum: true });
    const first = renderHook(() => useAudiencePreview(byNeighborhoods("n1"), 30), { wrapper });
    await waitFor(() => expect(first.result.current).toEqual({ kind: "below_minimum" }));

    mocked(api.previewAudience).mockRejectedValueOnce(
      new ApiError(422, { error: "invalid_audience", details: [ { path: "/geo/neighborhood_ids/0", message: "inactive_or_unknown" } ] }, "422"));
    const second = renderHook(() => useAudiencePreview(byNeighborhoods("n9"), 30), { wrapper });
    await waitFor(() => expect(second.result.current)
      .toEqual({ kind: "error", message: "há bairro ou unidade inativa no recorte — desmarque ou troque" }));
  });
});

describe("AudienceCounter", () => {
  it("frases de cada estado", () => {
    expect(previewText({ kind: "ok", citizens: 1234, phones: 987 }, null)).toBe("≈ 1.234 pessoas (987 telefones)");
    expect(previewText({ kind: "below_minimum" }, null)).toBe("menos de 5 — ajuste o público");
    expect(previewText({ kind: "loading" }, null)).toBe("calculando…");
    expect(previewText({ kind: "incomplete" }, "escolha ao menos um bairro")).toBe("complete o público: escolha ao menos um bairro");
    expect(previewText({ kind: "error", message: "falhou" }, null)).toBe("falhou");
  });

  it("só 'ok' libera o envio", () => {
    expect(previewAllowsSend({ kind: "ok", citizens: 5, phones: 5 })).toBe(true);
    for (const s of [ { kind: "loading" }, { kind: "below_minimum" }, { kind: "incomplete" } ] as const) {
      expect(previewAllowsSend(s)).toBe(false);
    }
  });

  it("renderiza como status nomeado", () => {
    render(<AudienceCounter state={{ kind: "below_minimum" }} problem={null} />);
    expect(screen.getByRole("status", { name: "Contagem do público" }).textContent).toBe("menos de 5 — ajuste o público");
  });
});
