import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";

vi.mock("qrcode", () => ({ toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QR") }));
vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), enrollMfa: vi.fn(), confirmMfa: vi.fn(), stepUpMfa: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { Security } from "./Security";

afterEach(cleanup);

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ENROLLMENT = { otpauth_uri: "otpauth://totp/Rota%20Sa%C3%BAde:ana?secret=JBSWY3DPEHPK3PXP&issuer=Rota%20Sa%C3%BAde",
                     recovery_codes: [ "aaaa111111", "bbbb222222" ] };

function session(overrides: Partial<api.SessionUser> = {}): api.SessionUser {
  return { id: "u1", email_address: "ana@cidade.gov.br", operator: false, memberships: [],
           mfa_enrolled: false, mfa_verified_at: null, ...overrides };
}

function renderSecurity() {
  function wrapper({ children }: { children: ReactNode }) {
    return <StrictMode><AuthProvider>{children}</AuthProvider></StrictMode>;
  }
  return render(<Security />, { wrapper });
}

describe("Security", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.enrollMfa, api.confirmMfa, api.stepUpMfa ]) mocked(fn).mockReset();
  });

  it("sem TOTP: nada é cadastrado sozinho, nem sob StrictMode", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session());
    renderSecurity();

    expect(await screen.findByRole("button", { name: "Cadastrar autenticador" })).not.toBeNull();
    expect(api.enrollMfa).not.toHaveBeenCalled();
  });

  it("cadastrar: uma chamada só, QR local, chave e códigos com aviso", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session());
    mocked(api.enrollMfa).mockResolvedValue(ENROLLMENT);
    renderSecurity();

    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar autenticador" }));

    expect(await screen.findByAltText("QR do autenticador")).toHaveProperty("src", "data:image/png;base64,QR");
    expect(api.enrollMfa).toHaveBeenCalledTimes(1);
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).not.toBeNull();
    expect(screen.getByText("aaaa111111")).not.toBeNull();
    expect(screen.getByText("Cada código vale como o autenticador, uma única vez. Guarde-os fora do computador.")).not.toBeNull();
  });

  it("confirmação só depois de 'guardei os códigos'; sucesso recarrega a sessão", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session());
    mocked(api.enrollMfa).mockResolvedValue(ENROLLMENT);
    mocked(api.confirmMfa).mockResolvedValue(undefined);
    renderSecurity();

    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar autenticador" }));
    await screen.findByAltText("QR do autenticador");
    expect(screen.queryByLabelText("Código do autenticador")).toBeNull();

    fireEvent.click(screen.getByLabelText("guardei os códigos"));
    mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_enrolled: true }));
    fireEvent.change(screen.getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cadastro" }));

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "autenticador ativo");
    expect(api.confirmMfa).toHaveBeenCalledWith("123456");
    expect(screen.queryByText("aaaa111111")).toBeNull();
  });

  it("código errado na confirmação: mensagem, campo limpo, cadastro continua na tela", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session());
    mocked(api.enrollMfa).mockResolvedValue(ENROLLMENT);
    mocked(api.confirmMfa).mockRejectedValue(new ApiError(422, { error: "invalid_code" }, "422"));
    renderSecurity();

    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar autenticador" }));
    await screen.findByAltText("QR do autenticador");
    fireEvent.click(screen.getByLabelText("guardei os códigos"));
    fireEvent.change(screen.getByLabelText("Código do autenticador"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cadastro" }));

    expect(await screen.findByText("código inválido — confira se o relógio do celular está certo")).not.toBeNull();
    expect((screen.getByLabelText("Código do autenticador") as HTMLInputElement).value).toBe("");
    expect(screen.getByAltText("QR do autenticador")).not.toBeNull();
  });

  it("com TOTP: trocar passa por step-up antes de cadastrar de novo", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_enrolled: true }));
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
    mocked(api.enrollMfa).mockResolvedValue(ENROLLMENT);
    mocked(api.confirmMfa).mockResolvedValue(undefined);
    renderSecurity();

    expect(await screen.findByText("Autenticador ativo.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Trocar autenticador" }));
    fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByAltText("QR do autenticador")).not.toBeNull();
    expect(mocked(api.stepUpMfa).mock.invocationCallOrder[0])
      .toBeLessThan(mocked(api.enrollMfa).mock.invocationCallOrder[0]);

    fireEvent.click(screen.getByLabelText("guardei os códigos"));
    fireEvent.change(screen.getByLabelText("Código do autenticador"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cadastro" }));

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "autenticador ativo");
    expect(api.confirmMfa).toHaveBeenCalledWith("654321");
  });

  it("trocar autenticador: recarrega a sessão logo depois do enroll, além do reload do próprio step-up", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_enrolled: true }));
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
    mocked(api.enrollMfa).mockResolvedValue(ENROLLMENT);
    renderSecurity();

    expect(await screen.findByText("Autenticador ativo.")).not.toBeNull();
    const callsBefore = mocked(api.fetchCurrentSession).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Trocar autenticador" }));
    fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await screen.findByAltText("QR do autenticador");
    // useStepUp().stepUp já recarrega a sessão (mfa_verified_at) sozinho — 1
    // chamada. O reload do enroll (D4) é uma SEGUNDA, por cima dessa.
    await waitFor(() => expect(mocked(api.fetchCurrentSession).mock.calls.length).toBe(callsBefore + 2));
  });

  it("trocar autenticador: avisa que o antigo já não vale, na confirmação e no cadastro em andamento", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session({ mfa_enrolled: true }));
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
    mocked(api.enrollMfa).mockResolvedValue(ENROLLMENT);
    renderSecurity();

    fireEvent.click(await screen.findByRole("button", { name: "Trocar autenticador" }));
    expect(await screen.findByText(
      "O autenticador atual deixa de valer assim que você confirmar esta etapa. Conclua o cadastro do novo sem sair da tela."
    )).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText(
      "Seu autenticador anterior já não vale — confirme o novo para voltar a aprovar ações."
    )).not.toBeNull();
    expect(screen.getByAltText("QR do autenticador")).not.toBeNull();
  });
});
