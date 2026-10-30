import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listMyPharmacyLocations: vi.fn(), lookupPharmacyPerson: vi.fn(), findPharmacyDuplicates: vi.fn(), searchPharmacyItems: vi.fn(),
  createExternalPrescription: vi.fn(), listPositions: vi.fn(), recordDispensation: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { PharmacyExternal } from "./PharmacyExternal";
import { renderWithProviders } from "../test/campaignFixtures";
import { AMOXI, CLONA, TODAY27, UBS_FARM, dispensation, phUser, position, prescription } from "../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const textAt = (label: string, index: number, value: string) => fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value } });
const lines = async () => (await screen.findAllByRole("listitem")).map((li) => li.textContent);

async function choosePatient() {
  await screen.findByLabelText("CPF"); text("CPF", "123.456.789-09");
  fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
  fireEvent.click(await screen.findByRole("button", { name: "Usar Joana Lima" }));
}
function prescriber(date = "2026-10-28") {
  text("Nome do profissional", "Dr. Ivo Teles"); text("Conselho", "CRM"); text("UF do conselho", "SC"); text("Número no conselho", "45678"); text("Data da receita", date);
}
async function addItem(name: string, unit: string) {
  text("Acrescentar medicamento", name.slice(0, 5).toLowerCase());
  fireEvent.click(await screen.findByRole("button", { name: `${name} · ${unit}` }));
}
const AMOXI_NAME = "Amoxicilina 500 mg cápsula";
const CLONA_NAME = "Clonazepam 2 mg comprimido";
const register = () => fireEvent.click(screen.getByRole("button", { name: "Registrar receita externa" }));

describe("PharmacyExternal", () => {
  beforeEach(() => {
    for (const fn of [ api.createExternalPrescription, api.searchPharmacyItems, api.findPharmacyDuplicates, api.lookupPharmacyPerson, api.recordDispensation ]) mocked(fn).mockReset();
    window.localStorage.clear(); window.sessionStorage.clear();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    mocked(api.lookupPharmacyPerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null, has_cpf: true, cns_masked: null });
    mocked(api.searchPharmacyItems).mockImplementation((q: string) => Promise.resolve(q.startsWith("clona") ? [ CLONA ] : [ AMOXI ]));
    mocked(api.listPositions).mockResolvedValue({ positions: [ position() ], next_before: null });
    mocked(api.createExternalPrescription).mockResolvedValue(prescription({ kind: "external", id: "ex1", short_code: null }));
  });

  it("paciente, profissional, item; corpo; a dispensação abre em seguida", async () => {
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await choosePatient(); prescriber();
    await addItem(AMOXI_NAME, "cápsula");
    expect((screen.getByLabelText("Unidade") as HTMLInputElement).value).toBe("cápsula");
    text("Quantidade prescrita", "21"); text("Posologia", "1 cápsula de 8 em 8 horas por 7 dias");
    expect(screen.queryByLabelText("Número da notificação")).not.toBeNull();
    // Antimicrobiano: o api calcula a retenção; a tela não tem campo para isso.
    expect(screen.queryByLabelText(/antimicrobiano|retenção|retida/i)).toBeNull();
    register();
    await waitFor(() => expect(mocked(api.createExternalPrescription)).toHaveBeenCalledWith({ patient_id: "pa1", location_id: "l2",
      prescriber: { name: "Dr. Ivo Teles", council: "CRM", council_state: "SC", council_number: "45678" }, issued_on: "2026-10-28",
      items: [ { catalog_item_id: "ci1", quantity: "21", quantity_unit: "cápsula", dosage_instructions: "1 cápsula de 8 em 8 horas por 7 dias", continuous: false } ] }));
    expect(await screen.findByRole("button", { name: "Registrar dispensação" })).not.toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("auxiliar: controlado recusado antes, sem campo de notificação", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacy_assistant" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [ "pharmacy_assistant" ] } ]);
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await choosePatient(); prescriber();
    expect(screen.queryByLabelText("Número da notificação")).toBeNull();
    await addItem(CLONA_NAME, "comprimido");
    text("Quantidade prescrita", "30"); text("Posologia", "1 comprimido à noite");
    register();
    expect((await screen.findAllByRole("listitem")).map((li) => li.textContent))
      .toContain("Clonazepam 2 mg comprimido: receita externa de controlado só o farmacêutico registra");
    expect(mocked(api.createExternalPrescription)).not.toHaveBeenCalled();
  });

  it("recusas do api na receita externa: invalid_patient e cpf_taken têm frase, não o código cru", async () => {
    mocked(api.createExternalPrescription)
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_patient", path: "new_patient.full_name",
        problems: [ { path: "new_patient.full_name", error: "invalid_patient" } ] }, "422"))
      .mockRejectedValueOnce(new ApiError(409, { error: "cpf_taken", path: "new_patient.cpf" }, "409"));
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await choosePatient(); prescriber();
    await addItem(AMOXI_NAME, "cápsula");
    text("Quantidade prescrita", "21"); text("Posologia", "1 cápsula de 8 em 8 horas");
    register();
    expect(await screen.findByText("confira os dados do paciente novo")).not.toBeNull();
    register();
    expect(await screen.findByText("este CPF já pertence a outro paciente — confira o número")).not.toBeNull();
    expect(screen.queryByText(/não foi possível concluir/)).toBeNull();
  });

  it("data no futuro, conselho incompleto e sem item: todas de uma vez; a recusa do api fica no formulário", async () => {
    mocked(api.createExternalPrescription).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "prescriber.council_number" }, "422"));
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await choosePatient(); prescriber("2026-10-30"); text("Número no conselho", "");
    register();
    expect(await lines()).toEqual(expect.arrayContaining([
      "a data da receita não pode ser depois de hoje", "o número no conselho tem só dígitos (até 10)", "acrescente ao menos um medicamento" ]));
    prescriber();
    await addItem(AMOXI_NAME, "cápsula");
    text("Quantidade prescrita", "21"); text("Posologia", "1 cápsula de 8 em 8 horas");
    register();
    expect(await screen.findByText("confira os dados do profissional da receita: nome, conselho, UF e número")).not.toBeNull();
    expect((screen.getByLabelText("Nome do profissional") as HTMLInputElement).value).toBe("Dr. Ivo Teles");
    expect((screen.getByLabelText("Quantidade prescrita") as HTMLInputElement).value).toBe("21");
  });

  it("lista A ou B: o farmacêutico precisa da notificação; o número vai no corpo; controlado avisa os 30 dias", async () => {
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await choosePatient(); prescriber();
    await addItem(AMOXI_NAME, "cápsula");
    expect(screen.queryByText(/vale 30 dias/)).toBeNull();
    await addItem(CLONA_NAME, "comprimido");
    expect(screen.queryByText(/vale 30 dias/)).not.toBeNull();
    textAt("Quantidade prescrita", 0, "21"); textAt("Posologia", 0, "1 cápsula de 8 em 8 horas");
    textAt("Quantidade prescrita", 1, "30"); textAt("Posologia", 1, "1 comprimido à noite"); textAt("Unidade", 1, "comp.");
    fireEvent.click(screen.getAllByLabelText("Uso contínuo")[1]);
    register();
    expect(await lines()).toEqual([ "receita de lista A ou B exige o número da notificação" ]);
    expect(mocked(api.createExternalPrescription)).not.toHaveBeenCalled();
    text("Número da notificação", "B-123.456/26");
    register();
    await waitFor(() => expect(mocked(api.createExternalPrescription)).toHaveBeenCalledTimes(1));
    expect(mocked(api.createExternalPrescription).mock.calls[0][0]).toEqual({ patient_id: "pa1", location_id: "l2",
      prescriber: { name: "Dr. Ivo Teles", council: "CRM", council_state: "SC", council_number: "45678" }, issued_on: "2026-10-28",
      notification_number: "B-123.456/26",
      items: [
        { catalog_item_id: "ci1", quantity: "21", quantity_unit: "cápsula", dosage_instructions: "1 cápsula de 8 em 8 horas", continuous: false },
        { catalog_item_id: "ci2", quantity: "30", quantity_unit: "comp.", dosage_instructions: "1 comprimido à noite", continuous: true } ] });
  });

  it("quantidade, unidade e posologia fora da regra, por item; Remover tira a linha", async () => {
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await choosePatient(); prescriber();
    await addItem(AMOXI_NAME, "cápsula");
    text("Quantidade prescrita", "21,555"); text("Unidade", ""); text("Posologia", "ab");
    register();
    expect(await lines()).toEqual([
      "Amoxicilina 500 mg cápsula: a quantidade prescrita tem no máximo 2 casas depois da vírgula",
      "Amoxicilina 500 mg cápsula: a unidade tem de 1 a 30 caracteres",
      "Amoxicilina 500 mg cápsula: a posologia tem de 3 a 500 caracteres" ]);
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(screen.queryByLabelText("Quantidade prescrita")).toBeNull();
    register();
    expect(await lines()).toEqual([ "acrescente ao menos um medicamento" ]);
    expect(mocked(api.createExternalPrescription)).not.toHaveBeenCalled();
  });

  it("422 com problems: cada problema na linha do item enviado; vencida e papel têm frase própria", async () => {
    mocked(api.createExternalPrescription)
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "items[1].quantity", problems: [
        { path: "items[1].quantity", error: "invalid_request" }, { path: "items[0].dosage_instructions", error: "invalid_request" } ] }, "422"))
      .mockRejectedValueOnce(new ApiError(422, { error: "prescription_expired", path: "issued_on" }, "422"))
      .mockRejectedValueOnce(new ApiError(403, { error: "controlled_requires_pharmacist" }, "403"));
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await choosePatient(); prescriber();
    await addItem(AMOXI_NAME, "cápsula"); await addItem(CLONA_NAME, "comprimido");
    textAt("Quantidade prescrita", 0, "21"); textAt("Posologia", 0, "1 cápsula de 8 em 8 horas");
    textAt("Quantidade prescrita", 1, "30"); textAt("Posologia", 1, "1 comprimido à noite"); text("Número da notificação", "B-1");
    register();
    await waitFor(() => expect(screen.queryAllByRole("listitem").length).toBe(2));
    expect(await lines()).toEqual([ `${CLONA_NAME}: quantidade inválida — use até 2 casas depois da vírgula`, `${AMOXI_NAME}: confira o item destacado` ]);
    register();
    expect(await screen.findByText("a receita já nasce vencida — confira a data da receita")).not.toBeNull();
    register();
    expect(await screen.findByText("receita externa de controlado só o farmacêutico registra")).not.toBeNull();
    expect(mocked(api.createExternalPrescription)).toHaveBeenCalledTimes(3);
  });

  it("CPF sem ninguém: pessoa nova no corpo; 409 duplicate_suspected volta à busca e segue revisada", async () => {
    mocked(api.lookupPharmacyPerson).mockRejectedValue(new ApiError(404, { error: "person_not_found" }, "404"));
    mocked(api.findPharmacyDuplicates).mockResolvedValue([]);
    mocked(api.createExternalPrescription)
      .mockRejectedValueOnce(new ApiError(409, { error: "duplicate_suspected" }, "409"))
      .mockResolvedValueOnce(prescription({ kind: "external", id: "ex2", short_code: null }));
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await screen.findByLabelText("CPF"); text("CPF", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    text("Nome completo", "José Souza"); text("Data de nascimento", "1990-03-04"); text("Nome da mãe", "Maria Souza"); text("Sexo", "male");
    expect(screen.queryByLabelText("Motivo de não ter CPF")).toBeNull();
    const fill = async () => {
      prescriber(); await addItem(AMOXI_NAME, "cápsula");
      text("Quantidade prescrita", "21"); text("Posologia", "1 cápsula de 8 em 8 horas"); register();
    };
    await fill();
    await waitFor(() => expect(mocked(api.createExternalPrescription)).toHaveBeenCalledTimes(1));
    const first = mocked(api.createExternalPrescription).mock.calls[0][0];
    expect(first.new_patient).toEqual({ full_name: "José Souza", birth_date: "1990-03-04", mother_name: "Maria Souza", sex: "male", cpf: "52998224725" });
    expect(first.location_id).toBe("l2");
    expect("duplicates_reviewed" in first).toBe(false);
    expect("patient_id" in first).toBe(false);
    await waitFor(() => expect(mocked(api.findPharmacyDuplicates).mock.calls[0][0]).toEqual({ full_name: "José Souza", birth_date: "1990-03-04", mother_name: "Maria Souza" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar pessoa nova com o CPF" }));
    expect(screen.queryByLabelText("Nome completo")).toBeNull();
    text("Sexo", "male");
    await fill();
    await waitFor(() => expect(mocked(api.createExternalPrescription)).toHaveBeenCalledTimes(2));
    const second = mocked(api.createExternalPrescription).mock.calls[1][0];
    expect(second.new_patient).toEqual(first.new_patient);
    expect(second.location_id).toBe("l2");
    expect(second.duplicates_reviewed).toBe(true);
  });

  it("pessoa nova inválida: a frase do 24a antes de enviar", async () => {
    mocked(api.lookupPharmacyPerson).mockRejectedValue(new ApiError(404, { error: "person_not_found" }, "404"));
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await screen.findByLabelText("CPF"); text("CPF", "52998224725");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    prescriber(); await addItem(AMOXI_NAME, "cápsula");
    text("Quantidade prescrita", "21"); text("Posologia", "1 cápsula de 8 em 8 horas"); register();
    expect((await lines()).length).toBeGreaterThan(0);
    expect(mocked(api.createExternalPrescription)).not.toHaveBeenCalled();
  });

  it("depois de registrar: cancelar a dispensação deixa a receita registrada e volta ao começo", async () => {
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await choosePatient(); prescriber(); await addItem(AMOXI_NAME, "cápsula");
    text("Quantidade prescrita", "21"); text("Posologia", "1 cápsula de 8 em 8 horas"); register();
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect((await screen.findByRole("status")).textContent).toBe("Receita externa registrada; dispense depois pela busca do paciente.");
    expect(screen.queryByLabelText("CPF")).not.toBeNull();
    expect(mocked(api.createExternalPrescription)).toHaveBeenCalledTimes(1);
  });

  it("depois de registrar: dispensar a receita criada e voltar ao começo", async () => {
    mocked(api.recordDispensation).mockResolvedValue(dispensation());
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    await choosePatient(); prescriber(); await addItem(AMOXI_NAME, "cápsula");
    text("Quantidade prescrita", "21"); text("Posologia", "1 cápsula de 8 em 8 horas"); register();
    await screen.findByRole("button", { name: "Registrar dispensação" });
    await waitFor(() => expect(mocked(api.listPositions)).toHaveBeenCalled());
    fireEvent.change(await screen.findByLabelText(`Quantidade — ${AMOXI_NAME} (cápsula)`), { target: { value: "21" } });
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    await waitFor(() => expect(mocked(api.recordDispensation)).toHaveBeenCalledTimes(1));
    expect(mocked(api.recordDispensation).mock.calls[0][0].prescription).toEqual({ kind: "external", id: "ex1" });
    expect((await screen.findByRole("status")).textContent).toBe("Dispensação registrada.");
    expect(screen.queryByLabelText("CPF")).not.toBeNull();
  });

  it("almoxarife sem papel de dispensação não usa a tela", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    renderWithProviders(<PharmacyExternal today={TODAY27} delayMs={0} />);
    expect(await screen.findByText("seu papel não permite usar a farmácia")).not.toBeNull();
    expect(screen.queryByLabelText("CPF")).toBeNull();
  });
});
