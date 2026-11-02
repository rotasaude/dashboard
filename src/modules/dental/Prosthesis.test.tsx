import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  listProsthesisOrders: vi.fn(), createProsthesisOrder: vi.fn(), changeProsthesisStage: vi.fn(), listDentalLaboratories: vi.fn(),
  listActiveUnits: vi.fn(), searchDentalProcedures: vi.fn(), getDentalChart: vi.fn(), listDentalPlans: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { DENTAL_DISABLED, DENTAL_NO_ROLE } from "../../lib/dental";
import { ProsthesisPanel } from "./ProsthesisPanel";
import { DentalEditor } from "./DentalEditor";
import { DentalProsthesis } from "../DentalProsthesis";
import { renderWithProviders } from "../../test/campaignFixtures";
import { record } from "../../test/consultationFixtures";
import { DENTURE, UBS, dentalDraft, dentalOptions, dentalUser, fields, odontogram, plan, prosthesisOrder } from "../../test/dentalFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("prótese", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser());
    mocked(api.listDentalLaboratories).mockResolvedValue([ { id: "cp1", name: "LRPD Municipal" } ]);
    mocked(api.listActiveUnits).mockResolvedValue([ UBS ]);
    mocked(api.searchDentalProcedures).mockResolvedValue([ DENTURE ]);
    mocked(api.createProsthesisOrder).mockResolvedValue(prosthesisOrder());
    mocked(api.listProsthesisOrders).mockResolvedValue({ orders: [ prosthesisOrder({ stage: "received" }) ], next_before: null });
    mocked(api.getDentalChart).mockResolvedValue(odontogram());
    mocked(api.listDentalPlans).mockResolvedValue([ plan() ]);
  });

  it("na consulta: novo pedido com laboratório terceiro e instalação do recebido", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ProsthesisPanel consultation={dentalDraft()} patientId="pa1" value={fields()} onChange={onChange} searchDelayMs={0} />);
    expect(mocked(api.listProsthesisOrders)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "total" } });
    fireEvent.click(await screen.findByRole("button", { name: `${DENTURE.sigtap} — ${DENTURE.name}` }));
    fireEvent.change(await screen.findByLabelText("Laboratório"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Nome do laboratório"), { target: { value: "Lab Sorriso" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pedido" }));
    await waitFor(() => expect(mocked(api.createProsthesisOrder)).toHaveBeenCalledWith({ patient_id: "pa1", consultation_id: "cs1", sigtap: DENTURE.sigtap,
      laboratory: { name: "Lab Sorriso" } }));
    fireEvent.click(screen.getByRole("button", { name: "Ver pedidos de prótese do paciente" }));
    expect(mocked(api.listProsthesisOrders)).toHaveBeenCalledWith({ patientId: "pa1", stage: null, before: null });
    fireEvent.click(await screen.findByRole("button", { name: `Registrar instalação nesta consulta — ${DENTURE.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Arcada superior" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar instalação" }));
    expect(onChange).toHaveBeenCalledWith(fields({ procedures: [ { sigtap: DENTURE.sigtap, name: DENTURE.name,
      location: { kind: "arch", tooth: null, face: null, sextant: null, arch: "upper" }, quantity: 1, plan_item_id: null, prosthesis_order_id: "po1" } ] }));
  });

  it("sob StrictMode: o pedido confirma e a lista aparece", async () => {
    renderWithProviders(<StrictMode><ProsthesisPanel consultation={dentalDraft()} patientId="pa1" value={fields()} onChange={vi.fn()} searchDelayMs={0} /></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: "Ver pedidos de prótese do paciente" }));
    expect(await screen.findByText(/Lab Sorriso/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "total" } });
    fireEvent.click(await screen.findByRole("button", { name: `${DENTURE.sigtap} — ${DENTURE.name}` }));
    fireEvent.change(await screen.findByLabelText("Laboratório"), { target: { value: "cp1" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pedido" }));
    await waitFor(() => expect(mocked(api.createProsthesisOrder)).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Registrar pedido" })).toBeNull());
  });

  it("na consulta: laboratório do município vai por id; nome curto é recusado sem enviar", async () => {
    renderWithProviders(<ProsthesisPanel consultation={dentalDraft()} patientId="pa1" value={fields()} onChange={vi.fn()} searchDelayMs={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "total" } });
    fireEvent.click(await screen.findByRole("button", { name: `${DENTURE.sigtap} — ${DENTURE.name}` }));
    fireEvent.change(await screen.findByLabelText("Laboratório"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Nome do laboratório"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pedido" }));
    expect(await screen.findByText("o nome do laboratório precisa de 3 a 120 caracteres")).not.toBeNull();
    expect(mocked(api.createProsthesisOrder)).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Laboratório"), { target: { value: "cp1" } });
    expect(screen.queryByLabelText("Nome do laboratório")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar pedido" }));
    await waitFor(() => expect(mocked(api.createProsthesisOrder)).toHaveBeenCalledWith({ patient_id: "pa1", consultation_id: "cs1", sigtap: DENTURE.sigtap,
      laboratory: { care_provider_id: "cp1" } }));
  });

  it("na consulta: pedido não recebido não oferece instalação; histórico de etapas aparece", async () => {
    mocked(api.listProsthesisOrders).mockResolvedValue({ orders: [ prosthesisOrder({ stage: "sent", created_at: "2026-10-20T10:00:00-03:00",
      stages: [ { stage: "impression", at: "2026-10-20T10:00:00-03:00", by: { name: "Dr. Caio Nunes" }, reason: null },
        { stage: "sent", at: "2026-10-22T10:00:00-03:00", by: { name: "Dr. Caio Nunes" }, reason: null } ] }) ], next_before: null });
    renderWithProviders(<ProsthesisPanel consultation={dentalDraft()} patientId="pa1" value={fields()} onChange={vi.fn()} searchDelayMs={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver pedidos de prótese do paciente" }));
    expect(await screen.findByText(/Lab Sorriso/)).not.toBeNull();
    expect(screen.getByText(/^Moldagem — /)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar instalação/ })).toBeNull();
  });

  it("tela: etapas permitidas, cancelamento com motivo e etapa mudada por outro", async () => {
    mocked(api.listProsthesisOrders).mockResolvedValue({ orders: [ prosthesisOrder() ], next_before: null });
    mocked(api.changeProsthesisStage).mockResolvedValueOnce(prosthesisOrder({ stage: "sent" }))
      .mockRejectedValueOnce(new ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<DentalProsthesis />);
    expect(mocked(api.listProsthesisOrders)).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByLabelText("Unidade"), { target: { value: "u1" } });
    expect(await screen.findByRole("button", { name: "Enviada ao laboratório — Joana Lima" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Recebida — Joana Lima" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enviada ao laboratório — Joana Lima" }));
    await waitFor(() => expect(mocked(api.changeProsthesisStage)).toHaveBeenCalledWith("po1", { stage: "sent" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar pedido — Joana Lima" }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "curto" } });
    expect((screen.getByRole("button", { name: "Confirmar cancelamento" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "paciente desistiu do tratamento" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText("o pedido de prótese mudou de etapa — a lista foi relida")).not.toBeNull();
    expect(mocked(api.changeProsthesisStage)).toHaveBeenLastCalledWith("po1", { stage: "cancelled", reason: "paciente desistiu do tratamento" });
    await waitFor(() => expect(mocked(api.listProsthesisOrders).mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(mocked(api.listProsthesisOrders)).toHaveBeenCalledWith({ healthUnitId: "u1", stage: null, before: null });
  });

  it("tela: filtro por etapa e Ver mais pelo next_before", async () => {
    mocked(api.listProsthesisOrders)
      .mockResolvedValueOnce({ orders: [ prosthesisOrder() ], next_before: "cur1" })
      .mockResolvedValueOnce({ orders: [ prosthesisOrder({ id: "po2", patient: { id: "pa2", display_name: "Maria Souza" } }) ], next_before: null })
      .mockResolvedValue({ orders: [], next_before: null });
    renderWithProviders(<DentalProsthesis />);
    fireEvent.change(await screen.findByLabelText("Unidade"), { target: { value: "u1" } });
    expect(await screen.findByRole("button", { name: "Enviada ao laboratório — Joana Lima" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver mais" }));
    expect(await screen.findByRole("button", { name: "Enviada ao laboratório — Maria Souza" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Enviada ao laboratório — Joana Lima" })).not.toBeNull();
    expect(mocked(api.listProsthesisOrders)).toHaveBeenNthCalledWith(2, { healthUnitId: "u1", stage: null, before: "cur1" });
    fireEvent.change(screen.getByLabelText("Etapa"), { target: { value: "sent" } });
    await waitFor(() => expect(mocked(api.listProsthesisOrders)).toHaveBeenLastCalledWith({ healthUnitId: "u1", stage: "sent", before: null }));
  });

  it("portão: interruptor desligado e papel errado não leem nada", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser([ "health_professional" ], { features: [ "clinical_record" ] }));
    renderWithProviders(<DentalProsthesis />);
    expect(await screen.findByText(DENTAL_DISABLED)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser([ "analyst" ]));
    renderWithProviders(<DentalProsthesis />);
    expect(await screen.findByText(DENTAL_NO_ROLE)).not.toBeNull();
    expect(mocked(api.listActiveUnits)).not.toHaveBeenCalled();
    expect(mocked(api.listProsthesisOrders)).not.toHaveBeenCalled();
  });

  function editor(role: "dentist" | "auxiliary", baseline = false) {
    renderWithProviders(<DentalEditor consultation={dentalDraft()} record={record()} unit={UBS} options={dentalOptions()}
      value={fields()} role={role} baseline={baseline} searchDelayMs={0} onChange={vi.fn()} />);
  }

  it("editor: o painel é só do dentista e fora do registro inicial", async () => {
    editor("dentist");
    expect(await screen.findByRole("region", { name: "Prótese" })).not.toBeNull();
    cleanup();
    editor("auxiliary");
    await screen.findByRole("button", { name: /^Dente 16:/ });
    expect(screen.queryByRole("region", { name: "Prótese" })).toBeNull();
    cleanup();
    editor("dentist", true);
    await screen.findByRole("button", { name: /^Dente 16:/ });
    expect(screen.queryByRole("region", { name: "Prótese" })).toBeNull();
  });

  it("tela: a frase da recusa 409 sobrevive à releitura atrasada", async () => {
    let release: (v: { orders: ReturnType<typeof prosthesisOrder>[]; next_before: null }) => void = () => {};
    mocked(api.listProsthesisOrders).mockResolvedValueOnce({ orders: [ prosthesisOrder() ], next_before: null })
      .mockImplementationOnce(() => new Promise((res) => { release = res; }));
    mocked(api.changeProsthesisStage).mockRejectedValueOnce(new ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<DentalProsthesis />);
    fireEvent.change(await screen.findByLabelText("Unidade"), { target: { value: "u1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Enviada ao laboratório — Joana Lima" }));
    expect(await screen.findByText("o pedido de prótese mudou de etapa — a lista foi relida")).not.toBeNull();
    release({ orders: [ prosthesisOrder({ stage: "sent" }) ], next_before: null });
    expect(await screen.findByRole("button", { name: "Recebida — Joana Lima" })).not.toBeNull();
    expect(screen.getByText("o pedido de prótese mudou de etapa — a lista foi relida")).not.toBeNull();
  });

  it("na consulta: a busca de locais usa o código e falha não fica guardada", async () => {
    mocked(api.searchDentalProcedures).mockRejectedValueOnce(new Error("x")).mockResolvedValue([ DENTURE ]);
    renderWithProviders(<ProsthesisPanel consultation={dentalDraft()} patientId="pa1" value={fields()} onChange={vi.fn()} searchDelayMs={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver pedidos de prótese do paciente" }));
    expect(await screen.findByText("Locais do procedimento indisponíveis.")).not.toBeNull();
    expect(mocked(api.searchDentalProcedures)).toHaveBeenCalledWith(DENTURE.sigtap);
    fireEvent.click(screen.getByRole("button", { name: "Ver pedidos de prótese do paciente" }));
    expect(await screen.findByRole("button", { name: `Registrar instalação nesta consulta — ${DENTURE.name}` })).not.toBeNull();
  });
});
