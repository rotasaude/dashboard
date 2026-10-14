// src/modules/ExamsUnit.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listActiveUnits: vi.fn(), listExamCatalog: vi.fn(), listExamRequesters: vi.fn(),
    lookupExamPatient: vi.fn(), uploadExamFile: vi.fn(), createReceptionOrder: vi.fn(), listExamOrders: vi.fn(), getExamOrder: vi.fn(),
    listEnabledProviders: vi.fn(), recordExternalResult: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ExamsUnit } from "./ExamsUnit";
import { renderWithProviders } from "../test/campaignFixtures";
import { HBA1C_ENTRY, HEMOGRAM_ENTRY, NOW21, UNIT21, VALID_CNS, VALID_CPF, examOrder, examUser, pdfFile } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listActiveUnits, api.listExamCatalog, api.listExamRequesters, api.lookupExamPatient,
  api.uploadExamFile, api.createReceptionOrder, api.listExamOrders, api.getExamOrder, api.listEnabledProviders, api.recordExternalResult ];

afterEach(() => { cleanup(); vi.useRealTimers(); });

async function openUnit() {
  fireEvent.click(await screen.findByRole("button", { name: "UBS Centro" }));
}

async function startGuide() {
  await openUnit();
  fireEvent.click(await screen.findByRole("button", { name: "Nova guia" }));
  const form = screen.getByRole("form", { name: "Nova guia" });
  fireEvent.change(within(form).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
  fireEvent.click(within(form).getByRole("button", { name: "Buscar paciente" }));
  await within(form).findByText("Paciente: Joana Lima · CPF ***.982.247-**");
  fireEvent.change(await within(form).findByLabelText("Exame"), { target: { value: "0202020380" } });
  return form;
}

async function attach(form: HTMLElement) {
  fireEvent.change(within(form).getByLabelText("Foto ou PDF da guia (até 10 MB)"), { target: { files: [ pdfFile("guia.pdf") ] } });
  await within(form).findByText("anexado: guia.pdf");
}

describe("ExamsUnit", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW21));
    localStorage.clear();
    for (const fn of ALL) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "citizen_verifier" ], { id: "us9" }));
    mocked(api.listActiveUnits).mockResolvedValue([ UNIT21 ]);
    mocked(api.listExamCatalog).mockResolvedValue([ HEMOGRAM_ENTRY, HBA1C_ENTRY ]);
    mocked(api.listExamRequesters).mockResolvedValue([ { user_id: "us1", name: "Dra. Ana Souza" } ]);
    mocked(api.lookupExamPatient).mockResolvedValue({ id: "pa1", display_name: "Joana Lima", cpf_masked: "***.982.247-**" });
    mocked(api.uploadExamFile).mockResolvedValue("up1");
    mocked(api.createReceptionOrder).mockResolvedValue(examOrder({ origin: "reception_guide" }));
    mocked(api.listExamOrders).mockResolvedValue({ orders: [ examOrder() ], next_before: null });
    mocked(api.listEnabledProviders).mockResolvedValue([]);
  });

  it("guia com profissional da rede: busca o paciente pelo CPF no corpo e registra", async () => {
    renderWithProviders(<ExamsUnit />);
    const form = await startGuide();
    expect(api.lookupExamPatient).toHaveBeenCalledWith(VALID_CPF);
    expect(api.listExamRequesters).toHaveBeenCalledWith("u1");
    fireEvent.click(within(form).getByLabelText("Urgente"));
    fireEvent.change(await within(form).findByLabelText("Profissional que pediu"), { target: { value: "us1" } });
    fireEvent.change(within(form).getByLabelText("CID-10 de justificativa (opcional)"), { target: { value: "e11" } });
    await attach(form);
    fireEvent.click(within(form).getByRole("button", { name: "Registrar guia" }));
    await waitFor(() => expect(api.createReceptionOrder).toHaveBeenCalledWith({
      patient_id: "pa1", unit_id: "u1", sigtap_code: "0202020380", priority: "urgent", cid10_justification: "E11",
      requester: { user_id: "us1" }, guide_upload_id: "up1"
    }));
    expect((await screen.findByText("Guia registrada · código K7M2Q9XW3P")).getAttribute("role")).toBe("status");
    expect(screen.queryByRole("form", { name: "Nova guia" })).toBeNull();
  });

  it("solicitante digitado: CNS inválido não envia; válido manda nome e CNS", async () => {
    renderWithProviders(<ExamsUnit />);
    const form = await startGuide();
    fireEvent.click(within(form).getByLabelText("Outro (nome e CNS)"));
    fireEvent.change(within(form).getByLabelText("Nome de quem pediu"), { target: { value: "Dr. Externo" } });
    fireEvent.change(within(form).getByLabelText("CNS de quem pediu"), { target: { value: "123" } });
    await attach(form);
    fireEvent.click(within(form).getByRole("button", { name: "Registrar guia" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("CNS de quem pediu inválido");
    expect(api.createReceptionOrder).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("CNS de quem pediu"), { target: { value: VALID_CNS } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar guia" }));
    await waitFor(() => expect(mocked(api.createReceptionOrder).mock.calls[0][0].requester).toEqual({ name: "Dr. Externo", cns: VALID_CNS }));
  });

  it("guia sem anexo não é enviada", async () => {
    renderWithProviders(<ExamsUnit />);
    const form = await startGuide();
    fireEvent.change(await within(form).findByLabelText("Profissional que pediu"), { target: { value: "us1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar guia" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("anexe a foto ou o PDF da guia");
    expect(api.createReceptionOrder).not.toHaveBeenCalled();
  });

  it("CPF sem paciente na cidade e CPF inválido explicam", async () => {
    mocked(api.lookupExamPatient).mockRejectedValue(new ApiError(404, { error: "patient_not_found" }, "x"));
    renderWithProviders(<ExamsUnit />);
    await openUnit();
    fireEvent.click(await screen.findByRole("button", { name: "Nova guia" }));
    const form = screen.getByRole("form", { name: "Nova guia" });
    fireEvent.change(within(form).getByLabelText("CPF do paciente"), { target: { value: "11111111111" } });
    fireEvent.click(within(form).getByRole("button", { name: "Buscar paciente" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("CPF inválido");
    expect(api.lookupExamPatient).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
    fireEvent.click(within(form).getByRole("button", { name: "Buscar paciente" }));
    await waitFor(() => expect(within(form).getByRole("alert").textContent).toBe("nenhum paciente com este CPF na cidade"));
  });

  it("422 sigtap_not_in_catalog do api aparece no formulário", async () => {
    mocked(api.createReceptionOrder).mockRejectedValue(new ApiError(422, { error: "sigtap_not_in_catalog" }, "x"));
    renderWithProviders(<ExamsUnit />);
    const form = await startGuide();
    fireEvent.change(await within(form).findByLabelText("Profissional que pediu"), { target: { value: "us1" } });
    await attach(form);
    fireEvent.click(within(form).getByRole("button", { name: "Registrar guia" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("este exame não está no catálogo da cidade");
  });

  it("lista da unidade por situação; Abrir mostra o exame", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder());
    renderWithProviders(<ExamsUnit />);
    await openUnit();
    const list = await screen.findByRole("region", { name: "Exames da unidade" });
    await waitFor(() => expect(api.listExamOrders).toHaveBeenCalledWith({ unitId: "u1", statuses: [ "awaiting_schedule" ], before: null }));
    fireEvent.click(within(list).getByRole("tab", { name: "Agendados" }));
    await waitFor(() => expect(api.listExamOrders).toHaveBeenCalledWith({ unitId: "u1", statuses: [ "scheduled" ], before: null }));
    fireEvent.click(await within(list).findByRole("button", { name: "Abrir Hemograma completo de Joana Lima" }));
    expect(await screen.findByRole("region", { name: "Exame Hemograma completo" })).not.toBeNull();
  });

  it("trocar o paciente descarta o anexo da guia (documento do paciente anterior)", async () => {
    renderWithProviders(<ExamsUnit />);
    const form = await startGuide();
    fireEvent.change(await within(form).findByLabelText("Profissional que pediu"), { target: { value: "us1" } });
    await attach(form);
    const fileBefore = within(form).getByLabelText("Foto ou PDF da guia (até 10 MB)");
    fireEvent.click(within(form).getByRole("button", { name: "Trocar paciente" }));
    expect(within(form).getByText("anexe a guia de novo")).not.toBeNull();
    expect(within(form).queryByText("anexado: guia.pdf")).toBeNull();
    // O campo foi remontado: o elemento antigo (com o arquivo) saiu do documento.
    expect(fileBefore.isConnected).toBe(false);
    fireEvent.change(within(form).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
    fireEvent.click(within(form).getByRole("button", { name: "Buscar paciente" }));
    await within(form).findByText("Paciente: Joana Lima · CPF ***.982.247-**");
    fireEvent.click(within(form).getByRole("button", { name: "Registrar guia" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("anexe a foto ou o PDF da guia");
    expect(api.createReceptionOrder).not.toHaveBeenCalled();
    await attach(form);
    expect(within(form).queryByText("anexe a guia de novo")).toBeNull();
  });

  it("Enter no CPF busca o paciente, na guia e no resultado externo", async () => {
    renderWithProviders(<ExamsUnit />);
    await openUnit();
    fireEvent.click(await screen.findByRole("button", { name: "Nova guia" }));
    const form = screen.getByRole("form", { name: "Nova guia" });
    const cpf = within(form).getByLabelText("CPF do paciente");
    fireEvent.change(cpf, { target: { value: VALID_CPF } });
    expect(fireEvent.keyDown(cpf, { key: "Enter" })).toBe(false);
    await within(form).findByText("Paciente: Joana Lima · CPF ***.982.247-**");
    expect(within(form).queryByRole("alert")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Voltar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resultado externo" }));
    const ext = screen.getByRole("region", { name: "Registrar resultado externo" });
    const cpf2 = within(ext).getByLabelText("CPF do paciente");
    fireEvent.change(cpf2, { target: { value: VALID_CPF } });
    expect(fireEvent.keyDown(cpf2, { key: "Enter" })).toBe(false);
    await within(ext).findByText("Paciente: Joana Lima · CPF ***.982.247-**");
    expect(api.lookupExamPatient).toHaveBeenCalledTimes(2);
  });

  it("o CPF não fica no campo depois da busca (nem ao trocar o paciente) nem no cache de consultas", async () => {
    const { client } = renderWithProviders(<ExamsUnit />);
    const form = await startGuide();
    fireEvent.click(within(form).getByRole("button", { name: "Trocar paciente" }));
    expect((within(form).getByLabelText("CPF do paciente") as HTMLInputElement).value).toBe("");
    expect(screen.queryByDisplayValue(VALID_CPF)).toBeNull();
    expect(screen.queryByDisplayValue("529.982.247-25")).toBeNull();
    const cached = JSON.stringify(client.getQueryCache().getAll().map((q) => [ q.queryKey, q.state.data ]));
    expect(cached.replace(/\D/g, "")).not.toContain(VALID_CPF);
  });

  it("guarda para um useMutation futuro: o cache de mutações não guarda o CPF", async () => {
    const { client } = renderWithProviders(<ExamsUnit />);
    await startGuide();
    const mutations = JSON.stringify(client.getMutationCache().getAll().map((m) => m.state));
    expect(mutations.replace(/\D/g, "")).not.toContain(VALID_CPF);
  });

  it("upload que termina depois de trocar o paciente não é anexado", async () => {
    let finish: (id: string) => void = () => {};
    mocked(api.uploadExamFile).mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    renderWithProviders(<ExamsUnit />);
    const form = await startGuide();
    fireEvent.change(await within(form).findByLabelText("Profissional que pediu"), { target: { value: "us1" } });
    fireEvent.change(within(form).getByLabelText("Foto ou PDF da guia (até 10 MB)"), { target: { files: [ pdfFile("guia-a.pdf") ] } });
    await within(form).findByText("enviando o arquivo…");
    fireEvent.click(within(form).getByRole("button", { name: "Trocar paciente" }));
    mocked(api.lookupExamPatient).mockResolvedValueOnce({ id: "pa2", display_name: "Maria Souza", cpf_masked: "***.123.456-**" });
    fireEvent.change(within(form).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
    fireEvent.click(within(form).getByRole("button", { name: "Buscar paciente" }));
    await within(form).findByText("Paciente: Maria Souza · CPF ***.123.456-**");
    finish("up-a");
    await new Promise((r) => setTimeout(r, 0));
    expect(within(form).queryByText("anexado: guia-a.pdf")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Registrar guia" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("anexe a foto ou o PDF da guia");
    expect(api.createReceptionOrder).not.toHaveBeenCalled();
  });

  it("busca em andamento ignora novo clique ou Enter", async () => {
    let found: (p: { id: string; display_name: string; cpf_masked: string }) => void = () => {};
    mocked(api.lookupExamPatient).mockImplementationOnce(() => new Promise((resolve) => { found = resolve; }));
    renderWithProviders(<ExamsUnit />);
    await openUnit();
    fireEvent.click(await screen.findByRole("button", { name: "Nova guia" }));
    const form = screen.getByRole("form", { name: "Nova guia" });
    const cpf = within(form).getByLabelText("CPF do paciente");
    fireEvent.change(cpf, { target: { value: VALID_CPF } });
    fireEvent.click(within(form).getByRole("button", { name: "Buscar paciente" }));
    fireEvent.keyDown(cpf, { key: "Enter" });
    fireEvent.click(within(form).getByRole("button", { name: /Buscar paciente/ }));
    expect(api.lookupExamPatient).toHaveBeenCalledTimes(1);
    found({ id: "pa1", display_name: "Joana Lima", cpf_masked: "***.982.247-**" });
    await within(form).findByText("Paciente: Joana Lima · CPF ***.982.247-**");
  });

  it("CPF sem cadastro validado e excesso de buscas explicam", async () => {
    mocked(api.lookupExamPatient).mockRejectedValueOnce(new ApiError(409, { error: "citizen_not_verified" }, "x"))
      .mockRejectedValueOnce(new ApiError(429, { error: "too_many_requests" }, "x"));
    renderWithProviders(<ExamsUnit />);
    await openUnit();
    fireEvent.click(await screen.findByRole("button", { name: "Nova guia" }));
    const form = screen.getByRole("form", { name: "Nova guia" });
    fireEvent.change(within(form).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
    fireEvent.click(within(form).getByRole("button", { name: "Buscar paciente" }));
    await waitFor(() => expect(within(form).getByRole("alert").textContent)
      .toBe("este CPF ainda não tem cadastro validado — faça a validação presencial no balcão antes"));
    fireEvent.click(within(form).getByRole("button", { name: "Buscar paciente" }));
    await waitFor(() => expect(within(form).getByRole("alert").textContent).toBe("muitas tentativas seguidas — espere um minuto e tente de novo"));
  });

  it("número da guia no prestador aceita até 60 caracteres", async () => {
    renderWithProviders(<ExamsUnit />);
    await openUnit();
    fireEvent.click(await screen.findByRole("button", { name: "Nova guia" }));
    const ref = within(screen.getByRole("form", { name: "Nova guia" })).getByLabelText("Número da guia no prestador (opcional)");
    expect((ref as HTMLInputElement).maxLength).toBe(60);
  });

  it("papel sem acesso e rastreamento desligado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "viewer" ]));
    renderWithProviders(<ExamsUnit />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    cleanup();
    // C4: o administrador municipal não é da unidade.
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "municipal_admin" ]));
    renderWithProviders(<ExamsUnit />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "citizen_verifier" ], { features: [] }));
    renderWithProviders(<ExamsUnit />);
    expect(await screen.findByText("o rastreamento de exames está desligado nesta cidade")).not.toBeNull();
  });
});
