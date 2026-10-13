// Mensagens do editor de protocolo em português (spec 6d, PR-08): quem escreve
// o protocolo é da saúde, não dev. Mensagem desconhecida passa como veio.
export function parseErrorMessage(raw: string): string {
  // V8 (Chrome, Edge): "(line 5 column 3)"; Firefox: "at line 5 column 3 of
  // the JSON data". Safari não dá posição (I5).
  const at = /line (\d+) column (\d+)/.exec(raw);
  const cause = /expected ',' or '}'/i.test(raw) ? "falta vírgula ou fechar chave"
    : /unexpected token|unexpected character/i.test(raw) ? "caractere inesperado"
    : /unexpected end/i.test(raw) ? "o texto termina antes de fechar"
    : null;
  if (at) return `linha ${at[1]}, coluna ${at[2]}: ${cause ?? "formato inválido"}`;
  return cause === "o texto termina antes de fechar" ? `JSON inválido: ${cause}` : `JSON inválido: ${raw}`;
}

const FIELD_LABEL: Record<string, string> = {
  answer_type: "tipo de resposta", prompt: "texto", id: "identificador", branches: "caminhos", weights: "pesos"
};

export function gateErrorMessage(raw: string): string {
  // O json_schemer aponta para o objeto da pergunta quando falta um campo
  // ("/steps/0 required") e para o campo nos outros casos (I4).
  const schema = /^schema: \/steps\/(\d+)(?:\/(\w+))? (\w+)$/.exec(raw);
  if (schema) {
    const [ , index, field, reason ] = schema;
    if (!field) return `Pergunta ${Number(index) + 1}: ${reason === "required" ? "campo obrigatório faltando" : reason}`;
    const label = FIELD_LABEL[field] ?? field;
    const what = reason === "enum"
      ? (field === "answer_type" ? "inválido (use boolean, enum, integer ou text)" : "fora das opções")
      : reason === "required" ? "obrigatório" : reason === "type" ? "com tipo errado" : reason;
    return `Pergunta ${Number(index) + 1}: ${label} ${what}`;
  }
  if (/^(Definition )?start_step_id refers to unknown step$/.test(raw)) return "start_step_id aponta para uma pergunta que não existe";
  return raw;
}
