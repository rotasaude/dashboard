// Prorrogar o prazo (só o ouvidor; uma vez por ciclo — `already_extended` volta com a frase). A justificativa (10–4000) vai ao
// cidadão. Corpo `{ expected_state, text }`.
import type { ActionFormProps } from "../useManifestationAction";
import { TextActionForm } from "./TextActionForm";

export function ExtendForm(p: ActionFormProps) {
  return (
    <TextActionForm {...p} action="extend" title="Prorrogar prazo" label="Justificativa (vai ao cidadão)" submit="Prorrogar"
      textPhrase="a justificativa tem de ter de 10 a 4000 caracteres" />
  );
}
