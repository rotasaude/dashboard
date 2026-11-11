// Módulo 32b (D11): o summary da entrada "urgency" já traz "observação N h"; a tela não acrescenta linha própria.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { vacUser } from "../../test/vaccinationFixtures";
import * as api from "../../lib/api";
import { PatientTimeline } from "./PatientTimeline";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getTimeline: vi.fn() }));
beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser([ "health_professional" ], { features: [ "clinical_record", "patient_timeline" ] }));
  vi.mocked(api.getTimeline).mockResolvedValue({ person: { display_name: "Joana Lima", partial: false, patient_id: "pa1" }, next_before: null,
    entries: [ { id: "e1", kind: "urgency", occurred_at: "2026-11-01T09:30:00-03:00", unit: { id: "u1", name: "UPA Boqueirão" },
      professional: { name: "Dra. Ana", cbo_code: "225125" }, title: "Atendimento na UPA", summary: "alta · observação 18 h", status: "active",
      detail_ref: null, observation_hours: 18 } ] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("linha do tempo com urgência e observação", () => {
  it("mostra o resumo uma vez e nenhuma linha 'Observação: N h' duplicada", async () => {
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect(await screen.findByText("alta · observação 18 h")).not.toBeNull();
    expect(screen.queryByText(/Observação: 18 h/)).toBeNull();
    expect(document.body.textContent?.match(/observação 18 h/gi)?.length).toBe(1);
  });
});
