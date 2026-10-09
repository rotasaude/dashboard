import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listMyConsultations: vi.fn(), getConsultation: vi.fn(),
    getConsultationOptions: vi.fn(), getJustifiedRecord: vi.fn(), getAttendanceRecord: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { MyConsultations } from "./MyConsultations";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { consultationListItem, finalized, options } from "../test/consultationFixtures";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const pro = () => sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record" ] });

describe("Minhas consultas", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listMyConsultations, api.getConsultation, api.getConsultationOptions ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue(pro());
    m(api.listMyConsultations).mockResolvedValue([ consultationListItem() ]);
    m(api.getConsultation).mockResolvedValue(finalized());
    m(api.getConsultationOptions).mockResolvedValue(options());
  });

  it("interruptor desligado: diz e não chama nada", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ]));
    renderWithProviders(<MyConsultations />);
    expect(await screen.findByText("o prontuário está desligado nesta cidade")).not.toBeNull();
    expect(api.listMyConsultations).not.toHaveBeenCalled();
  });

  it("papel errado: recepção não vê a lista", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "citizen_verifier" ], { features: [ "clinical_record" ] }));
    renderWithProviders(<MyConsultations />);
    expect(await screen.findByText("seu papel não permite ver consultas")).not.toBeNull();
    expect(api.listMyConsultations).not.toHaveBeenCalled();
  });

  it("lista sem período e mostra as colunas", async () => {
    renderWithProviders(<MyConsultations />);
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    expect(screen.getByText("Consulta no dia")).not.toBeNull();
    expect(screen.getByText("UBS Centro")).not.toBeNull();
    expect(m(api.listMyConsultations).mock.calls[0][0]).toEqual({});
  });

  it("tipo ausente vira travessão e lista vazia diz", async () => {
    m(api.listMyConsultations).mockResolvedValue([ consultationListItem({ care_type: null, care_type_label: null }) ]);
    renderWithProviders(<MyConsultations />);
    await screen.findByText("Joana Lima");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    cleanup();
    m(api.listMyConsultations).mockResolvedValue([]);
    renderWithProviders(<MyConsultations />);
    expect(await screen.findByText("nenhuma consulta finalizada no período")).not.toBeNull();
  });

  it("Buscar envia o período; invertido não busca e diz por quê", async () => {
    renderWithProviders(<MyConsultations />);
    await screen.findByText("Joana Lima");
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByText("Buscar"));
    expect(screen.getByText("a data inicial precisa ser igual ou anterior à final")).not.toBeNull();
    expect(api.listMyConsultations).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-08" } });
    fireEvent.click(screen.getByText("Buscar"));
    await waitFor(() => expect(api.listMyConsultations).toHaveBeenCalledTimes(2));
    expect(m(api.listMyConsultations).mock.calls[1][0]).toEqual({ from: "2026-10-05", to: "2026-10-08" });
  });

  it("422 invalid_period vira frase", async () => {
    m(api.listMyConsultations).mockRejectedValue(new ApiError(422, { error: "invalid_period" }, "422"));
    renderWithProviders(<MyConsultations />);
    expect(await screen.findByText("o período informado não é válido")).not.toBeNull();
  });

  it("403 missing_role na lista: frase local de consultas", async () => {
    m(api.listMyConsultations).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "403"));
    renderWithProviders(<MyConsultations />);
    expect(await screen.findByText("seu papel não permite ver consultas")).not.toBeNull();
  });

  it("Abrir mostra a consulta com Imprimir e Adendo para a autora; Fechar volta à lista", async () => {
    renderWithProviders(<MyConsultations />);
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getByRole("button", { name: /^Abrir consulta de / }));
    expect(await screen.findByText("Imprimir")).not.toBeNull();
    expect(screen.getByText("Adendo")).not.toBeNull();
    expect(m(api.getConsultation).mock.calls[0][0]).toBe("c1");
    expect(api.getJustifiedRecord).not.toHaveBeenCalled();
    expect(api.getAttendanceRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Fechar consulta"));
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    expect(screen.queryByText("Imprimir")).toBeNull();
  });
});
