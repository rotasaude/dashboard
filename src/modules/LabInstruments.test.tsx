// src/modules/LabInstruments.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listLabInstruments: vi.fn(), listAdminInstruments: vi.fn(),
    createInstrument: vi.fn(), updateInstrument: vi.fn() };
});

import * as api from "../lib/api";
import { LabInstruments } from "./LabInstruments";
import { INSTRUMENTS_DISABLED } from "../lib/qc";
import { renderWithProviders } from "../test/campaignFixtures";
import { instrument, qcContext, qcUser } from "../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listLabInstruments, api.listAdminInstruments, api.createInstrument, api.updateInstrument ];
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ]));
  mocked(api.getLabContext).mockResolvedValue(qcContext());
  mocked(api.listAdminInstruments).mockResolvedValue([ instrument() ]);
  mocked(api.listLabInstruments).mockResolvedValue([ instrument() ]);
  mocked(api.createInstrument).mockResolvedValue(instrument({ id: "in2", name: "Yumizen H550" }));
});

async function openNew() {
  renderWithProviders(<LabInstruments />);
  fireEvent.click(await screen.findByRole("button", { name: "Novo aparelho" }));
  return screen.getByRole("region", { name: "Novo aparelho" });
}

describe("LabInstruments", () => {
  it("admin cadastra com step-up; a lista relê", async () => {
    const form = await openNew();
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Yumizen H550" } });
    fireEvent.change(within(form).getByLabelText("Fabricante"), { target: { value: "Horiba" } });
    fireEvent.change(within(form).getByLabelText("Setor"), { target: { value: "hematology" } });
    fireEvent.change(within(form).getByLabelText("Identificador na HL7 (OBX-18)"), { target: { value: "H550-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar aparelho" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar aparelho" }));
    await waitFor(() => expect(api.createInstrument).toHaveBeenCalledWith({
      provider_id: "pv9", name: "Yumizen H550", manufacturer: "Horiba", model: "", serial_number: "", sector: "hematology", hl7_equipment_id: "H550-01", active: true
    }));
    expect(await screen.findByText("Aparelho salvo.")).not.toBeNull();
    await waitFor(() => expect(api.listAdminInstruments).toHaveBeenCalledTimes(2));
  });

  it("identificador HL7 com espaço não abre a confirmação", async () => {
    const form = await openNew();
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Yumizen" } });
    fireEvent.change(within(form).getByLabelText("Setor"), { target: { value: "hematology" } });
    fireEvent.change(within(form).getByLabelText("Identificador na HL7 (OBX-18)"), { target: { value: "H 550" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar aparelho" }));
    expect(within(form).getByRole("alert").textContent).toBe("identificador HL7 (OBX-18) com até 50 letras, números, ponto, hífen ou _");
    expect(screen.queryByRole("button", { name: "Salvar aparelho" })).toBeNull();
  });

  it("422 duplicate_hl7_equipment_id vira frase", async () => {
    mocked(api.createInstrument).mockRejectedValueOnce(new api.ApiError(422, { error: "duplicate_hl7_equipment_id" }, "x"));
    const form = await openNew();
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Yumizen" } });
    fireEvent.change(within(form).getByLabelText("Setor"), { target: { value: "hematology" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar aparelho" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar aparelho" }));
    expect(await screen.findByText("este identificador HL7 já está em outro aparelho")).not.toBeNull();
  });

  it("equipe do laboratório só lê (rota de membros), sem botão de cadastro", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ]));
    renderWithProviders(<LabInstruments />);
    expect(await screen.findByText("BS-200")).not.toBeNull();
    expect(api.listLabInstruments).toHaveBeenCalledWith("pv9");
    expect(api.listAdminInstruments).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Novo aparelho" })).toBeNull();
  });

  it("com só o estoque ligado a tela abre; com os dois desligados, a frase", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ], { features: [ "exam_tracking", "municipal_lab", "lab_inventory" ] }));
    const { unmount } = renderWithProviders(<LabInstruments />);
    expect(await screen.findByText("BS-200")).not.toBeNull();
    unmount();
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ], { features: [ "exam_tracking", "municipal_lab" ] }));
    renderWithProviders(<LabInstruments />);
    expect(await screen.findByText(INSTRUMENTS_DISABLED)).not.toBeNull();
  });

  it("identificador HL7 de 51 caracteres não abre a confirmação; 50 abre", async () => {
    const form = await openNew();
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Yumizen" } });
    fireEvent.change(within(form).getByLabelText("Setor"), { target: { value: "hematology" } });
    fireEvent.change(within(form).getByLabelText("Identificador na HL7 (OBX-18)"), { target: { value: "A".repeat(51) } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar aparelho" }));
    expect(within(form).getByRole("alert")).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("Identificador na HL7 (OBX-18)"), { target: { value: "A".repeat(50) } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar aparelho" }));
    expect(await screen.findByRole("button", { name: "Salvar aparelho" })).not.toBeNull();
  });

  it("editar um aparelho com campos null do api não quebra e salva por PATCH", async () => {
    mocked(api.listAdminInstruments).mockResolvedValue([ instrument({ manufacturer: null, model: null, serial_number: null, hl7_equipment_id: null }) ]);
    mocked(api.updateInstrument).mockResolvedValue(instrument());
    renderWithProviders(<LabInstruments />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const form = screen.getByRole("region", { name: "Editar BS-200" });
    expect((within(form).getByLabelText("Fabricante") as HTMLInputElement).value).toBe("");
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar aparelho" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar aparelho" }));
    await waitFor(() => expect(api.updateInstrument).toHaveBeenCalledWith("in1", expect.objectContaining({ hl7_equipment_id: null, manufacturer: "" })));
  });

  it("com o CIQ e o estoque desligados, a frase de aparelhos (não a do CIQ)", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ], { features: [ "exam_tracking", "municipal_lab" ] }));
    renderWithProviders(<LabInstruments />);
    expect(await screen.findByText(INSTRUMENTS_DISABLED)).not.toBeNull();
  });
});
