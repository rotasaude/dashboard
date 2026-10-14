import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(),
    startConsultation: vi.fn(), getConsultation: vi.fn(), getConsultationProblems: vi.fn() };
});
vi.mock("./ConsultationEditor", () => ({
  ConsultationEditor: (p: { examPriority?: boolean }) => <span>{`editor prioridade ${p.examPriority ? "ligada" : "desligada"}`}</span>
}));

import * as api from "../../lib/api";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { consultation, options, problem, record } from "../../test/consultationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

describe("ConsultationWorkspace — prioridade do exame (módulo 21a)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getAttendanceRecord, api.getConsultationOptions, api.startConsultation, api.getConsultationProblems ]) mocked(fn).mockReset();
    mocked(api.getAttendanceRecord).mockResolvedValue(record());
    mocked(api.getConsultationOptions).mockResolvedValue(options());
    mocked(api.startConsultation).mockResolvedValue(consultation());
    mocked(api.getConsultationProblems).mockResolvedValue([ problem() ]);
  });

  it.each([ [ [ "clinical_record", "exam_tracking" ], "ligada" ], [ [ "clinical_record" ], "desligada" ] ])("features %j: editor recebe prioridade %s", async (features, expected) => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features }));
    renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={() => undefined} onFinalized={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    expect(await screen.findByText(`editor prioridade ${expected}`)).not.toBeNull();
  });
});
