import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), collectSampleByBarcode: vi.fn(), listActiveUnits: vi.fn() };
});

import * as api from "../lib/api";
import { LabCollection, collectOutcome } from "./LabCollection";
import { renderWithProviders } from "../test/campaignFixtures";
import { UBS21B, labContext, labSample, labUser } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const read = (code: string) => {
  const input = screen.getByLabelText("Etiqueta do tubo");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  localStorage.clear();
  for (const fn of [ api.fetchCurrentSession, api.getLabContext, api.collectSampleByBarcode, api.listActiveUnits ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "health_professional" ]));
  mocked(api.getLabContext).mockResolvedValue(labContext());
  mocked(api.listActiveUnits).mockResolvedValue([ UBS21B ]);
  mocked(api.collectSampleByBarcode).mockResolvedValue({ ...labSample({ collected_at: "2026-10-15T09:00:00-03:00" }), requisition_number: "20260123" });
});

describe("LabCollection", () => {
  it("UBS: a leitura registra a coleta e diz a requisição", async () => {
    renderWithProviders(<LabCollection />);
    fireEvent.click(await screen.findByRole("button", { name: "UBS Centro" }));
    await screen.findByLabelText("Etiqueta do tubo");
    read("0000012301");
    await waitFor(() => expect(api.collectSampleByBarcode).toHaveBeenCalledWith("0000012301"));
    expect(await screen.findByText("0000012301 · coleta registrada · requisição 20260123")).not.toBeNull();
  });

  it("etiqueta desconhecida e amostra já coletada têm frases próprias", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    mocked(api.collectSampleByBarcode)
      .mockRejectedValueOnce(new api.ApiError(404, { error: "not_found" }, "x"))
      .mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<LabCollection />);
    await screen.findByLabelText("Etiqueta do tubo");
    read("0000099901"); read("0000012301");
    expect(await screen.findByText("0000099901 · etiqueta ou requisição não encontrada — confira o código")).not.toBeNull();
    expect(await screen.findByText("0000012301 · esta amostra já foi coletada ou não está aguardando coleta")).not.toBeNull();
  });

  it("collectOutcome: erro sem código conhecido cai na mensagem genérica; rede cai em sem conexão", () => {
    expect(collectOutcome(new api.ApiError(500, {}, "x")).text).toContain("500");
    expect(collectOutcome(new Error("boom"))).toEqual({ ok: false, text: "sem conexão com o servidor — tente de novo" });
  });

  it("UBS que não coleta não abre o campo", async () => {
    mocked(api.listActiveUnits).mockResolvedValue([ { ...UBS21B, collects_samples: false } ]);
    renderWithProviders(<LabCollection />);
    fireEvent.click(await screen.findByRole("button", { name: "UBS Centro" }));
    await waitFor(() => expect(screen.queryByLabelText("Etiqueta do tubo")).toBeNull());
  });
});
