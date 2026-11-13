// Módulo 24b (F-24.14, Q58): a entrada da visita mostra o resumo do api como veio e não abre detalhe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { hvUser } from "../../test/homeVisitFixtures";
import * as api from "../../lib/api";
import { PatientTimeline } from "./PatientTimeline";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getTimeline: vi.fn() }));
const base = { occurred_at: "2026-11-10T09:30:00-03:00", unit: { id: "u1", name: "UBS Centro" }, professional: { name: "Ana ACS", cbo_code: "515105" } };
beforeEach(() => {
  vi.mocked(api.getTimeline).mockResolvedValue({ person: { display_name: "Joana Lima", partial: false, patient_id: "pa1" }, next_before: null,
    entries: [
      { ...base, id: "e1", kind: "home_visit", title: "Visita no domicílio", summary: "PA 130/80 mmHg", status: "recorded",
        detail_ref: { type: "home_visit", id: "v1" } },
      { ...base, id: "e2", kind: "collective_activity", title: "Atividade coletiva", summary: "Educação em saúde", status: "withdrawn", detail_ref: null }
    ] } as never);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("linha do tempo com visita domiciliar", () => {
  it("mostra o resumo do api na íntegra, sem abrir detalhe", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "health_professional" ], [ "clinical_record", "patient_timeline", "territory_registry", "home_visits" ]));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect(await screen.findByText("PA 130/80 mmHg")).not.toBeNull();
    expect(screen.getByText("Educação em saúde")).not.toBeNull();
    expect(screen.getByText("retirada")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir visita domiciliar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir atividade coletiva/i })).toBeNull();
  });

  it("com o interruptor ligado o filtro oferece o tipo; desligado, a entrada continua e o filtro some", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "health_professional" ], [ "clinical_record", "patient_timeline", "territory_registry", "home_visits" ]));
    const { unmount } = renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    await screen.findByText("PA 130/80 mmHg");
    expect(screen.getByRole("checkbox", { name: "Visita domiciliar" })).not.toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Atividade coletiva" })).toBeNull(); // sem collective_activities
    unmount();
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "health_professional" ], [ "clinical_record", "patient_timeline" ]));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    await screen.findByText("PA 130/80 mmHg");
    expect(screen.queryByRole("checkbox", { name: "Visita domiciliar" })).toBeNull();
    expect(screen.getByText("Visita no domicílio")).not.toBeNull(); // registro retido
  });
});
