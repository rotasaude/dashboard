import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn() };
});

import * as api from "../../lib/api";
import { LabGate } from "./LabGate";
import { renderWithProviders } from "../../test/campaignFixtures";
import { labContext, labUser } from "../../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

function gate(allow = (r: { staff: boolean }) => r.staff) {
  return renderWithProviders(<LabGate title="Bancada" sub="x" allow={allow}>{() => <p>conteúdo</p>}</LabGate>);
}

describe("LabGate", () => {
  beforeEach(() => { mocked(api.fetchCurrentSession).mockReset(); mocked(api.getLabContext).mockReset(); });

  it("com papel e laboratório, mostra o conteúdo", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    mocked(api.getLabContext).mockResolvedValue(labContext());
    gate();
    expect(await screen.findByText("conteúdo")).not.toBeNull();
  });

  it("contexto vazio (B32) é estado vazio, não erro", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    mocked(api.getLabContext).mockResolvedValue(labContext({ labs: [] }));
    gate();
    expect(await screen.findByText("nenhum laboratório municipal para você — fale com o administrador")).not.toBeNull();
    expect(screen.queryByText("conteúdo")).toBeNull();
    expect(screen.queryByText("Falha ao carregar")).toBeNull();
  });

  it("sem o papel: avisa e nem lê o contexto", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "health_professional" ]));
    gate();
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.getLabContext).not.toHaveBeenCalled();
  });

  it("sem o interruptor: avisa e nem lê o contexto", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ], { features: [ "exam_tracking" ] }));
    gate();
    expect(await screen.findByText("o laboratório municipal está desligado nesta cidade")).not.toBeNull();
    expect(api.getLabContext).not.toHaveBeenCalled();
  });
});
