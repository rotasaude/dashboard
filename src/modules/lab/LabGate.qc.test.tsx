// src/modules/lab/LabGate.qc.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn() };
});

import * as api from "../../lib/api";
import { LabGate } from "./LabGate";
import { LabPick } from "./LabPick";
import { saveFile } from "./saveFile";
import { ReagentLotTag } from "../inventory/ReagentLotTag";
import { QC_DISABLED } from "../../lib/qc";
import { renderWithProviders } from "../../test/campaignFixtures";
import { qcContext, qcUser } from "../../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { mocked(api.fetchCurrentSession).mockReset(); mocked(api.getLabContext).mockReset(); });

const gate = (requires: ("lab_quality_control" | "lab_inventory")[]) => renderWithProviders(
  <LabGate title="CIQ" sub="x" allow={(r) => r.staff} requires={requires} disabledText={QC_DISABLED}>{() => <p>conteúdo</p>}</LabGate>
);

describe("LabGate com interruptor do 21c", () => {
  it("interruptor desligado: a frase do 21c e nenhuma leitura", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ], { features: [ "exam_tracking", "municipal_lab" ] }));
    gate([ "lab_quality_control" ]);
    expect(await screen.findByText(QC_DISABLED)).not.toBeNull();
    expect(api.getLabContext).not.toHaveBeenCalled();
  });

  it("basta um dos interruptores pedidos", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ], { features: [ "exam_tracking", "municipal_lab", "lab_inventory" ] }));
    mocked(api.getLabContext).mockResolvedValue(qcContext());
    gate([ "lab_quality_control", "lab_inventory" ]);
    expect(await screen.findByText("conteúdo")).not.toBeNull();
  });

  it("sem municipal_lab a frase é a do laboratório, mesmo com o 21c ligado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ], { features: [ "exam_tracking", "lab_quality_control" ] }));
    gate([ "lab_quality_control" ]);
    expect(await screen.findByText("o laboratório municipal está desligado nesta cidade")).not.toBeNull();
  });
});

describe("LabPick", () => {
  it("dois laboratórios: escolhe; RT vem do contexto", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_releaser" ]));
    mocked(api.getLabContext).mockResolvedValue(qcContext({
      labs: [ { id: "pv9", name: "Laboratório Municipal" }, { id: "pv8", name: "Laboratório Distrital" } ], technical_lead_of: [ "pv8" ]
    }));
    renderWithProviders(<LabPick>{(lab) => <p>{`${lab.name} · ${lab.lead ? "RT" : "equipe"}`}</p>}</LabPick>);
    expect(await screen.findByText("Laboratório Municipal · equipe")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Laboratório"), { target: { value: "pv8" } });
    expect(screen.getByText("Laboratório Distrital · RT")).not.toBeNull();
  });

  it("contexto sem technical_lead_of (api antigo): ninguém é RT", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_releaser" ]));
    mocked(api.getLabContext).mockResolvedValue({ labs: [ { id: "pv9", name: "Laboratório Municipal" } ], releaser_of: [ "pv9" ], council: "CRF" });
    renderWithProviders(<LabPick>{(lab) => <p>{lab.lead ? "RT" : "equipe"}</p>}</LabPick>);
    expect(await screen.findByText("equipe")).not.toBeNull();
    expect(screen.queryByLabelText("Laboratório")).toBeNull();
  });
});

describe("ReagentLotTag", () => {
  // Estoque desligado (nada aparece) está coberto pela regra pura `reagentLotMark` (Task 3).
  it("lote e sem rastreio com o estoque ligado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ]));
    renderWithProviders(<p><ReagentLotTag row={{ reagent_lot: { id: "sl1", lot_number: "R-778" } }} /> · <ReagentLotTag row={{ reagent_lot: null }} /></p>);
    expect(await screen.findByText("lote R-778")).not.toBeNull();
    expect(await screen.findByText("sem rastreio de reagente")).not.toBeNull();
  });
});

describe("saveFile", () => {
  it("baixa pelo link temporário e devolve o objeto", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    saveFile({ blob: new Blob([ "a,b" ]), filename: null }, "rastreio-R-778.csv");
    expect(click).toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith("blob:x");
    vi.useRealTimers();
  });
});
