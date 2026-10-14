import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const adminFetch = vi.fn(async () => ({ data: {} }));
let sessionUser: unknown = null;

vi.mock("./lib/api", async (importOriginal) => ({ ...(await importOriginal<object>()), adminFetch: (...a: unknown[]) => (adminFetch as (...x: unknown[]) => unknown)(...a) }));
vi.mock("./lib/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({ state: { kind: "authenticated", user: sessionUser }, user: sessionUser, citySlug: "x", login: vi.fn(), logout: vi.fn(), reload: vi.fn() })
}));

import { App } from "./App";

const user = (role: string) => ({
  id: "u1", email_address: "a@b.c", operator: false, memberships: [ { role } ], mfa_enrolled: true, mfa_verified_at: null, features: [ "exam_tracking" ]
});
const mount = (initialModule?: Parameters<typeof App>[0]["initialModule"]) =>
  render(<QueryClientProvider client={new QueryClient()}><App initialModule={initialModule} /></QueryClientProvider>);

beforeEach(() => { adminFetch.mockClear(); window.location.hash = ""; });
afterEach(cleanup);

describe("shell do prestador de exames", () => {
  it("sem sino e sem requisição de filas/saúde", async () => {
    sessionUser = user("exam_provider");
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /Notificações/ })).toBeNull();
    expect(adminFetch).not.toHaveBeenCalled();
  });

  it("o retorno do OAuth (initialModule) não leva o prestador a outra tela", () => {
    sessionUser = user("exam_provider");
    mount("overview");
    expect(window.location.hash).not.toBe("#/overview");
    expect(window.location.hash).not.toContain("overview");
  });

  it("quem não é prestador continua com o sino", () => {
    sessionUser = user("municipal_admin");
    mount();
    expect(screen.queryByRole("button", { name: /Notificações/ })).not.toBeNull();
  });
});
