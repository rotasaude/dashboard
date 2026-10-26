// src/lib/territoryDictionaries.test.ts
// Paridade com o api (mod24a): os casos das tabelas abaixo são os de
// spec/services/territory_registry/{rules,dictionary}_spec.rb, com o caminho
// da PRIMEIRA recusa que o api devolve. A tela nunca é mais estrita que o api.
import { describe, expect, it } from "vitest";
import type { HouseholdInput, NewPatient, RegistrationInput } from "./api";
import {
  DOMAINS, LEDI_VERSION, SECTIONS, STRING_DOMAINS, addressProblem, allowsFamilies, allowsLivingConditions, canBePregnant, dictLabel,
  exitProblem, familyProblem, familyRulesProblem, householdProblem, householdRulesProblem, individualRulesProblem, isValidLediName,
  livingFieldAllowed, patientFacts, registrationProblem, requiresInstitution, sectionProblem,
  type IndividualRulesInput, type PersonFacts, type RegistrationDraft
} from "./territoryDictionaries";
import { registration } from "../test/territoryFixtures";

const T = "2026-10-23";
const pathOf = (p: { path: string } | null) => p?.path ?? null;

describe("dicionários gerados do YAML do api (contrato §15)", () => {
  it("domínios por nome do domínio, na ordem do LEDI, com os grandes inteiros", () => {
    expect(LEDI_VERSION).toBe("8.7.0");
    expect(DOMAINS.justificativa_nao_possui_cpf.map((e) => e.code)).toEqual([ 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 ]);
    expect(DOMAINS.raca_cor.map((e) => e.code)).toEqual([ 1, 2, 4, 3, 5 ]);
    expect(DOMAINS.pais).toHaveLength(346);
    expect(DOMAINS.etnia).toHaveLength(406);
    expect(DOMAINS.povo_comunidade_tradicional).toHaveLength(35);
    expect(STRING_DOMAINS.tipo_logradouro).toHaveLength(393);
    expect(STRING_DOMAINS.uf).toHaveLength(27);
    expect(Object.keys(DOMAINS)).toHaveLength(39);
  });

  it("dictLabel: rótulo do LEDI; código em texto também; desconhecido cru; nulo traço", () => {
    expect(dictLabel("justificativa_nao_possui_cpf", 3)).toBe("Recém-nascidos");
    expect(dictLabel("sexo", 0)).toBe("Masculino");
    expect(dictLabel("motivo_saida", 135)).toBe("Óbito");
    expect(dictLabel("tipo_de_imovel", "99")).toBe("Outros");
    expect(dictLabel("renda_familiar", "8")).toBe("Ausência de renda");
    expect(dictLabel("tempo_situacao_de_rua", 17)).toBe("Menos de 6 meses");
    expect(dictLabel("pais", 31)).toBe("BRASIL");
    expect(dictLabel("tipo_logradouro", "081")).toBe("RUA");
    expect(dictLabel("uf", "17")).toBe("PARANÁ");
    expect(dictLabel("tipo_de_imovel", 42)).toBe("42");
    expect(dictLabel("tipo_logradouro", "81")).toBe("81");
    expect(dictLabel("tipo_de_imovel", null)).toBe("—");
    expect(dictLabel("tipo_de_imovel", undefined)).toBe("—");
  });

  it("SECTIONS: as 5 seções com tipo, domínio e limites; instituicao_permanencia é objeto", () => {
    expect(Object.fromEntries(Object.entries(SECTIONS).map(([ k, v ]) => [ k, v.length ])))
      .toEqual({ identification: 15, sociodemographic: 19, health_conditions: 30, street_situation: 12, living_conditions: 18 });
    expect(SECTIONS.identification.find((f) => f.key === "nacionalidade_cidadao"))
      .toMatchObject({ type: "code", domain: "nacionalidade", required: true });
    expect(SECTIONS.identification.find((f) => f.key === "codigo_ibge_municipio_nascimento")).toMatchObject({ type: "digits", min: 7, max: 7 });
    expect(SECTIONS.health_conditions.find((f) => f.key === "doenca_cardiaca")).toMatchObject({ type: "codes", max_items: 3 });
    const inst = SECTIONS.living_conditions.find((f) => f.key === "instituicao_permanencia");
    expect(inst?.type).toBe("object");
    expect(inst?.fields?.find((f) => f.key === "nome_responsavel_tecnico")).toMatchObject({ type: "name", required: true, max: 70 });
  });
});

describe("Validar nome (Dictionary.valid_name?)", () => {
  it.each([ "Maria da Paz", "JOÃO D'ÁVILA", "João D’Ávila", "Gonçalves Dias", "Ana Li", "Kauã Wyllian" ])("aceita %s", (name) => {
    expect(isValidLediName(name)).toBe(true);
  });
  it.each([
    [ "Jo" ], [ "Joaquim" ], [ "Maria  Paz" ], [ " Maria Paz" ], [ "Maria Paz 2" ], [ "Ana-Maria Souza" ], [ "Maria P. Souza" ],
    [ "A A da Silva" ], [ "Li Wu" ], [ `Maria ${"a".repeat(70)}` ]
  ])("recusa %s", (name) => {
    expect(isValidLediName(name)).toBe(false);
  });
  it("nulo e não texto", () => {
    expect(isValidLediName(null)).toBe(false);
    expect(isValidLediName(123)).toBe(false);
  });
});

describe("Dictionary.parse (tipo, domínio e limites; caminho do campo)", () => {
  it.each([
    [ "sociodemographic", { cpf: "1" }, "sociodemographic.cpf" ],
    [ "living_conditions", { piscina: true }, "living_conditions.piscina" ],
    [ "identification", "x", "identification" ],
    [ "health_conditions", { status_eh_fumante: "true" }, "health_conditions.status_eh_fumante" ],
    [ "identification", { nacionalidade_cidadao: 4 }, "identification.nacionalidade_cidadao" ],
    [ "identification", { nacionalidade_cidadao: "1" }, "identification.nacionalidade_cidadao" ],
    [ "living_conditions", { localizacao: 1 }, "living_conditions.localizacao" ],
    [ "health_conditions", { doenca_cardiaca: [ 24, 24 ] }, "health_conditions.doenca_cardiaca" ],
    [ "health_conditions", { doenca_cardiaca: [ 30 ] }, "health_conditions.doenca_cardiaca" ],
    [ "health_conditions", { doenca_cardiaca: 24 }, "health_conditions.doenca_cardiaca" ],
    [ "sociodemographic", { deficiencias_cidadao: [ 12, 13, 14, 15, 232, 16, 12 ] }, "sociodemographic.deficiencias_cidadao" ],
    [ "health_conditions", { descricao_outra_condicao1: "x".repeat(101) }, "health_conditions.descricao_outra_condicao1" ],
    [ "identification", { portaria_naturalizacao: "x".repeat(17) }, "identification.portaria_naturalizacao" ],
    [ "identification", { email_cidadao: "a@b.c" }, "identification.email_cidadao" ],
    [ "identification", { dnv: 12345678901 }, "identification.dnv" ],
    [ "identification", { nome_pai_cidadao: "José" }, "identification.nome_pai_cidadao" ],
    [ "identification", { nome_pai_cidadao: `José ${"a".repeat(70)}` }, "identification.nome_pai_cidadao" ],
    [ "identification", { telefone_celular: "419999900" }, "identification.telefone_celular" ],
    [ "identification", { telefone_celular: "(41)999990000" }, "identification.telefone_celular" ],
    [ "identification", { codigo_ibge_municipio_nascimento: 4106902 }, "identification.codigo_ibge_municipio_nascimento" ],
    [ "identification", { dt_entrada_brasil: "2021-02-29" }, "identification.dt_entrada_brasil" ],
    [ "identification", { dt_entrada_brasil: "29/02/2020" }, "identification.dt_entrada_brasil" ],
    [ "living_conditions", { nu_comodos: 0 }, "living_conditions.nu_comodos" ],
    [ "living_conditions", { nu_moradores: "2" }, "living_conditions.nu_moradores" ],
    [ "living_conditions", { instituicao_permanencia: { cargo_instituicao: "Diretora" } }, "living_conditions.instituicao_permanencia.nome_responsavel_tecnico" ],
    [ "living_conditions", { instituicao_permanencia: { nome_responsavel_tecnico: "Ana Maria Souza", cpf: "1" } }, "living_conditions.instituicao_permanencia.cpf" ],
    [ "living_conditions", { instituicao_permanencia: { nome_responsavel_tecnico: "Ana Maria Souza", telefone_responsavel_tecnico: "123" } },
      "living_conditions.instituicao_permanencia.telefone_responsavel_tecnico" ],
    [ "living_conditions", { instituicao_permanencia: "Abrigo" }, "living_conditions.instituicao_permanencia" ]
  ] as const)("%s %j → %s", (section, raw, path) => {
    expect(pathOf(sectionProblem(section, raw))).toBe(path);
  });

  it.each([
    [ "identification", { nacionalidade_cidadao: 1, telefone_celular: "41999990000", email_cidadao: null, desconhece_nome_pai: true } ],
    [ "identification", null ],
    [ "health_conditions", { status_eh_fumante: false, doenca_cardiaca: [ 24, 25 ], descricao_outra_condicao1: "x".repeat(100) } ],
    [ "health_conditions", { doenca_cardiaca: [] } ],
    [ "identification", { nome_pai_cidadao: "José da Silva", telefone_celular: "4199999000", dt_entrada_brasil: "2020-02-29" } ],
    [ "living_conditions", { nu_moradores: 2, instituicao_permanencia: { nome_responsavel_tecnico: "Ana Maria Souza", st_outros_profissionais_vinculados: true } } ]
  ] as const)("aceita %s %j", (section, raw) => {
    expect(sectionProblem(section, raw)).toBeNull();
  });

  it("chave com undefined não vai no JSON: não é recusada", () => {
    expect(sectionProblem("health_conditions", { campo_novo: undefined, status_eh_fumante: undefined })).toBeNull();
  });

  it("frases: limite estourado diz o limite; lista diz o máximo", () => {
    expect(sectionProblem("health_conditions", { descricao_outra_condicao1: "x".repeat(101) })?.message).toBe("texto com mais de 100 caracteres");
    expect(sectionProblem("living_conditions", { nu_comodos: 0 })?.message).toBe("informe um número inteiro maior que zero");
    expect(sectionProblem("identification", { telefone_celular: "419" })?.message).toBe("só números, de 10 a 11 dígitos");
    expect(sectionProblem("identification", { codigo_ibge_municipio_nascimento: "41069" })?.message).toBe("só números, 7 dígitos");
  });
});

describe("endereço do domicílio (TerritoryRegistry::Address, na ordem do api)", () => {
  const RAW = { zip: "81000000", street_type: "081", street: "das Acácias", number: "120", no_number: false, complement: "casa 2",
    neighborhood_id: "nb1", district: null, reference: "perto da escola" };
  const at = (over: Record<string, unknown>) => pathOf(addressProblem({ ...RAW, ...over }));

  it("aceita o endereço do contrato", () => {
    expect(addressProblem(RAW)).toBeNull();
    expect(at({ street: "Ruano Silva" })).toBeNull();
    expect(at({ street_type: "008", street: "Rua Nova" })).toBeNull();
    expect(at({ number: "", no_number: true })).toBeNull();
    expect(at({ number: null, no_number: true })).toBeNull();
    expect(at({ neighborhood_id: null, district: "Vila Nova" })).toBeNull();
    expect(at({ piscina: undefined })).toBeNull();
  });

  it.each([
    [ { street: "R".repeat(31) }, "address.street", "logradouro com mais de 30 caracteres" ],
    [ { number: "1234A6" }, "address.number", "número de 1 a 5 letras ou dígitos" ],
    [ { number: "12-A" }, "address.number", "número de 1 a 5 letras ou dígitos" ],
    [ { complement: "C".repeat(11) }, "address.complement", "complemento com mais de 10 caracteres" ],
    [ { reference: "R".repeat(41) }, "address.reference", "ponto de referência com mais de 40 caracteres" ],
    [ { zip: "8100000" }, "address.zip", "CEP com 8 dígitos" ],
    [ { street_type: "999" }, "address.street_type", "escolha o tipo de logradouro" ],
    [ { street_type: 81 }, "address.street_type", "escolha o tipo de logradouro" ],
    [ { street: "" }, "address.street", "informe o logradouro" ],
    [ { piscina: true }, "address.piscina", "campo que a ficha não conhece — recarregue a tela" ],
    [ { street: "Rua das Acácias" }, "address.street", "o nome do logradouro não repete o tipo (RUA)" ],
    [ { street: "rua das acacias" }, "address.street", "o nome do logradouro não repete o tipo (RUA)" ],
    [ { street: "RUA" }, "address.street", "o nome do logradouro não repete o tipo (RUA)" ],
    [ { street_type: "008", street: "Avenida Brasil" }, "address.street", "o nome do logradouro não repete o tipo (AVENIDA)" ],
    [ { street_type: "009", street: "Balneario Sul" }, "address.street", "o nome do logradouro não repete o tipo (BALNEÁRIO)" ],
    [ { number: "" }, "address.number", "informe o número ou marque sem número" ],
    [ { number: "120", no_number: true }, "address.number", "sem número: deixe o número em branco" ],
    [ { no_number: "sim" }, "address.no_number", "marque ou desmarque sem número" ],
    [ { neighborhood_id: null }, "address.district", "informe o bairro" ],
    [ { neighborhood_id: null, district: "D".repeat(31) }, "address.district", "bairro com mais de 30 caracteres" ]
  ])("recusa %j", (over, path, message) => {
    expect(addressProblem({ ...RAW, ...over })).toEqual({ path, message });
  });

  it("sem objeto: o endereço inteiro", () => {
    expect(addressProblem("Rua X")).toEqual({ path: "address", message: "informe o endereço" });
    expect(addressProblem(null)).toEqual({ path: "address", message: "informe o endereço" });
  });

  it("bairro do cadastro inativo ou com nome > 30 (errata 5.2): recusa e orienta o bairro em texto; fora da lista, deixa ao api", () => {
    const neighborhoods = [ { id: "nb1", name: "Jardim das Flores", active: false }, { id: "nb2", name: `Bairro ${"L".repeat(30)}`, active: true },
      { id: "nb3", name: "Centro", active: true } ];
    const msg = "este bairro não serve para a ficha (inativo ou com nome maior que 30 letras) — escreva o bairro no campo de texto";
    expect(addressProblem(RAW, neighborhoods)).toEqual({ path: "address.neighborhood_id", message: msg });
    expect(addressProblem({ ...RAW, neighborhood_id: "nb2" }, neighborhoods)).toEqual({ path: "address.neighborhood_id", message: msg });
    expect(addressProblem({ ...RAW, neighborhood_id: "nb3" }, neighborhoods)).toBeNull();
    expect(addressProblem({ ...RAW, neighborhood_id: "nb9" }, neighborhoods)).toBeNull();
  });
});

// ─── Rules.individual (rules_spec.rb) ──────────────────────────────────────
const WOMAN: PersonFacts = { sex: "female", birth_date: "1990-01-01", race_color: "03", ethnicity: null, mother_name_present: true };
const BASE: IndividualRulesInput = {
  identification: { nacionalidade_cidadao: 1, codigo_ibge_municipio_nascimento: "4106902", telefone_celular: "41999990000", desconhece_nome_pai: true },
  sociodemographic: { status_deseja_informar_orientacao_sexual: false, status_deseja_informar_identidade_genero: false },
  health_conditions: {}, street_situation: { status_situacao_rua: false }, refused: false, is_responsible: true
};
type Over = { [K in "identification" | "sociodemographic" | "health_conditions" | "street_situation"]?: Record<string, unknown> | null }
  & { is_responsible?: boolean; person?: Partial<PersonFacts> };
function rules(over: Over = {}) {
  const merge = (key: "identification" | "sociodemographic" | "health_conditions" | "street_situation") =>
    over[key] === null ? null : { ...(BASE[key] ?? {}), ...(over[key] ?? {}) };
  const input: IndividualRulesInput = { ...BASE, identification: merge("identification"), sociodemographic: merge("sociodemographic"),
    health_conditions: merge("health_conditions"), street_situation: merge("street_situation"), is_responsible: over.is_responsible ?? true };
  return pathOf(individualRulesProblem(input, { ...WOMAN, ...over.person }, T));
}
const REFUSED = (over: Partial<IndividualRulesInput> = {}): IndividualRulesInput =>
  ({ identification: {}, sociodemographic: null, health_conditions: null, street_situation: null, refused: true, is_responsible: true, ...over });
const NATURALIZED = { nacionalidade_cidadao: 2, codigo_ibge_municipio_nascimento: null, dt_naturalizacao: "2010-05-05", portaria_naturalizacao: "PORT 123/2010" };
const FOREIGN = { nacionalidade_cidadao: 3, codigo_ibge_municipio_nascimento: null, pais_nascimento: 45, dt_entrada_brasil: "2015-01-01" };

describe("Rules.individual — paridade (primeira recusa)", () => {
  it.each<[ string, Over, string | null ]>([
    [ "mínimo válido", {}, null ],
    [ "nascimento depois do atendimento", { person: { birth_date: "2026-10-24" } }, "birth_date" ],
    [ "nascimento há mais de 130 anos", { person: { birth_date: "1896-10-22" } }, "birth_date" ],
    [ "nascimento há 130 anos exatos", { person: { birth_date: "1896-10-23" } }, null ],
    [ "raça/cor ausente", { person: { race_color: null } }, "patient_demographics.race_color" ],
    [ "raça/cor fora do BPA", { person: { race_color: "06" } }, "patient_demographics.race_color" ],
    [ "indígena com etnia 0304 (PURI)", { person: { race_color: "05", ethnicity: "0304" } }, null ],
    [ "indígena com etnia sem código LEDI", { person: { race_color: "05", ethnicity: "0500" } }, "patient_demographics.ethnicity" ],
    [ "indígena sem etnia", { person: { race_color: "05", ethnicity: null } }, "patient_demographics.ethnicity" ],
    [ "etnia com outra raça/cor não é validada", { person: { ethnicity: "0500" } }, null ],
    [ "nacionalidade obrigatória", { identification: { nacionalidade_cidadao: null } }, "identification.nacionalidade_cidadao" ],
    [ "brasileiro sem município", { identification: { codigo_ibge_municipio_nascimento: null } }, "identification.codigo_ibge_municipio_nascimento" ],
    [ "estrangeiro sem país", { identification: { nacionalidade_cidadao: 3, codigo_ibge_municipio_nascimento: null } }, "identification.pais_nascimento" ],
    [ "município só com nacionalidade 1", { identification: { nacionalidade_cidadao: 3, pais_nascimento: 45, dt_entrada_brasil: "2015-01-01" } },
      "identification.codigo_ibge_municipio_nascimento" ],
    [ "brasileiro com país 31", { identification: { pais_nascimento: 31 } }, null ],
    [ "brasileiro com outro país", { identification: { pais_nascimento: 45 } }, "identification.pais_nascimento" ],
    [ "naturalizado completo", { identification: NATURALIZED }, null ],
    [ "naturalizado com país", { identification: { ...NATURALIZED, pais_nascimento: 45 } }, "identification.pais_nascimento" ],
    [ "naturalizado sem data", { identification: { ...NATURALIZED, dt_naturalizacao: null } }, "identification.dt_naturalizacao" ],
    [ "naturalizado sem portaria", { identification: { ...NATURALIZED, portaria_naturalizacao: null } }, "identification.portaria_naturalizacao" ],
    [ "naturalização no futuro", { identification: { ...NATURALIZED, dt_naturalizacao: "2026-10-24" } }, "identification.dt_naturalizacao" ],
    [ "naturalização antes do nascimento", { identification: { ...NATURALIZED, dt_naturalizacao: "1989-12-31" } }, "identification.dt_naturalizacao" ],
    [ "data de naturalização sem ser naturalizado", { identification: { dt_naturalizacao: "2010-05-05" } }, "identification.dt_naturalizacao" ],
    [ "portaria sem ser naturalizado", { identification: { portaria_naturalizacao: "PORT 1" } }, "identification.portaria_naturalizacao" ],
    [ "estrangeiro completo", { identification: FOREIGN }, null ],
    [ "estrangeiro sem entrada", { identification: { ...FOREIGN, dt_entrada_brasil: null } }, "identification.dt_entrada_brasil" ],
    [ "entrada no futuro", { identification: { ...FOREIGN, dt_entrada_brasil: "2026-10-24" } }, "identification.dt_entrada_brasil" ],
    [ "entrada antes do nascimento", { identification: { ...FOREIGN, dt_entrada_brasil: "1989-12-31" } }, "identification.dt_entrada_brasil" ],
    [ "entrada sem ser estrangeiro", { identification: { dt_entrada_brasil: "2015-01-01" } }, "identification.dt_entrada_brasil" ],
    [ "brasileiro sem celular", { identification: { telefone_celular: null } }, "identification.telefone_celular" ],
    [ "estrangeiro sem celular", { identification: { ...FOREIGN, telefone_celular: null } }, null ],
    [ "nome do pai com desconhece", { identification: { nome_pai_cidadao: "José da Silva" } }, "identification.nome_pai_cidadao" ],
    [ "sem nome do pai nem desconhece", { identification: { desconhece_nome_pai: false } }, "identification.nome_pai_cidadao" ],
    [ "nome do pai informado", { identification: { desconhece_nome_pai: false, nome_pai_cidadao: "José da Silva" } }, null ],
    [ "sem mãe nem desconhece", { person: { mother_name_present: false } }, "mother_name" ],
    [ "sem mãe com desconhece", { identification: { desconhece_nome_mae: true }, person: { mother_name_present: false } }, null ],
    [ "mãe com desconhece", { identification: { desconhece_nome_mae: true } }, "identification.desconhece_nome_mae" ],
    [ "e-mail sem extensão", { identification: { email_cidadao: "maria@posto" } }, "identification.email_cidadao" ],
    [ "e-mail certo", { identification: { email_cidadao: "maria@posto.gov.br" } }, null ],
    [ "deseja informar orientação ausente", { sociodemographic: { status_deseja_informar_orientacao_sexual: null } },
      "sociodemographic.status_deseja_informar_orientacao_sexual" ],
    [ "deseja informar identidade ausente", { sociodemographic: { status_deseja_informar_identidade_genero: null } },
      "sociodemographic.status_deseja_informar_identidade_genero" ],
    [ "sociodemográfico ausente", { sociodemographic: null }, "sociodemographic.status_deseja_informar_orientacao_sexual" ],
    [ "orientação obrigatória", { sociodemographic: { status_deseja_informar_orientacao_sexual: true } }, "sociodemographic.orientacao_sexual_cidadao" ],
    [ "orientação proibida", { sociodemographic: { orientacao_sexual_cidadao: 148 } }, "sociodemographic.orientacao_sexual_cidadao" ],
    [ "orientação informada", { sociodemographic: { status_deseja_informar_orientacao_sexual: true, orientacao_sexual_cidadao: 148 } }, null ],
    [ "identidade obrigatória", { sociodemographic: { status_deseja_informar_identidade_genero: true } }, "sociodemographic.identidade_genero_cidadao" ],
    [ "identidade proibida", { sociodemographic: { identidade_genero_cidadao: 201 } }, "sociodemographic.identidade_genero_cidadao" ],
    [ "CBO com 5", { sociodemographic: { ocupacao_codigo_cbo2002: "51510" } }, "sociodemographic.ocupacao_codigo_cbo2002" ],
    [ "CBO com minúscula", { sociodemographic: { ocupacao_codigo_cbo2002: "2231f8" } }, "sociodemographic.ocupacao_codigo_cbo2002" ],
    [ "CBO com símbolo", { sociodemographic: { ocupacao_codigo_cbo2002: "5151-0" } }, "sociodemographic.ocupacao_codigo_cbo2002" ],
    [ "CBO certo", { sociodemographic: { ocupacao_codigo_cbo2002: "2231F8" } }, null ],
    [ "deficiência sem lista", { sociodemographic: { status_tem_alguma_deficiencia: true } }, "sociodemographic.deficiencias_cidadao" ],
    [ "lista sem deficiência", { sociodemographic: { status_tem_alguma_deficiencia: false, deficiencias_cidadao: [ 12 ] } }, "sociodemographic.deficiencias_cidadao" ],
    [ "parentesco do responsável", { sociodemographic: { relacao_parentesco_cidadao: 138 } }, "sociodemographic.relacao_parentesco_cidadao" ],
    [ "parentesco de quem não é responsável", { sociodemographic: { relacao_parentesco_cidadao: 138 }, is_responsible: false }, null ],
    [ "responsável por criança aos 36", { sociodemographic: { responsavel_por_crianca: [ 1 ] } }, "sociodemographic.responsavel_por_crianca" ],
    [ "responsável por criança aos 9", { sociodemographic: { responsavel_por_crianca: [ 1 ] }, person: { birth_date: "2016-10-24" } }, null ],
    [ "responsável por criança aos 10", { sociodemographic: { responsavel_por_crianca: [ 1 ] }, person: { birth_date: "2016-10-23" } },
      "sociodemographic.responsavel_por_crianca" ],
    [ "povo tradicional sem ser membro", { sociodemographic: { status_membro_povo_comunidade_tradicional: false, co_povo_comunidade_tradicional: 157 } },
      "sociodemographic.co_povo_comunidade_tradicional" ],
    [ "só a 2ª pergunta de alimentação", { sociodemographic: { comeu_alguns_alimentos_que_tinha_dinheiro_acabou: true } },
      "sociodemographic.alimentos_acabaram_antes_ter_dinheiro_comprar_mais" ],
    [ "só a 1ª pergunta de alimentação", { sociodemographic: { alimentos_acabaram_antes_ter_dinheiro_comprar_mais: false } },
      "sociodemographic.comeu_alguns_alimentos_que_tinha_dinheiro_acabou" ],
    [ "gestante homem", { health_conditions: { status_eh_gestante: true }, person: { sex: "male" } }, "health_conditions.status_eh_gestante" ],
    [ "gestante (false) homem — errata 5.1", { health_conditions: { status_eh_gestante: false }, person: { sex: "male" } }, "health_conditions.status_eh_gestante" ],
    [ "gestante aos 66", { health_conditions: { status_eh_gestante: true }, person: { birth_date: "1960-01-01" } }, "health_conditions.status_eh_gestante" ],
    [ "gestante aos 8", { health_conditions: { status_eh_gestante: true }, person: { birth_date: "2018-01-01" } }, "health_conditions.status_eh_gestante" ],
    [ "gestante aos 36", { health_conditions: { status_eh_gestante: true } }, null ],
    [ "maternidade sem gestação", { health_conditions: { status_eh_gestante: false, maternidade_de_referencia: "Maternidade X" } },
      "health_conditions.maternidade_de_referencia" ],
    [ "cardíaca sem lista", { health_conditions: { status_teve_doenca_cardiaca: true } }, "health_conditions.doenca_cardiaca" ],
    [ "lista cardíaca sem doença", { health_conditions: { status_teve_doenca_cardiaca: false, doenca_cardiaca: [ 24 ] } }, "health_conditions.doenca_cardiaca" ],
    [ "respiratória sem lista", { health_conditions: { status_tem_doenca_respiratoria: true } }, "health_conditions.doenca_respiratoria" ],
    [ "lista respiratória sem doença", { health_conditions: { status_tem_doenca_respiratoria: false, doenca_respiratoria: [ 30 ] } },
      "health_conditions.doenca_respiratoria" ],
    [ "rins sem lista", { health_conditions: { status_tem_teve_doencas_rins: true } }, "health_conditions.doenca_rins" ],
    [ "lista rins sem doença", { health_conditions: { status_tem_teve_doencas_rins: false, doenca_rins: [ 27 ] } }, "health_conditions.doenca_rins" ],
    [ "causa sem internação", { health_conditions: { status_teve_internado_em12_meses: false, descricao_causa_internacao_em12_meses: "Pneumonia" } },
      "health_conditions.descricao_causa_internacao_em12_meses" ],
    [ "plantas sem uso", { health_conditions: { status_usa_planta_medicinais: false, descricao_plantas_medicinais_usadas: "Boldo" } },
      "health_conditions.descricao_plantas_medicinais_usadas" ],
    [ "situação de rua ausente", { street_situation: null }, "street_situation.status_situacao_rua" ],
    [ "tempo de rua fora da rua", { street_situation: { status_situacao_rua: false, tempo_situacao_rua: 17 } }, "street_situation.tempo_situacao_rua" ],
    [ "benefício fora da rua", { street_situation: { status_situacao_rua: false, status_recebe_beneficio: false } }, "street_situation.status_recebe_beneficio" ],
    [ "em situação de rua com tempo", { street_situation: { status_situacao_rua: true, tempo_situacao_rua: 17 } }, null ],
    [ "parente sem visita", { street_situation: { status_situacao_rua: true, status_visita_familiar_frequentemente: false, grau_parentesco_familiar_frequentado: "Irmã" } },
      "street_situation.grau_parentesco_familiar_frequentado" ],
    [ "higiene sem lista", { street_situation: { status_situacao_rua: true, status_tem_acesso_higiene_pessoal_situacao_rua: true } },
      "street_situation.higiene_pessoal_situacao_rua" ],
    [ "outra instituição sem acompanhamento", { street_situation: { status_situacao_rua: true, status_acompanhado_por_outra_instituicao: false, outra_instituicao_que_acompanha: "CAPS" } },
      "street_situation.outra_instituicao_que_acompanha" ]
  ])("%s", (_name, over, path) => {
    expect(rules(over)).toBe(path);
  });

  it("recusa do termo: identificação opcional; seções proibidas, pelo nome da seção", () => {
    expect(individualRulesProblem(REFUSED(), { ...WOMAN, race_color: null, mother_name_present: false }, T)).toBeNull();
    expect(pathOf(individualRulesProblem(REFUSED({ identification: BASE.identification, sociodemographic: { status_frequenta_escola: true } }), WOMAN, T)))
      .toBe("sociodemographic");
    expect(pathOf(individualRulesProblem(REFUSED({ health_conditions: { status_eh_fumante: true } }), WOMAN, T))).toBe("health_conditions");
    expect(individualRulesProblem(REFUSED({ street_situation: { status_situacao_rua: false } }), WOMAN, T))
      .toEqual({ path: "street_situation", message: "com recusa, esta parte da ficha não vai" });
  });

  it("frases das recusas mais comuns", () => {
    const msg = (over: Over) => {
      const p = individualRulesProblem({ ...BASE, ...over } as IndividualRulesInput, { ...WOMAN, ...over.person }, T);
      return p?.message;
    };
    expect(msg({ health_conditions: { status_eh_gestante: true }, person: { sex: "male" } })).toBe("gestante só para sexo feminino entre 9 e 60 anos");
    expect(msg({ street_situation: null })).toBe("diga se está em situação de rua");
    expect(msg({ person: { mother_name_present: false } })).toBe("informe o nome da mãe ou marque que não sabe");
    expect(msg({ person: { race_color: "05", ethnicity: null } })).toBe("raça/cor indígena pede a etnia da lista");
  });

  it("fato desconhecido do paciente (undefined) não recusa: o api confere", () => {
    const unknown: PersonFacts = { sex: undefined, birth_date: undefined, race_color: undefined, ethnicity: undefined, mother_name_present: undefined };
    expect(individualRulesProblem({ ...BASE, health_conditions: { status_eh_gestante: true } }, unknown, T)).toBeNull();
  });
});

// ─── Rules.household / Rules.family ────────────────────────────────────────
const HOME = { property_type: "1", living_conditions: { localizacao: 83, situacao_moradia_posse_terra: 75 }, refused: false, contact_phone: null };
const SHELTER = { property_type: "7", living_conditions: { localizacao: 83, instituicao_permanencia: { nome_responsavel_tecnico: "Ana Maria Souza" } },
  refused: false, contact_phone: null };
type Hh = typeof HOME | typeof SHELTER | { property_type: string; living_conditions: Record<string, unknown> | null; refused: boolean; contact_phone: string | null };
const hpath = (input: Hh, families: { members_count: number | null; responsible_patient_id?: string | null }[] = []) =>
  pathOf(householdRulesProblem(input, families));
const living = (base: Hh, extra: Record<string, unknown>) => ({ ...base, living_conditions: { ...(base.living_conditions ?? {}), ...extra } });

describe("Rules.household — paridade", () => {
  it("aceita domicílio, abrigo com instituição, comércio sem moradia e recusa sem moradia", () => {
    expect(hpath(HOME, [ { members_count: 2 } ])).toBeNull();
    expect(hpath(SHELTER)).toBeNull();
    expect(hpath({ property_type: "2", living_conditions: null, refused: false, contact_phone: null })).toBeNull();
    expect(hpath({ property_type: "1", living_conditions: null, refused: true, contact_phone: null })).toBeNull();
  });

  it.each<[ string, Hh, { members_count: number | null; responsible_patient_id?: string }[], string ]>([
    [ "moradia em comércio", { property_type: "2", living_conditions: { localizacao: 83 }, refused: false, contact_phone: null }, [], "living_conditions" ],
    [ "família em comércio", { property_type: "2", living_conditions: null, refused: false, contact_phone: null }, [ { members_count: 2 } ], "families" ],
    [ "moradores < membros", living(HOME, { nu_moradores: 2 }), [ { members_count: 3 } ], "living_conditions.nu_moradores" ],
    [ "tipo 14", { ...HOME, property_type: "14" }, [], "property_type" ],
    [ "recusa com moradia", { ...HOME, refused: true }, [], "living_conditions" ],
    [ "recusa com família", { ...HOME, refused: true, living_conditions: null }, [ { members_count: 1 } ], "families" ],
    [ "mesmo responsável", HOME, [ { members_count: 1, responsible_patient_id: "p1" }, { members_count: 1, responsible_patient_id: "p1" } ], "families" ],
    [ "abrigo sem instituição", { ...SHELTER, living_conditions: { localizacao: 83 } }, [], "living_conditions.instituicao_permanencia" ],
    [ "delegacia sem moradia", { ...SHELTER, property_type: "11", living_conditions: null }, [], "living_conditions.instituicao_permanencia" ],
    [ "instituição em domicílio", living(HOME, { instituicao_permanencia: { nome_responsavel_tecnico: "Ana Maria Souza" } }), [],
      "living_conditions.instituicao_permanencia" ],
    [ "abrigo com produção rural", living(SHELTER, { localizacao: 84, area_producao_rural: 101 }), [], "living_conditions.area_producao_rural" ],
    [ "abrigo com cômodos", living(SHELTER, { localizacao: 84, nu_comodos: 3 }), [], "living_conditions.nu_comodos" ],
    [ "abrigo com situação de moradia", living(SHELTER, { localizacao: 84, situacao_moradia_posse_terra: 75 }), [], "living_conditions.situacao_moradia_posse_terra" ],
    [ "CASAI com moradia", { property_type: "13", living_conditions: { localizacao: 84, tipo_domicilio: 85 }, refused: false, contact_phone: null }, [], "living_conditions" ],
    [ "sem localização", { ...HOME, living_conditions: { situacao_moradia_posse_terra: 75 } }, [], "living_conditions.localizacao" ],
    [ "sem situação de moradia", { ...HOME, living_conditions: { localizacao: 83 } }, [], "living_conditions.situacao_moradia_posse_terra" ],
    [ "abrigo com status de animais", living(SHELTER, { st_animais_no_domicilio: false }), [], "living_conditions.st_animais_no_domicilio" ],
    [ "abrigo com animais", living(SHELTER, { animais_no_domicilio: [ 128 ] }), [], "living_conditions.animais_no_domicilio" ],
    [ "abrigo com quantos animais", living(SHELTER, { quantos_animais_no_domicilio: 1 }), [], "living_conditions.quantos_animais_no_domicilio" ],
    [ "lista sem animais", living(HOME, { st_animais_no_domicilio: false, animais_no_domicilio: [ 128 ] }), [], "living_conditions.animais_no_domicilio" ],
    [ "quantos sem animais", living(HOME, { st_animais_no_domicilio: false, quantos_animais_no_domicilio: 1 }), [], "living_conditions.quantos_animais_no_domicilio" ],
    [ "quantos < espécies", living(HOME, { st_animais_no_domicilio: true, animais_no_domicilio: [ 128, 129 ], quantos_animais_no_domicilio: 1 }), [],
      "living_conditions.quantos_animais_no_domicilio" ],
    [ "produção rural urbana", living(HOME, { localizacao: 83, area_producao_rural: 101 }), [], "living_conditions.area_producao_rural" ],
    [ "produção rural periurbana", living(HOME, { localizacao: 205, area_producao_rural: 101 }), [], "living_conditions.area_producao_rural" ],
    [ "origem da energia sem energia", living(HOME, { st_disponibilidade_energia_eletrica: false, tipo_origem_energia_eletrica: 230 }), [],
      "living_conditions.tipo_origem_energia_eletrica" ],
    [ "moradores < famílias", living(HOME, { nu_moradores: 2 }), [ { members_count: null }, { members_count: null }, { members_count: null } ],
      "living_conditions.nu_moradores" ],
    [ "telefone curto", { ...HOME, contact_phone: "419999" }, [], "contact_phone" ]
  ])("%s", (_name, input, families, path) => {
    expect(hpath(input, families)).toBe(path);
  });

  it.each([ "2", "3", "4", "5", "6", "12", "13", "99" ])("moradia proibida no tipo %s", (type) => {
    expect(hpath({ ...HOME, property_type: type })).toBe("living_conditions");
  });

  it("casos aceitos", () => {
    expect(hpath(living(HOME, { st_animais_no_domicilio: true, animais_no_domicilio: [ 128, 129 ], quantos_animais_no_domicilio: 3 }))).toBeNull();
    expect(hpath(living(HOME, { localizacao: 84, area_producao_rural: 101 }))).toBeNull();
    expect(hpath(living(HOME, { nu_moradores: 2 }), [ { members_count: null }, { members_count: 1 } ])).toBeNull();
    expect(hpath({ ...HOME, contact_phone: "4133334444" })).toBeNull();
  });
});

describe("Rules.family — paridade", () => {
  const FAM = { members_count: 3, income_band: "3", living_since: "2020-03" };
  it.each<[ string, Record<string, unknown>, string, string | null ]>([
    [ "família do contrato", FAM, "1", null ],
    [ "tudo vazio", { members_count: null, income_band: null, living_since: null }, "1", null ],
    [ "em comércio", FAM, "2", "property_type" ],
    [ "0 membros", { ...FAM, members_count: 0 }, "1", "members_count" ],
    [ "1000 membros", { ...FAM, members_count: 1000 }, "1", "members_count" ],
    [ "membros em texto", { ...FAM, members_count: "3" }, "1", "members_count" ],
    [ "renda 9", { ...FAM, income_band: "9" }, "1", "income_band" ],
    [ "renda número", { ...FAM, income_band: 3 }, "1", "income_band" ],
    [ "mês 13", { ...FAM, living_since: "2020-13" }, "1", "living_since" ],
    [ "mês que vem", { ...FAM, living_since: "2026-11" }, "1", "living_since" ],
    [ "este mês", { ...FAM, living_since: "2026-10" }, "1", null ]
  ])("%s", (_name, input, type, path) => {
    expect(pathOf(familyRulesProblem(input, type, T))).toBe(path);
  });
});

// ─── Composições na ordem do api ───────────────────────────────────────────
const ADDRESS = { zip: "81020000", street_type: "081", street: "das Flores", number: "120", no_number: false, complement: null,
  neighborhood_id: "nb1", district: null, reference: null };
const HH: HouseholdInput = { micro_area_id: "ma1", address: ADDRESS, property_type: "1",
  living_conditions: { localizacao: 83, situacao_moradia_posse_terra: 75, nu_comodos: 4, nu_moradores: 3 }, contact_phone: null, refused: false };

describe("domicílio (SaveHousehold: endereço → dicionário da moradia → regras)", () => {
  it("moradia para 01 e 07–11; família só para 01; instituição só 07–11; campos por tipo", () => {
    expect([ "1", "7", "8", "9", "10", "11" ].every(allowsLivingConditions)).toBe(true);
    expect([ "2", "3", "4", "5", "6", "12", "13", "99", "14" ].some(allowsLivingConditions)).toBe(false);
    expect(allowsFamilies("1")).toBe(true);
    expect(allowsFamilies("7")).toBe(false);
    expect([ "7", "11" ].every(requiresInstitution)).toBe(true);
    expect(requiresInstitution("1")).toBe(false);
    expect(livingFieldAllowed("7", "nu_comodos")).toBe(false);
    expect(livingFieldAllowed("7", "situacao_moradia_posse_terra")).toBe(false);
    expect(livingFieldAllowed("7", "st_animais_no_domicilio")).toBe(false);
    expect(livingFieldAllowed("7", "instituicao_permanencia")).toBe(true);
    expect(livingFieldAllowed("1", "instituicao_permanencia")).toBe(false);
    expect(livingFieldAllowed("1", "nu_comodos")).toBe(true);
  });

  it("caminho feliz e a primeira recusa na ordem do api", () => {
    expect(householdProblem(HH, [])).toBeNull();
    // endereço antes da moradia antes das regras
    expect(pathOf(householdProblem({ ...HH, address: { ...ADDRESS, zip: "1" }, property_type: "2" }, []))).toBe("address.zip");
    expect(pathOf(householdProblem({ ...HH, living_conditions: { nu_comodos: 0 }, contact_phone: "41" }, []))).toBe("living_conditions.nu_comodos");
    expect(householdProblem({ ...HH, living_conditions: { ...HH.living_conditions, nu_comodos: 0 } }, []))
      .toEqual({ path: "living_conditions.nu_comodos", message: "informe um número inteiro maior que zero" });
    expect(householdProblem({ ...HH, property_type: "2" }, [])).toEqual({ path: "living_conditions", message: "este tipo de imóvel não leva condições de moradia" });
    expect(householdProblem({ ...HH, contact_phone: "4199" }, [])).toEqual({ path: "contact_phone", message: "telefone com DDD: 10 ou 11 dígitos" });
    expect(householdProblem({ ...HH, contact_phone: "" }, [])).toBeNull();
  });

  it("sem recusa o endereço é obrigatório; com recusa, só o endereço (se vier)", () => {
    expect(pathOf(householdProblem({ ...HH, address: null }, []))).toBe("address");
    expect(householdProblem({ ...HH, refused: true, address: null, living_conditions: null }, [])).toBeNull();
    expect(pathOf(householdProblem({ ...HH, refused: true, address: { ...ADDRESS, street: "" }, living_conditions: null }, []))).toBe("address.street");
    expect(householdProblem({ ...HH, refused: true }, [])).toEqual({ path: "living_conditions", message: "com recusa, o domicílio leva só o endereço" });
  });

  it("moradores ≥ soma das famílias ativas (mudadas não contam)", () => {
    const fam = { members_count: 4, moved_out: false, responsible: { patient_id: "pa1" } };
    expect(householdProblem(HH, [ fam ])).toEqual({ path: "living_conditions.nu_moradores", message: "moradores menos que a soma das famílias (4)" });
    expect(householdProblem(HH, [ { ...fam, moved_out: true } ])).toBeNull();
    expect(householdProblem(HH, [ { ...fam, members_count: 3 } ])).toBeNull();
  });

  it("bairro inutilizável vindo da lista do módulo 11", () => {
    const neighborhoods = [ { id: "nb1", name: "Jardim", active: false } ];
    expect(pathOf(householdProblem(HH, [], { neighborhoods }))).toBe("address.neighborhood_id");
  });
});

describe("família (SaveFamily: responsável → mudança → regras)", () => {
  const FAM = { responsible: { patient_id: "pa1" }, income_band: "3", members_count: 3, living_since: "2019-05" };
  it.each<[ string, Parameters<typeof familyProblem>[0], boolean, string | null, string | null ]>([
    [ "nova completa", FAM, true, null, null ],
    [ "nova sem responsável", { ...FAM, responsible: undefined }, true, "responsible.patient_id", "escolha o responsável" ],
    [ "nova já mudada", { ...FAM, moved_out: true }, true, "moved_out", "a família nasce morando no domicílio" ],
    [ "edição sem responsável", { ...FAM, responsible: undefined }, false, null, null ],
    [ "0 membros", { ...FAM, members_count: 0 }, true, "members_count", "número de membros de 1 a 999" ],
    [ "renda fora", { ...FAM, income_band: "9" }, true, "income_band", "escolha a renda da lista" ],
    [ "reside desde futuro", { ...FAM, living_since: "2026-11" }, true, "living_since", "reside desde depois deste mês" ],
    [ "reside desde inválido", { ...FAM, living_since: "2019-5" }, true, "living_since", "mês e ano no formato AAAA-MM" ]
  ])("%s", (_name, input, isNew, path, message) => {
    expect(familyProblem(input, { propertyType: "1", today: T, isNew })).toEqual(path ? { path, message } : null);
  });
  it("família só em domicílio", () => {
    expect(familyProblem(FAM, { propertyType: "7", today: T, isNew: true }))
      .toEqual({ path: "property_type", message: "só domicílio (tipo 01) tem famílias" });
  });
});

const IDENT = { nacionalidade_cidadao: 1, codigo_ibge_municipio_nascimento: "4106902", telefone_celular: "41999990000", desconhece_nome_pai: true };
const SECTIONS_OK = {
  identification: IDENT,
  sociodemographic: { status_deseja_informar_orientacao_sexual: false, status_deseja_informar_identidade_genero: false },
  health_conditions: {}, street_situation: { status_situacao_rua: false }
};
const NEW: NewPatient = { full_name: "José das Dores", birth_date: "1990-01-10", sex: "male", mother_name: "Maria das Dores", cpf: "52998224725" };
const fresh = (over: Partial<RegistrationDraft> = {}, patient: Partial<NewPatient> = {}): RegistrationDraft =>
  ({ new_patient: { ...NEW, ...patient }, patient_demographics: { race_color: "03" }, household_id: "hh1", family_id: "fa1",
    is_responsible: true, refused: false, ...SECTIONS_OK, ...over });

describe("cadastro individual (SaveRegistration: seções → identidade → raça/cor → paciente novo → regras)", () => {
  it("o corpo real é um rascunho válido (tipos) e o caminho feliz não recusa", () => {
    const body: RegistrationInput = { new_patient: NEW, patient_demographics: { race_color: "03" }, household_id: "hh1", is_responsible: false,
      refused: false, ...SECTIONS_OK };
    expect(registrationProblem(body, T)).toBeNull();
    expect(registrationProblem(fresh(), T)).toBeNull();
  });

  it.each<[ string, RegistrationDraft, string, string ]>([
    [ "sem CPF nem motivo", fresh({}, { cpf: null }), "new_patient.no_cpf_reason", "sem CPF, informe o motivo" ],
    [ "CPF e motivo juntos", fresh({}, { no_cpf_reason: "3" }), "new_patient.no_cpf_reason", "com CPF, não informe o motivo de não ter CPF" ],
    [ "motivo fora da lista", fresh({}, { cpf: null, no_cpf_reason: "1" }), "new_patient.no_cpf_reason", "escolha o motivo da lista" ],
    [ "CPF inválido", fresh({}, { cpf: "52998224724" }), "new_patient.cpf", "CPF inválido: confira os 11 dígitos" ],
    [ "CNS inválido", fresh({}, { cpf: null, no_cpf_reason: "3", cns: "123" }), "new_patient.cns", "CNS inválido: confira os 15 dígitos" ],
    [ "nome de um termo", fresh({}, { full_name: "José" }), "new_patient.full_name",
      "nome de 3 a 70 letras, com nome e sobrenome, sem números nem símbolos" ],
    [ "mãe curta", fresh({}, { mother_name: "Al" }), "new_patient.mother_name", "nome de 3 a 70 letras, com nome e sobrenome, sem números nem símbolos" ],
    [ "nascimento futuro", fresh({}, { birth_date: "2026-10-24" }), "new_patient.birth_date", "nascimento depois de hoje" ],
    [ "sem raça/cor", fresh({ patient_demographics: {} }), "patient_demographics.race_color", "informe a raça/cor" ],
    [ "indígena sem etnia", fresh({ patient_demographics: { race_color: "05" } }), "patient_demographics.ethnicity", "raça/cor indígena pede a etnia da lista" ],
    [ "etnia mal formada", fresh({ patient_demographics: { race_color: "05", ethnicity: "12" } }), "patient_demographics.ethnicity",
      "etnia: código de 4 dígitos da lista" ],
    [ "sem mãe nem desconhece", fresh({}, { mother_name: null }), "new_patient.mother_name", "informe o nome da mãe ou marque que não sabe" ],
    [ "gestante homem (errata: nem false)", fresh({ health_conditions: { status_eh_gestante: false } }), "health_conditions.status_eh_gestante",
      "gestante só para sexo feminino entre 9 e 60 anos" ],
    [ "situação de rua ausente", fresh({ street_situation: null }), "street_situation.status_situacao_rua", "diga se está em situação de rua" ],
    [ "tempo de rua fora da rua", fresh({ street_situation: { status_situacao_rua: false, tempo_situacao_rua: 17 } }), "street_situation.tempo_situacao_rua",
      "só para quem está em situação de rua" ],
    [ "parentesco do responsável", fresh({ sociodemographic: { ...SECTIONS_OK.sociodemographic, relacao_parentesco_cidadao: 137 } }),
      "sociodemographic.relacao_parentesco_cidadao", "parentesco só para quem não é o responsável da família" ],
    [ "município de 6 dígitos", fresh({ identification: { ...IDENT, codigo_ibge_municipio_nascimento: "410690" } }),
      "identification.codigo_ibge_municipio_nascimento", "só números, 7 dígitos" ]
  ])("recusa: %s", (_name, draft, path, message) => {
    expect(registrationProblem(draft, T)).toEqual({ path, message });
  });

  it("a ordem do api: seção antes de raça/cor, raça/cor antes do paciente novo, paciente novo antes das regras", () => {
    const bad = fresh({ patient_demographics: { race_color: "09" }, street_situation: null }, { full_name: "José" });
    expect(pathOf(registrationProblem({ ...bad, identification: { ...IDENT, telefone_celular: "41" } }, T))).toBe("identification.telefone_celular");
    expect(pathOf(registrationProblem(bad, T))).toBe("patient_demographics.race_color");
    expect(pathOf(registrationProblem({ ...bad, patient_demographics: { race_color: "03" } }, T))).toBe("new_patient.full_name");
    expect(pathOf(registrationProblem({ ...bad, patient_demographics: { race_color: "03" } }, T, null))).toBe("new_patient.full_name");
  });

  it("sem CPF com motivo e CNS válido grava; sem CPF e sem CNS também (a ficha fica 'sem identificador', L5)", () => {
    expect(registrationProblem(fresh({}, { cpf: null, no_cpf_reason: "3", cns: "700000000000005" }), T)).toBeNull();
    expect(registrationProblem(fresh({}, { cpf: null, no_cpf_reason: "3" }), T)).toBeNull();
  });

  it("recusa: só identificação e refused; com seções vindo, a seção recusada", () => {
    const refused: RegistrationDraft = { new_patient: NEW, refused: true, household_id: "hh1", is_responsible: false, identification: {} };
    expect(registrationProblem(refused, T)).toBeNull();
    expect(registrationProblem({ ...refused, health_conditions: { status_eh_gestante: true } }, T))
      .toEqual({ path: "health_conditions", message: "com recusa, esta parte da ficha não vai" });
  });

  it("paciente existente: identidade digitada em patient.*, CPF/CNS na raiz, fatos do servidor", () => {
    const current = patientFacts(registration());
    expect(current).toEqual({ sex: "female", birth_date: "1968-04-12", race_color: "03", ethnicity: null, mother_name_present: true });
    const existing: RegistrationDraft = { patient_id: "pa1", household_id: "hh1", family_id: "fa1", is_responsible: true, refused: false, ...SECTIONS_OK };
    expect(registrationProblem(existing, T, current)).toBeNull();
    // 58 anos na data: gestante vale; o nascimento digitado em patient.* passa a valer para a regra.
    expect(registrationProblem({ ...existing, health_conditions: { status_eh_gestante: true } }, T, current)).toBeNull();
    expect(registrationProblem({ ...existing, health_conditions: { status_eh_gestante: true }, patient: { birth_date: "1960-02-01" } }, T, current))
      .toEqual({ path: "health_conditions.status_eh_gestante", message: "gestante só para sexo feminino entre 9 e 60 anos" });
    expect(pathOf(registrationProblem({ ...existing, health_conditions: { status_eh_gestante: true } }, T, { ...current, sex: "male" })))
      .toBe("health_conditions.status_eh_gestante");
    expect(pathOf(registrationProblem({ ...existing, patient: { mother_name: "" } }, T, { ...current, mother_name_present: false })))
      .toBe("patient.mother_name");
    expect(pathOf(registrationProblem({ ...existing, patient: { full_name: "" } }, T, current))).toBe("patient.full_name");
    expect(pathOf(registrationProblem({ ...existing, patient: { sex: "x" as "male" } }, T, current))).toBe("patient.sex");
    expect(pathOf(registrationProblem({ ...existing, patient: { birth_date: "2026-10-24" } }, T, current))).toBe("patient.birth_date");
    expect(registrationProblem({ ...existing, cpf: "52998224724" }, T, current)).toEqual({ path: "cpf", message: "CPF inválido: confira os 11 dígitos" });
    expect(registrationProblem({ ...existing, cns: "123" }, T, current)).toEqual({ path: "cns", message: "CNS inválido: confira os 15 dígitos" });
    expect(registrationProblem({ ...existing, cpf: "" }, T, current)).toBeNull();
  });

  it("paciente sem fatos conhecidos (par validado, citizen_id): o que depende dele fica com o api", () => {
    const byCitizen: RegistrationDraft = { citizen_id: "ci1", household_id: "hh1", is_responsible: false, refused: false, ...SECTIONS_OK };
    expect(registrationProblem(byCitizen, T)).toBeNull();
    expect(registrationProblem({ ...byCitizen, health_conditions: { status_eh_gestante: true } }, T)).toBeNull();
  });
});

describe("gestante e saída", () => {
  it("gestante: não masculino, de 9 a 60 anos na data", () => {
    expect(canBePregnant("female", "2000-01-01", T)).toBe(true);
    expect(canBePregnant("female", "2017-10-23", T)).toBe(true);
    expect(canBePregnant("female", "2017-10-24", T)).toBe(false);
    expect(canBePregnant("female", "1965-10-24", T)).toBe(true);
    expect(canBePregnant("female", "1965-10-23", T)).toBe(false);
    expect(canBePregnant("male", "2000-01-01", T)).toBe(false);
    expect(canBePregnant("female", null, T)).toBe(false);
  });

  it("saída: datas entre o nascimento e hoje; data do óbito só e sempre no óbito; DO de 9 dígitos", () => {
    const B = "1940-01-01";
    expect(exitProblem({ reason: "death", on: "2026-10-20", death_on: "2026-10-19" }, B, T)).toBeNull();
    expect(exitProblem({ reason: "moved", on: "2026-10-20" }, B, T)).toBeNull();
    expect(exitProblem({ reason: "death", on: "2026-10-20", death_on: "2026-10-19", death_certificate: "123456789" }, B, T)).toBeNull();
    expect(exitProblem({ reason: "x", on: "2026-10-20" }, B, T)).toEqual({ path: "reason", message: "escolha o motivo da saída" });
    expect(exitProblem({ reason: "moved", on: "" }, B, T)).toEqual({ path: "on", message: "informe a data da saída" });
    expect(exitProblem({ reason: "moved", on: "2026-10-24" }, B, T)).toEqual({ path: "on", message: "data depois de hoje" });
    expect(exitProblem({ reason: "moved", on: "1939-12-31" }, B, T)).toEqual({ path: "on", message: "data antes do nascimento" });
    expect(exitProblem({ reason: "death", on: "2026-10-20" }, B, T)).toEqual({ path: "death_on", message: "informe a data do óbito" });
    expect(exitProblem({ reason: "death", on: "2026-10-20", death_on: "2026-10-24" }, B, T))
      .toEqual({ path: "death_on", message: "data do óbito depois de hoje" });
    expect(exitProblem({ reason: "moved", on: "2026-10-20", death_on: "2026-10-19" }, B, T))
      .toEqual({ path: "death_on", message: "data do óbito só no óbito" });
    expect(exitProblem({ reason: "death", on: "2026-10-20", death_on: "2026-10-19", death_certificate: "12345" }, B, T))
      .toEqual({ path: "death_certificate", message: "declaração de óbito com 9 dígitos" });
    expect(exitProblem({ reason: "moved", on: "2026-10-20", death_certificate: "123456789" }, B, T))
      .toEqual({ path: "death_certificate", message: "declaração de óbito só no óbito" });
    expect(exitProblem({ reason: "moved", on: "1939-12-31" }, null, T)).toBeNull();
  });
});
