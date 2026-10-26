// src/lib/territoryLabels.ts
// Rótulos em português dos campos das fichas (LEDI 8.7.0, dicionário da
// ficha de cadastro domiciliar — descrição oficial de cada campo, em
// linguagem simples). SECTIONS (territoryDictionaries.generated) só tem
// chaves; a tela pergunta aqui. Campo aninhado: "objeto.campo". Sem rótulo,
// a chave aparece crua (nunca some). A Task 12 acrescenta as seções do
// cadastro individual.
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

export const FIELD_LABELS: Partial<Record<SectionKey, Record<string, string>>> = { living_conditions: LIVING_CONDITIONS };

export function sectionFieldLabel(section: SectionKey, key: string): string {
  return FIELD_LABELS[section]?.[key] ?? key;
}
