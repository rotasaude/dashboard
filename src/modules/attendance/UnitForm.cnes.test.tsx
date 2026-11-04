// T47 (módulo 30): CNES opcional (7 dígitos) em qualquer tipo de unidade — a unidade Gestão do BPA do TFD precisa dele.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnitForm, type UnitFormValue } from "./UnitForm";
import { EMPTY_ADDRESS_FIELDS } from "../../lib/unitAddress";

afterEach(cleanup);
const form = (initial: Partial<UnitFormValue> = {}, onSave: (v: UnitFormValue) => void = () => undefined) => render(
  <UnitForm initial={{ name: "Secretaria", kind: "ubs", ...EMPTY_ADDRESS_FIELDS, ...initial }} neighborhoods={[]} busy={false} tfdOn
    onSave={onSave} onCancel={() => undefined} />);

describe("UnitForm — CNES (T47)", () => {
  it.each([ [ "ubs" ], [ "hospital" ], [ "health_management" ] ])("o campo CNES existe para %s", (kind) => {
    form({ kind });
    expect(screen.getByLabelText("CNES (opcional)")).not.toBeNull();
  });
  it("CNES fora de 7 dígitos recusa na tela, marcado, sem salvar", () => {
    const onSave = vi.fn();
    form({}, onSave);
    fireEvent.change(screen.getByLabelText("CNES (opcional)"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByText("o CNES tem 7 dígitos")).not.toBeNull();
    expect(screen.getByLabelText("CNES (opcional)").getAttribute("aria-invalid")).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
  });
  it("só dígitos, até 7; o valor vai ao salvar; vazio é permitido", () => {
    const onSave = vi.fn();
    form({ cnes: "7654321" }, onSave);
    const input = screen.getByLabelText("CNES (opcional)") as HTMLInputElement;
    expect(input.value).toBe("7654321");
    fireEvent.change(input, { target: { value: "12a34567890" } });
    expect(input.value).toBe("1234567");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave.mock.calls[0][0].cnes).toBe("1234567");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave.mock.calls[1][0].cnes).toBe("");
  });
});
