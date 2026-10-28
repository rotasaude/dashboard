import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, listNotifications: vi.fn() };
});
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { usePagedNotifications, type FirstPage } from "./usePagedNotifications";
import { notification } from "../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const page = (ids: string[], next: string | null): FirstPage =>
  ({ data: { notifications: ids.map((id) => notification({ id })), next_before: next }, dataUpdatedAt: 1 });

describe("usePagedNotifications", () => {
  beforeEach(() => mocked(api.listNotifications).mockReset());

  it("anexa a página pedida com o cursor e sem repetir a linha", async () => {
    mocked(api.listNotifications).mockResolvedValue({ notifications: [ notification({ id: "a" }), notification({ id: "b" }) ], next_before: null });
    const { result } = renderHook(() => usePagedNotifications(page([ "a" ], "c1"), { overdue: true }, "s"));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.rows.map((r) => r.id)).toEqual([ "a", "b" ]);
    expect(result.current.next).toBeNull();
    expect(mocked(api.listNotifications).mock.calls[0][0]).toEqual({ overdue: true, before: "c1" });
  });

  it("descarta a resposta atrasada de outro escopo, sucesso ou erro", async () => {
    let resolve!: (v: unknown) => void;
    mocked(api.listNotifications).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { result, rerender } = renderHook(({ scope }) => usePagedNotifications(page([ "a" ], "c1"), {}, scope), { initialProps: { scope: "s1" } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadMore(); });
    expect(result.current.more.busy).toBe(true);
    rerender({ scope: "s2" });
    expect(result.current.more.busy).toBe(false);
    await act(async () => { resolve({ notifications: [ notification({ id: "late" }) ], next_before: null }); await pending; });
    expect(result.current.rows.map((r) => r.id)).toEqual([ "a" ]);
    expect(result.current.next).toBe("c1");

    let reject!: (e: unknown) => void;
    mocked(api.listNotifications).mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    act(() => { pending = result.current.loadMore(); });
    rerender({ scope: "s3" });
    await act(async () => { reject(new ApiError(422, { error: "invalid_cursor" }, "x")); await pending; });
    expect(result.current.more.error).toBeNull();
    expect(result.current.more.busy).toBe(false);
  });

  it("erro da página aparece e libera o botão", async () => {
    mocked(api.listNotifications).mockReturnValueOnce(new Promise((_, reject) => setTimeout(() => reject(new ApiError(422, { error: "invalid_cursor" }, "x")), 0)));
    const { result } = renderHook(() => usePagedNotifications(page([ "a" ], "c1"), {}, "s"));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.more.error).toBe("a lista mudou — recarregue");
    expect(result.current.more.busy).toBe(false);
    expect(result.current.rows.map((r) => r.id)).toEqual([ "a" ]);
    expect(result.current.next).toBe("c1");
  });
});
