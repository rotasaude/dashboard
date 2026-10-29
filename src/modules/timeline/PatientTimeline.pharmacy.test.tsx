// src/modules/timeline/PatientTimeline.pharmacy.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getTimeline: vi.fn() };
});

import * as api from "../../lib/api";
import { PatientTimeline } from "./PatientTimeline";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { entry, page } from "../../test/timelineFixtures";

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

describe("PatientTimeline — dispensação (módulo 27a)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getTimeline ]) m(fn).mockReset();
    m(api.getTimeline).mockResolvedValue(page({ entries: [ entry({
      id: "dispensation:d1", kind: "dispensation", occurred_at: "2026-10-22T10:00:00-03:00", unit: { id: "u3", name: "Farmácia da UBS Centro" },
      professional: null, title: "Dispensação de medicamentos", summary: "Amoxicilina 500 mg; Metformina 850 mg",
      status: "dispensed", detail_ref: null
    }) ] }));
  });

  it("sem o interruptor a entrada continua na lista (registro retido), sem filtro e sem detalhe", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline" ] }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    await screen.findByText("Dispensação de medicamentos");
    expect(screen.queryByLabelText("Dispensação")).toBeNull();
    expect(screen.getByText("Farmácia da UBS Centro")).not.toBeNull();
    expect(screen.getByText("Amoxicilina 500 mg; Metformina 850 mg")).not.toBeNull();
    expect(screen.getByText("dispensado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir/ })).toBeNull();
  });

  it("com a farmácia ligada o tipo aparece no filtro e vai em kinds[]", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline", "pharmacy" ] }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    await screen.findByLabelText("Dispensação");
    for (const label of [ "Triagem", "Atendimento", "Escuta", "Agendamento", "Consulta", "Documento", "Notificação de receita", "Campanha" ]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(api.getTimeline).toHaveBeenLastCalledWith({ attendanceId: "a1" }, { kinds: [ "dispensation" ], from: "", to: "" }, null));
  });
});
