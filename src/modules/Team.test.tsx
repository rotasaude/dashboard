import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { Team } from "./Team";
import { fmtDateTime } from "../lib/format";

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
    for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.listMemberships, api.grantRole, api.revokeMembership, api.inviteMember, api.deactivateUser ]) {
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
    mocked(api.grantRole).mockRejectedValue(new ApiError(422, { error: "already_granted", message: "esta pessoa já tem o papel" }, "422"));
    renderTeam();

    fireEvent.click(await screen.findByRole("button", { name: "Tornar revisor" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("esta pessoa já tem o papel")).not.toBeNull();
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

  it("torna atendente com step-up e remove atendente", async () => {
    mocked(api.listMemberships).mockResolvedValue([
      membership("ana@cidade.gov.br", "viewer"),
      membership("bia@cidade.gov.br", "citizen_verifier", "m-bia")
    ]);
    mocked(api.grantRole).mockResolvedValue(undefined);
    mocked(api.revokeMembership).mockResolvedValue(undefined);
    renderTeam();

    fireEvent.click(await screen.findByRole("button", { name: "Tornar atendente" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.grantRole).toHaveBeenCalledWith("u-ana@cidade.gov.br", "citizen_verifier"));

    fireEvent.click(await screen.findByRole("button", { name: "Remover atendente" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.revokeMembership).toHaveBeenCalledWith("m-bia"));
  });

  it("torna profissional de saúde com step-up e remove profissional de saúde", async () => {
    mocked(api.listMemberships).mockResolvedValue([
      membership("ana@cidade.gov.br", "viewer"),
      membership("bia@cidade.gov.br", "health_professional", "m-bia-prof")
    ]);
    mocked(api.grantRole).mockResolvedValue(undefined);
    mocked(api.revokeMembership).mockResolvedValue(undefined);
    renderTeam();

    fireEvent.click(await screen.findByRole("button", { name: "Tornar profissional de saúde" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.grantRole).toHaveBeenCalledWith("u-ana@cidade.gov.br", "health_professional"));
    expect((await screen.findByRole("status")).textContent).toBe("ana@cidade.gov.br agora é profissional de saúde");

    fireEvent.click(await screen.findByRole("button", { name: "Remover profissional de saúde" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.revokeMembership).toHaveBeenCalledWith("m-bia-prof"));
    expect((await screen.findByRole("status")).textContent).toBe("bia@cidade.gov.br não é mais profissional de saúde");
  });
  it("marca 'sem vínculo' em quem tem o papel e não pode chamar", async () => {
    mocked(api.listMemberships).mockResolvedValue([
      { ...membership("medica@c.gov.br", "health_professional"), professional_status: "missing_link" }
    ]);
    renderTeam();
    expect(await screen.findByText("sem vínculo")).toBeTruthy();
  });

  it("'sem vínculo'/'sem perfil' leva à ficha do profissional, com aria-label nomeando o destino", async () => {
    mocked(api.listMemberships).mockResolvedValue([
      { ...membership("medica@c.gov.br", "health_professional"), professional_status: "missing_link" }
    ]);
    const { onNavigate } = renderTeam();
    fireEvent.click(await screen.findByRole("button", { name: "sem vínculo — abrir Profissionais" }));
    expect(onNavigate).toHaveBeenCalledWith("professionals");
  });

  describe("convidar e desativar", () => {
    const recent = () => new Date(Date.now() - 60_000).toISOString();
    const apiError = (status: number, body: unknown) => new ApiError(status, body, String(status));
    const invitation = { id: "i1", email: "novo@cidade.gov.br", role: "viewer", expires_at: "2026-10-04T15:00:00Z" };

    function fillInvite(email: string, role: string) {
      fireEvent.change(screen.getByLabelText("E-mail da pessoa"), { target: { value: email } });
      fireEvent.change(screen.getByLabelText("Papel"), { target: { value: role } });
      fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    }

    it("quem não é municipal_admin não vê o convite nem o Desativar", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session({
        memberships: [ { municipality_id: "m1", municipality_name: "Curitiba", municipality_uf: "PR", role: "viewer" } ]
      }));
      mocked(api.listMemberships).mockResolvedValue([ membership("ana@cidade.gov.br", "viewer") ]);
      renderTeam();

      await screen.findByText("ana@cidade.gov.br");
      expect(screen.queryByLabelText("E-mail da pessoa")).toBeNull();
      expect(screen.queryByRole("button", { name: "Convidar" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Desativar" })).toBeNull();
    });

    it("convida papel comum sem pedir código e mostra a validade do convite", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_verified_at: null }));
      mocked(api.listMemberships).mockResolvedValue([]);
      mocked(api.inviteMember).mockResolvedValue(invitation);
      renderTeam();

      await screen.findByLabelText("E-mail da pessoa");
      fillInvite(" novo@cidade.gov.br ", "viewer");
      expect(screen.queryByLabelText("Código do autenticador")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Enviar convite" }));

      await waitFor(() => expect(api.inviteMember).toHaveBeenCalledWith("novo@cidade.gov.br", "viewer"));
      expect(api.stepUpMfa).not.toHaveBeenCalled();
      expect((await screen.findByRole("status")).textContent)
        .toBe(`Convite enviado para novo@cidade.gov.br — válido até ${fmtDateTime(invitation.expires_at)}`);
    });

    it("papel privilegiado passa pelo step-up antes de convidar", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_verified_at: null }));
      mocked(api.listMemberships).mockResolvedValue([]);
      mocked(api.stepUpMfa).mockResolvedValue(undefined);
      mocked(api.inviteMember).mockResolvedValue({ ...invitation, role: "protocol_reviewer" });
      renderTeam();

      await screen.findByLabelText("E-mail da pessoa");
      fillInvite("novo@cidade.gov.br", "protocol_reviewer");
      fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "Enviar convite" }));

      await waitFor(() => expect(api.inviteMember).toHaveBeenCalledWith("novo@cidade.gov.br", "protocol_reviewer"));
      expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
      expect((await screen.findByRole("status")).textContent).toMatch(/^Convite enviado para novo@cidade.gov.br/);
    });

    it("mfa_required no convite pede o código e repete", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_verified_at: recent() }));
      mocked(api.listMemberships).mockResolvedValue([]);
      mocked(api.stepUpMfa).mockResolvedValue(undefined);
      mocked(api.inviteMember)
        .mockRejectedValueOnce(apiError(401, { error: "mfa_required" }))
        .mockResolvedValueOnce({ ...invitation, role: "municipal_admin" });
      renderTeam();

      await screen.findByLabelText("E-mail da pessoa");
      fillInvite("novo@cidade.gov.br", "municipal_admin");
      fireEvent.click(await screen.findByRole("button", { name: "Enviar convite" }));
      fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "654321" } });
      fireEvent.click(screen.getByRole("button", { name: "Enviar convite" }));

      await waitFor(() => expect(api.inviteMember).toHaveBeenCalledTimes(2));
      expect(api.stepUpMfa).toHaveBeenCalledWith("654321");
      expect((await screen.findByRole("status")).textContent).toMatch(/^Convite enviado/);
    });

    it("e-mail inválido é barrado antes de chamar a API", async () => {
      mocked(api.listMemberships).mockResolvedValue([]);
      renderTeam();

      await screen.findByLabelText("E-mail da pessoa");
      fillInvite("novo@cidade", "viewer");

      expect((await screen.findByRole("alert")).textContent).toBe("informe um e-mail válido");
      expect(screen.queryByRole("button", { name: "Enviar convite" })).toBeNull();
      expect(api.inviteMember).not.toHaveBeenCalled();
    });

    it.each([
      [ { error: "already_member" }, "Essa pessoa já faz parte da equipe" ],
      [ { error: "already_invited" }, "Já existe um convite pendente para esse e-mail" ],
      [ { error: "invalid", message: "papel desconhecido" }, "papel desconhecido" ]
    ])("recusa do convite %o vira frase clara", async (body, message) => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_verified_at: recent() }));
      mocked(api.listMemberships).mockResolvedValue([]);
      mocked(api.inviteMember).mockRejectedValue(apiError(422, body));
      renderTeam();

      await screen.findByLabelText("E-mail da pessoa");
      fillInvite("novo@cidade.gov.br", "viewer");
      fireEvent.click(screen.getByRole("button", { name: "Enviar convite" }));

      expect((await screen.findByRole("alert")).textContent).toBe(message);
    });

    it("convite sem a rota na API (404) mostra erro genérico, sem quebrar a tela", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_verified_at: recent() }));
      mocked(api.listMemberships).mockResolvedValue([]);
      mocked(api.inviteMember).mockRejectedValue(apiError(404, ""));
      renderTeam();

      await screen.findByLabelText("E-mail da pessoa");
      fillInvite("novo@cidade.gov.br", "viewer");
      fireEvent.click(screen.getByRole("button", { name: "Enviar convite" }));

      expect((await screen.findByRole("alert")).textContent).toBe("não foi possível concluir — tente de novo");
    });

    it("não oferece Desativar na linha da própria pessoa", async () => {
      mocked(api.listMemberships).mockResolvedValue([
        { id: "m-self", user: { id: "u-admin", email_address: "admin@cidade.gov.br" }, role: "municipal_admin", granted_at: "2026-09-01T00:00:00Z" },
        membership("ana@cidade.gov.br", "viewer")
      ]);
      renderTeam();

      await screen.findByText("admin@cidade.gov.br (você)");
      expect(screen.getAllByRole("button", { name: "Desativar" })).toHaveLength(1);
    });

    it("desativar confirma, exige step-up e relê a lista", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_verified_at: null }));
      mocked(api.listMemberships).mockResolvedValue([ membership("ana@cidade.gov.br", "viewer") ]);
      mocked(api.stepUpMfa).mockResolvedValue(undefined);
      mocked(api.deactivateUser).mockResolvedValue({ id: "u-ana@cidade.gov.br", deactivated_at: "2026-09-27T12:00:00Z" });
      renderTeam();

      fireEvent.click(await screen.findByRole("button", { name: "Desativar" }));
      expect(screen.getByText("Desativar ana@cidade.gov.br? A pessoa perde o acesso e as sessões abertas são encerradas.")).not.toBeNull();
      fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "111222" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirmar desativação" }));

      await waitFor(() => expect(api.deactivateUser).toHaveBeenCalledWith("u-ana@cidade.gov.br"));
      expect(api.stepUpMfa).toHaveBeenCalledWith("111222");
      expect((await screen.findByRole("status")).textContent).toBe("ana@cidade.gov.br foi desativado(a)");
      await waitFor(() => expect(mocked(api.listMemberships).mock.calls.length).toBe(2));
    });

    it("mfa_required na desativação pede o código e repete", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_verified_at: recent() }));
      mocked(api.listMemberships).mockResolvedValue([ membership("ana@cidade.gov.br", "viewer") ]);
      mocked(api.stepUpMfa).mockResolvedValue(undefined);
      mocked(api.deactivateUser)
        .mockRejectedValueOnce(apiError(401, { error: "mfa_required" }))
        .mockResolvedValueOnce({ id: "u-ana@cidade.gov.br", deactivated_at: "2026-09-27T12:00:00Z" });
      renderTeam();

      fireEvent.click(await screen.findByRole("button", { name: "Desativar" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar desativação" }));
      fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "333444" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirmar desativação" }));

      await waitFor(() => expect(api.deactivateUser).toHaveBeenCalledTimes(2));
      expect(api.stepUpMfa).toHaveBeenCalledWith("333444");
    });

    it.each([
      [ 422, { error: "cannot_deactivate_self" }, "Você não pode desativar o próprio acesso" ],
      [ 422, { error: "already_deactivated" }, "Essa pessoa já estava desativada" ],
      [ 404, "", "Usuário não encontrado" ]
    ])("recusa da desativação %i %o vira frase clara", async (status, body, message) => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_verified_at: recent() }));
      mocked(api.listMemberships).mockResolvedValue([ membership("ana@cidade.gov.br", "viewer") ]);
      mocked(api.deactivateUser).mockRejectedValue(apiError(status, body));
      renderTeam();

      fireEvent.click(await screen.findByRole("button", { name: "Desativar" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar desativação" }));

      expect((await screen.findByRole("alert")).textContent).toBe(message);
    });
  });
});
