import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  listChartEvents: vi.fn(), listDentalPlans: vi.fn(), addAddendum: vi.fn(), getConsultationProblems: vi.fn(), searchDentalProcedures: vi.fn() }));
import * as api from "../../lib/api";
import { DentalSummary } from "./DentalSummary";
import { ToothHistory } from "./ToothHistory";
import { ToothActions } from "./ToothActions";
import { AddendumForm } from "../consultation/AddendumForm";
import { ConsultationView } from "../consultation/ConsultationView";
import { renderWithProviders } from "../../test/campaignFixtures";
import { DENTAL_VOCABULARY, RESIN, SCALING, SITUATIONS, UBS, chartEvent, dentalFinalized, dentalOptions, dentalUser, fields, plan } from "../../test/dentalFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("leitura odontológica", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser());
    mocked(api.listChartEvents).mockReset();
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
});
