// src/modules/attendance/VitalSignsFields.test.tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { VitalSignsFields } from "./VitalSignsFields";
import { EMPTY_VITALS_FORM, bmiOf, parseVitals, type VitalsForm } from "../../lib/screening";

afterEach(cleanup);

function Harness({ alerts = [] }: { alerts?: string[] }) {
  const [ form, setForm ] = useState<VitalsForm>(EMPTY_VITALS_FORM);
  const { vitals, problems } = parseVitals(form);
  return (
    <>
      <VitalSignsFields form={form} problems={problems} alerts={alerts} bmi={bmiOf(vitals.weight_kg, vitals.height_cm)} onChange={setForm} />
      <pre data-testid="vitals">{JSON.stringify(vitals)}</pre>
    </>
  );
}
const vitals = () => JSON.parse(screen.getByTestId("vitals").textContent ?? "{}");
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("VitalSignsFields", () => {
  it("monta os sinais com vírgula decimal e calcula o IMC", () => {
    render(<Harness />);
    type("Pressão sistólica (mmHg)", "185");
    type("Pressão diastólica (mmHg)", "110");
    type("Temperatura (°C)", "37,8");
    type("Peso (kg)", "80");
    type("Altura (cm)", "170");
    expect(vitals()).toEqual({ systolic: 185, diastolic: 110, temperature_c: 37.8, weight_kg: 80, height_cm: 170 });
    expect(screen.getByText("27,7")).not.toBeNull();
  });

  it("fora do plausível mostra a frase sob o campo e não entra nos sinais", () => {
    render(<Harness />);
    type("Saturação (SpO2) (%)", "120");
    expect(screen.getByRole("alert").textContent).toBe("use de 50 a 100 %");
    expect(vitals()).toEqual({});
  });

  it("pressão pela metade e glicemia sem momento avisam", () => {
    render(<Harness />);
    type("Pressão sistólica (mmHg)", "140");
    type("Glicemia capilar (mg/dL)", "250");
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toContain("informe a sistólica e a diastólica juntas");
    expect(alerts).toContain("informe o momento da glicemia");
    fireEvent.change(screen.getByLabelText("Momento da glicemia"), { target: { value: "random" } });
    expect(vitals()).toEqual({ capillary_glucose: 250, glucose_moment: "random" });
  });

  it("alerta do api destaca o campo; código sem campo aparece como veio", () => {
    render(<Harness alerts={[ "systolic_high", "pregnancy_flag" ]} />);
    expect(screen.getByText("Pressão sistólica: acima da faixa de alerta")).not.toBeNull();
    expect(screen.getByText("alertas: pregnancy_flag")).not.toBeNull();
    const field = screen.getByLabelText("Pressão sistólica (mmHg)") as HTMLInputElement;
    expect(field.style.borderColor).toBe("var(--down)");
  });
});
