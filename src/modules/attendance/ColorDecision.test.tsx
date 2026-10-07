// src/modules/attendance/ColorDecision.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ColorDecision, type SuggestionState } from "./ColorDecision";
import type { ScreeningColor } from "../../lib/api";
import { suggestion } from "../../test/screeningFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";

afterEach(cleanup);

function renderIt(state: SuggestionState, final: ScreeningColor | null, reason = "") {
  const onFinal = vi.fn();
  const onReason = vi.fn();
  render(<ColorDecision state={state} final={final} reason={reason} onFinal={onFinal} onReason={onReason} />);
  return { onFinal, onReason };
}

describe("ColorDecision", () => {
  it("mostra a cor sugerida com o motivo e a cor final marcada", () => {
    renderIt({ kind: "ready", suggestion: suggestion() }, "red");
    expect(screen.getByRole("status").textContent).toContain("Cor sugerida: vermelho · atendimento imediato");
    expect(screen.getByRole("list", { name: "motivo da sugestão" }).textContent).toBe("pressão sistólica a partir de 180 mmHg");
    expect((screen.getByRole("radio", { name: /vermelho/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("Justificativa da mudança de cor")).toBeNull();
  });

  it("mudar da sugerida pede justificativa com o aviso de texto congelado", () => {
    const { onFinal } = renderIt({ kind: "ready", suggestion: suggestion() }, "yellow");
    expectFrozenNotice(screen.getByLabelText("Justificativa da mudança de cor"));
    fireEvent.click(screen.getByRole("radio", { name: /verde/ }));
    expect(onFinal).toHaveBeenCalledWith("green");
  });

  it("forceReason mostra a justificativa mesmo com a cor igual à sugerida", () => {
    render(<ColorDecision state={{ kind: "ready", suggestion: suggestion() }} final="red" reason="" forceReason
      onFinal={vi.fn()} onReason={vi.fn()} />);
    expect(screen.getByLabelText("Justificativa da mudança de cor")).not.toBeNull();
  });

  it("sem sugestão: explica e não pede justificativa", () => {
    renderIt({ kind: "ready", suggestion: suggestion({ suggested_color: null, matched_rules: [] }) }, "green");
    expect(screen.getByRole("status").textContent)
      .toBe("Sem cor sugerida: nenhuma regra do protocolo de acolhimento casou, ou a cidade não tem protocolo ativo.");
    expect(screen.queryByLabelText("Justificativa da mudança de cor")).toBeNull();
  });

  it("antes da queixa, enquanto calcula e com erro", () => {
    renderIt({ kind: "idle" }, null);
    expect(screen.getByRole("status").textContent).toBe("A cor sugerida aparece quando a queixa estiver escolhida.");
    cleanup();
    renderIt({ kind: "loading" }, null);
    expect(screen.getByRole("status").textContent).toBe("calculando a sugestão…");
    cleanup();
    renderIt({ kind: "error", message: "não foi possível concluir — tente de novo" }, null);
    expect(screen.getByRole("status").textContent).toBe("não foi possível concluir — tente de novo");
  });
});
