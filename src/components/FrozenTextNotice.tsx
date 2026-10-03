// Aviso junto de campo de texto livre que fica congelado depois do envio
// (api#32: decisão do usuário). Aparece ANTES do envio, sob o campo, e o
// campo aponta para ele com aria-describedby (o leitor de tela lê junto).
export const FROZEN_TEXT_NOTICE =
  "Depois de enviado, este texto não pode ser alterado. Não escreva nome, telefone, CPF ou outros dados pessoais.";

export function FrozenTextNotice({ id }: { id: string }) {
  return (
    <span id={id} style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.4 }}>
      {FROZEN_TEXT_NOTICE}
    </span>
  );
}
