import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listAllUnits: vi.fn(), createUnit: vi.fn(), updateUnit: vi.fn(), setUnitActive: vi.fn(), listNeighborhoods: vi.fn(), drainUnit: vi.fn() };
});

import * as api from "../../lib/api";
import { TICKET_PREFIX_TEXT } from "../../lib/urgency";
import { EMPTY_ADDRESS, EMPTY_ADDRESS_FIELDS } from "../../lib/unitAddress";
import { UnitForm, type UnitFormValue } from "./UnitForm";
import { Units } from "./Units";

afterEach(() => { cleanup(); });

const EMPTY: UnitFormValue = { name: "UPA Boqueirão", kind: "upa", ...EMPTY_ADDRESS_FIELDS };
const form = (initial: UnitFormValue, props: Partial<Parameters<typeof UnitForm>[0]> = {}) => {
  const onSave = vi.fn();
  render(<UnitForm initial={initial} neighborhoods={[]} busy={false} onSave={onSave} onCancel={() => {}} {...props} />);
  return { onSave };
};
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

describe("UnitForm — prefixo da senha e tempos na TV (módulo 32a)", () => {
  it("com o interruptor: o prefixo aparece (U na UPA, A nas demais), recusa 'u1' e envia 'UB'", () => {
    const { onSave } = form(EMPTY, { waitingRoomOn: true });
    const input = screen.getByLabelText("Prefixo da senha") as HTMLInputElement;
    expect(input.placeholder).toBe("U");
    pick("Tipo", "ubs");
    expect((screen.getByLabelText("Prefixo da senha") as HTMLInputElement).placeholder).toBe("A");
    pick("Prefixo da senha", "u1");
    save();
    expect(screen.getByText(TICKET_PREFIX_TEXT)).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    pick("Prefixo da senha", "UB");
    save();
    expect(screen.queryByText(TICKET_PREFIX_TEXT)).toBeNull();
    expect(onSave.mock.calls[0][0]).toMatchObject({ ticketPrefix: "UB" });
  });
  it("sem o interruptor, o campo não aparece e ticketPrefix não vai", () => {
    const { onSave } = form(EMPTY);
    expect(screen.queryByLabelText("Prefixo da senha")).toBeNull();
    expect(screen.queryByLabelText("Mostrar tempos de espera na TV")).toBeNull();
    save();
    expect(onSave.mock.calls[0][0].ticketPrefix).toBeUndefined();
    expect(onSave.mock.calls[0][0].showWaitTimes).toBeUndefined();
  });
  it("na edição, o prefixo atual não pode ficar vazio; na unidade nova, vazio fica o padrão", () => {
    const edit = form({ ...EMPTY, ticketPrefix: "U" }, { waitingRoomOn: true });
    pick("Prefixo da senha", "");
    save();
    expect(screen.getByText(TICKET_PREFIX_TEXT)).not.toBeNull();
    expect(edit.onSave).not.toHaveBeenCalled();
    cleanup();
    const fresh = form(EMPTY, { waitingRoomOn: true });
    save();
    expect(fresh.onSave).toHaveBeenCalledTimes(1);
  });
  it("'Mostrar tempos de espera na TV' só na UPA, com a explicação dos dois interruptores; nada no CAPS", () => {
    const { onSave } = form({ ...EMPTY, showWaitTimes: true }, { waitingRoomOn: true, capsOn: true });
    const box = screen.getByLabelText("Mostrar tempos de espera na TV") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.getByText(/só aparecem na TV que também estiver com/)).not.toBeNull();
    fireEvent.click(box);
    save();
    expect(onSave.mock.calls[0][0]).toMatchObject({ showWaitTimes: false });
    pick("Tipo", "ubs");
    expect(screen.queryByLabelText("Mostrar tempos de espera na TV")).toBeNull();
    pick("Tipo", "caps");
    expect(screen.queryByLabelText("Prefixo da senha")).toBeNull();
  });
});

describe("Units — prefixo e tempos no corpo (módulo 32a)", () => {
  const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
  const UPA_ROW = { id: "upa1", name: "UPA Boqueirão", kind: "upa", active: true, ticket_prefix: "U", show_wait_times: true };
  function renderUnits(waitingRoomOn: boolean) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Units waitingRoomOn={waitingRoomOn} /></QueryClientProvider>);
  }
  const editRow = async (name: string) => {
    const row = (await screen.findByText(name)).closest("[role=row]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Editar/ }));
  };
  beforeEach(() => {
    for (const fn of [ api.listAllUnits, api.createUnit, api.updateUnit, api.listNeighborhoods ]) mocked(fn).mockReset();
    mocked(api.listAllUnits).mockResolvedValue([ UPA_ROW ]);
    mocked(api.listNeighborhoods).mockResolvedValue([]);
    mocked(api.updateUnit).mockResolvedValue(UPA_ROW);
    mocked(api.createUnit).mockResolvedValue(UPA_ROW);
  });

  it("na edição, o prefixo e o interruptor da UPA vão no último argumento só quando mudam", async () => {
    renderUnits(true);
    await editRow("UPA Boqueirão");
    expect((screen.getByLabelText("Prefixo da senha") as HTMLInputElement).value).toBe("U");
    pick("Prefixo da senha", "UB");
    fireEvent.click(screen.getByLabelText("Mostrar tempos de espera na TV"));
    save();
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateUnit).mock.calls[0][8]).toEqual({ ticket_prefix: "UB", show_wait_times: false });
  });
  it("sem mudança, o corpo é o de sempre; sem o interruptor, nada do 32a vai", async () => {
    renderUnits(true);
    await editRow("UPA Boqueirão");
    save();
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateUnit).mock.calls[0]).toHaveLength(6);
    cleanup();
    mocked(api.updateUnit).mockClear();
    renderUnits(false);
    await editRow("UPA Boqueirão");
    expect(screen.queryByLabelText("Prefixo da senha")).toBeNull();
    save();
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateUnit).mock.calls[0]).toHaveLength(6);
  });
  it("unidade nova: prefixo vazio fica o padrão do api; digitado vai no 5º argumento", async () => {
    renderUnits(true);
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    pick("Nome", "UBS Xaxim");
    pick("Prefixo da senha", "X");
    save();
    await waitFor(() => expect(api.createUnit).toHaveBeenCalledWith("UBS Xaxim", "ubs", EMPTY_ADDRESS, undefined, { ticket_prefix: "X" }));
  });
});
