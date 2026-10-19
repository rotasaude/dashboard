import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listLabAdminExams: vi.fn(), listLabTemplates: vi.fn(), getLabAdminExam: vi.fn(), listAdminInstruments: vi.fn(), createLabExamVersion: vi.fn() };
});

import * as api from "../../lib/api";
import { LabExamsPanel } from "./LabExamsPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { labExam, labVersion } from "../../test/labFixtures";
import { instrument, qcUser } from "../../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(qcUser([ "municipal_admin" ]));
  mocked(api.listLabAdminExams).mockReset().mockResolvedValue([ labExam() ]);
  mocked(api.listLabTemplates).mockReset().mockResolvedValue([]);
  mocked(api.getLabAdminExam).mockReset().mockResolvedValue(labExam());
  mocked(api.listAdminInstruments).mockReset();
});

describe("LabExamsPanel: falha ao ler os aparelhos", () => {
  it("mostra o alerta, 'Tentar de novo' relê e o VersionForm monta", async () => {
    mocked(api.listAdminInstruments).mockRejectedValueOnce(new api.ApiError(500, {}, "x")).mockResolvedValue([ instrument() ]);
    renderWithProviders(<LabExamsPanel providerId="pv9" />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova versão" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.queryByRole("region", { name: /Nova versão de/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("region", { name: "Nova versão de Glicose (atual v1)" })).not.toBeNull();
    expect(api.listAdminInstruments).toHaveBeenCalledTimes(2);
  });
});

describe("LabExamsPanel: lista de exames do 21c", () => {
  it("criar versão invalida a lista de exames do CIQ/CEQ/estoque (qcExams)", async () => {
    mocked(api.listAdminInstruments).mockResolvedValue([ instrument() ]);
    mocked(api.createLabExamVersion).mockResolvedValue(labVersion({ id: "ev2", version: 2 }));
    const spy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    renderWithProviders(<LabExamsPanel providerId="pv9" />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova versão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revisar e salvar versão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar versão 2" }));
    await waitFor(() => expect(spy.mock.calls.some(([ f ]) => JSON.stringify((f as { queryKey?: unknown })?.queryKey) === JSON.stringify([ "qcExams" ]))).toBe(true));
  });
});
