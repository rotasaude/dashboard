// src/modules/consultation/MedicationsBlock.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listPatientMedications: vi.fn(), changeMedication: vi.fn(), searchMedications: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { MedicationsBlock } from "./MedicationsBlock";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CLONAZEPAM, docUser, medication } from "../../test/documentFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const LIST = [ medication(), medication({ id: "pm2", label: "Sinvastatina 20 mg", dosage_summary: null, status: "suspended", origin: "external", continuous: false }) ];

describe("MedicationsBlock", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listPatientMedications, api.changeMedication, api.searchMedications ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser());
    mocked(api.listPatientMedications).mockResolvedValue(LIST);
    mocked(api.changeMedication).mockResolvedValue(medication());
    mocked(api.searchMedications).mockResolvedValue([ CLONAZEPAM ]);
  });

  it("lista em uso e suspensos, com origem e uso contínuo; sem consulta em rascunho não oferece mudar", async () => {
    renderWithProviders(<MedicationsBlock patientId="pa1" draftConsultationId={null} />);
    const list = await screen.findByRole("list", { name: "medicamentos em uso" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0].textContent).toMatch(/Metformina 850 mg — 1 cp 2x\/dia/);
    expect(within(rows[0]).getByText("em uso")).not.toBeNull();
    expect(within(rows[0]).getByText("receita")).not.toBeNull();
    expect(within(rows[0]).getByText("uso contínuo")).not.toBeNull();
    expect(within(rows[1]).getByText("suspenso")).not.toBeNull();
    expect(within(rows[1]).getByText("de fora")).not.toBeNull();
    expect(api.listPatientMedications).toHaveBeenCalledWith("pa1");
    expect(screen.queryByRole("button", { name: /Suspender|Reativar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Informar medicamento em uso de fora" })).toBeNull();
  });

  it("suspende e reativa pela consulta em rascunho, e relê a lista", async () => {
    renderWithProviders(<MedicationsBlock patientId="pa1" draftConsultationId="cs1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Suspender Metformina 850 mg" }));
    await waitFor(() => expect(api.changeMedication).toHaveBeenCalledWith("cs1", { action: "suspend", medication_id: "pm1" }));
    fireEvent.click(screen.getByRole("button", { name: "Reativar Sinvastatina 20 mg" }));
    await waitFor(() => expect(api.changeMedication).toHaveBeenCalledWith("cs1", { action: "reactivate", medication_id: "pm2" }));
    await waitFor(() => expect(mocked(api.listPatientMedications).mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it("informa um medicamento de fora pelo catálogo (controlado entra: não é receita)", async () => {
    renderWithProviders(<MedicationsBlock patientId="pa1" draftConsultationId="cs1" unitId="u1" searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Informar medicamento em uso de fora" }));
    fireEvent.change(screen.getByLabelText("Buscar no catálogo"), { target: { value: "clon" } });
    fireEvent.click(await screen.findByRole("button", { name: "Clonazepam 2 mg, comprimido" }));
    fireEvent.change(screen.getByLabelText("Como usa (resumo)"), { target: { value: "1 cp à noite" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir na lista" }));
    await waitFor(() => expect(api.changeMedication).toHaveBeenCalledWith("cs1",
      { action: "add_external", catalog_item_id: "ci3", dosage_summary: "1 cp à noite", continuous: true }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Medicamento em uso de fora" })).toBeNull());
  });

  it("texto livre; sem nada escolhido diz o que falta", async () => {
    renderWithProviders(<MedicationsBlock patientId="pa1" draftConsultationId="cs1" searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Informar medicamento em uso de fora" }));
    fireEvent.click(screen.getByRole("button", { name: "Incluir na lista" }));
    expect((await screen.findByRole("alert")).textContent).toBe("escolha o medicamento no catálogo ou escreva o nome");
    expect(api.changeMedication).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Ou escreva o nome (texto livre)"), { target: { value: "Losartana 50 mg" } });
    fireEvent.click(screen.getByLabelText("Uso contínuo"));
    fireEvent.click(screen.getByRole("button", { name: "Incluir na lista" }));
    await waitFor(() => expect(api.changeMedication).toHaveBeenCalledWith("cs1",
      { action: "add_external", free_text: "Losartana 50 mg", continuous: false }));
  });

  it("409 already_active: diz e relê a lista", async () => {
    mocked(api.changeMedication).mockRejectedValue(new ApiError(409, { error: "already_active" }, "409"));
    renderWithProviders(<MedicationsBlock patientId="pa1" draftConsultationId="cs1" searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Informar medicamento em uso de fora" }));
    fireEvent.change(screen.getByLabelText("Ou escreva o nome (texto livre)"), { target: { value: "Metformina" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir na lista" }));
    expect((await screen.findByRole("alert")).textContent).toBe("este medicamento já está em uso na lista");
    await waitFor(() => expect(mocked(api.listPatientMedications).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("suspender/reativar travam enquanto a requisição está em voo: segundo clique não duplica", async () => {
    let finish: (m: ReturnType<typeof medication>) => void = () => {};
    mocked(api.changeMedication).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWithProviders(<MedicationsBlock patientId="pa1" draftConsultationId="cs1" />);
    const suspend = await screen.findByRole("button", { name: "Suspender Metformina 850 mg" }) as HTMLButtonElement;
    const reactivate = screen.getByRole("button", { name: "Reativar Sinvastatina 20 mg" }) as HTMLButtonElement;
    fireEvent.click(suspend);
    fireEvent.click(suspend);
    await waitFor(() => expect(suspend.disabled).toBe(true));
    expect(reactivate.disabled).toBe(true);
    fireEvent.click(reactivate);
    expect(api.changeMedication).toHaveBeenCalledTimes(1);
    finish(medication());
    await waitFor(() => expect(suspend.disabled).toBe(false));
    expect(reactivate.disabled).toBe(false);
  });

  it("invalid_medication ao suspender: diz que mudou e relê a lista", async () => {
    mocked(api.changeMedication).mockRejectedValue(new ApiError(422, { error: "invalid_medication" }, "422"));
    renderWithProviders(<MedicationsBlock patientId="pa1" draftConsultationId="cs1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Suspender Metformina 850 mg" }));
    expect((await screen.findByRole("alert")).textContent).toBe("este medicamento mudou desde a leitura — a lista foi atualizada");
    await waitFor(() => expect(mocked(api.listPatientMedications).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("'Incluir na lista' trava em voo: duplo clique manda uma vez só", async () => {
    let finish: (m: ReturnType<typeof medication>) => void = () => {};
    mocked(api.changeMedication).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWithProviders(<MedicationsBlock patientId="pa1" draftConsultationId="cs1" searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Informar medicamento em uso de fora" }));
    fireEvent.change(screen.getByLabelText("Ou escreva o nome (texto livre)"), { target: { value: "Losartana 50 mg" } });
    const save = screen.getByRole("button", { name: "Incluir na lista" }) as HTMLButtonElement;
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(save.disabled).toBe(true));
    expect(api.changeMedication).toHaveBeenCalledTimes(1);
    finish(medication());
    await waitFor(() => expect(screen.queryByRole("region", { name: "Medicamento em uso de fora" })).toBeNull());
  });
});
