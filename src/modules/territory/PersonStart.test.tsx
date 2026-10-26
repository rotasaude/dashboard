// src/modules/territory/PersonStart.test.tsx
// Passo 1 da ficha individual (Task 12): quem é a pessoa. Com CPF, a busca
// pelo CPF (L3, sem envelope; 404 = ninguém; 409 = par só declarado); sem
// CPF, a busca de possíveis duplicados ANTES de criar (decisão 2).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), lookupTerritoryPerson: vi.fn(), findDuplicates: vi.fn() };
});

import * as api from "../../lib/api";
import { PersonStart } from "./PersonStart";
import { renderWithProviders } from "../../test/campaignFixtures";
import { TODAY24, territoryUser } from "../../test/territoryFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.lookupTerritoryPerson, api.findDuplicates ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser());
});

function fillNoCpf() {
  fireEvent.click(screen.getByLabelText("Não tem CPF"));
  typeIn("Nome completo", "José das Dores");
  typeIn("Data de nascimento", "2026-09-30");
  typeIn("Nome da mãe", "Maria das Dores");
}

const CREATE = "Criar pessoa sem CPF";

describe("PersonStart", () => {
  it("sem CPF: só cria depois da busca; escolher o candidato manda patient_id", async () => {
    mocked(api.findDuplicates).mockResolvedValue([ { patient_id: "pa7", display_name: "José das Dores", birth_date: "2026-09-30", has_cpf: false } ]);
    const onChoose = vi.fn();
    renderWithProviders(<PersonStart today={TODAY24} onChoose={onChoose} onCancel={vi.fn()} />);
    fillNoCpf();
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    await waitFor(() => expect(api.findDuplicates).toHaveBeenCalledWith({ full_name: "José das Dores", birth_date: "2026-09-30", mother_name: "Maria das Dores" }));
    expect(await screen.findByText("José das Dores · nascido em 30/09/2026 · sem CPF")).not.toBeNull();
    // Com candidato, "é outra pessoa" também existe — depois da busca.
    expect(screen.getByRole("button", { name: CREATE })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "É esta pessoa" }));
    // Só a mãe digitada vai junto (nome e nascimento já casaram com o candidato).
    expect(onChoose).toHaveBeenCalledWith({ kind: "patient", patientId: "pa7", registrationId: null, displayName: "José das Dores", hasCpf: false,
      identity: { mother_name: "Maria das Dores" } });
  });

  it("sem candidato: 'criar sem CPF' leva os dados digitados; trocar nome, nascimento ou mãe pede nova busca", async () => {
    mocked(api.findDuplicates).mockResolvedValue([]);
    const onChoose = vi.fn();
    renderWithProviders(<PersonStart today={TODAY24} onChoose={onChoose} onCancel={vi.fn()} />);
    fillNoCpf();
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    expect(await screen.findByText("Nenhum paciente parecido.")).not.toBeNull();
    expect(screen.getByRole("button", { name: CREATE })).not.toBeNull();
    typeIn("Nome completo", "José Dores");
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
    expect(screen.queryByText("Nenhum paciente parecido.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    await screen.findByRole("button", { name: CREATE });
    typeIn("Data de nascimento", "2026-09-29");
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
    typeIn("Data de nascimento", "2026-09-30");
    typeIn("Nome da mãe", "Maria Dores");
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
    typeIn("Nome da mãe", "Maria das Dores");
    fireEvent.click(await screen.findByRole("button", { name: CREATE }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "new", identity: { full_name: "José Dores", birth_date: "2026-09-30", mother_name: "Maria das Dores" } });
    expect(api.findDuplicates).toHaveBeenCalledTimes(2);
  });

  it("busca de duplicados: nome sem sobrenome ou nascimento futuro não sai; mãe em branco não vai; 429 vira frase", async () => {
    mocked(api.findDuplicates).mockRejectedValue(new api.ApiError(429, { error: "too_many_requests" }, "429"));
    renderWithProviders(<PersonStart today={TODAY24} onChoose={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    typeIn("Nome completo", "José");
    typeIn("Data de nascimento", "2026-09-30");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    expect(screen.getByRole("alert").textContent).toBe("informe nome e sobrenome");
    typeIn("Nome completo", "José das Dores");
    typeIn("Data de nascimento", "2026-10-24");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    expect(screen.getByRole("alert").textContent).toBe("nascimento depois de hoje");
    expect(api.findDuplicates).not.toHaveBeenCalled();
    typeIn("Data de nascimento", "2026-09-30");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    expect(await screen.findByText("muitas buscas seguidas — aguarde um minuto")).not.toBeNull();
    expect(api.findDuplicates).toHaveBeenCalledWith({ full_name: "José das Dores", birth_date: "2026-09-30" });
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
  });

  it("com CPF: paciente com cadastro abre para atualizar; par validado vira citizen", async () => {
    mocked(api.lookupTerritoryPerson).mockResolvedValueOnce({ patient_id: "pa1", citizen_id: null, display_name: "Maria das Dores", registration_id: "rg1" })
      .mockResolvedValueOnce({ patient_id: null, citizen_id: "ci4", display_name: "Joana", registration_id: null });
    const onChoose = vi.fn();
    renderWithProviders(<PersonStart today={TODAY24} onChoose={onChoose} onCancel={vi.fn()} />);
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Atualizar o cadastro de Maria das Dores" }));
    expect(onChoose).toHaveBeenLastCalledWith({ kind: "patient", patientId: "pa1", registrationId: "rg1", displayName: "Maria das Dores", hasCpf: true });
    expect(api.lookupTerritoryPerson).toHaveBeenLastCalledWith("52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar Joana" }));
    expect(onChoose).toHaveBeenLastCalledWith({ kind: "citizen", citizenId: "ci4", displayName: "Joana" });
  });

  it("com CPF: paciente sem cadastro; ninguém (404) cria pessoa nova com o CPF; par só declarado (409) e CPF inválido são frases", async () => {
    mocked(api.lookupTerritoryPerson)
      .mockResolvedValueOnce({ patient_id: "pa5", citizen_id: null, display_name: null, registration_id: null })
      .mockRejectedValueOnce(new api.ApiError(404, { error: "person_not_found" }, "404"))
      .mockRejectedValueOnce(new api.ApiError(409, { error: "citizen_not_verified" }, "409"));
    const onChoose = vi.fn();
    renderWithProviders(<PersonStart today={TODAY24} onChoose={onChoose} onCancel={vi.fn()} />);
    typeIn("CPF", "529.982.247-24");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    expect(screen.getByRole("alert").textContent).toBe("CPF inválido: confira os 11 dígitos");
    expect(api.lookupTerritoryPerson).not.toHaveBeenCalled();

    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa sem nome no cadastro" }));
    expect(onChoose).toHaveBeenLastCalledWith({ kind: "patient", patientId: "pa5", registrationId: null, displayName: null, hasCpf: true });

    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    expect(await screen.findByText("nenhuma pessoa com este CPF — preencha os dados para cadastrar")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    expect(onChoose).toHaveBeenLastCalledWith({ kind: "new", identity: {}, cpf: "52998224725" });

    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    expect(await screen.findByText("este CPF tem cadastro declarado pelo cidadão, ainda sem validação presencial — valide a identidade antes")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar pessoa nova com este CPF" })).toBeNull();
  });

  it("trocar o CPF depois da busca apaga o resultado; Cancelar volta", async () => {
    mocked(api.lookupTerritoryPerson).mockResolvedValue({ patient_id: null, citizen_id: "ci4", display_name: "Joana", registration_id: null });
    const onCancel = vi.fn();
    renderWithProviders(<PersonStart today={TODAY24} onChoose={vi.fn()} onCancel={onCancel} />);
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    await screen.findByRole("button", { name: "Cadastrar Joana" });
    typeIn("CPF", "111.444.777-35");
    expect(screen.queryByRole("button", { name: "Cadastrar Joana" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("nada da busca vai para storage, URL ou console", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log");
    mocked(api.findDuplicates).mockResolvedValue([]);
    renderWithProviders(<PersonStart today={TODAY24} onChoose={vi.fn()} onCancel={vi.fn()} />);
    fillNoCpf();
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    await screen.findByText("Nenhum paciente parecido.");
    expect(setItem).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(window.location.search + window.location.hash).toBe("");
  });
});
