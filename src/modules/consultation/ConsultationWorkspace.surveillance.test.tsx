// src/modules/consultation/ConsultationWorkspace.surveillance.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(), startConsultation: vi.fn(),
    getConsultation: vi.fn(), getConsultationProblems: vi.fn() };
});
vi.mock("./ConsultationEditor", () => ({ ConsultationEditor: (p: { notifications?: boolean }) => <span>{`editor ${p.notifications ? "com" : "sem"} notificação`}</span> }));

import * as api from "../../lib/api";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { consultation, finalized, options, problem, record } from "../../test/consultationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

describe("ConsultationWorkspace — notificação (módulo 25)", () => {
  beforeEach(() => {
    mocked(api.getAttendanceRecord).mockResolvedValue(record());
    mocked(api.getConsultationOptions).mockResolvedValue(options());
    mocked(api.getConsultationProblems).mockResolvedValue([ problem() ]);
  });
  const open = async (features: string[], cbo = "225142", roles = [ "health_professional" ], started = consultation({ cbo_code: cbo })) => {
    mocked(api.startConsultation).mockResolvedValue(started);
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith(roles, { id: "us1", features }));
    renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={() => undefined} onFinalized={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
  };

  it("médico com surveillance e prontuário: o editor recebe a notificação", async () => {
    await open([ "clinical_record", "surveillance" ]);
    expect(await screen.findByText("editor com notificação")).not.toBeNull();
  });
  it("enfermeiro (2235*) também", async () => {
    await open([ "clinical_record", "surveillance" ], "223505");
    expect(await screen.findByText("editor com notificação")).not.toBeNull();
  });
  it.each([
    [ "sem surveillance", [ "clinical_record" ], "225142" ],
    [ "técnico de enfermagem", [ "clinical_record", "surveillance" ], "322205" ]
  ])("%s: sem notificação", async (_, features, cbo) => {
    await open(features, cbo);
    expect(await screen.findByText("editor sem notificação")).not.toBeNull();
  });
  it("sem o papel de profissional de saúde: sem notificação", async () => {
    await open([ "clinical_record", "surveillance" ], "225142", [ "municipal_admin" ]);
    expect(await screen.findByText("editor sem notificação")).not.toBeNull();
  });
  it("consulta finalizada: o editor nem existe (a tela só oferece notificar no rascunho)", async () => {
    await open([ "clinical_record", "surveillance" ], "225142", [ "health_professional" ], finalized());
    await screen.findByRole("region", { name: "Consulta finalizada" });
    expect(screen.queryByText(/^editor /)).toBeNull();
  });
});
