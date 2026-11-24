// Frases dos códigos de recusa do módulo 35b (centro de zoonoses; contrato 2026-11-23 §13, api-shapes §3).
// Uma frase por código, a mesma que o app de campo copia: este arquivo não importa nada para poder ser copiado inteiro.
// Nenhuma frase traz dado de pessoa, endereço nem o código cru. Código fora da tabela aparece cru na tela.

export const ZOONOSES_DISABLED = "o centro de zoonoses está desligado nesta cidade";
// `feature_disabled` com `feature: "ombudsman"` (as demandas exigem a ouvidoria, Q35) e a frase do encaminhamento repetido (Q34).
export const ZOONOSES_OMBUDSMAN_DISABLED = "A ouvidoria está desligada nesta cidade.";
export const FORWARDING_ALREADY_PENDING = "Já existe um encaminhamento pendente para este destino.";
// 409 invalid_transition path status no PATCH do animal com estada aberta no canil (ruling T8): sem ponto final, como no contrato.
export const ANIMAL_STAY_OPEN = "Feche a estada no canil antes de mudar a situação";

export const ZOONOSES_ERROR_CODES = [
  "feature_disabled", "missing_role", "veterinarian_required", "mfa_required", "not_found", "invalid_request", "invalid_cursor",
  "invalid_limit", "too_many_requests", "cbo_not_allowed", "out_of_scope", "invalid_cpf", "invalid_cns", "person_not_found",
  "citizen_not_verified", "animal_changed", "animal_not_active", "campaign_changed", "campaign_already_open", "survey_changed",
  "collar_changed", "invalid_transition", "demand_changed", "forwarding_changed", "forwarding_already_pending", "already_extended",
  "observation_changed", "test_changed", "stay_changed", "stay_already_open", "already_euthanized", "parameters_changed",
  "reserved_subject", "expected_version_required", "date_out_of_range", "microchip_taken", "registry_number_taken",
  "already_vaccinated_in_campaign", "campaign_not_open", "survey_not_open", "animal_not_dog", "observation_not_finished",
  "elisa_without_reactive_dpp", "household_not_in_survey", "invalid_parameter", "invalid_form", "tutor_not_found", "product_not_allowed",
  "client_uuid_conflict"
] as const;
export type ZoonosesErrorCode = (typeof ZOONOSES_ERROR_CODES)[number];

const CHANGED = "enquanto a tela estava aberta — os dados foram relidos";

export const ZOONOSES_ERRORS: Record<ZoonosesErrorCode, string> = {
  feature_disabled: ZOONOSES_DISABLED,
  missing_role: "seu papel não permite esta ação",
  veterinarian_required: "só o médico veterinário (papel da equipe de zoonoses, CBO 223305, com CRMV e vínculo na unidade de vigilância ambiental) registra esta ação",
  mfa_required: "confirme sua identidade com o segundo fator e tente de novo",
  not_found: "não encontrado — recarregue a lista",
  invalid_request: "pedido inválido — recarregue a tela e tente de novo",
  invalid_cursor: "a lista mudou — ela será lida do início",
  invalid_limit: "tamanho de página inválido — recarregue a tela",
  too_many_requests: "muitas buscas de pessoa em pouco tempo — espere um minuto e tente de novo",
  cbo_not_allowed: "seu CBO não permite esta ação",
  out_of_scope: "esta microárea não está no seu escopo",
  invalid_cpf: "CPF inválido: confira os 11 dígitos",
  invalid_cns: "CNS inválido: confira os 15 dígitos",
  person_not_found: "nenhuma pessoa com este documento",
  citizen_not_verified: "este CPF tem cadastro declarado pelo cidadão, ainda sem validação presencial — valide a identidade antes",
  animal_changed: "o animal mudou enquanto a tela estava aberta — os dados foram relidos; confira antes de repetir",
  animal_not_active: "o animal não está ativo",
  campaign_changed: `a campanha mudou ${CHANGED}`,
  campaign_already_open: "já há uma campanha aberta — encerre-a antes de abrir outra",
  survey_changed: `o inquérito mudou ${CHANGED}`,
  collar_changed: `a coleira mudou ${CHANGED}`,
  invalid_transition: "a situação mudou enquanto a tela estava aberta — confira e tente de novo",
  demand_changed: "a demanda mudou enquanto a tela estava aberta — os dados foram relidos",
  forwarding_changed: "o encaminhamento mudou enquanto a tela estava aberta — os dados foram relidos",
  forwarding_already_pending: FORWARDING_ALREADY_PENDING,
  already_extended: "a prorrogação já foi usada neste ciclo",
  observation_changed: "a observação mudou enquanto a tela estava aberta — os dados foram relidos",
  test_changed: "o exame mudou enquanto a tela estava aberta — os dados foram relidos",
  stay_changed: "a estada mudou enquanto a tela estava aberta — os dados foram relidos",
  stay_already_open: "o animal já tem uma estada aberta no canil",
  already_euthanized: "este animal já tem eutanásia registrada",
  parameters_changed: "os parâmetros foram salvos por outra pessoa — os dados foram relidos; confira antes de salvar",
  reserved_subject: "este assunto é reservado ao centro de zoonoses e não pode ser desativado com o centro ligado",
  expected_version_required: "a tela não mandou a versão lida — recarregue e tente de novo",
  date_out_of_range: "a data está fora do período permitido",
  microchip_taken: "este microchip já está em outro animal da cidade",
  registry_number_taken: "este número de registro já está em outro animal da cidade",
  already_vaccinated_in_campaign: "este animal já foi vacinado nesta campanha",
  campaign_not_open: "a campanha não está aberta",
  survey_not_open: "o inquérito não está aberto",
  animal_not_dog: "coleta de sorologia e coleira são só para cão",
  observation_not_finished: "o desfecho sadio só vale a partir do último dia da observação",
  elisa_without_reactive_dpp: "o ELISA só é lançado depois de um TR-DPP reagente",
  household_not_in_survey: "o domicílio não está nos quarteirões deste inquérito",
  invalid_parameter: "valor fora da faixa permitida para este parâmetro",
  invalid_form: "confira os campos da ficha de notificação",
  // Itens do app de campo (field-sync): animal (path tutor_client_uuid), vacina e coleira (path vector_product_id).
  tutor_not_found: "o tutor deste animal não foi encontrado — confira o cadastro do tutor",
  product_not_allowed: "este produto não vale para esta finalidade",
  client_uuid_conflict: "este envio já foi usado por outro registro — a tela gerou um novo identificador; confira os dados e grave de novo"
};
