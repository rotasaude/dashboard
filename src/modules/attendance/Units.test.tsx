import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, listAllUnits: vi.fn(), createUnit: vi.fn(), updateUnit: vi.fn(), setUnitActive: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { Units } from "./Units";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const rows = [
  { id: "u1", name: "UBS Centro", kind: "ubs", active: true },
  { id: "u2", name: "UPA Norte", kind: "upa", active: false }
];

describe("Units", () => {
  beforeEach(() => {
    for (const fn of [ api.listAllUnits, api.createUnit, api.updateUnit, api.setUnitActive ]) mocked(fn).mockReset();
    mocked(api.listAllUnits).mockResolvedValue(rows);
  });

  it("cria uma unidade com nome e tipo", async () => {
    mocked(api.createUnit).mockResolvedValue({ id: "u3", name: "Hospital Sul", kind: "hospital", active: true });
    mocked(api.listAllUnits).mockResolvedValueOnce(rows).mockResolvedValueOnce([
      ...rows, { id: "u3", name: "Hospital Sul", kind: "hospital", active: true }
    ]);
    render(<Units />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Hospital Sul" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "hospital" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.createUnit).toHaveBeenCalledWith("Hospital Sul", "hospital"));
    expect(await screen.findByText("Hospital Sul")).not.toBeNull();
  });

  it("edita uma unidade", async () => {
    mocked(api.updateUnit).mockResolvedValue({ id: "u1", name: "UBS Centro Novo", kind: "ubs", active: true });
    mocked(api.listAllUnits).mockResolvedValueOnce(rows).mockResolvedValueOnce([
      { id: "u1", name: "UBS Centro Novo", kind: "ubs", active: true }, rows[1]
    ]);
    render(<Units />);
    fireEvent.click(await screen.findAllByRole("button", { name: "Editar" }).then((btns) => btns[0]));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "UBS Centro Novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalledWith("u1", "UBS Centro Novo", "ubs"));
    expect(await screen.findByText("UBS Centro Novo")).not.toBeNull();
  });

  it("desativa uma unidade ativa", async () => {
    mocked(api.setUnitActive).mockResolvedValue({ id: "u1", name: "UBS Centro", kind: "ubs", active: false });
    render(<Units />);
    const btn = await screen.findByRole("button", { name: "Desativar" });
    fireEvent.click(btn);
    await waitFor(() => expect(api.setUnitActive).toHaveBeenCalledWith("u1", false));
  });

  it("reativa uma unidade inativa", async () => {
    mocked(api.setUnitActive).mockResolvedValue({ id: "u2", name: "UPA Norte", kind: "upa", active: true });
    render(<Units />);
    const btn = await screen.findByRole("button", { name: "Reativar" });
    fireEvent.click(btn);
    await waitFor(() => expect(api.setUnitActive).toHaveBeenCalledWith("u2", true));
  });

  it("mostra a frase de unit_name_taken", async () => {
    mocked(api.createUnit).mockRejectedValue(new ApiError(422, { error: "unit_name_taken" }, "x"));
    render(<Units />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "UBS Centro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("já existe uma unidade com este nome")).not.toBeNull();
  });
});
