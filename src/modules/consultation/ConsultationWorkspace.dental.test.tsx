// src/modules/consultation/ConsultationWorkspace.dental.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(), startConsultation: vi.fn(),
    getConsultation: vi.fn(), saveConsultationDraft: vi.fn(), finalizeConsultation: vi.fn(), getConsultationProblems: vi.fn(),
    getDentalChart: vi.fn(), listDentalPlans: vi.fn(), searchDentalProcedures: vi.fn(), listConsultationRegulationRequests: vi.fn() };
});
// O painel do 22 aparece em unidade que fatura (o CEO fatura; a UBS não): aqui ele só se anuncia.
vi.mock("../billing/ProceduresPanel", () => ({ ProceduresPanel: () => <span>painel do faturamento</span> }));
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders } from "../../test/campaignFixtures";
import { options, problem, record } from "../../test/consultationFixtures";
import { CEO_UNIT, RESIN, UBS, auxOptions, dentalDraft, dentalFinalized, dentalOptions, dentalUser, fields, odontogram, plan, toothLoc } from "../../test/dentalFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const withProblem = { evaluated_problems: [ { problem_id: "pp1", terminology: "ciap2" as const, code: "D82", label: "Doença dos dentes/gengivas", action: "evaluate" as const } ] };

function open(features = [ "clinical_record", "clinical_documents", "dental_care", "care_regulation" ], opts = dentalOptions(),
  unit: { id: string; name: string; kind: string } = UBS) {
  mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser([ "health_professional" ], { features }));
  mocked(api.getConsultationOptions).mockResolvedValue(opts);
  renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} autosaveDelayMs={0} searchDelayMs={0}
    onClose={() => undefined} onFinalized={() => undefined} />);
}

describe("ConsultationWorkspace — consulta odontológica (módulo 28)", () => {
  beforeEach(() => {
    for (const fn of [ api.startConsultation, api.finalizeConsultation, api.saveConsultationDraft, api.listDentalPlans ]) mocked(fn).mockReset();
    mocked(api.getAttendanceRecord).mockResolvedValue(record({ problems: [ problem() ] }));
    mocked(api.getConsultationProblems).mockResolvedValue([ problem() ]);
    mocked(api.getDentalChart).mockResolvedValue(odontogram());
    mocked(api.listDentalPlans).mockResolvedValue([ plan() ]);
    mocked(api.searchDentalProcedures).mockResolvedValue([ RESIN ]);
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([]);
    mocked(api.saveConsultationDraft).mockImplementation((_id: string, input: unknown) => Promise.resolve({ ...dentalDraft(), ...(input as object) }));
  });

  it("dentista: inicia odontológica e registro inicial; o tipo vai no corpo", async () => {
    mocked(api.startConsultation).mockResolvedValue(dentalDraft());
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta odontológica" }));
    await waitFor(() => expect(mocked(api.startConsultation)).toHaveBeenCalledWith("a1", { kind: "dental" }));
    expect(await screen.findByRole("group", { name: "Odontograma" })).not.toBeNull();
    // O "Tipo de atendimento" do 19a some; fica só o da ficha odontológica.
    expect(screen.getAllByLabelText("Tipo de atendimento")).toHaveLength(1);
    cleanup();
    mocked(api.startConsultation).mockResolvedValue(dentalDraft({ baseline: true, dental: fields({ care_type: null, dental_consultation_type: null,
      oral_health_surveillance: [], dental_outcomes: [], pregnant: null }) }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Registro inicial do odontograma" }));
    await waitFor(() => expect(mocked(api.startConsultation)).toHaveBeenLastCalledWith("a1", { kind: "dental", baseline: true }));
  });

  it("médico: só 'Iniciar consulta', sem argumento; sem dental_care o dentista não vê o tipo nem a comum", async () => {
    mocked(api.startConsultation).mockResolvedValue(dentalDraft({ kind: "general", cbo_code: "225142", dental: null }));
    open(undefined, options());
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    await waitFor(() => expect(mocked(api.startConsultation)).toHaveBeenCalledWith("a1"));
    cleanup();
    open([ "clinical_record" ], dentalOptions());
    await screen.findByText("a saúde bucal está desligada nesta cidade");
    expect(screen.queryByRole("button", { name: "Iniciar consulta odontológica" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar consulta" })).toBeNull();
    cleanup();
    // Sem tipo nenhum e sem o interruptor como causa: a linha do CBO.
    open(undefined, dentalOptions({ kinds: [] }));
    expect(await screen.findByText("seu CBO não registra consulta neste atendimento")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar consulta" })).toBeNull();
  });

  it("CEO antes de iniciar: sem \"general\" nos tipos, o painel do faturamento não aparece", async () => {
    open([ "clinical_record", "clinical_documents", "dental_care", "procedure_billing" ], dentalOptions(), CEO_UNIT);
    await screen.findByRole("button", { name: "Iniciar consulta odontológica" });
    expect(screen.queryByText("painel do faturamento")).toBeNull();
    cleanup();
    open([ "clinical_record", "clinical_documents", "dental_care", "procedure_billing" ], dentalOptions({ kinds: [ "general", "dental" ] }), CEO_UNIT);
    await screen.findByRole("button", { name: "Iniciar consulta odontológica" });
    expect(screen.getByText("painel do faturamento")).not.toBeNull();
  });

  it("recusa do início vira frase", async () => {
    mocked(api.startConsultation).mockRejectedValue(new ApiError(403, { error: "cbo_not_allowed" }, "x"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta odontológica" }));
    expect(await screen.findByText("seu CBO não registra consulta odontológica")).not.toBeNull();
  });

  it("auxiliar: sem documentos, regulação, registro inicial, encaminhamento nem plano", async () => {
    mocked(api.startConsultation).mockResolvedValue(dentalDraft({ cbo_code: "322405" }));
    open(undefined, auxOptions());
    await screen.findByRole("button", { name: "Iniciar consulta odontológica" });
    expect(screen.queryByRole("button", { name: "Registro inicial do odontograma" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar consulta odontológica" }));
    await screen.findByRole("group", { name: "Odontograma" });
    expect(screen.queryByRole("tab", { name: "Documentos" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Pedidos de regulação" })).toBeNull();
    expect(screen.queryByLabelText("Encaminhamento: endodontia")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancelar item/ })).toBeNull();
  });

  it("finalizar: o que falta antes; recusas do api todas de uma vez", async () => {
    mocked(api.startConsultation).mockResolvedValue(dentalDraft({ dental: fields({ oral_health_surveillance: [], pregnant: null }) }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta odontológica" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar consulta" }));
    const missing = screen.getByRole("list", { name: "o que falta para finalizar" });
    expect(missing.textContent).toContain("marque a vigilância em saúde bucal");
    expect(missing.textContent).toContain("informe se a paciente está gestante");
    expect(missing.textContent).toContain("avalie, inclua ou resolva ao menos um problema");
    expect(missing.textContent).not.toContain("marque ao menos uma conduta");
    expect(mocked(api.finalizeConsultation)).not.toHaveBeenCalled();
  });

  it("registro inicial: exige achado, não exige problema nem A/P", async () => {
    mocked(api.startConsultation).mockResolvedValue(dentalDraft({ baseline: true, dental: fields({ care_type: null, dental_consultation_type: null,
      oral_health_surveillance: [], dental_outcomes: [], pregnant: null }) }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Registro inicial do odontograma" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar consulta" }));
    const missing = screen.getByRole("list", { name: "o que falta para finalizar" });
    expect(missing.textContent).toContain("marque ao menos um dente no registro inicial");
    expect(missing.textContent).not.toContain("problema");
    expect(missing.textContent).not.toContain("avaliação (A)");
    expect(screen.queryByRole("tab", { name: "Documentos" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Pedidos de regulação" })).toBeNull();
  });

  it("plan_item_not_open: relê o plano, desfaz o vínculo e mantém o procedimento", async () => {
    const draft = dentalDraft({ ...withProblem, assessment: "Cárie oclusal no 16.",
      dental: fields({ procedures: [ { id: "dpr1", sigtap: RESIN.sigtap, name: RESIN.name, location: toothLoc("16", "O"), quantity: 1, plan_item_id: "pi1" } ] }) });
    mocked(api.startConsultation).mockResolvedValue(draft);
    mocked(api.finalizeConsultation).mockRejectedValue(new ApiError(422, { error: "plan_item_not_open",
      problems: [ { path: "dental.procedures[0].plan_item_id", error: "plan_item_not_open" }, { path: "dental.pregnant", error: "pregnant_required" } ] }, "x"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta odontológica" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar finalização" }));
    const refusals = await screen.findByRole("list", { name: "recusas do api" });
    expect(refusals.textContent).toContain("um item do plano já foi feito ou cancelado em outra consulta");
    expect(refusals.textContent).toContain("informe se a paciente está gestante");
    // Fechar e reabrir a finalização limpa as recusas antigas.
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao rascunho" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar consulta" }));
    expect(screen.queryByRole("list", { name: "recusas do api" })).toBeNull();
    await waitFor(() => expect(mocked(api.listDentalPlans)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocked(api.saveConsultationDraft)).toHaveBeenLastCalledWith("cs1", expect.objectContaining({
      dental: expect.objectContaining({ procedures: [ { id: "dpr1", sigtap: RESIN.sigtap, location: toothLoc("16", "O"), quantity: 1, plan_item_id: null } ] }) })));
    expect(mocked(api.finalizeConsultation)).toHaveBeenCalledTimes(1);
  });

  it("dental_care desligada: 403 no PATCH e na finalização mostra a frase da saúde bucal", async () => {
    const off = new ApiError(403, { error: "feature_disabled", feature: "dental_care" }, "x");
    mocked(api.startConsultation).mockResolvedValue(dentalDraft({ ...withProblem, assessment: "Cárie." }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta odontológica" }));
    mocked(api.saveConsultationDraft).mockRejectedValue(off);
    fireEvent.change(await screen.findByLabelText(/Avaliação/), { target: { value: "Cárie no 16." } });
    expect(await screen.findByText(/a saúde bucal está desligada nesta cidade/)).not.toBeNull();
    mocked(api.saveConsultationDraft).mockReset();
    mocked(api.saveConsultationDraft).mockImplementation((_id: string, input: unknown) => Promise.resolve({ ...dentalDraft(), ...(input as object) }));
    mocked(api.finalizeConsultation).mockRejectedValue(off);
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar finalização" }));
    await waitFor(() => expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain("a saúde bucal está desligada nesta cidade"));
  });

  it("dental_referral_request_required: frase na lista e a peça \"Pedir regulação\" relê os pedidos", async () => {
    const draft = dentalDraft({ ...withProblem, assessment: "Pulpite no 36.", dental: fields({ dental_outcomes: [ "3" ] }) });
    mocked(api.startConsultation).mockResolvedValue(draft);
    mocked(api.finalizeConsultation).mockRejectedValue(new ApiError(422, { error: "dental_referral_request_required",
      problems: [ { path: "dental.dental_outcomes", error: "dental_referral_request_required" } ] }, "x"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta odontológica" }));
    await screen.findByRole("region", { name: "Pedidos de regulação" });
    const reads = mocked(api.listConsultationRegulationRequests).mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar finalização" }));
    const refusals = await screen.findByRole("list", { name: "recusas do api" });
    expect(refusals.textContent).toContain("o encaminhamento ao CEO precisa do pedido de regulação da especialidade");
    await waitFor(() => expect(mocked(api.listConsultationRegulationRequests).mock.calls.length).toBeGreaterThan(reads));
  });

  it("consulta odontológica finalizada do dentista no CEO: aba Documentos; nunca o painel do faturamento", async () => {
    mocked(api.startConsultation).mockResolvedValue(dentalFinalized());
    open([ "clinical_record", "clinical_documents", "dental_care", "procedure_billing" ], dentalOptions(), CEO_UNIT);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta odontológica" }));
    expect(await screen.findByRole("tab", { name: "Documentos" })).not.toBeNull();
    expect(screen.queryByText("painel do faturamento")).toBeNull();
  });
});
