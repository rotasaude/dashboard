// Login com a moldura de entrada (spec city-identity §5): a cidade à esquerda,
// o formulário à direita, e o comportamento de sempre (erros, grant expirado,
// esqueci a senha sem enumeração, gov.br) preservado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const login = vi.fn();
vi.mock("../lib/auth", () => ({ useAuth: () => ({ login }) }));
vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, requestPasswordReset: vi.fn(), startGovBr: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import type { CityIdentity } from "../lib/cityIdentity";
import { Login } from "./Login";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CURITIBA: CityIdentity = {
  name: "Curitiba", uf: "PR", time_zone: "America/Sao_Paulo",
  health_department_name: "Secretaria Municipal da Saúde",
  coat_of_arms_url: "/city_identity/coat_of_arms?v=abc"
};

// A identidade vem de GET /city_identity; as demais chamadas de rede do login
// passam pelos mocks de ../lib/api e ../lib/auth.
function identityFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/city_identity") return impl();
    throw new Error(`fetch inesperado: ${url}`);
  }));
}
const respondWith = (identity: CityIdentity) =>
  identityFetch(() => Promise.resolve(new Response(JSON.stringify(identity), { status: 200 })));

beforeEach(() => {
  login.mockReset();
  mocked(api.requestPasswordReset).mockReset();
  mocked(api.startGovBr).mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Login: identidade da cidade", () => {
  it("com identidade: brasão com alt, prefeitura, órgão, h1 e frase", async () => {
    respondWith(CURITIBA);
    render(<Login />);
    expect((await screen.findByRole("img", { name: "Brasão de Curitiba" })).getAttribute("src")).toBe("/city_identity/coat_of_arms?v=abc");
    expect(screen.getByText("Prefeitura de")).toBeTruthy();
    expect(screen.getByText("Curitiba · PR", { selector: ".entry-city-name" })).toBeTruthy();
    expect(screen.getByText("Secretaria Municipal da Saúde")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Entrar no painel de Curitiba" })).toBeTruthy();
    expect(screen.getByText(/Entre para começar o turno em/).textContent).toBe("Entre para começar o turno em Curitiba · PR.");
    expect(screen.getByText("operado com Rota Saúde")).toBeTruthy();
  });

  it("sem brasão: ícone da marca no lugar, nenhum img de brasão", async () => {
    respondWith({ ...CURITIBA, coat_of_arms_url: null });
    render(<Login />);
    await screen.findByText("Curitiba · PR", { selector: ".entry-city-name" });
    expect(screen.queryByRole("img", { name: /Brasão/ })).toBeNull();
    expect(document.querySelector(".entry-crest [data-brand-mark]")).not.toBeNull();
  });

  it("brasão que falha ao carregar (storage fora): troca pelo ícone da marca", async () => {
    respondWith(CURITIBA);
    render(<Login />);
    const img = await screen.findByRole("img", { name: "Brasão de Curitiba" });
    fireEvent.error(img);
    expect(screen.queryByRole("img", { name: "Brasão de Curitiba" })).toBeNull();
    expect(document.querySelector(".entry-crest [data-brand-mark]")).not.toBeNull();
    expect(screen.getByText("Curitiba · PR", { selector: ".entry-city-name" })).toBeTruthy();
  });

  it("sem órgão: a linha não aparece", async () => {
    respondWith({ ...CURITIBA, health_department_name: null });
    render(<Login />);
    await screen.findByText("Curitiba · PR", { selector: ".entry-city-name" });
    expect(screen.queryByText(/Secretaria/)).toBeNull();
    expect(document.querySelector(".entry-dept")).toBeNull();
  });

  it("sem UF: só o nome", async () => {
    respondWith({ ...CURITIBA, uf: null });
    render(<Login />);
    expect((await screen.findByText(/Entre para começar o turno em/)).textContent).toBe("Entre para começar o turno em Curitiba.");
  });

  it("fetch pendurado: o formulário está utilizável no primeiro render", () => {
    identityFetch(() => new Promise(() => {}));
    render(<Login />);
    expect(document.activeElement).toBe(screen.getByLabelText("E-mail"));
    expect((screen.getByRole("button", { name: "Entrar" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeTruthy();
    expect(screen.getByText("Entre para começar o turno.")).toBeTruthy();
    expect(screen.queryByText("Prefeitura de")).toBeNull();
    expect(screen.getByText("operado com Rota Saúde")).toBeTruthy();
  });

  it("fetch rejeitado: igual ao pendurado e sem role=alert", async () => {
    identityFetch(() => Promise.reject(new Error("rede")));
    render(<Login />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeTruthy();
    expect(screen.getByText("Entre para começar o turno.")).toBeTruthy();
    expect(screen.queryByText("Prefeitura de")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Login: saudação de turno", () => {
  it("saudação no fuso da cidade (08:00Z em São Paulo = Bom dia.)", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
    respondWith(CURITIBA);
    render(<Login />);
    await screen.findByText("Curitiba · PR", { selector: ".entry-city-name" });
    expect(screen.getByText("Bom dia.")).toBeTruthy();
  });

  it("usa o fuso da cidade, não o do navegador (01:00Z em Tóquio = Bom dia.)", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-10-19T01:00:00Z"));
    respondWith({ ...CURITIBA, time_zone: "Asia/Tokyo" });
    render(<Login />);
    await screen.findByText("Curitiba · PR", { selector: ".entry-city-name" });
    expect(screen.getByText("Bom dia.")).toBeTruthy();
  });

  it("a saudação não é o h1", async () => {
    respondWith(CURITIBA);
    render(<Login />);
    await screen.findByText("Curitiba · PR", { selector: ".entry-city-name" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/^(Bom dia|Boa tarde|Boa noite)\.$/).tagName).toBe("P");
  });
});

describe("Login: fluxos de sempre", () => {
  beforeEach(() => identityFetch(() => new Promise(() => {})));

  function fill(email = "ana@cidade.gov.br", password = "senha") {
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  }

  it("credencial inválida", async () => {
    login.mockRejectedValue(new ApiError(401, null, "x"));
    render(<Login />);
    fill();
    expect((await screen.findByRole("alert")).textContent).toBe("E-mail ou senha inválidos.");
    expect(login).toHaveBeenCalledWith("ana@cidade.gov.br", "senha");
  });

  it("erro genérico", async () => {
    login.mockRejectedValue(new Error("rede"));
    render(<Login />);
    fill();
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível entrar. Tente novamente.");
  });

  it("grant expirado", () => {
    render(<Login expiredGrant />);
    expect(screen.getByRole("alert").textContent).toBe("O link de entrada expirou (vale 60 segundos). Entre com e-mail e senha, ou peça um novo acesso.");
  });

  it("esqueci a senha: mesma mensagem com ou sem conta, e volta ao login", async () => {
    mocked(api.requestPasswordReset).mockRejectedValue(new ApiError(404, null, "x"));
    render(<Login />);
    fireEvent.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
    expect(screen.getByRole("heading", { level: 1, name: "Esqueci minha senha" })).toBeTruthy();
    expect(screen.getByText("operado com Rota Saúde")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "x@y.z" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar link" }));
    expect(await screen.findByText("Se o e-mail existir, enviamos um link para redefinir a senha.")).toBeTruthy();
    expect(api.requestPasswordReset).toHaveBeenCalledWith("x@y.z");
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao login" }));
    expect(screen.getByRole("button", { name: "Entrar" })).toBeTruthy();
  });

  it("gov.br indisponível", async () => {
    mocked(api.startGovBr).mockRejectedValue(new Error("fora"));
    render(<Login />);
    fireEvent.click(screen.getByRole("button", { name: "Entrar com gov.br" }));
    expect((await screen.findByRole("alert")).textContent).toBe("gov.br indisponível no momento. Entre com e-mail e senha.");
  });
});
