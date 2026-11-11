import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()), lookupUrgencyPerson: vi.fn(), createUrgencyArrival: vi.fn(), getUrgencyQueue: vi.fn(),
  getUrgencyObservation: vi.fn()
}));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { DOCTOR_LINK, UPA, duplicateCandidates, patientRef, queue, urgencyUser } from "../../test/urgencyFixtures";
import { UrgencyDesk } from "./UrgencyDesk";

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.lookupUrgencyPerson).mockReset(); vi.mocked(api.createUrgencyArrival).mockReset();
  vi.mocked(api.getUrgencyQueue).mockReset().mockResolvedValue(queue({ awaiting_classification: [], by_color: [], in_care: [] }));
  vi.mocked(api.getUrgencyObservation).mockReset().mockResolvedValue({ beds: [], waiting_bed: [] });
});

function mount(roles = [ "citizen_verifier" ], links: api.ProfessionalLink[] = [], linksLoading = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <UrgencyDesk unit={UPA} user={urgencyUser(roles)} links={links} linksLoading={linksLoading} />
  </QueryClientProvider>);
}

async function searchFound(doc = "52998224725") {
  vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef(), candidates: [] });
  fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: doc } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  return screen.findByRole("button", { name: "Registrar chegada de Maria Lima" });
}

function fillNewPatient() {
  fireEvent.click(screen.getByRole("button", { name: "Paciente novo" }));
  fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Maria Lima" } });
  fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "1980-03-02" } });
  fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "female" } });
  fireEvent.change(screen.getByLabelText("CPF (se tiver)"), { target: { value: "529.982.247-25" } });
}
const NEW_PATIENT = { full_name: "Maria Lima", birth_date: "1980-03-02", sex: "female", cpf: "52998224725" };

describe("Recepção da UPA (F-32.2)", () => {
  it("CPF achado: um clique registra a chegada e mostra a senha grande para entregar", async () => {
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef(), candidates: [] });
    vi.mocked(api.createUrgencyArrival).mockResolvedValue({ attendance_id: "at9", encounter_id: "en9", ticket: "U-043", patient: patientRef() });
    mount();
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "529.982.247-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar chegada de Maria Lima" }));
    expect(await screen.findByRole("heading", { name: "Senha U-043" })).not.toBeNull();
    expect(screen.getByText("Entregue a senha à pessoa: ela será chamada por ela na TV.")).not.toBeNull();
    expect(vi.mocked(api.lookupUrgencyPerson).mock.calls[0][0]).toEqual({ cpf: "52998224725" });
    expect(vi.mocked(api.createUrgencyArrival).mock.calls[0][0]).toEqual({ health_unit_id: "upa1", patient_id: "pa1" });
  });

  it("a senha recebe o foco; 'Próxima chegada' volta ao campo CPF ou CNS, vazio", async () => {
    vi.mocked(api.createUrgencyArrival).mockResolvedValue({ attendance_id: "at9", encounter_id: "en9", ticket: "U-043", patient: patientRef() });
    mount();
    fireEvent.click(await searchFound());
    const title = await screen.findByRole("heading", { name: "Senha U-043" });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.getByText(UPA.name)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Próxima chegada" }));
    const field = screen.getByLabelText("CPF ou CNS") as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.value).toBe("");
    expect(screen.queryByRole("heading", { name: /^Senha/ })).toBeNull();
  });

  it("CNS de 15 dígitos vai como cns; sem senha (cidade sem TV) mostra 'Chegada registrada' sem número", async () => {
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef(), candidates: [] });
    vi.mocked(api.createUrgencyArrival).mockResolvedValue({ attendance_id: "at9", encounter_id: "en9", ticket: null, patient: patientRef() });
    mount();
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "700000000000005" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar chegada de Maria Lima" }));
    expect(await screen.findByText("Chegada registrada. A pessoa aguarda a classificação de risco.")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /^Senha/ })).toBeNull();
    expect(vi.mocked(api.lookupUrgencyPerson).mock.calls[0][0]).toEqual({ cns: "700000000000005" });
  });

  it("documento que não é CPF nem CNS não busca", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByText("digite o CPF (11 dígitos) ou o CNS (15 dígitos)")).not.toBeNull();
    expect(api.lookupUrgencyPerson).not.toHaveBeenCalled();
  });

  it("busca recusada (documento só declarado) mostra a frase", async () => {
    vi.mocked(api.lookupUrgencyPerson).mockRejectedValue(new ApiError(409, { error: "citizen_not_verified" }, "x"));
    mount();
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("documento só declarado — confirme no balcão ou cadastre como paciente novo")).not.toBeNull();
  });

  it("não identificado: descrição obrigatória de 10 a 500; o corpo leva só unidentified", async () => {
    vi.mocked(api.createUrgencyArrival).mockResolvedValue({ attendance_id: "at9", encounter_id: "en9", ticket: "U-044",
      patient: patientRef({ name: "Não identificado", unidentified: true }) });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Pessoa sem identificação" }));
    expect(screen.getByText(/não pode ser identificada agora/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "homem 40a" } });
    expect(screen.getByText("9/500")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
    expect(screen.getByText("descreva a pessoa (de 10 a 500 caracteres): sexo e idade aparentes, sinais, onde foi encontrada")).not.toBeNull();
    expect(api.createUrgencyArrival).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "homem, cerca de 40 anos, achado na rodoviária" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
    expect(await screen.findByRole("heading", { name: "Senha U-044" })).not.toBeNull();
    expect(vi.mocked(api.createUrgencyArrival).mock.calls[0][0]).toEqual({ health_unit_id: "upa1",
      unidentified: { description: "homem, cerca de 40 anos, achado na rodoviária" } });
  });

  it("paciente novo: recusa local sem enviar", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Paciente novo" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(api.createUrgencyArrival).not.toHaveBeenCalled();
  });

  it("paciente novo: o corpo leva só new_patient (CPF só com dígitos, sem motivo)", async () => {
    vi.mocked(api.createUrgencyArrival).mockResolvedValue({ attendance_id: "at9", encounter_id: "en9", ticket: "U-045", patient: patientRef() });
    mount();
    fillNewPatient();
    fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
    expect(await screen.findByRole("heading", { name: "Senha U-045" })).not.toBeNull();
    expect(vi.mocked(api.createUrgencyArrival).mock.calls[0][0]).toEqual({ health_unit_id: "upa1", new_patient: NEW_PATIENT });
  });

  it("paciente novo sem CPF exige o motivo da lista do 24a", async () => {
    vi.mocked(api.createUrgencyArrival).mockResolvedValue({ attendance_id: "at9", encounter_id: "en9", ticket: null, patient: patientRef() });
    mount();
    fillNewPatient();
    fireEvent.change(screen.getByLabelText("CPF (se tiver)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
    expect(screen.getByText("sem CPF, informe o motivo")).not.toBeNull();
    expect(api.createUrgencyArrival).not.toHaveBeenCalled();
    const reason = screen.getByLabelText("Motivo de não ter CPF") as HTMLSelectElement;
    fireEvent.change(reason, { target: { value: reason.options[1].value } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
    await waitFor(() => expect(api.createUrgencyArrival).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createUrgencyArrival).mock.calls[0][0]).toEqual({ health_unit_id: "upa1",
      new_patient: { full_name: "Maria Lima", birth_date: "1980-03-02", sex: "female", no_cpf_reason: reason.options[1].value } });
  });

  it("paciente novo recusado por Patients::CreateTyped (invalid_patient): a frase fica no campo", async () => {
    vi.mocked(api.createUrgencyArrival).mockRejectedValue(new ApiError(422, { error: "invalid_patient", path: "new_patient.full_name" }, "x"));
    mount();
    fillNewPatient();
    fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
    const msg = await screen.findByText("confira os dados do paciente novo");
    expect(msg.id).toBe(screen.getByLabelText("Nome completo").getAttribute("aria-describedby"));
    expect(screen.queryByText(/recusado pelo servidor/)).toBeNull();
  });

  it("paciente novo com CPF já cadastrado: a frase fica no campo do CPF", async () => {
    vi.mocked(api.createUrgencyArrival).mockRejectedValue(new ApiError(409, { error: "cpf_taken", path: "new_patient.cpf" }, "x"));
    mount();
    fillNewPatient();
    fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
    const msg = await screen.findByText("já existe paciente com este CPF — busque por ele e ligue ao existente");
    expect(msg.id).toBe(screen.getByLabelText("CPF (se tiver)").getAttribute("aria-describedby"));
  });

  describe("Q23: cadastro parecido (409 duplicate_suspected)", () => {
    const duplicate = () => new ApiError(409, { error: "duplicate_suspected", path: "new_patient", candidates: duplicateCandidates() }, "x");

    it("mostra os candidatos; escolher um reenvia com patient_id", async () => {
      vi.mocked(api.createUrgencyArrival).mockRejectedValueOnce(duplicate())
        .mockResolvedValueOnce({ attendance_id: "at9", encounter_id: "en9", ticket: "U-046", patient: patientRef({ patient_id: "pa5" }) });
      mount();
      fillNewPatient();
      fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
      const box = await screen.findByRole("group", { name: "Cadastros parecidos" });
      expect(within(box).getByText("Maria Lima · nasc. 02/03/1980 · com CPF")).not.toBeNull();
      expect(within(box).getByText("Maria Lima Souza · nasc. 12/03/1980 · sem CPF")).not.toBeNull();
      // É um passo, não um erro.
      expect(screen.queryAllByRole("alert")).toHaveLength(0);
      fireEvent.click(within(box).getByRole("button", { name: "Registrar chegada de Maria Lima" }));
      expect(await screen.findByRole("heading", { name: "Senha U-046" })).not.toBeNull();
      expect(vi.mocked(api.createUrgencyArrival).mock.calls[1][0]).toEqual({ health_unit_id: "upa1", patient_id: "pa5" });
    });

    it("'Nenhum destes' reenvia o paciente novo com duplicates_reviewed", async () => {
      vi.mocked(api.createUrgencyArrival).mockRejectedValueOnce(duplicate())
        .mockResolvedValueOnce({ attendance_id: "at9", encounter_id: "en9", ticket: null, patient: patientRef() });
      mount();
      fillNewPatient();
      fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
      fireEvent.click(await screen.findByRole("button", { name: "Nenhum destes — cadastrar como novo" }));
      expect(await screen.findByText("Chegada registrada. A pessoa aguarda a classificação de risco.")).not.toBeNull();
      expect(vi.mocked(api.createUrgencyArrival).mock.calls[1][0]).toEqual({ health_unit_id: "upa1", new_patient: NEW_PATIENT, duplicates_reviewed: true });
    });

    it("mudar os dados depois do aviso tira os candidatos", async () => {
      vi.mocked(api.createUrgencyArrival).mockRejectedValueOnce(duplicate());
      mount();
      fillNewPatient();
      fireEvent.click(screen.getByRole("button", { name: "Registrar chegada" }));
      await screen.findByRole("group", { name: "Cadastros parecidos" });
      fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Maria Lima Santos" } });
      expect(screen.queryByRole("group", { name: "Cadastros parecidos" })).toBeNull();
    });
  });

  it("duplo clique envia uma vez; encounter_open mostra a frase e mantém o formulário", async () => {
    vi.mocked(api.createUrgencyArrival).mockRejectedValue(new ApiError(409, { error: "encounter_open" }, "x"));
    mount();
    const go = await searchFound();
    fireEvent.click(go); fireEvent.click(go);
    expect(await screen.findByText("esta pessoa já tem um atendimento aberto nesta UPA")).not.toBeNull();
    expect(api.createUrgencyArrival).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Registrar chegada de Maria Lima" })).not.toBeNull();
  });

  it("paciente provisório escolhido (invalid_request patient_id) e urgência desligada têm frase", async () => {
    vi.mocked(api.createUrgencyArrival).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "patient_id" }, "x"))
      .mockRejectedValueOnce(new ApiError(403, { error: "feature_disabled", feature: "urgency_care" }, "x"));
    mount();
    const go = await searchFound();
    fireEvent.click(go);
    expect(await screen.findByText("este cadastro é provisório (sem identificação) — escolha outro paciente ou cadastre como paciente novo")).not.toBeNull();
    fireEvent.click(go);
    expect(await screen.findByText("a urgência está desligada nesta cidade")).not.toBeNull();
  });

  it("sem ninguém pelo documento: oferece paciente novo e não identificado, e o CPF não aparece em lugar nenhum além do campo", async () => {
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: null, candidates: [] });
    mount();
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("Ninguém com este documento. Cadastre como paciente novo ou registre sem identificação.")).not.toBeNull();
    expect(document.body.textContent).not.toContain("52998224725");
  });

  it("a fila da urgência fica abaixo da recepção, lida pela unidade", async () => {
    mount();
    expect(await screen.findByRole("region", { name: "Fila da urgência" })).not.toBeNull();
    expect(vi.mocked(api.getUrgencyQueue).mock.calls[0][0]).toBe("upa1");
  });

  it("vínculos ainda carregando: sem o aviso de papel (nada de piscar) e sem ler a fila", () => {
    mount([ "health_professional" ], [], true);
    expect(screen.queryByText("seu papel não atua nesta UPA")).toBeNull();
    expect(screen.getByText("carregando seus vínculos…")).not.toBeNull();
    expect(api.getUrgencyQueue).not.toHaveBeenCalled();
  });

  it("sem papel na UPA: o aviso, sem a recepção", () => {
    mount([ "health_professional" ], [ { ...DOCTOR_LINK, health_unit_id: "outra" } ]);
    expect(screen.getByText("seu papel não atua nesta UPA")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Recepção da UPA" })).toBeNull();
  });
});
