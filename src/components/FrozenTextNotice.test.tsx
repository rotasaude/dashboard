import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FROZEN_TEXT_NOTICE, FrozenTextNotice } from "./FrozenTextNotice";

describe("FrozenTextNotice (api#32)", () => {
  it("diz que o texto não muda depois do envio e pede para não escrever dado pessoal", () => {
    expect(FROZEN_TEXT_NOTICE).toBe(
      "Depois de enviado, este texto não pode ser alterado. Não escreva nome, telefone, CPF ou outros dados pessoais."
    );
    render(<FrozenTextNotice id="n1" />);
    expect(screen.getByText(FROZEN_TEXT_NOTICE).id).toBe("n1");
  });
});
