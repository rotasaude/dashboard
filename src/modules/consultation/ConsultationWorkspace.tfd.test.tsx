// src/modules/consultation/ConsultationWorkspace.tfd.test.tsx
// Módulo 30 (F-30.5): "Pedir TFD" na consulta finalizada só com o TFD usável (tfd + transporte + prontuário) e CBO 225 da consulta.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(), startConsultation: vi.fn(),
    getConsultation: vi.fn(), getConsultationProblems: vi.fn(), getTfdOptions: vi.fn(), getTfdPrefill: vi.fn() };
});

import * as api from "../../lib/api";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { finalized, options, problem, record } from "../../test/consultationFixtures";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const TFD_ON = [ "clinical_record", "sanitary_transport", "tfd" ];

async function open(features: string[], cbo: string) {
  mocked(api.getAttendanceRecord).mockResolvedValue(record());
  mocked(api.getConsultationOptions).mockResolvedValue(options());
  mocked(api.getConsultationProblems).mockResolvedValue([ problem() ]);
  mocked(api.startConsultation).mockResolvedValue(finalized({ cbo_code: cbo, author: { id: "us1", name: "Dra. Helena Prado" } }));
  mocked(api.getTfdOptions).mockResolvedValue({ destinations: [], providers: [], min_distance_km: 50 });
  mocked(api.getTfdPrefill).mockResolvedValue({ patient_id: "pa1", cid10: null, sigtap_code: null });
  mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features }));
  renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={() => undefined} onFinalized={() => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
  await screen.findByRole("region", { name: "Consulta finalizada" });
}

describe("ConsultationWorkspace — Pedir TFD (módulo 30)", () => {
  it("TFD usável e CBO 225: o botão abre o laudo pré-preenchido pela consulta", async () => {
    await open(TFD_ON, "225142");
    fireEvent.click(screen.getByRole("button", { name: "Pedir TFD" }));
    expect(await screen.findByRole("form", { name: "Laudo de TFD" })).not.toBeNull();
    expect(api.getTfdPrefill).toHaveBeenCalledWith("cs1");
  });

  it.each([
    [ TFD_ON, "223505" ], [ [ "clinical_record", "tfd" ], "225142" ], [ [ "clinical_record", "sanitary_transport" ], "225142" ]
  ])("features %j, CBO %s: sem Pedir TFD", async (features, cbo) => {
    await open(features, cbo);
    expect(screen.getByRole("button", { name: "Fechar painel" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Pedir TFD" })).toBeNull();
    expect(api.getTfdOptions).not.toHaveBeenCalled();
  });
});
