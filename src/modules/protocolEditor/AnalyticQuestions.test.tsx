// src/modules/protocolEditor/AnalyticQuestions.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AnalyticQuestions } from "./AnalyticQuestions";
import { ANALYTIC_HINT } from "../../lib/editor";

afterEach(cleanup);

const def = {
  steps: [
    { id: "febre", prompt: "Teve febre?", answer_type: "boolean" },
    { id: "sintoma", prompt: "Qual o sintoma?", answer_type: "enum", options: [ "dor" ], analytic: true },
    { id: "dias", prompt: "Há quantos dias?", answer_type: "integer" },
    { id: "obs", prompt: "Observações", answer_type: "text" }
  ]
};

describe("AnalyticQuestions", () => {
  it("caixa só em boolean/enum, com a dica", () => {
    render(<AnalyticQuestions definition={def} onChange={vi.fn()} />);
    const fever = within(screen.getByRole("group", { name: "Teve febre?" }));
    expect((fever.getByLabelText("Usar em Analytics") as HTMLInputElement).checked).toBe(false);
    expect(fever.getByText(ANALYTIC_HINT)).toBeTruthy();
    const symptom = within(screen.getByRole("group", { name: "Qual o sintoma?" }));
    expect((symptom.getByLabelText("Usar em Analytics") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("group", { name: "Há quantos dias?" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Observações" })).toBeNull();
    expect(screen.getAllByLabelText("Usar em Analytics")).toHaveLength(2);
  });

  it("marcar devolve a definição com analytic: true na pergunta", () => {
    const onChange = vi.fn();
    render(<AnalyticQuestions definition={def} onChange={onChange} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Teve febre?" })).getByLabelText("Usar em Analytics"));
    expect((onChange.mock.calls[0][0] as { steps: unknown[] }).steps[0]).toEqual(
      { id: "febre", prompt: "Teve febre?", answer_type: "boolean", analytic: true });
  });

  it("marca que sobrou em integer/text: aviso de que sai ao salvar", () => {
    const stranded = { steps: [ { id: "dias", prompt: "Há quantos dias?", answer_type: "integer", analytic: true } ] };
    render(<AnalyticQuestions definition={stranded} onChange={vi.fn()} />);
    expect(screen.getByRole("alert").textContent)
      .toBe("“Há quantos dias?” não é de sim/não nem de lista: a marca de Analytics sai ao salvar.");
  });

  it("JSON inválido ou sem perguntas: nada aparece", () => {
    const { container } = render(<AnalyticQuestions definition={null} onChange={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
