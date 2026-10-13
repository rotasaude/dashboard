import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listActiveUnits: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
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

  it("mostra alerta quando listActiveUnits falha, em vez de painel em branco", async () => {
    mocked(api.listActiveUnits).mockRejectedValue(new ApiError(500, { error: "server_error" }, "x"));
    render(<UnitPicker userId="u1" onChange={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("não foi possível concluir — tente de novo");
  });
});

describe("UnitPicker — usabilidade (6b)", () => {
  it("FC-16: a escolha explica o que libera, e a unidade escolhida fica no painel Unidade", async () => {
    localStorage.clear();
    mocked(api.listActiveUnits).mockResolvedValue(units);
    render(<UnitPicker userId="u1" onChange={vi.fn()} />);
    expect(await screen.findByText("Escolha a unidade para ver o check-in e a fila")).not.toBeNull();
    fireEvent.click(screen.getByText("UBS Centro"));
    expect(screen.getByRole("region", { name: "Unidade" })).not.toBeNull();
  });
});

describe("UnitPicker — vínculo, atual e cancelar (AT-16)", () => {
  it("unidades com vínculo primeiro e marcadas; ao trocar, a atual aparece e Escape mantém", async () => {
    localStorage.clear();
    localStorage.setItem(currentUnitKey("u1"), "u1");
    mocked(api.listActiveUnits).mockResolvedValue(units);
    const onChange = vi.fn();
    const onChoosing = vi.fn();
    render(<UnitPicker userId="u1" onChange={onChange} linkedUnitIds={new Set([ "u2" ])} onChoosing={onChoosing} />);
    fireEvent.click(await screen.findByRole("button", { name: "trocar" }));
    expect(onChoosing).toHaveBeenLastCalledWith(true);
    const options = screen.getAllByRole("button").filter((b) => /UBS Centro|UPA Norte/.test(b.textContent ?? "") && !/manter/.test(b.textContent ?? ""));
    expect(options[0].textContent).toContain("UPA Norte");
    expect(options[0].textContent).toContain("seu vínculo");
    expect(options[1].getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "manter UBS Centro" })).not.toBeNull();
    fireEvent.keyDown(options[0], { key: "Escape" });
    expect(screen.getByText("Unidade: UBS Centro")).not.toBeNull();
    expect(onChoosing).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("UnitPicker — Escape logo depois de trocar (I4)", () => {
  it("o foco vai para a unidade atual e Escape mantém", async () => {
    localStorage.clear();
    localStorage.setItem(currentUnitKey("u1"), "u1");
    mocked(api.listActiveUnits).mockResolvedValue(units);
    render(<UnitPicker userId="u1" onChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "trocar" }));
    const current = document.activeElement as HTMLElement;
    expect(current.getAttribute("aria-current")).toBe("true");
    fireEvent.keyDown(current, { key: "Escape" });
    expect(screen.getByText("Unidade: UBS Centro")).not.toBeNull();
  });
});

