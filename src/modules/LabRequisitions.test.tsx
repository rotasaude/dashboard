// src/modules/LabRequisitions.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listLabRequisitions: vi.fn(), getLabRequisition: vi.fn(),
    listActiveUnits: vi.fn() };
});

import * as api from "../lib/api";
import { LabRequisitions } from "./LabRequisitions";
import { renderWithProviders } from "../test/campaignFixtures";
import { LAB_PROVIDER, UBS21B, labContext, labRequisition, labUser } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const { items: _i, samples: _s, ...ROW } = labRequisition();

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  localStorage.clear();
  for (const fn of [ api.fetchCurrentSession, api.getLabContext, api.listLabRequisitions, api.getLabRequisition, api.listActiveUnits ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
  mocked(api.getLabContext).mockResolvedValue(labContext());
  mocked(api.listLabRequisitions).mockResolvedValue({ requisitions: [ ROW ], next_before: null });
  mocked(api.getLabRequisition).mockResolvedValue(labRequisition());
  mocked(api.listActiveUnits).mockResolvedValue([ UBS21B, { id: "u2", name: "UBS Sul", kind: "ubs", collects_samples: false } ]);
});

describe("LabRequisitions", () => {
  it("laboratório: lista do próprio laboratório e situação pelo número", async () => {
    renderWithProviders(<LabRequisitions />);
    expect(await screen.findByText("00000123")).not.toBeNull();
    expect(api.listLabRequisitions).toHaveBeenCalledWith({ providerId: LAB_PROVIDER.id, before: null });
    fireEvent.change(screen.getByLabelText("Número da requisição ou etiqueta"), { target: { value: "00000123" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver situação" }));
    await waitFor(() => expect(api.listLabRequisitions).toHaveBeenLastCalledWith({ providerId: "pv9", number: "00000123", before: null }));
  });

  it("busca que não é número nem etiqueta explica e não consulta", async () => {
    renderWithProviders(<LabRequisitions />);
    await screen.findByText("00000123");
    mocked(api.listLabRequisitions).mockClear();
    fireEvent.change(screen.getByLabelText("Número da requisição ou etiqueta"), { target: { value: "2026-000123" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver situação" }));
    expect((await screen.findByRole("alert")).textContent).toBe("informe o número da requisição (8 dígitos) ou leia a etiqueta (10 dígitos)");
    expect(api.listLabRequisitions).not.toHaveBeenCalled();
  });

  it("situação pela leitura da etiqueta: código de etiqueta vai como barcode", async () => {
    renderWithProviders(<LabRequisitions />);
    await screen.findByText("00000123");
    fireEvent.change(screen.getByLabelText("Número da requisição ou etiqueta"), { target: { value: "0000012301" } });
    fireEvent.keyDown(screen.getByLabelText("Número da requisição ou etiqueta"), { key: "Enter" });
    await waitFor(() => expect(api.listLabRequisitions).toHaveBeenLastCalledWith({ providerId: "pv9", barcode: "0000012301", before: null }));
  });

  it("UBS: escolhe a unidade; unidade que não coleta explica e não lista", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "health_professional" ]));
    renderWithProviders(<LabRequisitions />);
    fireEvent.click(await screen.findByRole("button", { name: "UBS Sul" }));
    expect(await screen.findByText(/esta unidade não coleta amostras/)).not.toBeNull();
    expect(api.listLabRequisitions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "trocar" }));
    fireEvent.click(await screen.findByRole("button", { name: "UBS Centro" }));
    await waitFor(() => expect(api.listLabRequisitions).toHaveBeenCalledWith({ originUnitId: "u1", before: null }));
  });

  it("sem laboratório no contexto: explica", async () => {
    mocked(api.getLabContext).mockResolvedValue(labContext({ labs: [] }));
    renderWithProviders(<LabRequisitions />);
    expect(await screen.findByText("nenhum laboratório municipal para você — fale com o administrador")).not.toBeNull();
  });

  it("sem laboratório (200 com lista vazia, B32): explica sem erro", async () => {
    mocked(api.getLabContext).mockResolvedValue(labContext({ labs: [] }));
    renderWithProviders(<LabRequisitions />);
    await screen.findByText("nenhum laboratório municipal para você — fale com o administrador");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.listLabRequisitions).not.toHaveBeenCalled();
  });

  it("recepção sem papel do laboratório não entra", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "citizen_verifier" ]));
    renderWithProviders(<LabRequisitions />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.getLabContext).not.toHaveBeenCalled();
  });
});
