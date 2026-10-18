import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listQcBlocks: vi.fn(), recordCorrectiveAction: vi.fn(), listQcExceptions: vi.fn(),
    listQcReviews: vi.fn(), decideQcReview: vi.fn(), listLabInstruments: vi.fn(), listLabExams: vi.fn(), listQcMaterials: vi.fn(), getReleaseRequisition: vi.fn() };
});

import * as api from "../lib/api";
import { LabQcBlocks } from "./LabQcBlocks";
import { RT_ONLY } from "../lib/qc";
import { renderWithProviders } from "../test/campaignFixtures";
import { labReport, releaseRequisition } from "../test/labFixtures";
import { GLU_EXAM, NOW21C, instrument, qcBlock, qcContext, qcException, qcMaterial, qcReview, qcUser } from "../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listQcBlocks, api.recordCorrectiveAction, api.listQcExceptions, api.listQcReviews,
  api.decideQcReview, api.listLabInstruments, api.listLabExams, api.listQcMaterials, api.getReleaseRequisition ];

const apiError = (status: number, code: string) => new api.ApiError(status, { error: code }, code);

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21C));
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_releaser" ]));
  mocked(api.getLabContext).mockResolvedValue(qcContext({ releaser_of: [ "pv9" ], technical_lead_of: [ "pv9" ], council: "CRF" }));
  mocked(api.listQcBlocks).mockResolvedValue([ qcBlock() ]);
  mocked(api.recordCorrectiveAction).mockResolvedValue(qcBlock({ corrective_action: "calibração refeita e reagente trocado" }));
  mocked(api.listQcExceptions).mockResolvedValue([ qcException() ]);
  mocked(api.listQcReviews).mockResolvedValue([ qcReview() ]);
  mocked(api.decideQcReview).mockResolvedValue(qcReview({ decision: "kept" }));
  mocked(api.listLabInstruments).mockResolvedValue([ instrument() ]);
  mocked(api.listLabExams).mockResolvedValue([ GLU_EXAM ]);
  mocked(api.listQcMaterials).mockResolvedValue([ qcMaterial() ]);
  mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({ items: releaseRequisition().items.map((i) => ({ ...i, status: "released" })), reports: [ labReport() ] }));
});

async function reviewsPanel() {
  const panel = await screen.findByRole("region", { name: "Revisões pendentes" });
  await within(panel).findByText("00000123");
  return panel;
}

describe("LabQcBlocks", () => {
  it("bloqueio ativo com aparelho e analito; ação corretiva (sem step-up) relê a lista", async () => {
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await screen.findByRole("region", { name: "Bloqueios" });
    expect(await within(panel).findByText("BS-200 · Glicose (Glicose)")).not.toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Registrar ação corretiva" }));
    const form = within(panel).getByRole("group", { name: "Ação corretiva — BS-200 · Glicose (Glicose)" });
    fireEvent.change(within(form).getByLabelText("O que foi feito"), { target: { value: "curto" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar" }));
    expect(within(form).getByRole("alert").textContent).toBe("escreva a ação corretiva (ao menos 10 caracteres)");
    expect(api.recordCorrectiveAction).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("O que foi feito"), { target: { value: "x".repeat(1001) } });
    fireEvent.click(await within(form).findByRole("button", { name: "Registrar" }));
    expect(within(form).getByRole("alert").textContent).toBe("a ação corretiva: no máximo 1000 caracteres");
    fireEvent.change(within(form).getByLabelText("O que foi feito"), { target: { value: "calibração refeita e reagente trocado" } });
    fireEvent.click(await within(form).findByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(api.recordCorrectiveAction).toHaveBeenCalledWith("qb1", "calibração refeita e reagente trocado"));
    expect(await screen.findByText("Ação corretiva registrada. O bloqueio fecha sozinho na próxima corrida aprovada com todos os níveis.")).not.toBeNull();
    await waitFor(() => expect(api.listQcBlocks).toHaveBeenCalledTimes(2));
  });

  it("409 conflict na ação corretiva diz a frase própria e relê", async () => {
    mocked(api.recordCorrectiveAction).mockRejectedValue(apiError(409, "conflict"));
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await screen.findByRole("region", { name: "Bloqueios" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Registrar ação corretiva" }));
    const form = within(panel).getByRole("group", { name: /Ação corretiva/ });
    fireEvent.change(within(form).getByLabelText("O que foi feito"), { target: { value: "calibração refeita e reagente trocado" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("isto já estava registrado — a tela foi atualizada");
    await waitFor(() => expect(api.listQcBlocks).toHaveBeenCalledTimes(2));
  });

  it("aba de encerrados lê com status=closed e não oferece ação", async () => {
    mocked(api.listQcBlocks).mockImplementation(async (status: string) => (status === "closed"
      ? [ qcBlock({ corrective_action: "reagente trocado", closed_at: "2026-10-18T09:30:00-03:00" }) ] : [ qcBlock() ]));
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    await screen.findByRole("region", { name: "Bloqueios" });
    fireEvent.click(screen.getByRole("tab", { name: "encerrados" }));
    await waitFor(() => expect(api.listQcBlocks).toHaveBeenCalledWith("closed", "pv9"));
    expect(await screen.findByText("reagente trocado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar ação corretiva" })).toBeNull();
  });

  it("exceções concedidas no mês, com a justificativa", async () => {
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await screen.findByRole("region", { name: "Exceções concedidas" });
    expect(await within(panel).findByText("paciente internado, médico assistente ciente")).not.toBeNull();
    expect(api.listQcExceptions).toHaveBeenCalledWith("pv9", "2026-10");
  });

  it("RT mantém o resultado com nota, depois do step-up", async () => {
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await reviewsPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Manter" }));
    fireEvent.change(within(panel).getByLabelText("Nota (opcional)"), { target: { value: "valor coerente com a série do paciente" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e manter" }));
    expect(api.decideQcReview).not.toHaveBeenCalled();
    fireEvent.click(await within(panel).findByRole("button", { name: "Confirmar: manter" }));
    await waitFor(() => expect(api.decideQcReview).toHaveBeenCalledWith("rv1", { decision: "kept", note: "valor coerente com a série do paciente" }));
    expect(await within(panel).findByText("Resultado mantido.")).not.toBeNull();
    await waitFor(() => expect(api.listQcReviews).toHaveBeenCalledTimes(2));
  });

  it("nota acima de 1000 é recusada antes do step-up; sem nota, o corpo não leva note", async () => {
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await reviewsPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Manter" }));
    fireEvent.change(within(panel).getByLabelText("Nota (opcional)"), { target: { value: "x".repeat(1001) } });
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e manter" }));
    expect(within(panel).getByRole("alert").textContent).toBe("a nota: no máximo 1000 caracteres");
    fireEvent.change(within(panel).getByLabelText("Nota (opcional)"), { target: { value: "" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e manter" }));
    fireEvent.click(await within(panel).findByRole("button", { name: "Confirmar: manter" }));
    await waitFor(() => expect(api.decideQcReview).toHaveBeenCalledWith("rv1", { decision: "kept" }));
  });

  it("revisão já decidida (409) relê a lista e diz a frase", async () => {
    mocked(api.decideQcReview).mockRejectedValue(apiError(409, "invalid_transition"));
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await reviewsPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Manter" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e manter" }));
    fireEvent.click(await within(panel).findByRole("button", { name: "Confirmar: manter" }));
    expect(await within(panel).findByText("a situação mudou — a tela foi atualizada")).not.toBeNull();
    await waitFor(() => expect(api.listQcReviews).toHaveBeenCalledTimes(2));
  });

  it("RT marca para retificar e a conferência da requisição abre pela requisition_id", async () => {
    mocked(api.decideQcReview).mockResolvedValue(qcReview({ decision: "rectify" }));
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await reviewsPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Retificar" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e retificar" }));
    fireEvent.click(await within(panel).findByRole("button", { name: "Confirmar: retificar" }));
    await waitFor(() => expect(api.decideQcReview).toHaveBeenCalledWith("rv1", { decision: "rectify" }));
    expect(await screen.findByRole("region", { name: "Conferência da requisição 00000123" })).not.toBeNull();
    expect(api.getReleaseRequisition).toHaveBeenCalledWith("rq1");
  });

  it("quem não é RT vê as revisões sem decidir", async () => {
    mocked(api.getLabContext).mockResolvedValue(qcContext({ releaser_of: [ "pv9" ], council: "CRF" }));
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await reviewsPanel();
    expect(within(panel).queryByRole("button", { name: "Manter" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Retificar" })).toBeNull();
    expect(within(panel).getByText(RT_ONLY)).not.toBeNull();
  });

  it("nenhuma lista tem polling", async () => {
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    await reviewsPanel();
    expect(api.listQcBlocks).toHaveBeenCalledTimes(1);
    expect(api.listQcExceptions).toHaveBeenCalledTimes(1);
    expect(api.listQcReviews).toHaveBeenCalledTimes(1);
  });

  it("laudo pendente de assinatura: retificar não abre a conferência e diz o porquê", async () => {
    mocked(api.listQcReviews).mockResolvedValue([ qcReview({ released_at: null }) ]);
    mocked(api.decideQcReview).mockResolvedValue(qcReview({ decision: "rectify", released_at: null }));
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await reviewsPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Retificar" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e retificar" }));
    fireEvent.click(await within(panel).findByRole("button", { name: "Confirmar: retificar" }));
    expect(await within(panel).findByText(/ainda aguarda assinatura/)).not.toBeNull();
    expect(api.getReleaseRequisition).not.toHaveBeenCalled();
  });

  it("mês apagado mostra escolha o mês; exceção mostra o exame", async () => {
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await screen.findByRole("region", { name: "Exceções concedidas" });
    expect((await within(panel).findAllByText("Glicose")).length).toBeGreaterThan(0);
    fireEvent.change(within(panel).getByLabelText("Mês"), { target: { value: "" } });
    expect(await within(panel).findByText("escolha o mês")).not.toBeNull();
  });

  it("após 409 o painel de decisão da revisão velha fecha", async () => {
    mocked(api.decideQcReview).mockRejectedValue(apiError(409, "invalid_transition"));
    renderWithProviders(<LabQcBlocks onNavigate={vi.fn()} />);
    const panel = await reviewsPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Manter" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e manter" }));
    fireEvent.click(await within(panel).findByRole("button", { name: "Confirmar: manter" }));
    await within(panel).findByText("a situação mudou — a tela foi atualizada");
    expect(within(panel).queryByLabelText("Nota (opcional)")).toBeNull();
  });
});
