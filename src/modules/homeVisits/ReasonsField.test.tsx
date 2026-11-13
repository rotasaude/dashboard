// src/modules/homeVisits/ReasonsField.test.tsx
// Motivos da visita: um motivo marcado que ficou indisponível ainda se desmarca; um não marcado e indisponível, não.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MALE_REASON_TEXT, type OfferedReason } from "../../lib/homeVisits";
import { ReasonsField } from "./ReasonsField";

afterEach(cleanup);

const row = (code: number, label: string, disabled: string | null): OfferedReason =>
  ({ code, label, group: "ACOMPANHAMENTO", group_label: "Acompanhamento", disabled });

describe("ReasonsField", () => {
  it("marcado e indisponível: a caixa fica livre para desmarcar; não marcado e indisponível: travada", () => {
    const onToggle = vi.fn();
    render(
      <ReasonsField offered={[ row(5, "Gestante", MALE_REASON_TEXT), row(6, "Puérpera", MALE_REASON_TEXT) ]} chosen={[ 5 ]} max={36} disabled={false}
        onToggle={onToggle} aria={() => ({})} errNode={() => null} />
    );
    const gestante = screen.getByLabelText("Gestante") as HTMLInputElement;
    const puerpera = screen.getByLabelText("Puérpera") as HTMLInputElement;
    expect(gestante.checked).toBe(true);
    expect(gestante.disabled).toBe(false);
    expect(puerpera.disabled).toBe(true);
    fireEvent.click(gestante);
    expect(onToggle).toHaveBeenCalledWith(5);
  });

  it("formulário travado: nem o marcado se desmarca", () => {
    render(
      <ReasonsField offered={[ row(5, "Gestante", MALE_REASON_TEXT) ]} chosen={[ 5 ]} max={36} disabled
        onToggle={vi.fn()} aria={() => ({})} errNode={() => null} />
    );
    expect((screen.getByLabelText("Gestante") as HTMLInputElement).disabled).toBe(true);
  });
});
