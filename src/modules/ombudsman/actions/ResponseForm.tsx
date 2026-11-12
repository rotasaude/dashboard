// Respostas ao cidadão. Intermediária: "Texto ao cidadão" (a anônima não recebe — `not_allowed_anonymous`). Conclusiva: na
// anônima o texto é "Conclusão interna" (não vai a ninguém, `ANONYMOUS_INTERNAL`); "Resolvida?" só em reclamação, solicitação
// e denúncia (`needsResolution`). Corpos `{ expected_state, text }` e `{ expected_state, text, resolution? }`.
import { ANONYMOUS_INTERNAL } from "../../../lib/ombudsman";
import type { ActionFormProps } from "../useManifestationAction";
import { TextActionForm } from "./TextActionForm";

const CITIZEN_TEXT = "o texto ao cidadão tem de ter de 10 a 4000 caracteres";

export function ResponseForm({ final, ...p }: ActionFormProps & { final: boolean }) {
  if (!final) {
    return (
      <TextActionForm {...p} action="interim_response" title="Resposta intermediária" label="Texto ao cidadão"
        submit="Enviar resposta intermediária" textPhrase={CITIZEN_TEXT} />
    );
  }
  const anonymous = p.m.identification_mode === "anonymous";
  return anonymous ? (
    <TextActionForm {...p} action="final_response" title="Resposta conclusiva" label="Conclusão interna" submit="Enviar resposta conclusiva"
      textPhrase="a conclusão interna tem de ter de 10 a 4000 caracteres" notice={ANONYMOUS_INTERNAL} />
  ) : (
    <TextActionForm {...p} action="final_response" title="Resposta conclusiva" label="Texto ao cidadão" submit="Enviar resposta conclusiva"
      textPhrase={CITIZEN_TEXT} />
  );
}
