import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), acceptInvitation: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { AcceptInvitation } from "./AcceptInvitation";

afterEach(cleanup);

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const STRONG = "senha-bem-longa-1";

function renderAccept() {
  const onDone = vi.fn();
  function wrapper({ children }: { children: ReactNode }) {
    return <AuthProvider>{children}</AuthProvider>;
  }
  render(<AcceptInvitation token="tok-1" onDone={onDone} />, { wrapper });
  return { onDone };
}

function submit(password: string, confirmation = password) {
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("AcceptInvitation", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(null);
    mocked(api.acceptInvitation).mockReset();
  });

  it("aceita com token e senha, recarrega a sessão e segue", async () => {
    mocked(api.acceptInvitation).mockResolvedValue(undefined);
    const { onDone } = renderAccept();

    submit(STRONG);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.acceptInvitation).toHaveBeenCalledWith("tok-1", STRONG);
    expect(mocked(api.fetchCurrentSession).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("senhas diferentes param antes da API", async () => {
    renderAccept();

    submit(STRONG, `${STRONG}x`);

    expect((await screen.findByRole("alert")).textContent).toBe("As senhas não conferem.");
    expect(api.acceptInvitation).not.toHaveBeenCalled();
  });

  it("senha com menos de 12 caracteres para antes da API", async () => {
    renderAccept();

    submit("curta-11chr");

    expect((await screen.findByRole("alert")).textContent).toBe("A senha precisa ter pelo menos 12 caracteres.");
    expect(api.acceptInvitation).not.toHaveBeenCalled();
  });

  it.each([
    [ "expired", "Este convite expirou. Peça um novo convite a quem convidou você." ],
    [ "already_member", "Você já faz parte da equipe desta cidade. Entre com seu e-mail e senha." ],
    [ "weak_password", "A senha precisa ter pelo menos 12 caracteres." ],
    [ "invalid_token", "Convite inválido ou expirado. Peça um novo convite a quem convidou você." ]
  ])("recusa 422 %s vira frase clara", async (code, message) => {
    mocked(api.acceptInvitation).mockRejectedValue(new ApiError(422, { error: code }, "422"));
    const { onDone } = renderAccept();

    submit(STRONG);

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("429 pede para esperar", async () => {
    mocked(api.acceptInvitation).mockRejectedValue(new ApiError(429, { error: "too_many_requests" }, "429"));
    renderAccept();

    submit(STRONG);

    expect((await screen.findByRole("alert")).textContent).toBe("Muitas tentativas. Tente novamente em alguns minutos.");
  });
});
