import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  listChartEvents: vi.fn(), listDentalPlans: vi.fn(), addAddendum: vi.fn(), getConsultationProblems: vi.fn(), searchDentalProcedures: vi.fn() }));
import * as api from "../../lib/api";
import { DentalSummary } from "./DentalSummary";
import { ToothHistory } from "./ToothHistory";
import { ToothActions } from "./ToothActions";
import { AddendumForm } from "../consultation/AddendumForm";
import { ApiError } from "../../lib/api";
import { ConsultationView } from "../consultation/ConsultationView";
import { renderWithProviders } from "../../test/campaignFixtures";
import { DENTAL_VOCABULARY, RESIN, SCALING, SITUATIONS, UBS, chartEvent, planItem, dentalFinalized, dentalOptions, dentalUser, fields, plan } from "../../test/dentalFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("leitura odontológica", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser());
    mocked(api.listChartEvents).mockReset();
    mocked(api.listDentalPlans).mockReset();
    mocked(api.searchDentalProcedures).mockResolvedValue([ RESIN, SCALING ]);
    mocked(api.addAddendum).mockResolvedValue({ id: "ad1", author_name: "Dr. Caio Nunes", created_at: "2026-10-30T11:00:00-03:00", reason: "", text: "", changes: null });
  });

  it("resumo da finalizada com rótulos das opções; registro inicial sem ficha", () => {
    const { rerender } = renderWithProviders(<DentalSummary consultation={dentalFinalized()} vocabulary={DENTAL_VOCABULARY} />);
    expect(screen.getByText("Consulta agendada")).not.toBeNull();
    expect(screen.getByText("Primeira consulta odontológica programática")).not.toBeNull();
    expect(screen.getByText("Não identificado")).not.toBeNull();
    expect(screen.getByText(`${RESIN.name} · dente 16, face oclusal/incisal · 1`)).not.toBeNull();
    rerender(<DentalSummary vocabulary={DENTAL_VOCABULARY} consultation={dentalFinalized({ baseline: true, dental: fields({ care_type: null, dental_consultation_type: null,
      dental_outcomes: [], oral_health_surveillance: [], findings: [ { tooth: "36", face: null, part: "crown", situation: "missing" } ] }) })} />);
    expect(screen.getByText("Registro inicial (sem ficha do e-SUS)")).not.toBeNull();
    expect(screen.getByText("dente 36: Ausente")).not.toBeNull();
  });

  it("código sem rótulo aparece cru e a raiz é dita", () => {
    renderWithProviders(<DentalSummary vocabulary={DENTAL_VOCABULARY} situations={SITUATIONS} consultation={dentalFinalized({ dental: fields({ care_type: "77",
      findings: [ { tooth: "16", face: null, part: "root", situation: "endodontics" } ] }) })} />);
    expect(screen.getByText("77")).not.toBeNull();
    expect(screen.getByText("dente 16, raiz: Endodontia")).not.toBeNull();
  });

  it("consulta finalizada mostra o bloco odontológico mesmo com dental_care desligado (O16, ADR 0026)", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser(["health_professional"], { features: [ "clinical_record" ] }));
    renderWithProviders(<ConsultationView consultation={dentalFinalized()} options={dentalOptions()} patientProblems={[]}
      onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(`${RESIN.name} · dente 16, face oclusal/incisal · 1`)).not.toBeNull();
    expect(screen.getByText("Consulta agendada")).not.toBeNull();
  });

  it("adendo lido traz só a parte que mudou: só achado ou só cancelamento não quebra a leitura", async () => {
    const addendum = (id: string, dental: api.AddendumChanges["dental"]) =>
      ({ id, author_name: "Dr. Caio Nunes", created_at: "2026-10-30T11:00:00-03:00", reason: "achado", text: "texto", changes: { dental } });
    renderWithProviders(<ConsultationView options={dentalOptions()} patientProblems={[]} onAddendumAdded={vi.fn()} onClose={vi.fn()}
      consultation={dentalFinalized({ addenda: [
        addendum("ad1", { findings: [ { tooth: "36", face: "O", part: "crown", situation: "caries" } ] }),
        addendum("ad2", { plan_changes: { cancel: [ { item_id: "i1", reason: "paciente recusou" } ] } })
      ] })} />);
    expect(await screen.findByText(/Achados: dente 36, face oclusal\/incisal/)).not.toBeNull();
    expect(screen.getByText("Plano: 1 item cancelado")).not.toBeNull();
  });

  it("histórico do dente só no clique; sem tooth na chamada; filtra na tela e pagina", async () => {
    mocked(api.listChartEvents).mockResolvedValueOnce({ events: [ chartEvent(), chartEvent({ id: "evx", tooth: "26", situation: "restored" }) ], next_before: "c1" })
      .mockResolvedValueOnce({ events: [ chartEvent({ id: "evy", tooth: "26" }) ], next_before: "c2" })
      .mockResolvedValueOnce({ events: [ chartEvent({ id: "ev0", situation: null, procedure: { sigtap: RESIN.sigtap, name: RESIN.name }, addendum_id: "ad9" }) ], next_before: null });
    renderWithProviders(<ToothHistory patientId="pa1" tooth="16" situations={SITUATIONS} />);
    expect(mocked(api.listChartEvents)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Histórico do dente 16" }));
    expect(await screen.findByText(/Cariado/)).not.toBeNull();
    expect(mocked(api.listChartEvents)).toHaveBeenCalledWith("pa1", { before: null });
    expect(screen.queryByText(/Restaurado/)).toBeNull();
    expect(screen.getByText(/Dr\. Caio Nunes \(223208\).*consulta/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver mais" }));
    expect(await screen.findByText("nenhuma marcação do dente 16 nesta página")).not.toBeNull();
    expect(mocked(api.listChartEvents)).toHaveBeenLastCalledWith("pa1", { before: "c1" });
    fireEvent.click(screen.getByRole("button", { name: "Ver mais" }));
    expect(await screen.findByText(new RegExp(`${RESIN.name}.*adendo`))).not.toBeNull();
    expect(mocked(api.listChartEvents)).toHaveBeenLastCalledWith("pa1", { before: "c2" });
    expect(screen.queryByRole("button", { name: "Ver mais" })).toBeNull();
  });

  it("adendo odontológico: achado e cancelamento de item, sem procedimento", async () => {
    mocked(api.listDentalPlans).mockResolvedValue([ plan() ]);
    renderWithProviders(<AddendumForm consultation={dentalFinalized()} options={dentalOptions()} patientProblems={[]} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Motivo do adendo"), { target: { value: "achado depois da radiografia" } });
    fireEvent.change(screen.getByLabelText("Texto do adendo"), { target: { value: "Cárie distal no 26 vista na radiografia." } });
    fireEvent.click(screen.getByLabelText("Mudar o odontograma ou o plano"));
    expect(screen.queryByLabelText("Procedimento (SIGTAP)")).toBeNull();
    fireEvent.change(screen.getByLabelText("Dente"), { target: { value: "26" } });
    fireEvent.change(screen.getByLabelText("Face"), { target: { value: "D" } });
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "caries" } });
    fireEvent.click(screen.getByRole("button", { name: "Acrescentar achado" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver plano" }));
    fireEvent.click(await screen.findByRole("button", { name: `Cancelar item — ${RESIN.name}` }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dente indicado para extração" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(mocked(api.addAddendum)).toHaveBeenCalledWith("cs1", expect.objectContaining({ changes: expect.objectContaining({
      dental: { findings: [ { tooth: "26", face: "D", part: "crown", situation: "caries" } ], plan_changes: { cancel: [ { item_id: "pi1", reason: "dente indicado para extração" } ] } } }) })));
    expect(mocked(api.listDentalPlans)).toHaveBeenCalledWith("pa1", { status: "open" });
  });

  it("adendo do auxiliar não cancela item do plano", async () => {
    mocked(api.listDentalPlans).mockResolvedValue([ plan() ]);
    renderWithProviders(<AddendumForm consultation={dentalFinalized({ cbo_code: "322425" })} options={dentalOptions({ dental_role: "auxiliary" })} patientProblems={[]} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Mudar o odontograma ou o plano"));
    expect(screen.getByRole("button", { name: "Acrescentar achado" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ver plano" })).toBeNull();
  });

  it("ToothActions: escolher outro procedimento limpa o local escolhido antes", async () => {
    renderWithProviders(<ToothActions selection={{ tooth: "16", face: null }} value={fields()} plan={plan()} unit={UBS} role="dentist" baseline={false}
      situations={SITUATIONS} searchDelayMs={0} patientId="pa1" onSelectFace={vi.fn()} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "raspagem" } });
    fireEvent.click(await screen.findByRole("button", { name: `${SCALING.sigtap} — ${SCALING.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Sextante S1" }));
    expect(screen.getByRole("button", { name: "Sextante S1" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "resina" } });
    fireEvent.click(await screen.findByRole("button", { name: `${RESIN.sigtap} — ${RESIN.name}` }));
    expect(screen.getByRole("button", { name: "Sextante S1" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(screen.getByRole("region", { name: "Dente selecionado" })).getByRole("button", { name: "Histórico do dente 16" })).not.toBeNull();
  });

  it("adendo com unitId lê só o plano da unidade; sem unitId, agrupa pelo nome da unidade", async () => {
    mocked(api.listDentalPlans).mockResolvedValue([ plan(), plan({ id: "dp2", health_unit: { id: "u9", name: "CEO Boqueirão", kind: "ceo" }, items: [ planItem({ id: "pi9", name: "Outro item" }) ] }) ]);
    const { unmount } = renderWithProviders(<AddendumForm consultation={dentalFinalized()} options={dentalOptions()} patientProblems={[]} unitId="u1" onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Mudar o odontograma ou o plano"));
    fireEvent.click(screen.getByRole("button", { name: "Ver plano" }));
    await screen.findByRole("button", { name: `Cancelar item — ${RESIN.name}` });
    expect(mocked(api.listDentalPlans)).toHaveBeenCalledWith("pa1", { status: "open", healthUnitId: "u1" });
    expect(screen.queryByRole("group", { name: /^Plano — / })).toBeNull();
    unmount();
    renderWithProviders(<AddendumForm consultation={dentalFinalized()} options={dentalOptions()} patientProblems={[]} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Mudar o odontograma ou o plano"));
    fireEvent.click(screen.getByRole("button", { name: "Ver plano" }));
    const g = await screen.findByRole("group", { name: "Plano — CEO Boqueirão" });
    expect(within(g).getByRole("button", { name: "Cancelar item — Outro item" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "Plano — UBS Centro" })).not.toBeNull();
  });

  it("recusa do adendo: frase odontológica; plan_item_not_open tira o cancelamento e relê o plano", async () => {
    mocked(api.listDentalPlans).mockResolvedValue([ plan() ]);
    mocked(api.addAddendum).mockRejectedValue(new ApiError(422, { error: "invalid", problems: [ { error: "plan_item_not_open", path: "changes.dental.plan_changes.cancel[0].item_id" } ] }, "x"));
    renderWithProviders(<AddendumForm consultation={dentalFinalized()} options={dentalOptions()} patientProblems={[]} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Motivo do adendo"), { target: { value: "achado depois da radiografia" } });
    fireEvent.change(screen.getByLabelText("Texto do adendo"), { target: { value: "Cancelar o item." } });
    fireEvent.click(screen.getByLabelText("Mudar o odontograma ou o plano"));
    fireEvent.click(screen.getByRole("button", { name: "Ver plano" }));
    fireEvent.click(await screen.findByRole("button", { name: `Cancelar item — ${RESIN.name}` }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dente indicado para extração" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(screen.getByRole("list", { name: "cancelamentos do adendo" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    expect(await screen.findByText(/já foi feito ou cancelado em outra consulta/)).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole("list", { name: "cancelamentos do adendo" })).toBeNull());
    await waitFor(() => expect(mocked(api.listDentalPlans)).toHaveBeenCalledTimes(2));
  });

  it("histórico do dente: erro de leitura aparece; resposta de dente anterior é ignorada", async () => {
    mocked(api.listChartEvents).mockRejectedValueOnce(new ApiError(500, {}, "x"));
    const { rerender } = renderWithProviders(<ToothHistory patientId="pa1" tooth="16" />);
    fireEvent.click(screen.getByRole("button", { name: "Histórico do dente 16" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    let resolve: (v: unknown) => void = () => {};
    mocked(api.listChartEvents).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    fireEvent.click(screen.getByRole("button", { name: "Histórico do dente 16" }));
    rerender(<ToothHistory patientId="pa1" tooth="26" />);
    resolve({ events: [ chartEvent() ], next_before: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("button", { name: "Histórico do dente 26" })).not.toBeNull();
    expect(screen.queryByText(/Cariado|caries/)).toBeNull();
  });
});
