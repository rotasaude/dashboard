import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnitForm, type UnitFormValue } from "./UnitForm";

afterEach(cleanup);
const BASE: UnitFormValue = { name: "UBS Centro", kind: "ubs", street: "", number: "", complement: "", zip: "", neighborhoodId: "", screeningScope: "walk_in" };
const LABEL = "Unidade notificadora (notificação negativa semanal)";

describe("UnitForm — unidade notificadora (módulo 25)", () => {
  it("na edição com o campo presente, o checkbox muda o valor salvo", () => {
    const onSave = vi.fn();
    render(<UnitForm initial={{ ...BASE, notifying: true }} neighborhoods={[]} busy={false} onSave={onSave} onCancel={vi.fn()} />);
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText(LABEL));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave.mock.calls[0][0].notifying).toBe(false);
  });
  it("sem o campo (interruptor desligado ou unidade nova), nada aparece", () => {
    render(<UnitForm initial={BASE} neighborhoods={[]} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });
});
