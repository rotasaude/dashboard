// Frases do envio à BNAFAR (módulo 27b; contrato §7). Uma tabela única: pendência, recusa MSG do Ministério, recusa do api e recusa de
// linha da planilha. As frases são proposta, salvo BNAFAR_DISABLED. Nenhuma tem sublinhado nem dado de pessoa; código novo aparece cru.
export const BNAFAR_DISABLED = "o envio à BNAFAR está desligado nesta cidade";

const GROUP_CREDENTIAL = "a BNAFAR recusou a credencial da cidade — o administrador troca e testa em Integrações";
const GROUP_CNPJ = "CNPJ do fabricante não encontrado na Receita Federal";
const GROUP_DEADLINE = "passou o prazo de 30 dias para corrigir na BNAFAR";

export const BNAFAR_ERRORS: Record<string, string> = {
  // Pendências (api: Bnafar::Pendencies).
  lot_incomplete: "lote sem os dados do envio (valor, fabricante, registro ANVISA, programa ou AMPP)",
  location_without_cnes: "local sem CNES — o envio deste local espera o CNES",
  product_without_code: "produto sem código da BNAFAR (VMP do medicamento, código OBM da vacina ou CATMAT do produto de campo)",
  fractional_balance: "saldo com fração — a BNAFAR só aceita quantidade inteira; ajuste o saldo",
  exit_type_missing: "saída sem tipo BNAFAR correspondente — fica fora do envio",
  domain_off: "tipo de produto ainda não ligado ao envio",
  lot_number_too_long: "número do lote com mais de 30 caracteres — a BNAFAR não aceita este lote",
  feature_disabled: BNAFAR_DISABLED,
  // Recusas do api (409/422) do complemento, da correção e do reenvio.
  lot_bnafar_changed: "os dados do lote foram salvos por outra pessoa — o lote foi relido; confira antes de salvar",
  external_exit_changed: "a saída foi corrigida por outra pessoa — os dados foram relidos; confira antes de corrigir",
  retry_window_closed: "passou o dia seguinte ao da remessa — os registros recusados ficaram perdidos",
  correction_window_closed: "passaram os 30 dias depois do envio — esta saída não pode mais ser corrigida",
  not_correctable: "só a saída externa aceita pode ser corrigida; a posição de estoque sai corrigida no dia seguinte",
  nothing_to_retry: "esta remessa não tem registros recusados para reenviar",
  expected_version_required: "a versão do registro não foi enviada — recarregue a tela e tente de novo",
  ampp_unknown: "esta apresentação (AMPP) não está no catálogo OBM",
  ampp_not_in_vmp: "esta apresentação (AMPP) é de outro medicamento",
  anvisa_mismatch: "o registro ANVISA não é o da apresentação (AMPP) escolhida",
  program_unknown: "programa de saúde fora da tabela da BNAFAR",
  invalid_cnpj: "CNPJ inválido — confira os 14 caracteres",
  cnes_in_use: "este CNES já é de uma unidade de saúde — use o CNES próprio do almoxarifado",
  invalid_environment: "ambiente desconhecido",
  environment_not_allowed: "a homologação não é aceita em produção",
  invalid_credential: "usuário ou senha da BNAFAR inválidos — confira",
  credential_missing: "a cidade ainda não gravou a credencial da BNAFAR",
  lot_mismatch: "este lote já existe com outros dados — confira validade, fabricante e os dados do envio",
  // Saída externa.
  lot_blocked: "lote bloqueado — escolha outro lote",
  lot_expired: "lote vencido — só a devolução ao fornecedor aceita lote vencido",
  invalid_items: "lote inexistente, repetido ou sem cadastro na vacina — escolha outro lote",
  // Último erro da remessa e do registro (sem código do Ministério).
  not_sent: "o registro não chegou a ser enviado à BNAFAR",
  not_processed: "a BNAFAR recebeu a remessa mas não a processou",
  window_closed: "o prazo para reenviar esta remessa já terminou",
  bnafar_unavailable: "a BNAFAR está fora do ar — o envio tenta de novo sozinho",
  internal_error: "erro interno ao montar o envio — avise a equipe do Rota Saúde",
  rejected: "a BNAFAR recusou a remessa",
  // Planilha do saldo inicial (códigos de linha).
  cnes_unknown: "o CNES da linha não é de nenhum local de estoque da cidade",
  invalid_product_type: "tipo de produto da linha desconhecido",
  product_unknown: "produto da linha não encontrado no catálogo",
  item_not_allowed_here: "este item não entra neste local",
  domain_disabled: "o tipo de produto desta linha está desligado nesta cidade",
  invalid_lot_number: "número do lote inválido",
  invalid_date: "data de validade inválida",
  expired_lot: "o lote da linha já venceu — não entra como saldo inicial",
  invalid_quantity: "quantidade inválida — use um número inteiro maior que zero",
  invalid_price: "valor unitário inválido — use reais com vírgula, maior que zero",
  invalid_anvisa: "o registro ANVISA tem 11 ou 13 dígitos",
  manufacturer_not_in_catalog: "o fabricante não está no catálogo de imunobiológicos",
  duplicate_line: "linha repetida na planilha — mesmo local, produto e lote",
  opening_exists: "este item já tem saldo inicial neste local",
  too_many_lots: "lotes demais para este item neste local",
  // Saldo inicial, atos e arquivo.
  opening_import_changed: "a importação mudou enquanto você olhava — a tela foi relida; confira antes de seguir",
  revert_blocked: "há movimento depois da abertura em algum local — o saldo inicial não pode mais ser desfeito",
  invalid_file: "arquivo inválido — baixe o modelo e confira o cabeçalho e as colunas",
  file_too_large: "arquivo grande demais — até 5 MB e 20.000 linhas",
  // Recusas do Ministério (retorno da BNAFAR).
  MSG01: GROUP_CREDENTIAL, MSG02: GROUP_CREDENTIAL, MSG03: GROUP_CREDENTIAL, MSG04: GROUP_CREDENTIAL, MSG64: GROUP_CREDENTIAL,
  MSG06: "a BNAFAR não encontrou este CNES",
  MSG08: "um valor está fora da tabela da BNAFAR",
  MSG09: "a BNAFAR não reconheceu o produto (código)",
  MSG10: "a BNAFAR não reconheceu o programa de saúde",
  MSG11: "data no futuro",
  MSG12: GROUP_CNPJ, MSG59: GROUP_CNPJ,
  MSG13: "fabricante: informe só o CNPJ ou só o nome do fabricante internacional",
  MSG15: "registro igual a um já enviado — contado como aceito",
  MSG16: GROUP_DEADLINE, MSG17: GROUP_DEADLINE, MSG18: GROUP_DEADLINE,
  MSG21: "tipo de saída não aceito pela BNAFAR",
  MSG22: "a remessa anterior ainda está em processamento na BNAFAR",
  MSG44: "serviço do Ministério indisponível — a BNAFAR reprocessa sozinha",
  MSG46: "registro com itens demais",
  MSG47: "nenhum item do registro foi aceito",
  MSG51: "o CNES não pertence a esta cidade",
  MSG62: "remessa com mais de 1.000 registros",
  MSG63: "remessa sem itens válidos",
  MSG71: "a BNAFAR não reconheceu o AMPP",
  MSG72: "o registro ANVISA não confere com o AMPP",
  MSG73: "a BNAFAR só aceita a data de hoje ou de ontem"
};

const has = (code: string): boolean => Object.prototype.hasOwnProperty.call(BNAFAR_ERRORS, code);

export function bnafarErrorText(code: string): string {
  return has(code) ? BNAFAR_ERRORS[code] : `recusa da BNAFAR: ${code}`;
}

// Todos os códigos de um registro, na ordem dada, sem repetir a frase (MSG12 e MSG59 dizem o mesmo). A MSG47 mantém a frase própria.
export function bnafarErrorTexts(codes: string[]): string[] {
  return [ ...new Set(codes.map(bnafarErrorText)) ];
}
