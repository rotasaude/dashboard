import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real,
    fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
    listMemberships: vi.fn(), grantRole: vi.fn(), revokeMembership: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { Team } from "./Team";

afterEach(cleanup);

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function session(overrides: Partial<api.SessionUser> = {}): api.SessionUser {
  return {
    id: "u-admin", email_address: "admin@cidade.gov.br", operator: false,
    memberships: [ { municipality_id: "m1", municipality_name: "Curitiba", municipality_uf: "PR", role: "municipal_admin" } ],
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

describe("Team", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.listMemberships, api.grantRole, api.revokeMembership ]) {
      mocked(fn).mockReset();
    }
    mocked(api.fetchCurrentSession).mockResolvedValue(session());
  });

  it("lista uma linha por pessoa, com os papéis juntos", async () => {
    mocked(api.listMemberships).mockResolvedValue([
      membership("ana@cidade.gov.br", "municipal_admin"),
      membership("ana@cidade.gov.br", "protocol_publisher"),
      membership("bia@cidade.gov.br", "protocol_reviewer")
    ]);
    renderTeam();

    expect(await screen.findByText("ana@cidade.gov.br")).not.toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(3); // cabeçalho + 2 pessoas
    expect(screen.getByText("municipal_admin")).not.toBeNull();
    expect(screen.getByText("protocol_publisher")).not.toBeNull();
  });

  it("avisa quando a cidade tem menos de 2 revisores", async () => {
    mocked(api.listMemberships).mockResolvedValue([ membership("bia@cidade.gov.br", "protocol_reviewer") ]);
    renderTeam();

    expect(await screen.findByText("sem 2 revisores, nenhum protocolo é publicado ou ativado nesta cidade")).not.toBeNull();
  });

  it("com 2 revisores, some o aviso", async () => {
    mocked(api.listMemberships).mockResolvedValue([
      membership("ana@cidade.gov.br", "protocol_reviewer"),
      membership("bia@cidade.gov.br", "protocol_reviewer")
    ]);
    renderTeam();

    await screen.findByText("ana@cidade.gov.br");
    expect(screen.queryByText(/sem 2 revisores/)).toBeNull();
  });

  it("tornar revisor: confirma com a janela aberta e invalida a lista", async () => {
    mocked(api.listMemberships).mockResolvedValue([ membership("ana@cidade.gov.br", "protocol_publisher") ]);
    mocked(api.grantRole).mockResolvedValue(undefined);
    renderTeam();

    fireEvent.click(await screen.findByRole("button", { name: "Tornar revisor" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(api.grantRole).toHaveBeenCalledWith("u-ana@cidade.gov.br", "protocol_reviewer"));
    expect((await screen.findByRole("status")).textContent).toBe("ana@cidade.gov.br agora é revisor");
    await waitFor(() => expect(mocked(api.listMemberships).mock.calls.length).toBe(2));
  });

  it("remover revisor: manda o id da membership de revisor", async () => {
    mocked(api.listMemberships).mockResolvedValue([ membership("bia@cidade.gov.br", "protocol_reviewer", "m-9") ]);
    mocked(api.revokeMembership).mockResolvedValue(undefined);
    renderTeam();

    fireEvent.click(await screen.findByRole("button", { name: "Remover revisor" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(api.revokeMembership).toHaveBeenCalledWith("m-9"));
    expect((await screen.findByRole("status")).textContent).toBe("bia@cidade.gov.br não é mais revisor");
  });

  it("a recusa da API aparece no painel, que continua aberto", async () => {
    mocked(api.listMemberships).mockResolvedValue([ membership("ana@cidade.gov.br", "protocol_publisher") ]);
    mocked(api.grantRole).mockRejectedValue(new ApiError(422, { error: "already_granted", message: "papel já concedido" }, "422"));
    renderTeam();

    fireEvent.click(await screen.findByRole("button", { name: "Tornar revisor" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("papel já concedido")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar" })).not.toBeNull();
  });

  it("sem TOTP cadastrado, aponta para a Segurança", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_enrolled: false, mfa_verified_at: null }));
    mocked(api.listMemberships).mockResolvedValue([ membership("ana@cidade.gov.br", "protocol_publisher") ]);
    const { onNavigate } = renderTeam();

    fireEvent.click(await screen.findByRole("button", { name: "Tornar revisor" }));
    fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));

    expect(onNavigate).toHaveBeenCalledWith("security");
  });

  it("403 na listagem mostra a mensagem de papel", async () => {
    mocked(api.listMemberships).mockRejectedValue(new ApiError(403, "", "403"));
    renderTeam();

    expect(await screen.findByText("seu papel não permite esta ação")).not.toBeNull();
  });

  it("marca a linha da própria pessoa logada com (você)", async () => {
    mocked(api.listMemberships).mockResolvedValue([
      { id: "m-self", user: { id: "u-admin", email_address: "admin@cidade.gov.br" }, role: "municipal_admin", granted_at: "2026-09-01T00:00:00Z" },
      membership("ana@cidade.gov.br", "protocol_publisher")
    ]);
    renderTeam();

    expect(await screen.findByText("admin@cidade.gov.br (você)")).not.toBeNull();
    expect(screen.getByText("ana@cidade.gov.br")).not.toBeNull();
  });

  it("lista vazia mostra estado vazio", async () => {
    mocked(api.listMemberships).mockResolvedValue([]);
    renderTeam();

    expect(await screen.findByText("nenhuma pessoa com papel ativo")).not.toBeNull();
  });
});
