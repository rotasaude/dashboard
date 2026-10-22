// src/modules/timeline/PatientTimeline.procedure.test.tsx
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

describe("PatientTimeline — procedimentos (módulo 22)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getTimeline ]) m(fn).mockReset();
    m(api.getTimeline).mockResolvedValue(page({ entries: [ entry({
      id: "procedure:pp1", kind: "procedure", occurred_at: "2026-10-21T09:10:00-03:00", unit: { id: "u7", name: "UPA Boa Vista" },
      professional: { name: "Dra. Helena Prado", cbo_code: "225125" }, title: "Atendimento de urgência em atenção especializada",
      summary: null, status: "recorded", detail_ref: null
    }) ] }));
  });

  it("sem o interruptor não há filtro Procedimento; com ele, o tipo aparece, a entrada mostra unidade e profissional e não abre", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline" ] }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    await screen.findByText("Linha do tempo de Joana Lima");
    expect(screen.queryByLabelText("Procedimento")).toBeNull();
    cleanup();
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline", "procedure_billing" ] }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    await screen.findByLabelText("Procedimento");
    expect(screen.getByText("Atendimento de urgência em atenção especializada")).not.toBeNull();
    expect(screen.getByText("UPA Boa Vista")).not.toBeNull();
    expect(screen.getByText("Dra. Helena Prado")).not.toBeNull();
    expect(screen.getByText("registrado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir procedimento/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Campanha"));
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(api.getTimeline).toHaveBeenLastCalledWith({ attendanceId: "a1" }, {
      kinds: [ "triage", "attendance", "screening", "appointment", "consultation", "clinical_document", "controlled_notification", "procedure" ],
      from: "", to: ""
    }, null));
  });
});
