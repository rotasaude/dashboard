// Frases dos códigos de recusa do módulo 35a (vigilância ambiental de endemias; contrato §17, Q7, Q9, Q10, Q26(4)).
// Uma frase por código, a mesma que o app de campo copia. Nenhuma traz dado de pessoa, endereço de caso nem o
// código cru. Os códigos gerais (missing_role, not_found, invalid_request, invalid_cursor, out_of_scope,
// client_uuid_conflict, mfa_required) não são do 35a e ficam fora desta tabela.

export const VECTOR_CONTROL_DISABLED = "a vigilância ambiental (endemias) está desligada nesta cidade";

// Os 38 da brief (33 do §17 + sample_label_taken, unit_has_vector_control_location, cbo_not_allowed, feature_disabled,
// invalid_transition), o proposal_changed, que o api emite na confirmação do bloqueio (Q26(4)), e os dois do PUT dos parâmetros
// (Q34: parameters_changed e expected_version_required).
export const VECTOR_ERROR_CODES = [
  "vector_inspection_invalid", "situation_outcome_mismatch", "inspection_not_worked", "activity_property_mismatch",
  "liraa_item_not_found", "transmission_block_not_active", "deposit_counts_inconsistent", "product_not_allowed",
  "samples_exceed_larvae", "inspection_times_invalid", "reason_derived", "block_already_set", "household_without_neighborhood",
  "block_not_in_household_neighborhood", "household_without_block", "consent_required", "ovitrap_number_taken",
  "collection_out_of_range", "reading_not_open", "reading_not_countable", "ovitrap_not_active", "invalid_neighbor", "block_in_use",
  "product_in_use", "already_reconciled", "stratum_overlap", "stratum_out_of_range", "survey_not_draft", "cycle_invalid",
  "cycle_overlap", "invalid_parameter", "sample_result_invalid", "block_number_taken", "cbo_not_allowed", "feature_disabled",
  "sample_label_taken", "unit_has_vector_control_location", "invalid_transition", "proposal_changed",
  "parameters_changed", "expected_version_required"
] as const;
export type VectorErrorCode = (typeof VECTOR_ERROR_CODES)[number];

export const VECTOR_ERRORS: Record<VectorErrorCode, string> = {
  vector_inspection_invalid: "confira o campo destacado do boletim",
  situation_outcome_mismatch: "a situação do imóvel não combina com o desfecho: trabalhado é visita realizada, recusado é recusada, fechado e desocupado são ausente",
  inspection_not_worked: "imóvel fechado, recusado ou desocupado não leva depósito, medida, amostra nem ação educativa",
  activity_property_mismatch: "esta atividade não vale para este tipo de imóvel: PE só em ponto estratégico e IE só em imóvel especial",
  liraa_item_not_found: "este imóvel não tem item do LIRAa pendente em levantamento sorteado",
  transmission_block_not_active: "o bloqueio não está ativo ou o quarteirão do imóvel não está na área dele",
  deposit_counts_inconsistent: "contagem de depósitos incoerente: com água até os existentes, com larva até os com água, eliminados até os existentes e tratados até os com água",
  product_not_allowed: "este produto está inativo ou não serve para este método",
  samples_exceed_larvae: "amostras incoerentes: numere de 1 em diante sem pular, só em grupo com larva e no máximo um tubito por depósito com larva",
  inspection_times_invalid: "horários inválidos: entrada e saída no dia da visita, a entrada até a hora da visita, a saída depois dela e no máximo 12 horas entre as duas",
  reason_derived: "os motivos de controle vetorial (34 a 37) saem do boletim — desmarque-os",
  block_already_set: "o imóvel já tem quarteirão — só a coordenação de endemias troca",
  household_without_neighborhood: "o domicílio está sem bairro no cadastro — o ACS corrige o endereço no cadastro territorial",
  block_not_in_household_neighborhood: "o quarteirão é de outro bairro — escolha um do bairro do domicílio",
  household_without_block: "o imóvel ainda não tem quarteirão — a ovitrampa só é instalada em imóvel com quarteirão",
  consent_required: "a instalação exige o termo de consentimento assinado pelo morador",
  ovitrap_number_taken: "já existe ovitrampa ativa com este número",
  collection_out_of_range: "a coleta está fora do prazo da palheta — confira as datas de instalação e de coleta",
  reading_not_open: "esta ovitrampa não tem palheta instalada para coletar",
  reading_not_countable: "só se contam ovos de palheta coletada em bom estado",
  ovitrap_not_active: "esta ovitrampa não está mais ativa",
  invalid_neighbor: "vizinho inválido — um quarteirão não é vizinho dele mesmo",
  block_in_use: "o quarteirão tem imóvel ativo — atribua os imóveis a outro quarteirão antes de desativar",
  product_in_use: "unidade e tamanho da carga não mudam depois do primeiro lote ou aplicação — cadastre outro produto",
  already_reconciled: "esta falta já foi conciliada",
  stratum_overlap: "este quarteirão já está em outro estrato deste levantamento",
  stratum_out_of_range: "o número de imóveis do estrato está fora da faixa do tipo escolhido",
  survey_not_draft: "o levantamento já foi sorteado — os estratos não mudam mais",
  cycle_invalid: "ciclo inválido — confira as datas, a duração e o intervalo desde o ciclo anterior",
  cycle_overlap: "este período se sobrepõe a outro ciclo",
  invalid_parameter: "valor fora da faixa aceita para este parâmetro",
  sample_result_invalid: "resultado incoerente: examinadas até as coletadas, e Ae. aegypti mais Ae. albopictus até as examinadas",
  block_number_taken: "já existe quarteirão com este número neste bairro",
  cbo_not_allowed: "só o agente de combate às endemias registra boletim e ovitrampa",
  feature_disabled: VECTOR_CONTROL_DISABLED,
  sample_label_taken: "esta etiqueta já foi usada — gere etiquetas novas para este boletim",
  unit_has_vector_control_location: "esta unidade tem local de estoque do controle vetorial e não troca de tipo",
  invalid_transition: "a situação mudou enquanto a tela estava aberta — os dados foram relidos",
  // Frase proposta (não estava na brief): 409 da confirmação quando a proposta tem caso que a tela não mostrou.
  proposal_changed: "a proposta ganhou caso novo enquanto a tela estava aberta — os dados foram relidos",
  // Q34 (frase do coordenador, na caixa e pontuação da tabela): 409 do PUT dos parâmetros com outra versão gravada no meio.
  parameters_changed: "outra pessoa alterou os parâmetros; confira e salve de novo",
  expected_version_required: "a tela está desatualizada — recarregue a página e tente de novo"
};
