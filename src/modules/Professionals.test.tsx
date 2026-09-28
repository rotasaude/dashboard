import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listProfessionals: vi.fn(), listPendingProfessionals: vi.fn(),
    createProfessional: vi.fn(), getProfessional: vi.fn(), listProfessionalShifts: vi.fn(), listCbo: vi.fn(),
    listActiveUnits: vi.fn() };
});

// ProfessionalDetail (Task 4) ainda é um stub que renderiza `null`; para
// verificar "Vincular abre a ficha" sem depender da Task 4, trocamos por um
// dublê que expõe o `professionalId` recebido.
vi.mock("./professionals/ProfessionalDetail", () => ({
  ProfessionalDetail: ({ professionalId }: { professionalId: string }) => <div>ficha aberta: {professionalId}</div>
}));

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { Professionals } from "./Professionals";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<Professionals />, { wrapper });
}

describe("Professionals", () => {
  beforeEach(() => {
    // Os mocks do módulo persistem call history entre `it`s (não há reset
    // global no vitest.config.ts); sem isto, `createProfessional` de um
    // teste anterior "vaza" para o `.not.toHaveBeenCalled()` de outro.
    vi.clearAllMocks();
    mocked(api.fetchCurrentSession).mockResolvedValue({
      id: "u-admin", email_address: "admin@cidade.gov.br", operator: false, mfa_enrolled: true,
      mfa_verified_at: new Date().toISOString(),
      memberships: [ { municipality_id: "m1", municipality_name: "Curitiba", municipality_uf: "PR", role: "municipal_admin" } ]
    });
    mocked(api.listProfessionals).mockResolvedValue([ {
      id: "p1", user_id: "u1", email_address: "medica@c.gov.br", professional_name: "Helena Duarte", council: "CRM",
      council_state: "PR", registration_number: "12345", cns_masked: "*** **** **** 0005",
      links: [ { id: "l1", health_unit_id: "h1", unit_name: "UBS Jardim", cbo_code: "225125", cbo_title: "Médico clínico",
        started_at: "2026-09-01T12:00:00Z", started_by: "admin@c.gov.br", ended_at: null, ended_by: null } ]
    } ]);
    mocked(api.listPendingProfessionals).mockResolvedValue([
      { user_id: "u2", email_address: "novato@c.gov.br", status: "missing_profile" }
    ]);
  });

  it("lista perfis com vínculos ativos e o painel de pendência", async () => {
    renderIt();
    expect(await screen.findByText("Helena Duarte")).toBeTruthy();
    expect(screen.getByText("CRM-PR 12345")).toBeTruthy();
    expect(screen.getByText("UBS Jardim · Médico clínico")).toBeTruthy();
    expect(screen.getByText("novato@c.gov.br")).toBeTruthy();
    expect(screen.getByText("sem perfil")).toBeTruthy();
  });

  it("cadastra o perfil a partir da pendência", async () => {
    mocked(api.createProfessional).mockResolvedValue({ id: "p2" } as api.Professional);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar perfil" }));
    fireEvent.change(screen.getByLabelText("Nome profissional"), { target: { value: "Rafael Lima" } });
    fireEvent.change(screen.getByLabelText("Conselho"), { target: { value: "COREN" } });
    fireEvent.change(screen.getByLabelText("UF do conselho"), { target: { value: "PR" } });
    fireEvent.change(screen.getByLabelText("Número do registro"), { target: { value: "54321" } });
    fireEvent.change(screen.getByLabelText("CNS"), { target: { value: "7000 0000 0000 005" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await waitFor(() => expect(api.createProfessional).toHaveBeenCalledWith("u2", expect.objectContaining({
      professional_name: "Rafael Lima", council: "COREN", council_state: "PR", registration_number: "54321",
      cns: "700000000000005"
    })));
  });

  it("CNS inválido é recusado na tela, sem chamar a API", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar perfil" }));
    fireEvent.change(screen.getByLabelText("CNS"), { target: { value: "712345678901237" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("CNS"));
    expect(api.createProfessional).not.toHaveBeenCalled();
  });

  it("recusa da API aparece traduzida", async () => {
    mocked(api.createProfessional).mockRejectedValue(new ApiError(409, { error: "cns_taken" }, "x"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar perfil" }));
    fireEvent.change(screen.getByLabelText("Nome profissional"), { target: { value: "Rafael" } });
    fireEvent.change(screen.getByLabelText("Número do registro"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("CNS"), { target: { value: "700000000000005" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect(await screen.findByText("este CNS já está em outro perfil")).toBeTruthy();
  });

  it("Vincular com o perfil já na lista abre a ficha", async () => {
    mocked(api.listPendingProfessionals).mockResolvedValue([
      { user_id: "u1", email_address: "medica@c.gov.br", status: "missing_link" }
    ]);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Vincular" }));
    expect(await screen.findByText("ficha aberta: p1")).toBeTruthy();
  });

  it("Vincular sem o perfil na lista mostra alerta e recarrega as consultas", async () => {
    mocked(api.listPendingProfessionals).mockResolvedValue([
      { user_id: "u3", email_address: "fora-da-lista@c.gov.br", status: "missing_link" }
    ]);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Vincular" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("não encontrado"));
    await waitFor(() => expect(mocked(api.listProfessionals).mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(mocked(api.listPendingProfessionals).mock.calls.length).toBeGreaterThan(1));
  });

  it("falha ao ler pendências mostra um alerta, não silencia o painel", async () => {
    mocked(api.listPendingProfessionals).mockRejectedValue(new ApiError(500, "", "x"));
    renderIt();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "não foi possível concluir — tente de novo");
  });

  it("enquanto a lista carrega, não mostra 'nenhum profissional cadastrado'", async () => {
    let resolveList: (rows: api.Professional[]) => void = () => {};
    mocked(api.listProfessionals).mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    renderIt();
    await screen.findByText("novato@c.gov.br");
    expect(screen.queryByText("nenhum profissional cadastrado")).toBeNull();
    resolveList([]);
    expect(await screen.findByText("nenhum profissional cadastrado")).toBeTruthy();
  });

  it("falha ao ler a lista mostra a mensagem de erro, nunca a lista vazia", async () => {
    mocked(api.listProfessionals).mockRejectedValue(new ApiError(500, "", "x"));
    renderIt();
    expect(await screen.findByText("não foi possível concluir — tente de novo")).toBeTruthy();
    expect(screen.queryByText("nenhum profissional cadastrado")).toBeNull();
  });

  it("perfil sem vínculo ativo mostra a tag de pendência; o com vínculo ativo não mostra", async () => {
    mocked(api.listProfessionals).mockResolvedValue([
      {
        id: "p1", user_id: "u1", email_address: "medica@c.gov.br", professional_name: "Helena Duarte", council: "CRM",
        council_state: "PR", registration_number: "12345", cns_masked: "*** **** **** 0005",
        links: [ { id: "l1", health_unit_id: "h1", unit_name: "UBS Jardim", cbo_code: "225125", cbo_title: "Médico clínico",
          started_at: "2026-09-01T12:00:00Z", started_by: "admin@c.gov.br", ended_at: null, ended_by: null } ]
      },
      {
        id: "p3", user_id: "u3", email_address: "marcos@c.gov.br", professional_name: "Marcos Silva", council: "CRM",
        council_state: "PR", registration_number: "99999", cns_masked: "*** **** **** 0009",
        links: [ { id: "l2", health_unit_id: "h1", unit_name: "UBS Jardim", cbo_code: "225125", cbo_title: "Médico clínico",
          started_at: "2026-01-01T12:00:00Z", started_by: "admin@c.gov.br", ended_at: "2026-02-01T12:00:00Z", ended_by: "admin@c.gov.br" } ]
      }
    ]);
    renderIt();
    expect(await screen.findByText("Marcos Silva")).toBeTruthy();
    expect(screen.getByText("sem vínculo")).toBeTruthy();
  });
});
