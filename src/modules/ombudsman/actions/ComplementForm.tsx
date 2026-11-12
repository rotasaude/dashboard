// Complemento recebido fora do canal (telefone, balcão), registrado pela equipe em `awaiting_complement`. Corpo
// `{ expected_state, text }`; os anexos (`attachment_ids`) entram com o `AttachmentPicker` da Task 9.
import type { ActionFormProps } from "../useManifestationAction";
import { TextActionForm } from "./TextActionForm";

export function ComplementForm(p: ActionFormProps) {
  return (
    <TextActionForm {...p} action="complement" title="Registrar complemento recebido" label="Complemento recebido" submit="Registrar"
      textPhrase="o complemento tem de ter de 10 a 4000 caracteres" />
  );
}
