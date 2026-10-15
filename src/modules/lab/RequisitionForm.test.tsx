// src/modules/lab/RequisitionForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), lookupExamPatient: vi.fn(), listLabCandidates: vi.fn(), listLabExams: vi.fn(),
    listExamRequesters: vi.fn(), listActiveUnits: vi.fn(), createLabRequisition: vi.fn() };
});

import * as api from "../../lib/api";
import { RequisitionForm } from "./RequisitionForm";
import { renderWithProviders } from "../../test/campaignFixtures";
import { UBS21B, labRequisition, labUser } from "../../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const CANDIDATE = { id: "eo1", short_code: "K7M2Q9XW3P", sigtap_code: "0202020380", label: "Hemograma completo", priority: "routine", status: "awaiting_schedule", requester_name: "Dra. Ana" };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.lookupExamPatient, api.listLabCandidates, api.listLabExams, api.listExamRequesters,
    api.listActiveUnits, api.createLabRequisition ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "health_professional" ]));
  mocked(api.lookupExamPatient).mockResolvedValue({ id: "pa1", display_name: "Joana Lima", cpf_masked: "***.***.***-25" });
  mocked(api.listLabCandidates).mockResolvedValue([ CANDIDATE ]);
  mocked(api.listLabExams).mockResolvedValue([ { sigtap_code: "0202010473", name: "Glicose", material: "soro", delivery_days: 2 } ]);
  mocked(api.listExamRequesters).mockResolvedValue([ { user_id: "us1", name: "Dra. Ana" } ]);
  mocked(api.createLabRequisition).mockResolvedValue(labRequisition());
});

async function findPatient() {
  fireEvent.change(await screen.findByLabelText("CPF do paciente"), { target: { value: "529.982.247-25" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar paciente" }));
  await screen.findByText(/Paciente: Joana Lima/);
}

describe("RequisitionForm", () => {
  it("UBS: candidatos do 21a, sexo, mãe e envio com a unidade e o local fixos", async () => {
    const onDone = vi.fn();
    renderWithProviders(<RequisitionForm place="ubs" providerId="pv9" originUnit={UBS21B} onDone={onDone} onCancel={vi.fn()} />);
    await findPatient();
    expect(api.listLabCandidates).toHaveBeenCalledWith("pa1", "pv9");
    fireEvent.click(await screen.findByRole("checkbox", { name: /Hemograma completo/ }));
    fireEvent.change(screen.getByLabelText("Sexo biológico"), { target: { value: "female" } });
    fireEvent.change(screen.getByLabelText("Nome da mãe"), { target: { value: "Maria Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir requisição" }));
    await waitFor(() => expect(api.createLabRequisition).toHaveBeenCalledWith({
      patient_id: "pa1", provider_id: "pv9", origin_unit_id: "u1", collection_place: "ubs", biological_sex: "female",
      mother_name: "Maria Lima", urgent: false, exam_order_ids: [ "eo1" ]
    }));
    expect(onDone).toHaveBeenCalledWith(labRequisition());
  });

  it("sem nome da mãe não envia e diz por quê", async () => {
    renderWithProviders(<RequisitionForm place="ubs" providerId="pv9" originUnit={UBS21B} onDone={vi.fn()} onCancel={vi.fn()} />);
    await findPatient();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Hemograma completo/ }));
    fireEvent.change(screen.getByLabelText("Sexo biológico"), { target: { value: "female" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir requisição" }));
    expect(screen.getByRole("alert").textContent).toBe("informe o nome da mãe (identificação da amostra)");
    expect(api.createLabRequisition).not.toHaveBeenCalled();
  });

  it("laboratório: pede a unidade de origem; pedido em papel com solicitante digitado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    mocked(api.listActiveUnits).mockResolvedValue([ UBS21B, { id: "u2", name: "UBS Norte", kind: "ubs" } ]);
    mocked(api.listLabCandidates).mockResolvedValue([]);
    renderWithProviders(<RequisitionForm place="lab" providerId="pv9" originUnit={null} onDone={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole("option", { name: "UBS Norte" });
    fireEvent.change(screen.getByLabelText("Unidade de origem"), { target: { value: "u2" } });
    await findPatient();
    expect(await screen.findByText("nenhum exame do paciente aguardando este laboratório — use o pedido em papel")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Incluir pedido em papel" }));
    const paper = screen.getByRole("group", { name: "Pedido em papel 1" });
    fireEvent.change(within(paper).getByLabelText("Exame"), { target: { value: "0202010473" } });
    fireEvent.click(within(paper).getByLabelText("Digitar quem pediu"));
    fireEvent.change(within(paper).getByLabelText("Nome de quem pediu"), { target: { value: "Dr. Externo" } });
    fireEvent.change(within(paper).getByLabelText("CNS de quem pediu"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Sexo biológico"), { target: { value: "male" } });
    fireEvent.change(screen.getByLabelText("Nome da mãe"), { target: { value: "Maria Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir requisição" }));
    expect(screen.getByRole("alert").textContent).toBe("pedido em papel 1: CNS de quem pediu inválido");
    fireEvent.change(within(paper).getByLabelText("CNS de quem pediu"), { target: { value: "702002887429583" } });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir requisição" }));
    await waitFor(() => expect(mocked(api.createLabRequisition).mock.calls[0][0]).toMatchObject({
      origin_unit_id: "u2", collection_place: "lab", exam_order_ids: [],
      paper_orders: [ { sigtap_code: "0202010473", requester: { name: "Dr. Externo", cns: "702002887429583" } } ]
    }));
  });

  it("422 order_not_eligible: explica e relê os candidatos", async () => {
    mocked(api.createLabRequisition).mockRejectedValueOnce(new api.ApiError(422, { error: "order_not_eligible" }, "x"));
    renderWithProviders(<RequisitionForm place="ubs" providerId="pv9" originUnit={UBS21B} onDone={vi.fn()} onCancel={vi.fn()} />);
    await findPatient();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Hemograma completo/ }));
    fireEvent.change(screen.getByLabelText("Sexo biológico"), { target: { value: "female" } });
    fireEvent.change(screen.getByLabelText("Nome da mãe"), { target: { value: "Maria Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir requisição" }));
    expect((await screen.findByRole("alert")).textContent).toContain("um dos exames não pode entrar na requisição");
    await waitFor(() => expect(api.listLabCandidates).toHaveBeenCalledTimes(2));
  });

  it("trocar a unidade de origem zera o profissional da rede escolhido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    mocked(api.listActiveUnits).mockResolvedValue([ UBS21B, { id: "u2", name: "UBS Norte", kind: "ubs" } ]);
    renderWithProviders(<RequisitionForm place="lab" providerId="pv9" originUnit={null} onDone={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole("option", { name: "UBS Norte" });
    fireEvent.change(screen.getByLabelText("Unidade de origem"), { target: { value: "u1" } });
    await findPatient();
    fireEvent.click(screen.getByRole("button", { name: "Incluir pedido em papel" }));
    const paper = screen.getByRole("group", { name: "Pedido em papel 1" });
    await within(paper).findByRole("option", { name: "Dra. Ana" });
    fireEvent.change(within(paper).getByLabelText("Quem pediu"), { target: { value: "us1" } });
    expect((within(paper).getByLabelText("Quem pediu") as HTMLSelectElement).value).toBe("us1");
    fireEvent.change(screen.getByLabelText("Unidade de origem"), { target: { value: "u2" } });
    expect((within(paper).getByLabelText("Quem pediu") as HTMLSelectElement).value).toBe("");
  });

  it("corpo com pedido em papel da rede, urgente e informação clínica", async () => {
    renderWithProviders(<RequisitionForm place="ubs" providerId="pv9" originUnit={UBS21B} onDone={vi.fn()} onCancel={vi.fn()} />);
    await findPatient();
    fireEvent.click(screen.getByRole("button", { name: "Incluir pedido em papel" }));
    const paper = screen.getByRole("group", { name: "Pedido em papel 1" });
    await within(paper).findByRole("option", { name: "Dra. Ana" });
    fireEvent.change(within(paper).getByLabelText("Exame"), { target: { value: "0202010473" } });
    fireEvent.change(within(paper).getByLabelText("Quem pediu"), { target: { value: "us1" } });
    fireEvent.change(screen.getByLabelText("Sexo biológico"), { target: { value: "female" } });
    fireEvent.change(screen.getByLabelText("Nome da mãe"), { target: { value: "Maria Lima" } });
    fireEvent.click(screen.getByLabelText("Urgente"));
    fireEvent.change(screen.getByLabelText("Informação clínica (opcional)"), { target: { value: "jejum de 8 h" } });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir requisição" }));
    await waitFor(() => expect(mocked(api.createLabRequisition).mock.calls[0][0]).toMatchObject({
      urgent: true, clinical_info: "jejum de 8 h", exam_order_ids: [],
      paper_orders: [ { sigtap_code: "0202010473", requester: { user_id: "us1" } } ]
    }));
  });

  it("order_not_eligible limpa a seleção", async () => {
    mocked(api.createLabRequisition).mockRejectedValueOnce(new api.ApiError(422, { error: "order_not_eligible" }, "x"));
    renderWithProviders(<RequisitionForm place="ubs" providerId="pv9" originUnit={UBS21B} onDone={vi.fn()} onCancel={vi.fn()} />);
    await findPatient();
    const box = await screen.findByRole("checkbox", { name: /Hemograma completo/ });
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText("Sexo biológico"), { target: { value: "female" } });
    fireEvent.change(screen.getByLabelText("Nome da mãe"), { target: { value: "Maria Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir requisição" }));
    await screen.findByRole("alert");
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /Hemograma completo/ }) as HTMLInputElement).checked).toBe(false));
  });

  it.each([
    [ "mother_name_required", "informe o nome da mãe (identificação da amostra)" ],
    [ "exam_not_in_lab_catalog", "este exame não está no catálogo do laboratório" ]
  ])("422 %s mostra a mensagem", async (code, message) => {
    mocked(api.createLabRequisition).mockRejectedValueOnce(new api.ApiError(422, { error: code }, "x"));
    renderWithProviders(<RequisitionForm place="ubs" providerId="pv9" originUnit={UBS21B} onDone={vi.fn()} onCancel={vi.fn()} />);
    await findPatient();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Hemograma completo/ }));
    fireEvent.change(screen.getByLabelText("Sexo biológico"), { target: { value: "female" } });
    fireEvent.change(screen.getByLabelText("Nome da mãe"), { target: { value: "Maria Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir requisição" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });
});
