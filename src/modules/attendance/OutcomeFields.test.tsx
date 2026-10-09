import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { EMPTY_OUTCOME, type OutcomeDraft } from "../../lib/outcome";
import { OutcomeFields } from "./OutcomeFields";
import { expectFrozenNotice } from "../../test/frozenNotice";

afterEach(cleanup);
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const units = [ unit, { id: "u2", name: "UBS Bairro Alto", kind: "ubs" } ];

function Harness({ idPrefix }: { idPrefix?: string }) {
  const [ value, setValue ] = useState<OutcomeDraft>(EMPTY_OUTCOME);
  return (
    <>
      <OutcomeFields value={value} onChange={setValue} referenceIds={[ "u2" ]} unit={unit} units={units} idPrefix={idPrefix} />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  );
}

describe("OutcomeFields", () => {
  it("encaminhado: referência escolhida, descrição com o aviso e a linha do pedido", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
    expect((screen.getByLabelText("Unidade de destino") as HTMLSelectElement).value).toBe("u2");
    expect(screen.getByRole("option", { name: "UBS Bairro Alto · referência" })).not.toBeNull();
    expectFrozenNotice(screen.getByLabelText("Descrição"));
    expect(screen.getByText("Gera pedido de agendamento na UBS Bairro Alto")).not.toBeNull();
  });

  it("retorno: nota opcional; o prefixo separa os ids dos avisos", () => {
    render(<Harness idPrefix="consultation-" />);
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "return" } });
    const note = screen.getByLabelText("Nota (opcional)");
    expect(note.getAttribute("aria-describedby")).toBe("consultation-return-note-notice");
    expectFrozenNotice(note);
    fireEvent.change(note, { target: { value: "trazer exames" } });
    expect(JSON.parse(screen.getByTestId("value").textContent ?? "{}")).toEqual({ outcome: "return", referralChoice: null, note: "trazer exames" });
  });
});
