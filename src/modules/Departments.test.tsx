// Setores da secretaria (módulo 33; F-33.1): do municipal_admin, sem o interruptor da ouvidoria (Q12); nunca se apaga setor.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { ombudsmanUser } from "../test/ombudsmanFixtures";
import * as api from "../lib/api";
import { ApiError, type SessionUser } from "../lib/api";
import { OMBUDSMAN_ERRORS, OMBUDSMAN_NO_ROLE } from "../lib/ombudsman";
import { Departments } from "./Departments";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listDepartments: vi.fn(),
  createDepartment: vi.fn(), updateDepartment: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const DEP1: api.Department = { id: "dep1", name: "Assistência Farmacêutica", active: true };

function mount(user: SessionUser, list: api.Department[] = [ DEP1 ]) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.listDepartments).mockResolvedValue(list);
  return renderWithProviders(<Departments />);
}

describe("setores da secretaria", () => {
  it("admin cria, renomeia e desativa; nome repetido dá a frase; não há apagar", async () => {
    vi.mocked(api.createDepartment).mockRejectedValueOnce(new ApiError(409, { error: "name_taken" }, "x"));
    vi.mocked(api.updateDepartment).mockResolvedValue({ ...DEP1, active: false });
    mount(ombudsmanUser([ "municipal_admin" ]));
    fireEvent.change(await screen.findByLabelText("Nome do setor"), { target: { value: "assistência farmacêutica" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar setor" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.name_taken)).not.toBeNull();
    expect(api.createDepartment).toHaveBeenCalledWith("assistência farmacêutica");
    fireEvent.click(screen.getByRole("button", { name: "Desativar Assistência Farmacêutica" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.updateDepartment).toHaveBeenCalledWith("dep1", { name: "Assistência Farmacêutica", active: false }));
    expect(screen.queryByRole("button", { name: /Apagar|Excluir/ })).toBeNull();
  });

  it("não depende do interruptor da ouvidoria (Q12)", async () => {
    mount(ombudsmanUser([ "municipal_admin" ], []));
    expect(await screen.findByText("Assistência Farmacêutica")).not.toBeNull();
    expect(screen.queryByText(/desligada/)).toBeNull();
  });

  it("nome com 1 caractere não sai; criar limpa o campo e relê a lista", async () => {
    vi.mocked(api.createDepartment).mockResolvedValue({ id: "dep2", name: "Regulação", active: true });
    mount(ombudsmanUser([ "municipal_admin" ]), []);
    const field = await screen.findByLabelText("Nome do setor");
    fireEvent.change(field, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar setor" }));
    expect(api.createDepartment).not.toHaveBeenCalled();
    expect(screen.getByText("o nome tem de ter de 2 a 80 caracteres")).not.toBeNull();
    expect(field.getAttribute("maxlength")).toBeNull();
    fireEvent.change(field, { target: { value: "  Regulação " } });
    const calls = vi.mocked(api.listDepartments).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Adicionar setor" }));
    await waitFor(() => expect(api.createDepartment).toHaveBeenCalledWith("Regulação"));
    await waitFor(() => expect((field as HTMLInputElement).value).toBe(""));
    await waitFor(() => expect(vi.mocked(api.listDepartments).mock.calls.length).toBeGreaterThan(calls));
  });

  it("duplo clique em Adicionar manda uma vez", async () => {
    let resolve!: (d: api.Department) => void;
    vi.mocked(api.createDepartment).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    mount(ombudsmanUser([ "municipal_admin" ]), []);
    fireEvent.change(await screen.findByLabelText("Nome do setor"), { target: { value: "Regulação" } });
    const add = screen.getByRole("button", { name: "Adicionar setor" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(api.createDepartment).toHaveBeenCalledTimes(1);
    resolve({ id: "dep2", name: "Regulação", active: true });
    await waitFor(() => expect((screen.getByLabelText("Nome do setor") as HTMLInputElement).value).toBe(""));
  });

  it("renomeia (1 caractere não sai) e reativa setor desativado", async () => {
    vi.mocked(api.updateDepartment).mockImplementation(async (id, i) => ({ id, ...i }));
    mount(ombudsmanUser([ "municipal_admin" ]), [ DEP1, { id: "dep3", name: "Vigilância", active: false } ]);
    fireEvent.click(await screen.findByRole("button", { name: "Renomear Assistência Farmacêutica" }));
    const input = screen.getByLabelText("Novo nome de Assistência Farmacêutica");
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
    expect(api.updateDepartment).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Farmácia central" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
    await waitFor(() => expect(api.updateDepartment).toHaveBeenCalledWith("dep1", { name: "Farmácia central", active: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Reativar Vigilância" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.updateDepartment).toHaveBeenCalledWith("dep3", { name: "Vigilância", active: true }));
  });

  it("sem o papel de admin, a frase e nenhuma leitura", async () => {
    mount(ombudsmanUser([ "ombudsman" ]));
    expect(await screen.findByText(OMBUDSMAN_NO_ROLE)).not.toBeNull();
    expect(api.listDepartments).not.toHaveBeenCalled();
  });
});
