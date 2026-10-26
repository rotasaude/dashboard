// src/lib/territoryLabels.ts
// Rótulos em português dos campos das fichas (LEDI 8.7.0, dicionários das
// fichas de cadastro domiciliar e individual — descrição oficial de cada
// campo, em linguagem simples). SECTIONS (territoryDictionaries.generated) só
// tem chaves; a tela pergunta aqui, e a ordem das chaves é a ordem da tela.
// Campo aninhado: "objeto.campo". Sem rótulo, a chave aparece crua (nunca some).
import type { SectionKey } from "./territoryDictionaries";

const LIVING_CONDITIONS: Record<string, string> = {
  localizacao: "Localização",
  situacao_moradia_posse_terra: "Situação de moradia ou posse da terra",
  area_producao_rural: "Posse e uso da terra (área de produção rural)",
  tipo_domicilio: "Tipo de domicílio",
  tipo_acesso_domicilio: "Acesso ao domicílio",
  material_predominante_paredes_ext_domicilio: "Material predominante das paredes externas",
  nu_comodos: "Número de cômodos",
  nu_moradores: "Número de moradores",
  st_disponibilidade_energia_eletrica: "Tem energia elétrica",
  tipo_origem_energia_eletrica: "Origem da energia elétrica",
  abastecimento_agua: "Abastecimento de água",
  agua_consumo_domicilio: "Tratamento da água para consumo",
  forma_escoamento_banheiro: "Escoamento do banheiro ou sanitário",
  destino_lixo: "Destino do lixo",
  st_animais_no_domicilio: "Tem animais no domicílio",
  animais_no_domicilio: "Animais no domicílio",
  quantos_animais_no_domicilio: "Quantos animais",
  instituicao_permanencia: "Instituição de permanência",
  "instituicao_permanencia.nome_instituicao_permanencia": "Nome da instituição",
  "instituicao_permanencia.nome_responsavel_tecnico": "Nome do responsável técnico",
  "instituicao_permanencia.cargo_instituicao": "Cargo do responsável técnico",
  "instituicao_permanencia.cns_responsavel_tecnico": "CNS do responsável técnico",
  "instituicao_permanencia.telefone_responsavel_tecnico": "Telefone do responsável técnico",
  "instituicao_permanencia.st_outros_profissionais_vinculados": "Há outros profissionais de saúde vinculados (fora da rede pública)"
};

// Cadastro individual (dicionario-fci). Nome, nascimento, sexo, mãe, CPF e CNS
// moram no paciente (a ficha os tira dele) e têm rótulo na própria tela.
const IDENTIFICATION: Record<string, string> = {
  nacionalidade_cidadao: "Nacionalidade",
  codigo_ibge_municipio_nascimento: "Município de nascimento (código IBGE, 7 dígitos)",
  pais_nascimento: "País de nascimento",
  dt_naturalizacao: "Data de naturalização",
  portaria_naturalizacao: "Portaria de naturalização",
  dt_entrada_brasil: "Data de entrada no Brasil",
  telefone_celular: "Celular (DDD + número)",
  email_cidadao: "E-mail",
  nome_pai_cidadao: "Nome do pai",
  desconhece_nome_pai: "Não sabe o nome do pai",
  desconhece_nome_mae: "Não sabe o nome da mãe",
  numero_nis_pis_pasep: "NIS (PIS/PASEP)",
  estado_civil: "Estado civil",
  tipo_sanguineo: "Tipo sanguíneo",
  dnv: "Declaração de nascido vivo (DNV)"
};

const SOCIODEMOGRAPHIC: Record<string, string> = {
  status_deseja_informar_orientacao_sexual: "Quer informar a orientação sexual?",
  orientacao_sexual_cidadao: "Orientação sexual",
  status_deseja_informar_identidade_genero: "Quer informar a identidade de gênero?",
  identidade_genero_cidadao: "Identidade de gênero",
  relacao_parentesco_cidadao: "Parentesco com o responsável da família",
  grau_instrucao_cidadao: "Curso mais elevado que frequenta ou frequentou",
  status_frequenta_escola: "Frequenta escola ou creche",
  ocupacao_codigo_cbo2002: "Ocupação (código CBO)",
  situacao_mercado_trabalho_cidadao: "Situação no mercado de trabalho",
  responsavel_por_crianca: "Com quem a criança fica (menor de 10 anos)",
  status_frequenta_benzedeira: "Frequenta cuidador tradicional (benzedeira, rezadeira)",
  status_participa_grupo_comunitario: "Participa de grupo comunitário",
  status_possui_plano_saude_privado: "Tem plano de saúde privado",
  status_membro_povo_comunidade_tradicional: "É de povo ou comunidade tradicional",
  co_povo_comunidade_tradicional: "Povo ou comunidade tradicional",
  status_tem_alguma_deficiencia: "Tem alguma deficiência",
  deficiencias_cidadao: "Deficiências",
  alimentos_acabaram_antes_ter_dinheiro_comprar_mais: "Nos últimos 3 meses, os alimentos acabaram antes de haver dinheiro para comprar mais?",
  comeu_alguns_alimentos_que_tinha_dinheiro_acabou: "Nos últimos 3 meses, comeu só alguns alimentos que ainda tinha porque o dinheiro acabou?"
};

const HEALTH_CONDITIONS: Record<string, string> = {
  status_eh_gestante: "Está gestante",
  maternidade_de_referencia: "Maternidade de referência",
  situacao_peso: "Sobre o peso, a pessoa se considera",
  status_eh_fumante: "É fumante",
  status_eh_dependente_alcool: "Faz uso de álcool",
  status_eh_dependente_outras_drogas: "Faz uso de outras drogas",
  status_tem_hipertensao_arterial: "Tem hipertensão arterial",
  status_tem_diabetes: "Tem diabetes",
  status_teve_avc_derrame: "Teve AVC ou derrame",
  status_teve_infarto: "Teve infarto",
  status_teve_doenca_cardiaca: "Tem ou teve doença do coração",
  doenca_cardiaca: "Doenças do coração",
  status_tem_teve_doencas_rins: "Tem ou teve problema nos rins",
  doenca_rins: "Problemas nos rins",
  status_tem_doenca_respiratoria: "Tem doença respiratória",
  doenca_respiratoria: "Doenças respiratórias",
  status_tem_hanseniase: "Tem hanseníase",
  status_tem_tuberculose: "Tem tuberculose",
  status_tem_teve_cancer: "Tem ou teve câncer",
  status_teve_internado_em12_meses: "Esteve internado nos últimos 12 meses",
  descricao_causa_internacao_em12_meses: "Causa da internação",
  status_diagnostico_mental: "Teve diagnóstico de problema de saúde mental",
  status_esta_acamado: "Está acamado",
  status_esta_domiciliado: "Está domiciliado",
  status_usa_planta_medicinais: "Usa plantas medicinais",
  descricao_plantas_medicinais_usadas: "Quais plantas medicinais",
  status_usa_outras_praticas_integrativas_ou_complementares: "Usa outras práticas integrativas e complementares",
  descricao_outra_condicao1: "Outra condição de saúde (1)",
  descricao_outra_condicao2: "Outra condição de saúde (2)",
  descricao_outra_condicao3: "Outra condição de saúde (3)"
};

const STREET_SITUATION: Record<string, string> = {
  status_situacao_rua: "Está em situação de rua?",
  tempo_situacao_rua: "Há quanto tempo está em situação de rua",
  status_recebe_beneficio: "Recebe algum benefício",
  status_possui_referencia_familiar: "Tem referência familiar",
  quantidade_alimentacoes_ao_dia_situacao_rua: "Quantas vezes se alimenta por dia",
  origem_alimento_situacao_rua: "Origem da alimentação",
  status_acompanhado_por_outra_instituicao: "É acompanhado por outra instituição",
  outra_instituicao_que_acompanha: "Qual instituição acompanha",
  status_visita_familiar_frequentemente: "Visita algum familiar com frequência",
  grau_parentesco_familiar_frequentado: "Parentesco do familiar que visita",
  status_tem_acesso_higiene_pessoal_situacao_rua: "Tem acesso a higiene pessoal",
  higiene_pessoal_situacao_rua: "Acesso à higiene"
};

export const FIELD_LABELS: Partial<Record<SectionKey, Record<string, string>>> = {
  living_conditions: LIVING_CONDITIONS, identification: IDENTIFICATION, sociodemographic: SOCIODEMOGRAPHIC,
  health_conditions: HEALTH_CONDITIONS, street_situation: STREET_SITUATION
};

export function sectionFieldLabel(section: SectionKey, key: string): string {
  return FIELD_LABELS[section]?.[key] ?? key;
}
