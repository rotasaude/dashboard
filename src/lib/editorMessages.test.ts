import { describe, expect, it } from "vitest";
import { gateErrorMessage, parseErrorMessage } from "./editorMessages";

describe("mensagens do editor de protocolo (PR-08)", () => {
  it("erro de JSON com linha e coluna, em português", () => {
    expect(parseErrorMessage("Expected ',' or '}' after property value in JSON at position 73 (line 5 column 3)"))
      .toBe("linha 5, coluna 3: falta vírgula ou fechar chave");
    expect(parseErrorMessage("Unexpected token } in JSON at position 10 (line 2 column 1)"))
      .toBe("linha 2, coluna 1: caractere inesperado");
    expect(parseErrorMessage("Unexpected end of JSON input")).toBe("JSON inválido: o texto termina antes de fechar");
  });

  it("erros do portão viram frases sobre a pergunta", () => {
    expect(gateErrorMessage("schema: /steps/0/answer_type enum"))
      .toBe("Pergunta 1: tipo de resposta inválido (use boolean, enum, integer ou text)");
    expect(gateErrorMessage("schema: /steps/2/prompt required")).toBe("Pergunta 3: texto obrigatório");
    expect(gateErrorMessage("Definition start_step_id refers to unknown step"))
      .toBe("start_step_id aponta para uma pergunta que não existe");
    expect(gateErrorMessage("outra coisa")).toBe("outra coisa");
  });
});

describe("mensagens reais do api e de outros navegadores (I4/I5)", () => {
  it("required aponta para o objeto da pergunta, e o start_step_id vem com ou sem prefixo", () => {
    expect(gateErrorMessage("schema: /steps/0 required")).toBe("Pergunta 1: campo obrigatório faltando");
    expect(gateErrorMessage("start_step_id refers to unknown step")).toBe("start_step_id aponta para uma pergunta que não existe");
  });
  it("Firefox dá linha e coluna; Safari, sem posição, mostra a causa", () => {
    expect(parseErrorMessage("JSON.parse: expected ',' or '}' after property value in object at line 3 column 3 of the JSON data"))
      .toBe("linha 3, coluna 3: falta vírgula ou fechar chave");
    expect(parseErrorMessage("JSON Parse error: Expected '}'")).toBe("JSON inválido: JSON Parse error: Expected '}'");
  });
});

