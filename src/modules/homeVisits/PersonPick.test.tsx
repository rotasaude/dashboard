// src/modules/homeVisits/PersonPick.test.tsx
// Pessoa da visita e do participante (módulo 24b, Task 5; decisão 7A): busca por CPF/CNS, duplicados e registro rápido.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), lookupVisitPerson: vi.fn(), findVisitDuplicates: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { PersonPick } from "./PersonPick";
import { HOME_VISIT_ERRORS } from "../../lib/homeVisits";
import { DUPLICATE_SUSPECTED_TEXT } from "../../lib/territoryRegistry";
import { renderWithProviders } from "../../test/campaignFixtures";
import { TODAY24B, candidate, hvUser, person } from "../../test/homeVisitFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
type Props = Partial<React.ComponentProps<typeof PersonPick>>;
function mount(p: Props = {}) {
  return renderWithProviders(<PersonPick scope="home_visits" today={TODAY24B} onChoose={vi.fn()} onCancel={vi.fn()} {...p} />);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.lookupVisitPerson, api.findVisitDuplicates ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
});

describe("PersonPick", () => {
  it("CPF achado: escolher devolve o paciente com sexo; nada na URL", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue(person({ sex: "male" }));
    const onChoose = vi.fn();
    mount({ onChoose });
    typeIn("CPF ou CNS", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Escolher Ana Prado" }));
    expect(api.lookupVisitPerson).toHaveBeenCalledWith("home_visits", { cpf: "52998224725" });
    expect(onChoose).toHaveBeenCalledWith({ kind: "patient", patientId: "pa9", displayName: "Ana Prado", hasCpf: true, hasCns: false, sex: "male" });
    expect(window.location.href).not.toMatch(/529/);
  });

  it("CNS não achado: o registro rápido abre com o CNS e pede o resto", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue(null);
    mount();
    typeIn("CPF ou CNS", "898000000000005");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(((await screen.findByLabelText("CNS (opcional)")) as HTMLInputElement).value).toBe("898000000000005");
    expect(api.lookupVisitPerson).toHaveBeenCalledWith("home_visits", { cns: "898000000000005" });
    fireEvent.click(screen.getByRole("button", { name: "Usar esta pessoa" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(1);
  });

  it("registro rápido completo devolve a pessoa nova (sem CPF, com motivo)", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue(null);
    const onChoose = vi.fn();
    mount({ onChoose });
    typeIn("CPF ou CNS", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByLabelText("Nome completo");
    expect((screen.getByLabelText("CPF") as HTMLInputElement).value).toBe("529.982.247-25");
    typeIn("Nome completo", "Ana Prado");
    typeIn("Data de nascimento", "1990-04-02");
    typeIn("Sexo", "female");
    fireEvent.click(screen.getByRole("button", { name: "Usar esta pessoa" }));
    expect(onChoose).toHaveBeenCalledWith({
      kind: "new", duplicatesReviewed: false,
      patient: { full_name: "Ana Prado", birth_date: "1990-04-02", sex: "female", cpf: "52998224725" }
    });
  });

  it("sem documento: 'é outra pessoa' só depois de buscar exatamente o digitado", async () => {
    mocked(api.findVisitDuplicates).mockResolvedValue([ candidate() ]);
    const onChoose = vi.fn();
    mount({ onChoose });
    fireEvent.click(screen.getByRole("button", { name: "Não tem o documento" }));
    typeIn("Nome completo", "Ana Prado");
    typeIn("Data de nascimento", "1990-04-02");
    expect(screen.queryByRole("button", { name: /É outra pessoa/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    expect(await screen.findByText(/Ana Prado · nascido em 02\/04\/1990 · sem CPF/)).not.toBeNull();
    expect(screen.getByRole("button", { name: /É outra pessoa/ })).not.toBeNull();
    typeIn("Nome completo", "Ana Prado Silva");
    expect(screen.queryByRole("button", { name: /É outra pessoa/ })).toBeNull();
  });

  it("sem documento: 'é outra pessoa' abre o registro rápido com duplicatesReviewed", async () => {
    mocked(api.findVisitDuplicates).mockResolvedValue([ candidate() ]);
    const onChoose = vi.fn();
    mount({ onChoose });
    fireEvent.click(screen.getByRole("button", { name: "Não tem o documento" }));
    typeIn("Nome completo", "Ana Prado");
    typeIn("Data de nascimento", "1990-04-02");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: /É outra pessoa/ }));
    expect((screen.getByLabelText("Nome completo") as HTMLInputElement).value).toBe("Ana Prado");
    typeIn("Sexo", "female");
    typeIn("Motivo de não ter CPF", "8");
    fireEvent.click(screen.getByRole("button", { name: "Usar esta pessoa" }));
    expect(onChoose).toHaveBeenCalledWith({
      kind: "new", duplicatesReviewed: true,
      patient: { full_name: "Ana Prado", birth_date: "1990-04-02", sex: "female", no_cpf_reason: "8" }
    });
  });

  it("escolher um candidato devolve o paciente", async () => {
    mocked(api.findVisitDuplicates).mockResolvedValue([ candidate() ]);
    const onChoose = vi.fn();
    mount({ onChoose });
    fireEvent.click(screen.getByRole("button", { name: "Não tem o documento" }));
    typeIn("Nome completo", "Ana Prado");
    typeIn("Data de nascimento", "1990-04-02");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Escolher Ana Prado" }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "patient", patientId: "pa8", displayName: "Ana Prado", hasCpf: false, hasCns: true, sex: "female" });
  });

  it("restart do 409 duplicate_suspected: frase e candidatos sem nova busca", async () => {
    mount({ restart: { query: { full_name: "Ana Prado", birth_date: "1990-04-02" }, candidates: [ candidate() ] } });
    expect(screen.getByText(DUPLICATE_SUSPECTED_TEXT)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Escolher Ana Prado" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /É outra pessoa/ })).not.toBeNull();
    expect(api.findVisitDuplicates).not.toHaveBeenCalled();
  });

  it("429 da busca vira frase; o documento não aparece em mensagem", async () => {
    mocked(api.lookupVisitPerson).mockRejectedValue(new ApiError(429, { error: "too_many_requests" }, "x"));
    mount();
    typeIn("CPF ou CNS", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    const msg = await screen.findByText(HOME_VISIT_ERRORS.too_many_requests);
    expect(msg.textContent).not.toMatch(/529/);
    expect(api.lookupVisitPerson).toHaveBeenCalledTimes(1);
  });

  it("403 feature_disabled mostra a frase do interruptor", async () => {
    mocked(api.lookupVisitPerson).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "home_visits" }, "x"));
    mount();
    typeIn("CPF ou CNS", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText(HOME_VISIT_ERRORS.feature_disabled)).not.toBeNull();
  });

  it("409 citizen_not_verified tem frase própria", async () => {
    mocked(api.lookupVisitPerson).mockRejectedValue(new ApiError(409, { error: "citizen_not_verified" }, "x"));
    mount();
    typeIn("CPF ou CNS", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText(HOME_VISIT_ERRORS.citizen_not_verified)).not.toBeNull();
  });

  it("CPF inválido não chama o api", async () => {
    mount();
    typeIn("CPF ou CNS", "11111111111");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getAllByRole("alert").length).toBe(1);
    expect(api.lookupVisitPerson).not.toHaveBeenCalled();
  });

  it("invalid_patient em new_patient.full_name marca 'Nome completo'", async () => {
    mount({ restart: undefined, refusal: { path: "new_patient.full_name", text: HOME_VISIT_ERRORS.invalid_patient }, initialNew: { cpf: "52998224725" } });
    expect(screen.getByLabelText("Nome completo").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Data de nascimento").getAttribute("aria-invalid")).not.toBe("true");
    expect(screen.getByText(HOME_VISIT_ERRORS.invalid_patient)).not.toBeNull();
  });

  it("cpf_or_reason_required marca o motivo de não ter CPF", async () => {
    mount({ refusal: { path: "new_patient.no_cpf_reason", text: HOME_VISIT_ERRORS.cpf_or_reason_required }, initialNew: {} });
    expect(screen.getByLabelText("Motivo de não ter CPF").getAttribute("aria-invalid")).toBe("true");
  });

  it("busca pendente abandonada ('Não tem o documento' ou 'Cancelar') nunca reabre o registro rápido com o documento", async () => {
    let resolve!: (p: null) => void;
    mocked(api.lookupVisitPerson).mockReturnValue(new Promise((r) => { resolve = r; }));
    const onCancel = vi.fn();
    mount({ onCancel });
    typeIn("CPF ou CNS", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(screen.getByRole("button", { name: "Não tem o documento" }));
    resolve(null);
    await waitFor(() => expect(api.lookupVisitPerson).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText("CNS (opcional)")).toBeNull();
    expect(screen.getByRole("button", { name: "Buscar possíveis duplicados" })).not.toBeNull();

    cleanup();
    mocked(api.lookupVisitPerson).mockReturnValue(new Promise((r) => { resolve = r; }));
    mount({ onCancel });
    typeIn("CPF ou CNS", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    resolve(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText("CNS (opcional)")).toBeNull();
  });

  it("pessoa sem identificação (urgência) não é escolhível e mostra a frase", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue(person({ patient_id: "pa5" }));
    const onChoose = vi.fn();
    mount({ onChoose, unidentifiedIds: [ "pa5" ] });
    typeIn("CPF ou CNS", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(screen.getByText(HOME_VISIT_ERRORS.patient_unidentified)).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Escolher Ana Prado" })).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });
});
