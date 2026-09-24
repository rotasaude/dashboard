import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listActiveUnits: vi.fn() };
});

import * as api from "../../lib/api";
import { currentUnitKey } from "../../lib/attendance";
import { UnitPicker } from "./UnitPicker";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const units = [
  { id: "u1", name: "UBS Centro", kind: "ubs" },
  { id: "u2", name: "UPA Norte", kind: "upa" }
];

describe("UnitPicker", () => {
  beforeEach(() => {
    mocked(api.listActiveUnits).mockReset();
    localStorage.clear();
  });

  it("sem unidade guardada mostra a lista e grava a escolha", async () => {
    mocked(api.listActiveUnits).mockResolvedValue(units);
    const onChange = vi.fn();
    render(<UnitPicker userId="u1" onChange={onChange} />);
    expect(await screen.findByText("UBS Centro")).not.toBeNull();
    fireEvent.click(screen.getByText("UBS Centro"));
    expect(onChange).toHaveBeenCalledWith(units[0]);
    expect(localStorage.getItem(currentUnitKey("u1"))).toBe("u1");
  });

  it("com unidade guardada ativa mostra Unidade: UBS Centro", async () => {
    localStorage.setItem(currentUnitKey("u1"), "u1");
    mocked(api.listActiveUnits).mockResolvedValue(units);
    render(<UnitPicker userId="u1" onChange={vi.fn()} />);
    expect(await screen.findByText("Unidade: UBS Centro")).not.toBeNull();
  });

  it("com unidade guardada que não está mais ativa pede escolha de novo", async () => {
    localStorage.setItem(currentUnitKey("u1"), "u9");
    mocked(api.listActiveUnits).mockResolvedValue(units);
    const onChange = vi.fn();
    render(<UnitPicker userId="u1" onChange={onChange} />);
    expect(await screen.findByText("UBS Centro")).not.toBeNull();
    expect(screen.queryByText(/^Unidade:/)).toBeNull();
    expect(localStorage.getItem(currentUnitKey("u1"))).toBeNull();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("trocar volta à lista", async () => {
    localStorage.setItem(currentUnitKey("u1"), "u1");
    mocked(api.listActiveUnits).mockResolvedValue(units);
    render(<UnitPicker userId="u1" onChange={vi.fn()} />);
    expect(await screen.findByText("Unidade: UBS Centro")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "trocar" }));
    expect(await screen.findByText("UPA Norte")).not.toBeNull();
  });
});
