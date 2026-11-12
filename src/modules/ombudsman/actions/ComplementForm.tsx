// Complemento recebido fora do canal (telefone, balcão), registrado pela equipe em `awaiting_complement`. Corpo
// `{ expected_state, text, attachment_ids? }`: os anexos (até 3, `AttachmentPicker`) sobem antes; a recusa de um não registra.
import type { ActionFormProps } from "../useManifestationAction";
import { TextActionForm } from "./TextActionForm";

export function ComplementForm(p: ActionFormProps) {
  return (
    <TextActionForm {...p} action="complement" title="Registrar complemento recebido" label="Complemento recebido" submit="Registrar" attachments
      textPhrase="o complemento tem de ter de 10 a 4000 caracteres" />
  );
}
