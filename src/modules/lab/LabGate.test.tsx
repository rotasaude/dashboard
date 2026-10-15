import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

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

function gate(allow: (r: { staff: boolean; admin: boolean }) => boolean = (r) => r.staff, needsLab?: boolean) {
  return renderWithProviders(<LabGate title="Bancada" sub="x" allow={allow} needsLab={needsLab}>{() => <p>conteúdo</p>}</LabGate>);
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

  it("tela de administração (needsLab=false) abre com labs vazio e não lê o contexto", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "municipal_admin" ]));
    mocked(api.getLabContext).mockResolvedValue(labContext({ labs: [] }));
    gate((r) => r.admin, false);
    expect(await screen.findByText("conteúdo")).not.toBeNull();
    expect(screen.queryByText(/nenhum laboratório municipal para você/)).toBeNull();
    expect(api.getLabContext).not.toHaveBeenCalled();
  });

  it("administrador numa tela que exige laboratório (padrão) segue a regra de B32", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "municipal_admin" ]));
    mocked(api.getLabContext).mockResolvedValue(labContext({ labs: [] }));
    gate((r) => r.admin);
    expect(await screen.findByText(/nenhum laboratório municipal para você/)).not.toBeNull();
  });

  it("enquanto lê o contexto mostra o esqueleto, sem o conteúdo", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    mocked(api.getLabContext).mockReturnValue(new Promise(() => {}));
    const { container } = gate();
    await waitFor(() => expect(api.getLabContext).toHaveBeenCalled());
    expect(screen.queryByText("conteúdo")).toBeNull();
    expect(container.textContent).not.toContain("nenhum laboratório");
  });

  it("profissional com 403 missing_role: unidade não coleta (estado vazio, sem erro)", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "health_professional" ]));
    mocked(api.getLabContext).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "x"));
    gate((r) => (r as { professional?: boolean }).professional === true);
    expect(await screen.findByText(/esta unidade não coleta amostras/)).not.toBeNull();
    expect(screen.queryByText("Falha ao carregar")).toBeNull();
  });

  it("403 missing_role de quem não é profissional segue como erro", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    mocked(api.getLabContext).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "x"));
    gate();
    expect(await screen.findByText("Falha ao carregar")).not.toBeNull();
  });

  it("falha na leitura do contexto vira ErrorState com nova tentativa", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    mocked(api.getLabContext).mockRejectedValueOnce(new Error("rede"));
    gate();
    expect(await screen.findByText("Falha ao carregar")).not.toBeNull();
    expect(screen.queryByText("conteúdo")).toBeNull();
    mocked(api.getLabContext).mockResolvedValueOnce(labContext());
    fireEvent.click(screen.getByRole("button", { name: "tentar novamente" }));
    expect(await screen.findByText("conteúdo")).not.toBeNull();
  });
});
