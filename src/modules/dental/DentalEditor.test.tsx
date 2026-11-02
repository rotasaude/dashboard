import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  getDentalChart: vi.fn(), listDentalPlans: vi.fn(), searchDentalProcedures: vi.fn() }));
import * as api from "../../lib/api";
import type { DentalFields, DentalRole, Sex } from "../../lib/api";
import { DentalEditor } from "./DentalEditor";
import { renderWithProviders } from "../../test/campaignFixtures";
import { record } from "../../test/consultationFixtures";
import { FLUOR, RESIN, SCALING, UBS, dentalDraft, dentalOptions, dentalUser, fields, odontogram, plan } from "../../test/dentalFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
let last: DentalFields | null = null;

function Harness({ role = "dentist", baseline = false, initial = fields(), sex = "female" }:
  { role?: DentalRole; baseline?: boolean; initial?: DentalFields; sex?: Sex }) {
  const [ value, setValue ] = useState(initial);
  return <DentalEditor consultation={dentalDraft()} record={record({ patient: { ...record().patient, sex } })} unit={UBS} options={dentalOptions()}
    value={value} role={role} baseline={baseline} searchDelayMs={0} onChange={(f) => { last = f; setValue(f); }} />;
}

describe("DentalEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    last = null;
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser());
    mocked(api.getDentalChart).mockResolvedValue(odontogram());
    mocked(api.listDentalPlans).mockResolvedValue([ plan() ]);
    mocked(api.searchDentalProcedures).mockResolvedValue([ RESIN, SCALING, FLUOR ]);
  });

  it("lê odontograma e plano uma vez, pelo paciente e pela unidade", async () => {
    renderWithProviders(<Harness />);
    expect(await screen.findByRole("button", { name: /^Dente 16:/ })).not.toBeNull();
    expect(mocked(api.listDentalPlans)).toHaveBeenCalledWith("pa1", { healthUnitId: "u1", status: "open" });
    expect(mocked(api.getDentalChart)).toHaveBeenCalledTimes(1);
  });

  it("lê o odontograma pelo paciente da consulta quando o prontuário não tem id (primeiro atendimento)", async () => {
    const noRecord = record({ patient: { ...record().patient, id: null as unknown as string } });
    renderWithProviders(<DentalEditor consultation={dentalDraft({ patient_id: "pa9" })} record={noRecord} unit={UBS} options={dentalOptions()}
      value={fields()} role="dentist" baseline searchDelayMs={0} onChange={() => {}} />);
    expect(await screen.findByRole("button", { name: /^Dente 16:/ })).not.toBeNull();
    expect(mocked(api.getDentalChart)).toHaveBeenCalledWith("pa9");
    expect(mocked(api.getDentalChart)).not.toHaveBeenCalledWith(null);
  });

  it("achado na face e procedimento ligado ao plano entram no rascunho", async () => {
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^Dente 16:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Face oclusal/incisal" }));
    fireEvent.change(screen.getByLabelText("Achado"), { target: { value: "caries" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar achado" }));
    expect(last!.findings).toEqual([ { tooth: "16", face: "O", part: "crown", situation: "caries" } ]);
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "resina" } });
    fireEvent.click(await screen.findByRole("button", { name: `${RESIN.sigtap} — ${RESIN.name}` }));
    fireEvent.change(screen.getByLabelText("Item do plano"), { target: { value: "pi1" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar procedimento" }));
    expect(last!.procedures).toEqual([ { sigtap: RESIN.sigtap, name: RESIN.name, location: { kind: "face", tooth: "16", face: "O", sextant: null, arch: null },
      quantity: 1, plan_item_id: "pi1" } ]);
    expect(screen.getByRole("button", { name: /^Dente 16:.*2 marcações nesta consulta$/ })).not.toBeNull();
  });

  it("trocar de dente zera a face escolhida (dente inteiro)", async () => {
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^Dente 16:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Face oclusal/incisal" }));
    expect(screen.getByRole("button", { name: "Face oclusal/incisal" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^Dente 17:/ }));
    expect(screen.getByRole("button", { name: "Dente inteiro" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Achado"), { target: { value: "caries" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar achado" }));
    expect(last!.findings).toEqual([ { tooth: "17", face: null, part: "crown", situation: "caries" } ]);
  });

  it("raiz e prótese total por arcada entram como achado (O3)", async () => {
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^Dente 16:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Raiz" }));
    fireEvent.change(screen.getByLabelText("Achado"), { target: { value: "endodontics" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar achado" }));
    expect(last!.findings).toEqual([ { tooth: "16", face: null, part: "root", situation: "endodontics" } ]);
    fireEvent.click(screen.getByRole("button", { name: "Prótese total — arcada superior" }));
    expect(last!.findings[1]).toEqual({ tooth: null, face: null, part: "crown", arch: "upper", situation: "complete_denture" });
  });

  it("local fora do tipo do procedimento é recusado; sextante e boca toda", async () => {
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^Dente 16:/ }));
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "raspagem" } });
    fireEvent.click(await screen.findByRole("button", { name: `${SCALING.sigtap} — ${SCALING.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar procedimento" }));
    expect(screen.getByText(`${SCALING.name}: escolha um local do tipo sextante`)).not.toBeNull();
    expect(last).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sextante S1" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar procedimento" }));
    expect(last!.procedures[0].location).toEqual({ kind: "sextant", tooth: null, face: null, sextant: "S1", arch: null });
  });

  it("quantidade acima do limite do local aparece como recusa, sem cortar", async () => {
    renderWithProviders(<Harness initial={fields({ procedures: [
      { sigtap: SCALING.sigtap, name: SCALING.name, location: { kind: "sextant", tooth: null, face: null, sextant: "S1", arch: null }, quantity: 7, plan_item_id: null } ] })} />);
    await screen.findByRole("button", { name: /^Dente 16:/ });
    expect(screen.getByRole("alert").textContent).toContain(`${SCALING.name}: no máximo 6 por sextante nesta consulta`);
    fireEvent.click(screen.getByRole("button", { name: `Remover procedimento — ${SCALING.name}` }));
    expect(last!.procedures).toEqual([]);
  });

  it("FAO: tipo de consulta some na escuta; 99 exclui os demais", async () => {
    renderWithProviders(<Harness />);
    await screen.findByRole("button", { name: /^Dente 16:/ });
    fireEvent.change(screen.getByLabelText("Tipo de atendimento"), { target: { value: "4" } });
    expect((screen.getByLabelText("Tipo de consulta odontológica") as HTMLSelectElement).disabled).toBe(true);
    expect(last!.dental_consultation_type).toBeNull();
    fireEvent.click(screen.getByLabelText("Dor de dente"));
    expect(last!.oral_health_surveillance).toEqual([ "3" ]);
  });

  it("gestante pré-preenchida pede confirmação; masculino sem o campo", async () => {
    const { unmount } = renderWithProviders(<Harness initial={fields({ pregnant: true })} />);
    expect(await screen.findByText("pré-preenchido pela linha de pré-natal — confirme")).not.toBeNull();
    unmount();
    renderWithProviders(<Harness initial={fields({ pregnant: true })} sex="male" />);
    await screen.findByRole("button", { name: /^Dente 16:/ });
    expect(screen.queryByRole("group", { name: "Gestante" })).toBeNull();
    expect(screen.getByText("Gestante não se aplica: vai em branco na ficha.")).not.toBeNull();
    await waitFor(() => expect(last!.pregnant).toBeNull());
  });

  it("auxiliar: sem desfechos de encaminhamento, sem incluir no plano, busca só da lista", async () => {
    mocked(api.searchDentalProcedures).mockResolvedValue([ RESIN, FLUOR ]);
    renderWithProviders(<Harness role="auxiliary" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Dente 16:/ }));
    expect(screen.queryByLabelText("Encaminhamento: endodontia")).toBeNull();
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "flu" } });
    const fluor = await screen.findByRole("button", { name: `${FLUOR.sigtap} — ${FLUOR.name}` });
    expect(screen.queryByRole("button", { name: `${RESIN.sigtap} — ${RESIN.name}` })).toBeNull();
    fireEvent.click(fluor);
    expect(screen.getByRole("button", { name: "Registrar procedimento" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Incluir no plano" })).toBeNull();
  });

  it("dentista vê o desfecho de encaminhamento e pode incluir no plano", async () => {
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^Dente 16:/ }));
    expect(screen.getByLabelText("Encaminhamento: endodontia")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "resina" } });
    fireEvent.click(await screen.findByRole("button", { name: `${RESIN.sigtap} — ${RESIN.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Incluir no plano" }));
    expect(last!.plan_changes.add).toEqual([ { sigtap: RESIN.sigtap, name: RESIN.name, location: { kind: "tooth", tooth: "16", face: null, sextant: null, arch: null } } ]);
  });

  it("gestante pré-preenchida: clicar em Sim confirma e mantém true", async () => {
    renderWithProviders(<Harness initial={fields({ pregnant: true })} />);
    await screen.findByText("pré-preenchido pela linha de pré-natal — confirme");
    fireEvent.click(screen.getByLabelText("Sim"));
    expect(screen.queryByText("pré-preenchido pela linha de pré-natal — confirme")).toBeNull();
    expect(last).toBeNull();
  });

  it("procedimento escolhido desabilita locais de outro tipo; face cai para dente", async () => {
    mocked(api.searchDentalProcedures).mockResolvedValue([ { ...RESIN, locations: [ "tooth" ] } ]);
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^Dente 16:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Face oclusal/incisal" }));
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "resina" } });
    fireEvent.click(await screen.findByRole("button", { name: `${RESIN.sigtap} — ${RESIN.name}` }));
    expect((screen.getByRole("button", { name: "Sextante S1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Boca toda" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Registrar procedimento" }));
    expect(last!.procedures[0].location).toEqual({ kind: "tooth", tooth: "16", face: null, sextant: null, arch: null });
  });

  it("trocar de dente volta a parte para coroa", async () => {
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^Dente 16:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Raiz" }));
    expect(screen.getByRole("button", { name: "Raiz" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^Dente 26:/ }));
    expect(screen.getByRole("button", { name: "Coroa" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("registro inicial: só achados; sem FAO, plano nem procedimento", async () => {
    renderWithProviders(<Harness baseline initial={fields({ care_type: null, dental_consultation_type: null, oral_health_surveillance: [], dental_outcomes: [], pregnant: null })} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Dente 36:/ }));
    expect(screen.getByText("Registro inicial: marque a situação de cada dente. Não gera ficha do e-SUS.")).not.toBeNull();
    expect(screen.queryByLabelText("Procedimento (SIGTAP)")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Plano de tratamento" })).toBeNull();
    expect(screen.queryByLabelText("Tipo de atendimento")).toBeNull();
    await waitFor(() => expect(mocked(api.listDentalPlans)).not.toHaveBeenCalled());
  });

  it("seção de especialidade continua aberta ao remover o último item", async () => {
    const { container } = renderWithProviders(<Harness initial={fields({ endodontics: [ { tooth: "16", canals: 3, status: "in_progress" } ] })} />);
    await screen.findByRole("button", { name: /^Dente 16:/ });
    const endo = () => Array.from(container.querySelectorAll("details")).find((d) => d.textContent?.includes("Endodontia"))!;
    expect(endo().open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remover dente 16" }));
    expect(endo().open).toBe(true);
  });

  it("especialidades: dentista vê as três; auxiliar só o registro simplificado; registro inicial nenhuma", async () => {
    const { unmount } = renderWithProviders(<Harness />);
    await screen.findByRole("button", { name: /^Dente 16:/ });
    expect(screen.queryByRole("group", { name: "Registro periodontal simplificado" })).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Periograma" })).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Endodontia" })).not.toBeNull();
    unmount();
    cleanup();
    const aux = renderWithProviders(<Harness role="auxiliary" />);
    await screen.findByRole("button", { name: /^Dente 16:/ });
    expect(screen.queryByRole("group", { name: "Registro periodontal simplificado" })).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Periograma" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Endodontia" })).toBeNull();
    aux.unmount();
    cleanup();
    renderWithProviders(<Harness baseline />);
    await screen.findByRole("button", { name: /^Dente 16:/ });
    expect(screen.queryByRole("group", { name: "Registro periodontal simplificado" })).toBeNull();
  });

  it("periograma e endodontia entram no rascunho com os dentes presentes do odontograma", async () => {
    renderWithProviders(<Harness />);
    await screen.findByRole("button", { name: /^Dente 16:/ });
    const [ chartPick, endoPick ] = screen.getAllByLabelText("Dente");
    expect(chartPick.querySelector('option[value="36"]')).toBeNull();
    expect(chartPick.querySelector('option[value="16"]')).not.toBeNull();
    fireEvent.change(chartPick, { target: { value: "16" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Acrescentar dente" })[0]);
    expect(last!.periodontal_chart?.teeth.map((t) => t.tooth)).toEqual([ "16" ]);
    fireEvent.change(endoPick, { target: { value: "46" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Acrescentar dente" })[1]);
    expect(last!.endodontics).toEqual([ { tooth: "46", canals: 1, status: "in_progress" } ]);
  });
});
