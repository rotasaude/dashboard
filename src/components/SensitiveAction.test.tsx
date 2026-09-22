import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { SensitiveAction } from "./SensitiveAction";

afterEach(cleanup);

const fetchSession = api.fetchCurrentSession as unknown as ReturnType<typeof vi.fn>;
const stepUpMfa = api.stepUpMfa as unknown as ReturnType<typeof vi.fn>;

function session(overrides: Partial<api.SessionUser> = {}): api.SessionUser {
  return {
    id: "u1", email_address: "ana@cidade.gov.br", operator: false, memberships: [],
    mfa_enrolled: true, mfa_verified_at: null, ...overrides
  };
}
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const apiError = (status: number, body: unknown) => new ApiError(status, body, String(status));

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

function renderAction(props: Partial<Parameters<typeof SensitiveAction>[0]> = {}) {
  // Cast: every caller passes a vi.fn() for `run` (default here, or explicit
  // in the test), so this is always a Mock at runtime — the cast just gives
  // TS that back, since the prop's declared type (a plain function) doesn't
  // carry `.mock`.
  const run = (props.run ?? vi.fn().mockResolvedValue(undefined)) as ReturnType<typeof vi.fn>;
  const onDone = props.onDone ?? vi.fn();
  render(
    <SensitiveAction title="Assinar publicação" requiresStepUp run={run} onDone={onDone} onCancel={vi.fn()} {...props} />,
    { wrapper }
  );
  return { run, onDone };
}

const codeField = () => screen.queryByLabelText("Código do autenticador") as HTMLInputElement | null;
const confirm = () => screen.getByRole("button", { name: "Confirmar" });

describe("SensitiveAction", () => {
  beforeEach(() => { fetchSession.mockReset(); stepUpMfa.mockReset(); });

  it("janela fechada: pede o código, faz step-up e depois roda a ação", async () => {
    fetchSession.mockResolvedValue(session());
    const { run, onDone } = renderAction();
    await waitFor(() => expect(codeField()).not.toBeNull());

    stepUpMfa.mockResolvedValue(undefined);
    fireEvent.change(codeField()!, { target: { value: "123456" } });
    fireEvent.click(confirm());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(stepUpMfa).toHaveBeenCalledWith("123456");
    expect(run).toHaveBeenCalledTimes(1);
    expect(stepUpMfa.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
  });

  it("janela aberta: não pede código, mostra o tempo e roda direto", async () => {
    fetchSession.mockResolvedValue(session({ mfa_verified_at: minutesAgo(1) }));
    const { run, onDone } = renderAction();
    expect(await screen.findByText("verificação válida por mais 4 min")).not.toBeNull();
    expect(codeField()).toBeNull();

    fireEvent.click(confirm());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(stepUpMfa).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("sem autenticador: não oferece confirmar e aponta para a Segurança", async () => {
    fetchSession.mockResolvedValue(session({ mfa_enrolled: false }));
    const onGoToSecurity = vi.fn();
    renderAction({ onGoToSecurity });

    expect(await screen.findByText("Esta ação exige um autenticador cadastrado.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "cadastre seu autenticador" }));
    expect(onGoToSecurity).toHaveBeenCalled();
  });

  it("ação sem step-up: nunca pede código", async () => {
    fetchSession.mockResolvedValue(session({ mfa_enrolled: false }));
    const { run } = renderAction({ requiresStepUp: false });
    await waitFor(() => expect(fetchSession).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(codeField()).toBeNull();
  });

  it("código inválido: mensagem no campo, campo limpo, ação não roda", async () => {
    fetchSession.mockResolvedValue(session());
    const { run } = renderAction();
    await waitFor(() => expect(codeField()).not.toBeNull());

    stepUpMfa.mockRejectedValue(apiError(422, { error: "invalid_code" }));
    fireEvent.change(codeField()!, { target: { value: "000000" } });
    fireEvent.click(confirm());

    expect(await screen.findByText("código inválido")).not.toBeNull();
    expect(codeField()!.value).toBe("");
    expect(run).not.toHaveBeenCalled();
  });

  it("mfa_required da ação: pede novo código e repete UMA vez; na segunda, para", async () => {
    fetchSession.mockResolvedValue(session({ mfa_verified_at: minutesAgo(1) }));
    const run = vi.fn().mockRejectedValue(apiError(401, { error: "mfa_required" }));
    renderAction({ run });
    await screen.findByText("verificação válida por mais 4 min");

    fireEvent.click(confirm());
    expect(await screen.findByText("sua verificação expirou — informe um novo código")).not.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);

    stepUpMfa.mockResolvedValue(undefined);
    fireEvent.change(codeField()!, { target: { value: "123456" } });
    fireEvent.click(confirm());

    expect(await screen.findByText("a verificação não foi aceita — recarregue a página e tente de novo")).not.toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("campo de código do step-up aceita recovery code (sem inputMode numeric)", async () => {
    fetchSession.mockResolvedValue(session());
    renderAction();
    await waitFor(() => expect(codeField()).not.toBeNull());

    expect(codeField()!.getAttribute("inputMode")).toBeNull();
  });

  it("aviso de verificação expirada some quando a tentativa seguinte falha com invalid_code", async () => {
    fetchSession.mockResolvedValue(session({ mfa_verified_at: minutesAgo(1) }));
    const run = vi.fn().mockRejectedValueOnce(apiError(401, { error: "mfa_required" }));
    renderAction({ run });
    await screen.findByText("verificação válida por mais 4 min");

    fireEvent.click(confirm());
    expect(await screen.findByText("sua verificação expirou — informe um novo código")).not.toBeNull();

    stepUpMfa.mockRejectedValue(apiError(422, { error: "invalid_code" }));
    fireEvent.change(codeField()!, { target: { value: "000000" } });
    fireEvent.click(confirm());

    expect(await screen.findByText("código inválido")).not.toBeNull();
    expect(screen.queryByText("sua verificação expirou — informe um novo código")).toBeNull();
  });

  it("recusa do domínio: mensagem da API no painel, que continua aberto", async () => {
    fetchSession.mockResolvedValue(session({ mfa_verified_at: minutesAgo(1) }));
    const run = vi.fn().mockRejectedValue(apiError(422, { error: "insufficient_signatures", message: "falta 1 assinatura" }));
    const { onDone } = renderAction({ run });
    await screen.findByText("verificação válida por mais 4 min");

    fireEvent.click(confirm());

    expect(await screen.findByText("falta 1 assinatura")).not.toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    expect(confirm()).not.toBeNull();
  });

  it("403: seu papel não permite", async () => {
    fetchSession.mockResolvedValue(session({ mfa_verified_at: minutesAgo(1) }));
    renderAction({ run: vi.fn().mockRejectedValue(apiError(403, "")) });
    await screen.findByText("verificação válida por mais 4 min");

    fireEvent.click(confirm());

    expect(await screen.findByText("seu papel não permite esta ação")).not.toBeNull();
  });

  it("campo obrigatório vazio e código vazio não chegam à rede", async () => {
    fetchSession.mockResolvedValue(session());
    const { run } = renderAction({ fields: [ { name: "reason", label: "Motivo", required: true } ] });
    await waitFor(() => expect(codeField()).not.toBeNull());

    fireEvent.click(confirm());

    expect(await screen.findByText("preencha: Motivo")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "regra errada" } });
    fireEvent.click(confirm());
    expect(await screen.findByText("informe o código do autenticador")).not.toBeNull();
    expect(stepUpMfa).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  // D3 — enquanto a ação está em voo (busy), o botão Confirmar fica
  // desabilitado E precisa parecer desabilitado.
  it("Confirmar parece desabilitado enquanto a ação está em voo", async () => {
    fetchSession.mockResolvedValue(session({ mfa_verified_at: minutesAgo(1) }));
    let resolveRun!: () => void;
    const run = vi.fn().mockReturnValue(new Promise<void>((resolve) => { resolveRun = resolve; }));
    renderAction({ run });
    await screen.findByText("verificação válida por mais 4 min");

    fireEvent.click(confirm());

    await waitFor(() => expect((confirm() as HTMLButtonElement).disabled).toBe(true));
    expect((confirm() as HTMLButtonElement).style.opacity).toBe("0.55");
    expect((confirm() as HTMLButtonElement).style.cursor).toBe("not-allowed");

    resolveRun();
  });

  it("passa os campos para a ação", async () => {
    fetchSession.mockResolvedValue(session({ mfa_verified_at: minutesAgo(1) }));
    const { run } = renderAction({ fields: [ { name: "reason", label: "Motivo", required: true } ] });
    await screen.findByText("verificação válida por mais 4 min");

    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "  regra errada " } });
    fireEvent.click(confirm());

    await waitFor(() => expect(run).toHaveBeenCalledWith({ reason: "  regra errada " }));
  });
});
