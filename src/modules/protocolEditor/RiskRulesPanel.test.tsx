// src/modules/protocolEditor/RiskRulesPanel.test.tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { RiskRulesPanel } from "./RiskRulesPanel";

afterEach(cleanup);

const DEF = { name: "acolhimento", version: 1, kind: "screening", risk_rules: [ { when: { gte: [ "vitals.systolic", 180 ] }, color: "red" } ] };

function Harness({ initial }: { initial: unknown }) {
  const [ def, setDef ] = useState<unknown>(initial);
  return (
    <>
      <RiskRulesPanel definition={def} onChange={setDef} />
      <pre data-testid="json">{JSON.stringify(def)}</pre>
    </>
  );
}
const json = () => JSON.parse(screen.getByTestId("json").textContent ?? "null");
const rule = (n: number) => screen.getByRole("group", { name: `regra de cor ${n}` });

describe("RiskRulesPanel", () => {
  it("mostra a regra do JSON em frase", () => {
    render(<Harness initial={DEF} />);
    expect(within(rule(1)).getByText("pressão sistólica a partir de 180 mmHg")).not.toBeNull();
    expect((within(rule(1)).getByLabelText("Cor sugerida") as HTMLSelectElement).value).toBe("red");
  });

  it("+ regra monta cor e condição de saturação no JSON", () => {
    render(<Harness initial={DEF} />);
    fireEvent.click(screen.getByRole("button", { name: "+ regra de cor" }));
    expect(within(rule(2)).getByText("defina quando sugerir esta cor")).not.toBeNull();
    fireEvent.change(within(rule(2)).getByLabelText("Cor sugerida"), { target: { value: "red" } });
    const when = within(rule(2)).getByRole("group", { name: "Quando sugerir" });
    fireEvent.click(within(when).getByRole("button", { name: "+ condição" }));
    fireEvent.change(within(when).getByLabelText("campo"), { target: { value: "vitals.spo2" } });
    fireEvent.change(within(when).getByLabelText("operador"), { target: { value: "lte" } });
    fireEvent.change(within(when).getByLabelText("valor"), { target: { value: "89" } });
    expect(json().risk_rules[1]).toEqual({ when: { lte: [ "vitals.spo2", 89 ] }, color: "red" });
  });

  it("remover a última deixa a lista vazia no JSON e pede uma regra", () => {
    render(<Harness initial={DEF} />);
    fireEvent.click(within(rule(1)).getByRole("button", { name: "remover regra" }));
    expect(json().risk_rules).toEqual([]);
    expect(screen.getByRole("alert").textContent).toBe("Inclua ao menos uma regra de cor.");
  });

  it("formato errado no JSON: diz o motivo e não reescreve", () => {
    render(<Harness initial={{ ...DEF, risk_rules: [ { when: {}, color: "laranja" } ] }} />);
    expect(screen.getByRole("alert").textContent).toBe("uma regra de cor está fora do formato { when, color }: corrija no JSON");
    expect(json().risk_rules[0].color).toBe("laranja");
  });

  it("50 regras travam o + regra", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ when: { gte: [ "vitals.heart_rate", 100 + i ] }, color: "yellow" }));
    render(<Harness initial={{ ...DEF, risk_rules: fifty }} />);
    expect((screen.getByRole("button", { name: "+ regra de cor" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
