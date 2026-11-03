// src/modules/timeline/PatientTimeline.vaccination.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { immunization, vacUser } from "../../test/vaccinationFixtures";
import * as api from "../../lib/api";
import { PatientTimeline } from "./PatientTimeline";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getTimeline: vi.fn(), getImmunization: vi.fn() }));
beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser([ "health_professional" ], { features: [ "clinical_record", "patient_timeline", "vaccination" ] }));
  vi.mocked(api.getTimeline).mockResolvedValue({ person: { display_name: "Joana Lima", partial: false, patient_id: "pa1" }, next_before: null,
    entries: [ { id: "e1", kind: "vaccination", occurred_at: "2026-09-01T09:30:00-03:00", unit: { id: "u1", name: "UBS Centro" },
      professional: { name: "Téc. Ana Souza", cbo_code: "322205" }, title: "Vacina Penta (DTP/HepB/Hib) — 1ª dose", summary: null, status: "active",
      detail_ref: { type: "immunization", id: "im1" } } ] });
  vi.mocked(api.getImmunization).mockResolvedValue(immunization());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("linha do tempo com vacina", () => {
  it("filtro Vacina, entrada e detalhe lido no clique", async () => {
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect(await screen.findByText("Vacina Penta (DTP/HepB/Hib) — 1ª dose")).not.toBeNull();
    expect(screen.getByLabelText("Vacina")).not.toBeNull();
    expect(api.getImmunization).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Abrir vacina de/ }));
    await waitFor(() => expect(api.getImmunization).toHaveBeenCalledWith("im1"));
    expect(await screen.findByText("enviada ao Ministério")).not.toBeNull();
  });
});
