import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real,
    fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
    listMemberships: vi.fn(), grantRole: vi.fn(), revokeMembership: vi.fn(),
    inviteMember: vi.fn(), deactivateUser: vi.fn()
  };
});

import * as api from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { Team } from "./Team";

afterEach(cleanup);

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function session(overrides: Partial<api.SessionUser> = {}): api.SessionUser {
  return {
    id: "u-admin", email_address: "admin@cidade.gov.br", operator: false,
    memberships: [ { city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role: "municipal_admin" } ],
    mfa_enrolled: true, mfa_verified_at: new Date().toISOString(), ...overrides
  };
}

function membership(email: string, role: string, id = `${email}-${role}`) {
  return { id, user: { id: `u-${email}`, email_address: email }, role, granted_at: "2026-09-01T00:00:00Z" };
}

function renderTeam(onNavigate = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  }
  render(<Team onNavigate={onNavigate} />, { wrapper });
  return { onNavigate };
}

describe("Team em modo cartão", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session());
    mocked(api.listMemberships).mockResolvedValue([ membership("ana@cidade.gov.br", "municipal_admin") ]);
  });

  it("a coluna Papéis é par mesmo contendo o botão de perfil (não vai para as ações)", async () => {
    renderTeam();
    const tag = await screen.findByText("municipal_admin");
    const cell = tag.closest('[role="cell"]')!;
    expect(cell.getAttribute("data-label")).toBe("Papéis");
    expect(cell.getAttribute("data-card")).toBe("pair");
  });
});
