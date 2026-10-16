import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnitForm, type UnitFormValue } from "./UnitForm";

afterEach(cleanup);

const BASE: UnitFormValue = { name: "UBS Centro", kind: "ubs", street: "", number: "", complement: "", zip: "", neighborhoodId: "", screeningScope: "walk_in" };

describe("UnitForm — coleta de amostras (módulo 21b)", () => {
  it("na edição com o campo presente, o checkbox muda o valor salvo", () => {
    const onSave = vi.fn();
    render(<UnitForm initial={{ ...BASE, collectsSamples: false }} neighborhoods={[]} busy={false} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Coleta amostras para o laboratório municipal"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave.mock.calls[0][0].collectsSamples).toBe(true);
  });

  it("sem o campo (interruptor desligado ou unidade nova), nada aparece", () => {
    render(<UnitForm initial={BASE} neighborhoods={[]} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Coleta amostras para o laboratório municipal")).toBeNull();
  });
});
