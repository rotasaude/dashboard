// src/modules/attendance/UnitForm.vector.test.tsx
// Módulo 35a (F-35.1; ADR 0054; Q10): o tipo de unidade "Vigilância ambiental e zoonoses" (environmental_surveillance) e a recusa de
// trocar o tipo da unidade que tem local de estoque vector_control ativo (409 unit_has_vector_control_location; health_units_controller.rb).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listAllUnits: vi.fn(), createUnit: vi.fn(), updateUnit: vi.fn(), setUnitActive: vi.fn(),
    listNeighborhoods: vi.fn(), drainUnit: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { EMPTY_ADDRESS_FIELDS } from "../../lib/unitAddress";
import { VECTOR_ERRORS } from "../../lib/vectorErrors";
import { UnitForm, type UnitFormValue } from "./UnitForm";
import { Units } from "./Units";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const LABEL = "Vigilância ambiental e zoonoses";
const EMPTY: UnitFormValue = { name: "UVZ Central", kind: "ubs", ...EMPTY_ADDRESS_FIELDS };
const form = (initial: UnitFormValue, props: Partial<Parameters<typeof UnitForm>[0]> = {}) => {
  const onSave = vi.fn();
  render(<UnitForm initial={initial} neighborhoods={[]} busy={false} onSave={onSave} onCancel={() => {}} {...props} />);
  return onSave;
};
const kinds = () => [ ...(screen.getByLabelText("Tipo") as HTMLSelectElement).options ].map((o) => o.value);

describe("UnitForm — vigilância ambiental (módulo 35a)", () => {
  it("com vectorOn o tipo é oferecido e segue no onSave", () => {
    const onSave = form(EMPTY, { vectorOn: true });
    expect(screen.getByRole("option", { name: LABEL })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "environmental_surveillance" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ kind: "environmental_surveillance" });
  });
  it("sem vectorOn o tipo não é oferecido (os outros tipos não mudam)", () => {
    form(EMPTY);
    expect(screen.queryByRole("option", { name: LABEL })).toBeNull();
    expect(kinds()).toEqual([ "ubs", "upa", "hospital", "other" ]);
  });
  it("a unidade já gravada com o tipo continua legível com o interruptor desligado", () => {
    form({ ...EMPTY, kind: "environmental_surveillance" });
    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).value).toBe("environmental_surveillance");
    expect(screen.getByRole("option", { name: LABEL })).not.toBeNull();
  });
});

const UVZ = { id: "u-uvz", name: "UVZ Central", kind: "environmental_surveillance", active: true };
const UBS = { id: "u1", name: "UBS Centro", kind: "ubs", active: true };
function renderUnits(vectorOn: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Units vectorOn={vectorOn} /></QueryClientProvider>);
}
const editRow = async (name: string) => {
  const row = (await screen.findByText(name)).closest("[role=row]") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: /Editar/ }));
};

describe("Units — vigilância ambiental (módulo 35a)", () => {
  beforeEach(() => {
    for (const fn of [ api.listAllUnits, api.createUnit, api.updateUnit, api.setUnitActive, api.listNeighborhoods ]) mocked(fn).mockReset();
    mocked(api.listAllUnits).mockResolvedValue([ UBS, UVZ ]);
    mocked(api.listNeighborhoods).mockResolvedValue([]);
  });

  it("a lista mostra o tipo pelo rótulo, com ou sem o interruptor", async () => {
    renderUnits(false);
    const row = (await screen.findByText("UVZ Central")).closest("[role=row]") as HTMLElement;
    expect(row.textContent).toContain(LABEL);
  });
  it("trocar o tipo com local vector_control ativo: 409 unit_has_vector_control_location mostra a frase do 35a, sem reenviar", async () => {
    mocked(api.updateUnit).mockRejectedValue(new ApiError(409, { error: "unit_has_vector_control_location" }, "409"));
    renderUnits(true);
    await editRow("UVZ Central");
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "ubs" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(VECTOR_ERRORS.unit_has_vector_control_location);
    expect(mocked(api.updateUnit)).toHaveBeenCalledTimes(1);
    expect(mocked(api.updateUnit).mock.calls[0].slice(0, 3)).toEqual([ "u-uvz", "UVZ Central", "ubs" ]);
    // O formulário fica aberto com o que foi digitado; nada é reenviado sozinho.
    await waitFor(() => expect(mocked(api.listAllUnits)).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).value).toBe("ubs");
  });
  it("Units passa vectorOn ao formulário: a unidade nova pode ser de vigilância ambiental só com ele", async () => {
    renderUnits(true);
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    expect(screen.getByRole("option", { name: LABEL })).not.toBeNull();
    cleanup();
    renderUnits(false);
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    expect(screen.queryByRole("option", { name: LABEL })).toBeNull();
  });
});

describe("Attendance — unidade de vigilância ambiental só com zoonoses (35b)", () => {
  it("com o vectorOn de quem só tem zoonoses, a unidade nova oferece o tipo", async () => {
    const { canUseVectorSupplies } = await import("../../lib/vectorControl");
    const { zooUser } = await import("../../test/zoonosesFixtures");
    mocked(api.listAllUnits).mockResolvedValue([ UBS ]);
    mocked(api.listNeighborhoods).mockResolvedValue([]);
    renderUnits(canUseVectorSupplies(zooUser([ "municipal_admin" ])));
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    expect(screen.getByRole("option", { name: LABEL })).not.toBeNull();
  });
});
