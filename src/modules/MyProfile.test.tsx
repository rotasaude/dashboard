import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, getMyProfessional: vi.fn(), updateMyProfessional: vi.fn() };
});

import * as api from "../lib/api";
import { MyProfile } from "./MyProfile";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MyProfile />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

describe("MyProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.getMyProfessional).mockResolvedValue({
      professional: { id: "p1", user_id: "u1", email_address: "medica@c.gov.br", professional_name: "Helena Duarte",
        council: "CRM", council_state: "PR", registration_number: "12345", cns_masked: "*** **** **** 0005",
        cns: "700000000000005", phone: null, contact_email: null },
      links: [ { id: "l1", health_unit_id: "h1", unit_name: "UBS Jardim", cbo_code: "225125", cbo_title: "Médico clínico",
        started_at: "2026-09-01T12:00:00Z", started_by: "a", ended_at: null, ended_by: null } ],
      shifts: []
    });
  });

  it("mostra dados conferidos só para leitura, com CNS mascarado", async () => {
    renderIt();
    expect(await screen.findByText("CRM-PR 12345")).toBeTruthy();
    expect(screen.getByText("*** **** **** 0005")).toBeTruthy();
    expect(screen.queryByText("700000000000005")).toBeNull();
    expect(screen.getByText("UBS Jardim · Médico clínico")).toBeTruthy();
    expect(screen.queryByLabelText("CNS")).toBeNull();
    expect(screen.queryByLabelText("Conselho")).toBeNull();
  });

  it("edita só nome e contato", async () => {
    mocked(api.updateMyProfessional).mockResolvedValue({} as api.Professional);
    renderIt();
    fireEvent.change(await screen.findByLabelText("Telefone profissional"), { target: { value: "41998765432" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.updateMyProfessional).toHaveBeenCalledWith({
      professional_name: "Helena Duarte", phone: "41998765432", contact_email: null
    }));
  });

  it("sem perfil: orienta a procurar a administração", async () => {
    mocked(api.getMyProfessional).mockResolvedValue(null);
    renderIt();
    expect(await screen.findByText("Seu cadastro profissional ainda não foi feito. Fale com a administração da cidade.")).toBeTruthy();
  });
});
