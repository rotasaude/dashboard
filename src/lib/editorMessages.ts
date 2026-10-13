// Mensagens do editor de protocolo em português (spec 6d, PR-08): quem escreve
// o protocolo é da saúde, não dev. Mensagem desconhecida passa como veio.
export function parseErrorMessage(raw: string): string {
  const at = /\(line (\d+) column (\d+)\)/.exec(raw);
  if (!at) return "JSON inválido";
  const cause = /Expected ',' or '}'/.test(raw) ? "falta vírgula ou fechar chave"
    : /Unexpected token/.test(raw) ? "caractere inesperado"
    : "formato inválido";
  return `linha ${at[1]}, coluna ${at[2]}: ${cause}`;
}

const FIELD_LABEL: Record<string, string> = {
  answer_type: "tipo de resposta", prompt: "texto", id: "identificador", branches: "caminhos", weights: "pesos"
};

export function gateErrorMessage(raw: string): string {
  const schema = /^schema: \/steps\/(\d+)\/(\w+) (\w+)$/.exec(raw);
  if (schema) {
    const [ , index, field, reason ] = schema;
    const label = FIELD_LABEL[field] ?? field;
    const what = reason === "enum"
      ? (field === "answer_type" ? "inválido (use boolean, enum, integer ou text)" : "fora das opções")
      : reason === "required" ? "obrigatório" : reason === "type" ? "com tipo errado" : reason;
    return `Pergunta ${Number(index) + 1}: ${label} ${what}`;
  }
  if (raw === "Definition start_step_id refers to unknown step") return "start_step_id aponta para uma pergunta que não existe";
  return raw;
}
