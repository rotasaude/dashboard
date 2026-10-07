// src/modules/protocolEditor/ScreeningSimulator.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, simulateScreening: vi.fn() };
});

import * as api from "../../lib/api";
import { ScreeningSimulator } from "./ScreeningSimulator";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const DEF = { name: "acolhimento", version: 1, kind: "screening", risk_rules: [ { when: { gte: [ "vitals.systolic", 180 ] }, color: "red" } ] };

describe("ScreeningSimulator", () => {
  beforeEach(() => {
    mocked(api.simulateScreening).mockReset();
    mocked(api.simulateScreening).mockResolvedValue({ suggested_color: "red", matched_rules: [ { index: 0, text: "pressão sistólica a partir de 180 mmHg" } ], errors: [], warnings: [] });
  });

  it("manda a definição do editor, o perfil, a queixa e os sinais; mostra a cor e as regras", async () => {
    render(<ScreeningSimulator definition={DEF} valid />);
    fireEvent.change(screen.getByLabelText("Idade"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Código CIAP-2"), { target: { value: "k86" } });
    fireEvent.change(screen.getByLabelText("Pressão sistólica (mmHg)"), { target: { value: "185" } });
    fireEvent.change(screen.getByLabelText("Pressão diastólica (mmHg)"), { target: { value: "110" } });
    fireEvent.click(screen.getByRole("button", { name: "Simular" }));
    await waitFor(() => expect(api.simulateScreening).toHaveBeenCalledWith({
      definition: DEF, ciap2_code: "K86", vitals: { systolic: 185, diastolic: 110 }, profile: { age: 70, sex: "female" }
    }));
    expect((await screen.findByRole("status")).textContent).toContain("Cor sugerida: vermelho · atendimento imediato");
    expect(screen.getByText("regra 1: pressão sistólica a partir de 180 mmHg")).not.toBeNull();
  });

  it("nenhuma regra casou; erros do gate aparecem", async () => {
    mocked(api.simulateScreening).mockResolvedValue({ suggested_color: null, matched_rules: [],
      errors: [ "schema: /risk_rules minItems" ], warnings: [] });
    render(<ScreeningSimulator definition={DEF} valid />);
    fireEvent.click(screen.getByRole("button", { name: "Simular" }));
    expect(await screen.findByText("Nenhuma regra casou: sem cor sugerida")).not.toBeNull();
    expect(screen.getByText("schema: /risk_rules minItems")).not.toBeNull();
  });

  it("código CIAP-2 fora do padrão ou sinal implausível travam", () => {
    render(<ScreeningSimulator definition={DEF} valid />);
    fireEvent.change(screen.getByLabelText("Código CIAP-2"), { target: { value: "febre" } });
    expect((screen.getByRole("button", { name: "Simular" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Código CIAP-2"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Saturação (SpO2) (%)"), { target: { value: "130" } });
    expect((screen.getByRole("button", { name: "Simular" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("mudar a entrada esconde o resultado antigo", async () => {
    render(<ScreeningSimulator definition={DEF} valid />);
    fireEvent.click(screen.getByRole("button", { name: "Simular" }));
    expect(await screen.findByRole("status")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Idade"), { target: { value: "30" } });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
