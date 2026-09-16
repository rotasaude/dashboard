import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode, createElement, type ReactNode } from "react";

vi.mock("./api", () => ({
  redeemGrant: vi.fn()
}));

import { useGrantEntry } from "./use_grant_entry";
import * as api from "./api";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

beforeEach(() => vi.clearAllMocks());

describe("useGrantEntry", () => {
  it("redime o grant uma única vez sob StrictMode e chama onSettled(true)", async () => {
    (api.redeemGrant as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    const onSettled = vi.fn();

    renderHook(() => useGrantEntry({ kind: "grant", token: "tok-1" }, onSettled), { wrapper });

    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(api.redeemGrant).toHaveBeenCalledTimes(1);
    expect(api.redeemGrant).toHaveBeenCalledWith("tok-1");
    expect(onSettled).toHaveBeenCalledWith(true);
  });

  it("grant inválido: uma única POST, hook falha e onSettled(false)", async () => {
    (api.redeemGrant as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("invalid_grant"));
    const onSettled = vi.fn();

    const { result } = renderHook(() => useGrantEntry({ kind: "grant", token: "tok-2" }, onSettled), { wrapper });

    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(api.redeemGrant).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(false);
    expect(result.current).toBe(true);
  });
});
