// Redefinição de senha dentro da moldura de entrada da cidade (spec city-identity §5).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, resetPassword: vi.fn() };
});

import * as api from "../lib/api";
import type { CityIdentity } from "../lib/cityIdentity";
import { ResetPassword } from "./ResetPassword";

const CURITIBA: CityIdentity = {
  name: "Curitiba", uf: "PR", time_zone: "America/Sao_Paulo",
  health_department_name: "Secretaria Municipal da Saúde",
  coat_of_arms_url: "/city_identity/coat_of_arms?v=abc"
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubIdentity() {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/city_identity") return Promise.resolve(new Response(JSON.stringify(CURITIBA), { status: 200 }));
    throw new Error(`fetch inesperado: ${url}`);
  }));
}

describe("ResetPassword: moldura da cidade", () => {
  it("mostra o brasão da cidade e o rodapé da plataforma", async () => {
    stubIdentity();
    render(<ResetPassword token="t" />);
    expect(await screen.findByRole("img", { name: "Brasão de Curitiba" })).toBeTruthy();
    expect(screen.getByText("operado com Rota Saúde")).toBeTruthy();
    expect(screen.getByText("Redefinir senha", { selector: "h1" })).toBeTruthy();
  });

  it("segue redefinindo: senhas diferentes dão erro, iguais chamam a API", async () => {
    stubIdentity();
    vi.mocked(api.resetPassword).mockResolvedValue(undefined as never);
    render(<ResetPassword token="t" />);
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "abd" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
    expect((await screen.findByRole("alert")).textContent).toBe("As senhas não coincidem.");
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
    await waitFor(() => expect(api.resetPassword).toHaveBeenCalledWith("t", "abc", "abc"));
    expect(await screen.findByText("Senha redefinida com sucesso.")).toBeTruthy();
  });
});
