import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const adminFetch = vi.fn(async () => ({ data: {} }));
const countPending = vi.fn(async () => ({ pending: 0, has_more: false, denied: 0 }));
const countCriticals = vi.fn(async () => 0);
const listPending = vi.fn(async () => ({ orders: [], denied: [], next_before: null }));
let sessionUser: unknown = null;

vi.mock("./lib/api", async (importOriginal) => ({ ...(await importOriginal<object>()), adminFetch: (...a: unknown[]) => (adminFetch as (...x: unknown[]) => unknown)(...a),
  countPendingAcknowledgements: () => countPending(), countUnnotifiedCriticals: () => countCriticals(), listPendingAcknowledgements: () => listPending() }));
vi.mock("./lib/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({ state: { kind: "authenticated", user: sessionUser }, user: sessionUser, citySlug: "x", login: vi.fn(), logout: vi.fn(), reload: vi.fn() })
}));

import { App } from "./App";

const user = (role: string) => ({
  id: "u1", email_address: "a@b.c", operator: false, memberships: [ { role } ], mfa_enrolled: true, mfa_verified_at: null, features: [ "exam_tracking", "municipal_lab" ]
});
const mount = (initialModule?: import("./shell/modules").ModuleId) =>
  render(<QueryClientProvider client={new QueryClient()}><App initialModule={initialModule} /></QueryClientProvider>);

beforeEach(() => { adminFetch.mockClear(); countPending.mockClear(); listPending.mockClear(); countCriticals.mockClear(); countCriticals.mockResolvedValue(0); window.location.hash = ""; });
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
  it("o Início lê só a rota de contagem, nunca a lista, e mostra o número exato e os negados", async () => {
    sessionUser = user("health_professional");
    adminFetch.mockRejectedValue(new Error("offline"));
    countPending.mockResolvedValue({ pending: 73, has_more: true, denied: 1 });
    mount();
    expect(await screen.findByText("73 resultados aguardando sua ciência · 1 exame negado")).not.toBeNull();
    expect(countPending).toHaveBeenCalled();
    expect(listPending).not.toHaveBeenCalled();
  });
});

describe("aviso de críticos sem registro de aviso (módulo 21b)", () => {
  it("o liberador vê o aviso no Início quando há críticos", async () => {
    sessionUser = user("lab_releaser");
    adminFetch.mockRejectedValue(new Error("offline"));
    countCriticals.mockResolvedValue(2);
    mount();
    expect(await screen.findByText("2 valores críticos liberados sem registro de aviso")).not.toBeNull();
    expect(countCriticals).toHaveBeenCalled();
  });

  it("com zero, nada aparece", async () => {
    sessionUser = user("lab_releaser");
    adminFetch.mockRejectedValue(new Error("offline"));
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(countCriticals).toHaveBeenCalled();
    expect(screen.queryByText(/sem registro de aviso/)).toBeNull();
  });

  it("quem não é liberador não consulta a contagem", async () => {
    sessionUser = user("municipal_admin");
    adminFetch.mockRejectedValue(new Error("offline"));
    countCriticals.mockResolvedValue(5);
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(countCriticals).not.toHaveBeenCalled();
    expect(screen.queryByText(/sem registro de aviso/)).toBeNull();
  });

  it("com municipal_lab desligado, nem o liberador consulta", async () => {
    sessionUser = { ...user("lab_releaser"), features: [ "exam_tracking" ] };
    adminFetch.mockRejectedValue(new Error("offline"));
    countCriticals.mockResolvedValue(5);
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(countCriticals).not.toHaveBeenCalled();
    expect(screen.queryByText(/sem registro de aviso/)).toBeNull();
  });
});
