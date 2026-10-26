// src/modules/territory/RegistrationForm.test.tsx
// Ficha de cadastro individual (Task 12), nas formas do api REAL (preflight
// C9–C13; errata 5.1, 9, 10, 12): sexo "male"/"female", motivo sem CPF em
// texto, raça/cor e etnia só em patient_demographics (etnia só com 05), CPF
// de quem não tinha na raiz, identidade digitada em `patient`, seção
// Identificação com os obrigatórios do §15 e o lugar (domicílio + família, ou
// a equipe fora de área). O CNS do brief (898001160660003) não passa no dígito:
// vale o do spec do api (700000000000005).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), createRegistration: vi.fn(), updateRegistration: vi.fn(), getRegistration: vi.fn() };
});

import * as api from "../../lib/api";
import type { RegistrationPatient } from "../../lib/api";
import { RegistrationForm } from "./RegistrationForm";
import { STALE_TEXT } from "../../lib/territoryRegistry";
import { renderWithProviders } from "../../test/campaignFixtures";
import { TODAY24, registration, territoryUser } from "../../test/territoryFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pick = typeIn;
const answer = (group: string, value: "Sim" | "Não") => fireEvent.click(within(screen.getByRole("group", { name: group })).getByLabelText(value));
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
const created = () => mocked(api.createRegistration).mock.calls[0][0];
const updated = () => mocked(api.updateRegistration).mock.calls[0];
const CNS = "700000000000005";

// Paciente sem CPF (recém-nascido), sem par validado: identidade editável.
const UNLOCKED: RegistrationPatient = { id: "pa2", display_name: "José das Dores", full_name: "José das Dores", mother_name: "Maria das Dores",
  birth_date: "2026-09-30", sex: "male", has_cpf: false, no_cpf_reason: "3", cns_masked: null, identity_locked: false };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.createRegistration, api.updateRegistration, api.getRegistration ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser());
  mocked(api.createRegistration).mockResolvedValue(registration());
  mocked(api.updateRegistration).mockResolvedValue(registration({ version: 2 }));
  mocked(api.getRegistration).mockResolvedValue(registration({ id: "rg2", patient: UNLOCKED, patient_demographics: { race_color: null, ethnicity: null },
    is_responsible: false, street_situation: { status_situacao_rua: false } }));
});

const NEW = { kind: "new" as const, identity: { full_name: "José das Dores", birth_date: "2026-09-30", mother_name: "Maria das Dores" } };
const HOUSE = { id: "hh1", familyId: "fa1", responsiblePatientId: "pa1" };

// Os obrigatórios do §15 que não moram no paciente (nacionalidade já vem Brasileira).
function fillIdentification() {
  typeIn("Município de nascimento (código IBGE, 7 dígitos)", "4106902");
  typeIn("Celular (DDD + número)", "(41) 99999-0000");
  fireEvent.click(screen.getByLabelText("Não sabe o nome do pai"));
  answer("Quer informar a orientação sexual?", "Não");
  answer("Quer informar a identidade de gênero?", "Não");
  fireEvent.click(screen.getByLabelText("Não está em situação de rua"));
}

function fillNewbornIdentity() {
  pick("Sexo", "male");
  pick("Raça/cor", "03");
  pick("Motivo de não ter CPF", "3");
  typeIn("CNS", CNS);
  fillIdentification();
}

describe("RegistrationForm", () => {
  it("recém-nascido sem CPF: cria o paciente com o motivo; raça/cor no paciente; sem gestante na tela", async () => {
    const onSaved = vi.fn();
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE} choice={NEW} onSaved={onSaved} onCancel={vi.fn()} />);
    fillNewbornIdentity();
    expect(screen.queryByLabelText("Está gestante")).toBeNull();
    save();
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalledTimes(1));
    expect(created()).toEqual({
      new_patient: { full_name: "José das Dores", birth_date: "2026-09-30", sex: "male", mother_name: "Maria das Dores", no_cpf_reason: "3", cns: CNS },
      patient_demographics: { race_color: "03" },
      household_id: "hh1", family_id: "fa1", is_responsible: false,
      identification: { nacionalidade_cidadao: 1, codigo_ibge_municipio_nascimento: "4106902", pais_nascimento: 31, telefone_celular: "41999990000",
        desconhece_nome_pai: true },
      sociodemographic: { status_deseja_informar_orientacao_sexual: false, status_deseja_informar_identidade_genero: false },
      health_conditions: {},
      street_situation: { status_situacao_rua: false },
      refused: false
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(registration()));
  });

  it("pessoa nova com CPF (busca deu 404): o CPF vai em new_patient, sem motivo; a tela não pede o CPF de novo", async () => {
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE} choice={{ kind: "new", identity: {}, cpf: "52998224725" }}
      onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Motivo de não ter CPF")).toBeNull();
    expect(screen.getByText("529.982.247-25")).not.toBeNull();
    typeIn("Nome completo", "Rita  de Souza ");
    typeIn("Data de nascimento", "1990-01-10");
    pick("Sexo", "female");
    typeIn("Nome da mãe", "Ana de Souza");
    pick("Raça/cor", "01");
    fillIdentification();
    save();
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalledTimes(1));
    expect(created().new_patient).toEqual({ full_name: "Rita de Souza", birth_date: "1990-01-10", sex: "female", mother_name: "Ana de Souza",
      cpf: "52998224725" });
    expect(created()).not.toHaveProperty("cpf");
    expect(created()).not.toHaveProperty("patient");
  });

  it("paciente existente (duplicado escolhido) que é o responsável da família: patient_id e is_responsible; sem new_patient", async () => {
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE}
      choice={{ kind: "patient", patientId: "pa1", registrationId: null, displayName: "Maria das Dores", hasCpf: true }} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Maria das Dores")).not.toBeNull();
    expect(screen.queryByLabelText("Nome completo")).toBeNull();
    expect(screen.queryByLabelText("Informar CPF")).toBeNull();
    pick("Raça/cor", "05");
    typeIn("Etnia (código)", "0001");
    fillIdentification();
    save();
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalledTimes(1));
    const body = created();
    expect(body).toEqual(expect.objectContaining({ patient_id: "pa1", household_id: "hh1", family_id: "fa1", is_responsible: true,
      patient_demographics: { race_color: "05", ethnicity: "0001" } }));
    expect(Object.keys(body).filter((k) => [ "new_patient", "patient", "cpf", "cns", "citizen_id", "team_id" ].includes(k))).toEqual([]);
  });

  it("par validado fora de área (validade, sem cadastro): citizen_id e team_id; raça/cor sem etnia fora de 05", async () => {
    renderWithProviders(<RegistrationForm today={TODAY24} teamId="tm1" choice={{ kind: "citizen", citizenId: "ci4", displayName: "Joana Prado" }}
      onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("validados no posto")).not.toBeNull();
    pick("Raça/cor", "05");
    typeIn("Etnia (código)", "0001");
    pick("Raça/cor", "02");
    expect(screen.queryByLabelText("Etnia (código)")).toBeNull();
    fillIdentification();
    save();
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalledTimes(1));
    const body = created();
    expect(body).toEqual(expect.objectContaining({ citizen_id: "ci4", team_id: "tm1", is_responsible: false, patient_demographics: { race_color: "02" } }));
    expect(body).not.toHaveProperty("household_id");
    expect(body).not.toHaveProperty("family_id");
  });

  it("recusa: só identificação e refused; as seções somem e voltam vazias", async () => {
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE} choice={{ kind: "patient", patientId: "pa1", registrationId: null }}
      onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Tem diabetes"));
    fireEvent.click(await screen.findByLabelText("O cidadão recusou o cadastro (termo de recusa)"));
    expect(screen.queryByRole("group", { name: "Sociodemográfico" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Condições de saúde" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Situação de rua" })).toBeNull();
    save();
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalled());
    expect(created()).toEqual(expect.objectContaining({ patient_id: "pa1", refused: true, sociodemographic: {}, health_conditions: {}, street_situation: null }));
    fireEvent.click(screen.getByLabelText("O cidadão recusou o cadastro (termo de recusa)"));
    expect((screen.getByLabelText("Tem diabetes") as HTMLInputElement).checked).toBe(false);
  });

  it("paciente sem CPF: informar CPF já usado → cpf_taken, o campo fica marcado e o formulário fica", async () => {
    mocked(api.updateRegistration).mockRejectedValue(new api.ApiError(409, { error: "cpf_taken" }, "409"));
    renderWithProviders(<RegistrationForm today={TODAY24} registrationId="rg2" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByLabelText("Informar CPF");
    typeIn("Informar CPF", "529.982.247-25");
    pick("Raça/cor", "03");
    save();
    expect(await screen.findByText("este CPF já pertence a outro paciente — confira o número; a junção de pacientes ainda não existe")).not.toBeNull();
    const [ id, body, version ] = updated();
    expect(id).toBe("rg2");
    expect(version).toBe(1);
    expect(body.cpf).toBe("52998224725");
    // Nada mudou na identidade: `patient` não vai; o lugar é o do cadastro.
    expect(body).not.toHaveProperty("patient");
    expect(body).toEqual(expect.objectContaining({ household_id: "hh1", family_id: "fa1", is_responsible: false, patient_demographics: { race_color: "03" } }));
    const field = screen.getByLabelText("Informar CPF") as HTMLInputElement;
    expect(field.value).toBe("529.982.247-25");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field);
  });

  it("identidade sem par validado: o que mudou vai em `patient`; o motivo sem CPF fica no paciente", async () => {
    renderWithProviders(<RegistrationForm today={TODAY24} registrationId="rg2" onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(((await screen.findByLabelText("Nome completo")) as HTMLInputElement).value).toBe("José das Dores");
    expect((screen.getByLabelText("Nome da mãe") as HTMLInputElement).value).toBe("Maria das Dores");
    typeIn("Nome completo", "José Ribeiro das Dores");
    pick("Raça/cor", "03");
    save();
    await waitFor(() => expect(api.updateRegistration).toHaveBeenCalledTimes(1));
    expect(updated()[1].patient).toEqual({ full_name: "José Ribeiro das Dores" });
    expect(updated()[1]).not.toHaveProperty("cpf");
  });

  it("identidade validada no posto é só leitura; aviso de revisão (L24) com a data da validação", async () => {
    mocked(api.getRegistration).mockResolvedValue(registration({ identity_review_pending: true, identity_changed_at: "2026-10-20T09:00:00-03:00" }));
    renderWithProviders(<RegistrationForm today={TODAY24} registrationId="rg1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByText("Os dados de identificação foram atualizados pela validação no posto em 20/10/2026; confira e salve para gerar a nova versão.")).not.toBeNull();
    expect(screen.getByText("identidade atualizada no posto, revisar e salvar")).not.toBeNull();
    expect(screen.queryByLabelText("Nome completo")).toBeNull();
    expect(screen.queryByLabelText("Informar CPF")).toBeNull();
    expect(screen.getByText("validados no posto")).not.toBeNull();
    expect(screen.getByText("Maria das Dores")).not.toBeNull();
    expect(screen.getByText("12/04/1968")).not.toBeNull();
    save();
    await waitFor(() => expect(api.updateRegistration).toHaveBeenCalledTimes(1));
    expect(updated()[1]).not.toHaveProperty("patient");
    // O que estava gravado volta igual (seções do servidor, sem rascunho).
    expect(updated()[1]).toEqual(expect.objectContaining({ household_id: "hh1", family_id: "fa1", is_responsible: true,
      health_conditions: { status_tem_diabetes: true, status_tem_hipertensao_arterial: true },
      identification: { nacionalidade_cidadao: 1, codigo_ibge_municipio_nascimento: "4106902", pais_nascimento: 31, telefone_celular: "41999990000",
        desconhece_nome_pai: true } }));
  });

  it("sem revisão pendente não há aviso; cadastro fora de área volta com a equipe", async () => {
    mocked(api.getRegistration).mockResolvedValue(registration({ household_id: null, family_id: null, is_responsible: false, micro_area: null,
      identity_changed_at: "2026-10-20T09:00:00-03:00", identity_review_pending: false }));
    renderWithProviders(<RegistrationForm today={TODAY24} registrationId="rg1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByText("validados no posto");
    expect(screen.queryByText(/foram atualizados pela validação no posto/)).toBeNull();
    save();
    await waitFor(() => expect(api.updateRegistration).toHaveBeenCalledTimes(1));
    expect(updated()[1]).toEqual(expect.objectContaining({ team_id: "tm1", is_responsible: false }));
    expect(updated()[1]).not.toHaveProperty("household_id");
  });

  it("nada no storage nem na URL: CPF, nome, condições só no corpo", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log");
    renderWithProviders(<RegistrationForm today={TODAY24} household={{ id: "hh1", familyId: null }} choice={NEW} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillNewbornIdentity();
    fireEvent.click(screen.getByLabelText("Tem diabetes"));
    save();
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalled());
    expect(created().health_conditions).toEqual({ status_tem_diabetes: true });
    expect(created()).not.toHaveProperty("family_id");
    expect(setItem).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(window.location.search + window.location.hash).toBe("");
  });

  it("gestante só para sexo feminino de 9 a 60 anos: o campo some e sai do corpo (errata 5.1)", async () => {
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE}
      choice={{ kind: "new", identity: { full_name: "Ana Souza", birth_date: "1990-01-10", mother_name: "Rita Souza" } }} onSaved={vi.fn()} onCancel={vi.fn()} />);
    pick("Sexo", "female");
    fireEvent.click(screen.getByLabelText("Está gestante"));
    typeIn("Maternidade de referência", "Maternidade Bairro Novo");
    pick("Sexo", "male");
    expect(screen.queryByLabelText("Está gestante")).toBeNull();
    expect(screen.queryByLabelText("Maternidade de referência")).toBeNull();
    pick("Raça/cor", "01");
    pick("Motivo de não ter CPF", "8");
    fillIdentification();
    save();
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalledTimes(1));
    expect(created().health_conditions).toEqual({});
    pick("Sexo", "female");
    typeIn("Data de nascimento", "1960-01-10");
    expect(screen.queryByLabelText("Está gestante")).toBeNull();
  });

  it("recusa local antes de enviar: frase e campo marcado; nada sai", async () => {
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE} choice={NEW} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillNewbornIdentity();
    typeIn("Celular (DDD + número)", "");
    save();
    expect(screen.getByRole("alert").textContent).toBe("informe o celular (DDD + número)");
    const field = screen.getByLabelText("Celular (DDD + número)");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field);
    expect(api.createRegistration).not.toHaveBeenCalled();
  });

  it("situação de rua: o resto só com sim; estrangeiro escolhe o país", async () => {
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE} choice={NEW} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Há quanto tempo está em situação de rua")).toBeNull();
    fireEvent.click(screen.getByLabelText("Está em situação de rua"));
    expect(screen.getByLabelText("Há quanto tempo está em situação de rua")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Não está em situação de rua"));
    expect(screen.queryByLabelText("Há quanto tempo está em situação de rua")).toBeNull();
    expect(screen.queryByLabelText("País de nascimento")).toBeNull();
    pick("Nacionalidade", "3");
    expect(screen.getByLabelText("País de nascimento")).not.toBeNull();
    expect(screen.queryByLabelText("Município de nascimento (código IBGE, 7 dígitos)")).toBeNull();
  });

  it("recusas do api: cpf_or_reason_required foca o motivo; invalid_registration foca o path; seção recolhida reabre", async () => {
    mocked(api.createRegistration)
      .mockRejectedValueOnce(new api.ApiError(422, { error: "cpf_or_reason_required" }, "422"))
      .mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_registration", path: "health_conditions.situacao_peso" }, "422"));
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE} choice={NEW} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillNewbornIdentity();
    save();
    expect(await screen.findByText("informe o CPF ou o motivo de não ter CPF")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Motivo de não ter CPF"));
    fireEvent.click(screen.getByRole("button", { name: "Recolher Condições de saúde" }));
    expect(screen.queryByLabelText("Sobre o peso, a pessoa se considera")).toBeNull();
    save();
    expect(await screen.findByText("confira o campo destacado")).not.toBeNull();
    const field = screen.getByLabelText("Sobre o peso, a pessoa se considera");
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });

  it("already_registered com o id: 'Abrir cadastro' lê o ativo e salva por PATCH", async () => {
    mocked(api.createRegistration).mockRejectedValue(new api.ApiError(409, { error: "already_registered", registration_id: "rg2" }, "409"));
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE} choice={{ kind: "patient", patientId: "pa2", registrationId: null }}
      onSaved={vi.fn()} onCancel={vi.fn()} />);
    pick("Raça/cor", "03");
    fillIdentification();
    save();
    expect(await screen.findByText("esta pessoa já tem cadastro individual ativo — abra o cadastro dela para atualizar")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir cadastro" }));
    await waitFor(() => expect(api.getRegistration).toHaveBeenCalledWith("rg2"));
    expect(((await screen.findByLabelText("Nome completo")) as HTMLInputElement).value).toBe("José das Dores");
  });

  it("already_registered sem o id: só a frase", async () => {
    mocked(api.createRegistration).mockRejectedValue(new api.ApiError(409, { error: "already_registered" }, "409"));
    renderWithProviders(<RegistrationForm today={TODAY24} household={HOUSE} choice={{ kind: "patient", patientId: "pa2", registrationId: null }}
      onSaved={vi.fn()} onCancel={vi.fn()} />);
    pick("Raça/cor", "03");
    fillIdentification();
    save();
    expect(await screen.findByText("esta pessoa já tem cadastro individual ativo — abra o cadastro dela para atualizar")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir cadastro" })).toBeNull();
  });

  it("409 stale_version: frase, o digitado fica, nada é reenviado; Recarregar relê o cadastro", async () => {
    mocked(api.updateRegistration).mockRejectedValue(new api.ApiError(409, { error: "stale_version" }, "409"));
    renderWithProviders(<RegistrationForm today={TODAY24} registrationId="rg2" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByLabelText("Nome completo");
    typeIn("Nome completo", "José Ribeiro das Dores");
    pick("Raça/cor", "03");
    save();
    expect(await screen.findByText(STALE_TEXT)).not.toBeNull();
    expect((screen.getByLabelText("Nome completo") as HTMLInputElement).value).toBe("José Ribeiro das Dores");
    expect(api.updateRegistration).toHaveBeenCalledTimes(1);
    mocked(api.getRegistration).mockResolvedValue(registration({ id: "rg2", version: 3, patient: { ...UNLOCKED, full_name: "José Lima das Dores" },
      is_responsible: false }));
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect((screen.getByLabelText("Nome completo") as HTMLInputElement).value).toBe("José Lima das Dores"));
    expect(api.getRegistration).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(STALE_TEXT)).toBeNull();
  });
});
