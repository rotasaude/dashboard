// Pedido de complemento ao cidadão (uma vez por ciclo, nunca na anônima — o `can` e o api decidem; `complement_already_used`
// e `complement_not_allowed` voltam com a frase). Corpo `{ expected_state, text }`.
import type { ActionFormProps } from "../useManifestationAction";
import { TextActionForm } from "./TextActionForm";

export function RequestComplementForm(p: ActionFormProps) {
  return (
    <TextActionForm {...p} action="request_complement" title="Pedir complemento" label="Texto ao cidadão" submit="Pedir complemento ao cidadão"
      textPhrase="o texto ao cidadão tem de ter de 10 a 4000 caracteres" />
  );
}
