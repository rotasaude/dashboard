import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {},
  fetchCurrentSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn()
}));

import { AuthProvider, useAuth } from "./auth";
import { cityTimeZone, setCityTimeZone } from "./format";
import * as api from "./api";

const USER = {
  id: "u1", email_address: "admin@curitiba.demo", operator: false,
  memberships: [{ city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role: "municipal_admin" }]
};

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe("AuthProvider", () => {
  it("boot sem sessão → anonymous", async () => {
    (api.fetchCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.kind).toBe("anonymous"));
    expect(result.current.citySlug).toBe(null);
  });

  it("login ok → authenticated + citySlug da membership", async () => {
    (api.fetchCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.login as ReturnType<typeof vi.fn>).mockResolvedValue(USER);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.kind).toBe("anonymous"));
    await act(async () => { await result.current.login("admin@curitiba.demo", "pw"); });
    expect(result.current.state.kind).toBe("authenticated");
    expect(result.current.citySlug).toBe("m1");
  });

  it("logout → anonymous", async () => {
    (api.fetchCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValue(USER);
    (api.logout as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.kind).toBe("authenticated"));
    await act(async () => { await result.current.logout(); });
    expect(result.current.state.kind).toBe("anonymous");
    expect(result.current.citySlug).toBe(null);
  });

  it("a sessão define o fuso da cidade usado na formatação (api#27)", async () => {
    setCityTimeZone(null);
    (api.fetchCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValue({ ...USER, time_zone: "America/Manaus" });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.kind).toBe("authenticated"));
    expect(cityTimeZone()).toBe("America/Manaus");

    (api.login as ReturnType<typeof vi.fn>).mockResolvedValue({ ...USER, time_zone: "America/Rio_Branco" });
    await act(async () => { await result.current.login("admin@curitiba.demo", "pw"); });
    expect(cityTimeZone()).toBe("America/Rio_Branco");
    setCityTimeZone(null);
  });
});
