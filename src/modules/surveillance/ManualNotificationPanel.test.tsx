// src/modules/surveillance/ManualNotificationPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), lookupSurveillancePerson: vi.fn(), findSurveillanceDuplicates: vi.fn(),
    createManualNotification: vi.fn(), listSurveillanceDiseases: vi.fn(), listSurveillanceUnits: vi.fn(), lookupTerritoryPerson: vi.fn(), findDuplicates: vi.fn() };
});
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { DUPLICATE_SUSPECTED_TEXT } from "../../lib/territoryRegistry";
import { ManualNotificationPanel } from "./ManualNotificationPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { DENGUE, MEASLES, TODAY25, UBS_CENTRO, notification, survUser } from "../../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const panel = (over: Partial<Parameters<typeof ManualNotificationPanel>[0]> = {}) =>
  renderWithProviders(<ManualNotificationPanel today={TODAY25} onCreated={vi.fn()} onOpenExisting={vi.fn()} onCancel={vi.fn()} {...over} />);
async function fillCase() {
  await screen.findByRole("option", { name: "Sarampo" });
  await screen.findByRole("option", { name: "UBS Centro · CNES 2384299" });
  text("Doença ou agravo", "sarampo");
  text("Unidade notificadora", "u1");
}

describe("ManualNotificationPanel", () => {
  beforeEach(() => {
    for (const fn of [ api.lookupSurveillancePerson, api.findSurveillanceDuplicates, api.createManualNotification, api.lookupTerritoryPerson, api.findDuplicates ])
      mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser());
    mocked(api.listSurveillanceDiseases).mockResolvedValue([ DENGUE, MEASLES ]);
    mocked(api.listSurveillanceUnits).mockResolvedValue([ { ...UBS_CENTRO, kind: "ubs", notifying: true } ]);
    mocked(api.createManualNotification).mockResolvedValue(notification({ id: "nt9", origin: "manual" }));
  });

  it("paciente pelo CPF: manda patient_id, doença, datas e unidade; usa a busca da vigilância", async () => {
    mocked(api.lookupSurveillancePerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null });
    const onCreated = vi.fn();
    panel({ onCreated });
    text("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Notificar Joana Lima" }));
    await fillCase();
    text("Primeiros sintomas (opcional)", "2026-10-25");
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    await waitFor(() => expect(mocked(api.createManualNotification).mock.calls[0][0]).toEqual({
      patient_id: "pa1", disease_code: "sarampo", suspected_on: "2026-10-27", symptoms_on: "2026-10-25", unit_id: "u1" }));
    expect(mocked(api.lookupTerritoryPerson)).not.toHaveBeenCalled();
    expect(onCreated.mock.calls[0][0].id).toBe("nt9");
  });

  it("sem CPF: só cria depois da busca de duplicados; new_patient com sexo, motivo e duplicates_reviewed", async () => {
    mocked(api.findSurveillanceDuplicates).mockResolvedValue([]);
    panel();
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    text("Nome completo", "José Souza"); text("Data de nascimento", "2026-09-30"); text("Nome da mãe", "Maria Souza");
    expect(screen.queryByRole("button", { name: "Criar pessoa sem CPF" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar pessoa sem CPF" }));
    text("Sexo", "male"); text("Motivo de não ter CPF", "3");
    await fillCase();
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    await waitFor(() => expect(mocked(api.createManualNotification)).toHaveBeenCalled());
    const body = mocked(api.createManualNotification).mock.calls[0][0];
    expect(body.new_patient).toEqual({ full_name: "José Souza", birth_date: "2026-09-30", mother_name: "Maria Souza", sex: "male", no_cpf_reason: "3" });
    expect(body.duplicates_reviewed).toBe(true);
  });

  it("residente em outro município exige IBGE de 7 dígitos", async () => {
    mocked(api.lookupSurveillancePerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null });
    panel();
    text("CPF", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Notificar Joana Lima" }));
    await fillCase();
    fireEvent.click(screen.getByLabelText("Mora em outro município"));
    text("Código IBGE do município de residência", "410690");
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    expect((await screen.findByRole("alert")).textContent).toBe("código IBGE do município de residência com 7 dígitos");
    text("Código IBGE do município de residência", "4106902");
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    await waitFor(() => expect(mocked(api.createManualNotification).mock.calls[0][0]).toMatchObject({ resident_elsewhere: true, residence_ibge: "4106902" }));
  });

  it("409 already_notified com notification_id: abrir a existente", async () => {
    mocked(api.lookupSurveillancePerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null });
    mocked(api.createManualNotification).mockRejectedValue(new ApiError(409, { error: "already_notified", notification_id: "nt3" }, "x"));
    const onOpenExisting = vi.fn();
    panel({ onOpenExisting });
    text("CPF", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Notificar Joana Lima" }));
    await fillCase();
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir a notificação existente" }));
    expect(onOpenExisting).toHaveBeenCalledWith("nt3");
  });

  it("busca e criação: CPF, nome e mãe só no corpo; nada no storage", async () => {
    mocked(api.findSurveillanceDuplicates).mockResolvedValue([]);
    panel();
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    text("Nome completo", "José Souza"); text("Data de nascimento", "2026-09-30"); text("Nome da mãe", "Maria Souza");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    await screen.findByRole("button", { name: "Criar pessoa sem CPF" });
    expect(mocked(api.findSurveillanceDuplicates).mock.calls[0][0]).toEqual({ full_name: "José Souza", birth_date: "2026-09-30", mother_name: "Maria Souza" });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("CPF sem ninguém: digita a pessoa; 409 duplicate_suspected volta à busca e a criação segue revisada, com o CPF", async () => {
    mocked(api.lookupSurveillancePerson).mockRejectedValue(new ApiError(404, { error: "person_not_found" }, "x"));
    mocked(api.findSurveillanceDuplicates).mockResolvedValue([]);
    mocked(api.createManualNotification)
      .mockRejectedValueOnce(new ApiError(409, { error: "duplicate_suspected" }, "x"))
      .mockResolvedValueOnce(notification({ id: "nt9", origin: "manual" }));
    panel();
    text("CPF", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    text("Nome completo", "José Souza"); text("Data de nascimento", "2026-09-30"); text("Nome da mãe", "Maria Souza");
    text("Sexo", "male");
    expect(screen.queryByLabelText("Motivo de não ter CPF")).toBeNull();
    await fillCase();
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    await waitFor(() => expect(mocked(api.createManualNotification)).toHaveBeenCalledTimes(1));
    const first = mocked(api.createManualNotification).mock.calls[0][0];
    expect(first.new_patient).toEqual({ full_name: "José Souza", birth_date: "2026-09-30", mother_name: "Maria Souza", sex: "male", cpf: "52998224725" });
    expect("duplicates_reviewed" in first).toBe(false);
    // De volta ao passo 1: a frase e a busca do que foi digitado, já feita.
    expect((await screen.findByRole("alert")).textContent).toBe(DUPLICATE_SUSPECTED_TEXT);
    await waitFor(() => expect(mocked(api.findSurveillanceDuplicates).mock.calls[0][0])
      .toEqual({ full_name: "José Souza", birth_date: "2026-09-30", mother_name: "Maria Souza" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar pessoa nova com o CPF" }));
    // A identidade revisada não se digita de novo; o sexo, sim.
    expect(screen.queryByLabelText("Nome completo")).toBeNull();
    text("Sexo", "male");
    await fillCase();
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    await waitFor(() => expect(mocked(api.createManualNotification)).toHaveBeenCalledTimes(2));
    const second = mocked(api.createManualNotification).mock.calls[1][0];
    expect(second.new_patient).toEqual(first.new_patient);
    expect(second.duplicates_reviewed).toBe(true);
    expect(mocked(api.findDuplicates)).not.toHaveBeenCalled();
  });

  it("par validado manda citizen_id; todas as unidades ativas, não só as notificadoras; frases do contexto manual", async () => {
    mocked(api.lookupSurveillancePerson).mockResolvedValue({ patient_id: null, citizen_id: "ci1", display_name: "Ana Reis", registration_id: null });
    mocked(api.listSurveillanceUnits).mockResolvedValue([ { ...UBS_CENTRO, kind: "ubs", notifying: true },
      { id: "u3", cnes: null, name: "Policlínica", kind: "policlinic", notifying: false } ]);
    mocked(api.createManualNotification)
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", field: "suspected_on" }, "x"))
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_unit" }, "x"));
    panel();
    text("CPF", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Notificar Ana Reis" }));
    await fillCase();
    await screen.findByRole("option", { name: "Policlínica" });
    text("Unidade notificadora", "u3");
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    expect((await screen.findByRole("alert")).textContent).toBe("data da suspeita inválida ou no futuro");
    expect(mocked(api.createManualNotification).mock.calls[0][0]).toEqual({
      citizen_id: "ci1", disease_code: "sarampo", suspected_on: "2026-10-27", unit_id: "u3" });
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("unidade inexistente ou inativa"));
  });

  it("recusas locais: doença, unidade, suspeita futura e sintomas depois da suspeita não saem", async () => {
    mocked(api.lookupSurveillancePerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null });
    panel();
    text("CPF", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Notificar Joana Lima" }));
    await screen.findByRole("option", { name: "Sarampo" });
    const submit = () => fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe("escolha a doença ou agravo");
    text("Doença ou agravo", "sarampo");
    text("Data da suspeita", "2026-10-28");
    submit();
    expect(screen.getByRole("alert").textContent).toBe("data da suspeita depois de hoje");
    text("Data da suspeita", "2026-10-20");
    text("Primeiros sintomas (opcional)", "2026-10-21");
    submit();
    expect(screen.getByRole("alert").textContent).toBe("primeiros sintomas depois da data da suspeita");
    text("Primeiros sintomas (opcional)", "");
    submit();
    expect(screen.getByRole("alert").textContent).toBe("escolha a unidade notificadora");
    expect(mocked(api.createManualNotification)).not.toHaveBeenCalled();
  });

  it("sem CPF: sem sexo ou sem motivo não sai (o caminho do api, new_patient.*)", async () => {
    mocked(api.findSurveillanceDuplicates).mockResolvedValue([]);
    panel();
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    text("Nome completo", "José Souza"); text("Data de nascimento", "2026-09-30");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar pessoa sem CPF" }));
    await fillCase();
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    expect((await screen.findByRole("alert")).textContent).toBe("informe o sexo");
    text("Sexo", "female");
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    expect(screen.getByRole("alert").textContent).toBe("sem CPF, informe o motivo");
    expect(mocked(api.createManualNotification)).not.toHaveBeenCalled();
  });
});
