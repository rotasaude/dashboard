import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const adminFetch = vi.fn(async () => ({ data: {} }));
const countPending = vi.fn(async () => ({ pending: 0, has_more: false, denied: 0 }));
const listPending = vi.fn(async () => ({ orders: [], denied: [], next_before: null }));
let sessionUser: unknown = null;

vi.mock("./lib/api", async (importOriginal) => ({ ...(await importOriginal<object>()), adminFetch: (...a: unknown[]) => (adminFetch as (...x: unknown[]) => unknown)(...a),
  countPendingAcknowledgements: () => countPending(), listPendingAcknowledgements: () => listPending() }));
vi.mock("./lib/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({ state: { kind: "authenticated", user: sessionUser }, user: sessionUser, citySlug: "x", login: vi.fn(), logout: vi.fn(), reload: vi.fn() })
}));

import { App } from "./App";

const user = (role: string) => ({
  id: "u1", email_address: "a@b.c", operator: false, memberships: [ { role } ], mfa_enrolled: true, mfa_verified_at: null, features: [ "exam_tracking" ]
});
const mount = (initialModule?: import("./shell/modules").ModuleId) =>
  render(<QueryClientProvider client={new QueryClient()}><App initialModule={initialModule} /></QueryClientProvider>);

beforeEach(() => { adminFetch.mockClear(); countPending.mockClear(); listPending.mockClear(); window.location.hash = ""; });
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

describe("contador de resultados aguardando ciência (A46)", () => {
  it("o Início lê só a rota de contagem, nunca a lista, e mostra 50+ e os negados", async () => {
    sessionUser = user("health_professional");
    adminFetch.mockRejectedValue(new Error("offline"));
    countPending.mockResolvedValue({ pending: 50, has_more: true, denied: 1 });
    mount();
    expect(await screen.findByText("50+ resultados aguardando sua ciência · 1 exame negado")).not.toBeNull();
    expect(countPending).toHaveBeenCalled();
    expect(listPending).not.toHaveBeenCalled();
  });
});
