// src/modules/LabQcSetup.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listLabExams: vi.fn(), listQcMaterials: vi.fn(), createQcMaterial: vi.fn(),
    updateQcMaterial: vi.fn(), listQcLots: vi.fn(), createQcLot: vi.fn(), closeQcLot: vi.fn(), getQcTargets: vi.fn(), listQcSuggestions: vi.fn(),
    listLabInstruments: vi.fn(), getQcRules: vi.fn() };
});

import * as api from "../lib/api";
import { LabQcSetup } from "./LabQcSetup";
import { QC_DISABLED, QC_LEAD_ONLY } from "../lib/qc";
import { renderWithProviders } from "../test/campaignFixtures";
import { CHOL_EXAM, GLU_EXAM, NOW21C, instrument, qcContext, qcLot, qcMaterial, qcRules, qcUser } from "../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listLabExams, api.listQcMaterials, api.createQcMaterial, api.updateQcMaterial,
  api.listQcLots, api.createQcLot, api.closeQcLot, api.getQcTargets, api.listQcSuggestions, api.listLabInstruments, api.getQcRules ];

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21C));
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ]));
  mocked(api.getLabContext).mockResolvedValue(qcContext());
  mocked(api.listLabExams).mockResolvedValue([ GLU_EXAM, CHOL_EXAM ]);
  mocked(api.listQcMaterials).mockResolvedValue([ qcMaterial() ]);
  mocked(api.listQcLots).mockResolvedValue([ qcLot() ]);
  mocked(api.createQcMaterial).mockResolvedValue(qcMaterial({ id: "qm2" }));
  mocked(api.createQcLot).mockResolvedValue(qcLot({ id: "ql2" }));
  mocked(api.closeQcLot).mockResolvedValue(qcLot({ status: "closed", closed_on: "2026-10-18" }));
  mocked(api.getQcTargets).mockResolvedValue({ current: [], history: [] });
  mocked(api.listQcSuggestions).mockResolvedValue([]);
  mocked(api.listLabInstruments).mockResolvedValue([ instrument() ]);
  mocked(api.getQcRules).mockResolvedValue(qcRules());
});

describe("LabQcSetup — materiais e lotes", () => {
  it("material novo: níveis por ponto e vírgula e analitos dos exames do laboratório", async () => {
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Materiais de controle" });
    fireEvent.click(within(panel).getByRole("button", { name: "Novo material" }));
    const form = within(panel).getByRole("region", { name: "Novo material" });
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Controle lipídico" } });
    fireEvent.change(within(form).getByLabelText("Níveis (separados por ;)"), { target: { value: "normal; alto" } });
    fireEvent.click(await within(form).findByLabelText("HDL (Colesterol total e frações)"));
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar material" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar material" }));
    await waitFor(() => expect(api.createQcMaterial).toHaveBeenCalledWith({
      provider_id: "pv9", name: "Controle lipídico", manufacturer: "", levels: [ "normal", "alto" ], analytes: [ { lab_exam_id: "le2", analyte_key: "hdl" } ], active: true
    }));
    expect(await within(panel).findByText("Material salvo.")).not.toBeNull();
  });

  it("material com lote: níveis travados, analito usado travado, analito novo acrescenta por PATCH", async () => {
    mocked(api.updateQcMaterial).mockResolvedValue(qcMaterial());
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Materiais de controle" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Editar" }));
    const form = within(panel).getByRole("region", { name: "Editar Controle bioquímico" });
    expect((within(form).getByLabelText("Níveis (separados por ;)") as HTMLInputElement).disabled).toBe(true);
    expect(((await within(form).findByLabelText("Glicose (Glicose)")) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(form).getByLabelText("HDL (Colesterol total e frações)"));
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar material" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar material" }));
    await waitFor(() => expect(api.updateQcMaterial).toHaveBeenCalledWith("qm1", expect.objectContaining({
      analytes: [ { lab_exam_id: "le1", analyte_key: "glicose" }, { lab_exam_id: "le2", analyte_key: "hdl" } ]
    })));
  });

  it("a mesma chave de analito em outro exame não pode ser marcada", async () => {
    const dup = { ...CHOL_EXAM, id: "le3", name: "Glicose pós", analytes: [ { key: "glicose", name: "Glicose" } ] };
    mocked(api.listLabExams).mockResolvedValue([ GLU_EXAM, dup ]);
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Materiais de controle" });
    fireEvent.click(within(panel).getByRole("button", { name: "Novo material" }));
    const form = within(panel).getByRole("region", { name: "Novo material" });
    fireEvent.click(await within(form).findByLabelText("Glicose (Glicose)"));
    expect((within(form).getByLabelText("Glicose (Glicose pós)") as HTMLInputElement).disabled).toBe(true);
  });

  it("material salvo com fabricante null abre vazio e a recusa 422 vira frase", async () => {
    mocked(api.listQcMaterials).mockResolvedValue([ qcMaterial({ manufacturer: null, has_lots: false }) ]);
    mocked(api.updateQcMaterial).mockRejectedValueOnce(new api.ApiError(422, { error: "duplicate_analyte_key" }, "x"));
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Materiais de controle" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Editar" }));
    const form = within(panel).getByRole("region", { name: "Editar Controle bioquímico" });
    expect((within(form).getByLabelText("Fabricante") as HTMLInputElement).value).toBe("");
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar material" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar material" }));
    expect(await screen.findByText("a mesma chave de analito não pode entrar em dois exames do material")).not.toBeNull();
  });

  it("lote novo: um código por nível; Enter do leitor não envia; 422 barcode_taken vira frase", async () => {
    mocked(api.createQcLot).mockRejectedValueOnce(new api.ApiError(422, { error: "barcode_taken" }, "x"));
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Lotes de controle" });
    fireEvent.click(within(panel).getByRole("button", { name: "Novo lote" }));
    const form = within(panel).getByRole("region", { name: "Novo lote" });
    await within(form).findByRole("option", { name: "Controle bioquímico" });
    fireEvent.change(within(form).getByLabelText("Material"), { target: { value: "qm1" } });
    fireEvent.change(within(form).getByLabelText("Número do lote"), { target: { value: "L2026B" } });
    fireEvent.change(within(form).getByLabelText("Validade"), { target: { value: "2027-06-30" } });
    const normal = within(form).getByLabelText("Código de barras — normal");
    fireEvent.change(normal, { target: { value: "QC-L2026B-N" } });
    fireEvent.keyDown(normal, { key: "Enter" });
    expect(api.createQcLot).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Código de barras — patológico"), { target: { value: "QC-L2026B-P" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar lote" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar lote" }));
    await waitFor(() => expect(api.createQcLot).toHaveBeenCalledWith({
      material_id: "qm1", lot_number: "L2026B", expires_on: "2027-06-30", level_barcodes: { normal: "QC-L2026B-N", "patológico": "QC-L2026B-P" }
    }));
    expect((await within(form).findByRole("alert")).textContent).toBe("este código de barras já está em outro lote de controle ou numa amostra");
    expect((within(form).getByLabelText("Número do lote") as HTMLInputElement).value).toBe("L2026B");
  });

  it("código de barras só com 10 dígitos ou fora do formato é recusado antes do envio", async () => {
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Lotes de controle" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Novo lote" }));
    const form = within(panel).getByRole("region", { name: "Novo lote" });
    await within(form).findByRole("option", { name: "Controle bioquímico" });
    fireEvent.change(within(form).getByLabelText("Material"), { target: { value: "qm1" } });
    fireEvent.change(within(form).getByLabelText("Número do lote"), { target: { value: "L2026C" } });
    fireEvent.change(within(form).getByLabelText("Validade"), { target: { value: "2027-06-30" } });
    fireEvent.change(within(form).getByLabelText("Código de barras — normal"), { target: { value: "1234567890" } });
    fireEvent.change(within(form).getByLabelText("Código de barras — patológico"), { target: { value: "ab" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar lote" }));
    expect(within(form).getByRole("alert").textContent).toContain("só 10 dígitos");
    fireEvent.change(within(form).getByLabelText("Código de barras — normal"), { target: { value: "QC-X-N" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar lote" }));
    expect(within(form).getByRole("alert").textContent).toContain("3 a 30");
    expect(api.createQcLot).not.toHaveBeenCalled();
  });

  it("lote vencido é recusado antes do envio", async () => {
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Lotes de controle" });
    fireEvent.click(within(panel).getByRole("button", { name: "Novo lote" }));
    const form = within(panel).getByRole("region", { name: "Novo lote" });
    await within(form).findByRole("option", { name: "Controle bioquímico" });
    fireEvent.change(within(form).getByLabelText("Material"), { target: { value: "qm1" } });
    fireEvent.change(within(form).getByLabelText("Número do lote"), { target: { value: "L2025Z" } });
    fireEvent.change(within(form).getByLabelText("Validade"), { target: { value: "2026-10-17" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar lote" }));
    expect(within(form).getByRole("alert").textContent).toBe("lote vencido — confira a validade");
    expect(api.createQcLot).not.toHaveBeenCalled();
  });

  it("encerrar lote pede confirmação", async () => {
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Lotes de controle" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Encerrar" }));
    expect(api.closeQcLot).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar encerramento de L2026A" }));
    await waitFor(() => expect(api.closeQcLot).toHaveBeenCalledWith("ql1"));
    expect(await screen.findByText("Lote L2026A encerrado.")).not.toBeNull();
  });

  it("liberador que não é RT: a frase e nenhuma leitura do CIQ; RT vê", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_releaser" ]));
    mocked(api.getLabContext).mockResolvedValue(qcContext({ releaser_of: [ "pv9" ] }));
    const { unmount } = renderWithProviders(<LabQcSetup />);
    expect(await screen.findByText(QC_LEAD_ONLY)).not.toBeNull();
    expect(api.listQcMaterials).not.toHaveBeenCalled();
    unmount();
    mocked(api.getLabContext).mockResolvedValue(qcContext({ releaser_of: [ "pv9" ], technical_lead_of: [ "pv9" ] }));
    renderWithProviders(<LabQcSetup />);
    expect(await screen.findByRole("region", { name: "Materiais de controle" })).not.toBeNull();
  });

  it("registro de outro laboratório (404 not_found) vira frase própria", async () => {
    mocked(api.closeQcLot).mockRejectedValueOnce(new api.ApiError(404, { error: "not_found" }, "x"));
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Lotes de controle" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Encerrar" }));
    const before = mocked(api.listQcLots).mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar encerramento de L2026A" }));
    expect(await screen.findByText("não encontrado neste laboratório — a tela foi atualizada")).not.toBeNull();
    await waitFor(() => expect(mocked(api.listQcLots).mock.calls.length).toBeGreaterThan(before));
  });

  it("CIQ desligado: a frase", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ], { features: [ "exam_tracking", "municipal_lab", "lab_inventory" ] }));
    renderWithProviders(<LabQcSetup />);
    expect(await screen.findByText(QC_DISABLED)).not.toBeNull();
  });

  it("Referências abre o painel do lote escolhido", async () => {
    renderWithProviders(<LabQcSetup />);
    const panel = await screen.findByRole("region", { name: "Lotes de controle" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Referências" }));
    expect(await screen.findByRole("region", { name: "Referências do lote L2026A" })).not.toBeNull();
    expect(api.getQcTargets).toHaveBeenCalledWith("ql1");
    expect(await screen.findByRole("region", { name: "Regras de Westgard" })).not.toBeNull();
  });
});
