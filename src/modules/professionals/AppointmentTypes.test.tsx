// src/modules/professionals/AppointmentTypes.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listAppointmentTypes: vi.fn(), createAppointmentType: vi.fn(), updateAppointmentType: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { AppointmentTypes } from "./AppointmentTypes";
import { TYPES } from "../../test/schedulingFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<AppointmentTypes />, { wrapper });
}

describe("AppointmentTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.listAppointmentTypes).mockResolvedValue(TYPES);
  });

  it("lista nome, chave, duração, CBOs, origem e situação", async () => {
    renderIt();
    expect(await screen.findByText("Consulta médica")).not.toBeNull();
    expect(screen.getByText("consulta_medica")).not.toBeNull();
    expect(screen.getByText("20 min")).not.toBeNull();
    expect(screen.getByText("2251, 2252, 2253")).not.toBeNull();
    expect(screen.getAllByText("plataforma")).toHaveLength(3);
    expect(screen.getByText("cidade")).not.toBeNull();
    expect(screen.getByText("inativo")).not.toBeNull();
  });

  it("novo tipo: chave inválida trava o botão; válido manda o payload e relê a lista", async () => {
    mocked(api.createAppointmentType).mockResolvedValue({ ...TYPES[3], key: "pre_natal", active: true });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Novo tipo" }));
    fireEvent.change(screen.getByLabelText("Chave"), { target: { value: "Pre-natal" } });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Pré-natal" } });
    fireEvent.change(screen.getByLabelText("Duração (min)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Grupos de CBO"), { target: { value: "2235, 2251" } });
    expect((screen.getByRole("button", { name: "Salvar tipo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("chave: minúsculas, números e _, começando por letra (2 a 41)")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Chave"), { target: { value: "pre_natal" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tipo" }));
    await waitFor(() => expect(api.createAppointmentType).toHaveBeenCalledWith({
      key: "pre_natal", name: "Pré-natal", duration_minutes: 30, cbo_prefixes: [ "2235", "2251" ]
    }));
    await waitFor(() => expect(api.listAppointmentTypes).toHaveBeenCalledTimes(2));
  });

  it("key_taken aparece traduzido e o formulário continua aberto", async () => {
    mocked(api.createAppointmentType).mockRejectedValue(new ApiError(422, { error: "key_taken" }, "x"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Novo tipo" }));
    fireEvent.change(screen.getByLabelText("Chave"), { target: { value: "retorno" } });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Retorno" } });
    fireEvent.change(screen.getByLabelText("Duração (min)"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Grupos de CBO"), { target: { value: "2251" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tipo" }));
    expect(await screen.findByText("já existe um tipo com esta chave")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Salvar tipo" })).not.toBeNull();
  });

  it("tipo da plataforma: CBO travado, e salvar manda só nome e duração", async () => {
    mocked(api.updateAppointmentType).mockResolvedValue({ ...TYPES[0], duration_minutes: 25 });
    renderIt();
    await screen.findByText("Consulta médica");
    const row = screen.getByText("consulta_medica").closest("[role=row]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("Grupos de CBO") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Chave")).toBeNull();
    fireEvent.change(screen.getByLabelText("Duração (min)"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tipo" }));
    await waitFor(() => expect(api.updateAppointmentType).toHaveBeenCalledWith("consulta_medica",
      { name: "Consulta médica", duration_minutes: 25 }));
  });

  it("tipo da cidade manda os CBOs; desativar e reativar mandam só active", async () => {
    mocked(api.updateAppointmentType).mockResolvedValue(TYPES[3]);
    renderIt();
    await screen.findByText("Puericultura");
    const row = screen.getByText("puericultura").closest("[role=row]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Reativar" }));
    await waitFor(() => expect(api.updateAppointmentType).toHaveBeenCalledWith("puericultura", { active: true }));
    const medica = screen.getByText("consulta_medica").closest("[role=row]") as HTMLElement;
    fireEvent.click(within(medica).getByRole("button", { name: "Desativar" }));
    await waitFor(() => expect(api.updateAppointmentType).toHaveBeenCalledWith("consulta_medica", { active: false }));
    fireEvent.click(within(row).getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar tipo" }));
    await waitFor(() => expect(api.updateAppointmentType).toHaveBeenLastCalledWith("puericultura",
      { name: "Puericultura", duration_minutes: 30, cbo_prefixes: [ "2235" ] }));
  });
});
