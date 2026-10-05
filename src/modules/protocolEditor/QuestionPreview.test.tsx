// src/modules/protocolEditor/QuestionPreview.test.tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuestionPreview, previewSteps } from "./QuestionPreview";

afterEach(cleanup);

const DEF = {
  name: "dor", version: 1, start_step_id: "febre",
  steps: [
    { id: "febre", prompt: "Teve febre?", answer_type: "boolean" },
    { id: "dias", prompt: "Há quantos dias?", answer_type: "integer" },
    { id: "onde", prompt: "Onde dói?", answer_type: "enum", options: [ "cabeça", "barriga" ] },
    { id: "obs", prompt: "Conte mais", answer_type: "text" }
  ]
};

describe("previewSteps", () => {
  it("sim/não vira Sim e Não; lista usa as opções; passo sem texto usa o id; lixo some", () => {
    expect(previewSteps({ steps: [ { id: "a", answer_type: "boolean" }, null, "x", { id: "b", prompt: "B?", answer_type: "enum", options: [ "1", 2 ] } ] }))
      .toEqual([
        { id: "a", prompt: "a", answerType: "boolean", options: [ "Sim", "Não" ] },
        { id: "b", prompt: "B?", answerType: "enum", options: [ "1" ] }
      ]);
    expect(previewSteps(null)).toEqual([]);
  });
});

describe("QuestionPreview", () => {
  it("primeira pergunta como no wpda: título, contagem, Sim e Não, sem Continuar nem Voltar", () => {
    render(<QuestionPreview definition={DEF} />);
    expect(screen.getByRole("heading", { name: "Teve febre?" })).not.toBeNull();
    expect(screen.getByText("Pergunta 1 de 4")).not.toBeNull();
    expect(screen.getByText("Sim")).not.toBeNull();
    expect(screen.getByText("Não")).not.toBeNull();
    expect(screen.queryByText("Continuar")).toBeNull();
    expect(screen.queryByText("Voltar")).toBeNull();
    expect((screen.getByRole("button", { name: "← pergunta anterior" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Em emergência, ligue 192.")).not.toBeNull();
  });

  it("número: campo, Continuar e Voltar", () => {
    render(<QuestionPreview definition={DEF} />);
    fireEvent.click(screen.getByRole("button", { name: "próxima pergunta →" }));
    expect(screen.getByRole("heading", { name: "Há quantos dias?" })).not.toBeNull();
    expect(screen.getByLabelText("campo do cidadão")).not.toBeNull();
    expect(screen.getByText("Continuar")).not.toBeNull();
    expect(screen.getByText("Voltar")).not.toBeNull();
  });

  it("lista mostra as opções; na última a próxima trava", () => {
    render(<QuestionPreview definition={DEF} />);
    fireEvent.click(screen.getByRole("button", { name: "próxima pergunta →" }));
    fireEvent.click(screen.getByRole("button", { name: "próxima pergunta →" }));
    expect(screen.getByText("cabeça")).not.toBeNull();
    expect(screen.getByText("barriga")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "próxima pergunta →" }));
    expect(screen.getByText("Pergunta 4 de 4")).not.toBeNull();
    expect((screen.getByRole("button", { name: "próxima pergunta →" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("pergunta removida no JSON: a posição recua para a última que existe", () => {
    const { rerender } = render(<QuestionPreview definition={DEF} />);
    fireEvent.click(screen.getByRole("button", { name: "próxima pergunta →" }));
    fireEvent.click(screen.getByRole("button", { name: "próxima pergunta →" }));
    rerender(<QuestionPreview definition={{ ...DEF, steps: DEF.steps.slice(0, 1) }} />);
    expect(screen.getByText("Pergunta 1 de 1")).not.toBeNull();
  });

  it("sem perguntas não desenha nada", () => {
    const { container } = render(<QuestionPreview definition={null} />);
    expect(container.innerHTML).toBe("");
  });
});
