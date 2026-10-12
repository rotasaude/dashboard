// src/modules/consultation/PatientPanel.timeline.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getTimeline: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn() };
});

import * as api from "../../lib/api";
import { PatientPanel } from "./PatientPanel";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { options, record } from "../../test/consultationFixtures";
import { page } from "../../test/timelineFixtures";

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

describe("PatientPanel — aba Linha do tempo (módulo 20)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getTimeline, api.getAttendanceRecord, api.getConsultationOptions ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], {
      id: "us1", features: [ "clinical_record", "patient_timeline" ]
    }));
    m(api.getTimeline).mockResolvedValue(page());
    m(api.getAttendanceRecord).mockResolvedValue(record());
    m(api.getConsultationOptions).mockResolvedValue(options());
  });

  it("sem a prop: nenhuma aba, nada muda", () => {
    renderWithProviders(<PatientPanel record={record()} onOpenConsultation={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "Linha do tempo" })).toBeNull();
    expect(screen.getByText("Problemas ativos")).not.toBeNull();
  });

  it("com a prop: lê só ao abrir a aba e mantém montada na volta ao Resumo", async () => {
    renderWithProviders(<PatientPanel record={record()} onOpenConsultation={vi.fn()} timeline={{ subject: { attendanceId: "a1" } }} />);
    expect(screen.getByRole("tab", { name: "Resumo" }).getAttribute("aria-selected")).toBe("true");
    expect(api.getTimeline).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Linha do tempo" }));
    expect(await screen.findByText("Linha do tempo de Joana Lima")).not.toBeNull();
    expect(api.getTimeline).toHaveBeenCalledWith({ attendanceId: "a1" }, { kinds: [], from: "", to: "" }, null);
    // Escondido (hidden), não desmontado: *ByRole ignora o que está escondido.
    expect(screen.queryByRole("list", { name: "problemas ativos" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Resumo" }));
    expect(screen.getByRole("list", { name: "problemas ativos" })).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Linha do tempo" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Linha do tempo" }));
    expect(api.getTimeline).toHaveBeenCalledTimes(1);
  });

  it("no atendimento chamado (modo record): a aba lê pelo atendimento", async () => {
    renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={vi.fn()} onFinalized={vi.fn()} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Linha do tempo" }));
    expect(await screen.findByText("Linha do tempo de Joana Lima")).not.toBeNull();
    expect(api.getTimeline).toHaveBeenCalledWith({ attendanceId: "a1" }, { kinds: [], from: "", to: "" }, null);
  });

  it("no atendimento chamado sem patient_timeline: sem aba", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record" ] }));
    renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={vi.fn()} onFinalized={vi.fn()} />);
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "Linha do tempo" })).toBeNull();
  });
});
