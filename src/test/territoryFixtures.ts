// src/test/territoryFixtures.ts
// Dados comuns aos testes do módulo 24a (cadastro territorial), nas formas do
// api REAL (apps/api, mod24a: TerritoryRegistry::Json). Nomes fictícios;
// semente realista: tipo de logradouro DNE "081" (Rua) com o nome sem o tipo,
// tipo de imóvel e renda como texto, códigos LEDI inteiros, sexo em texto,
// CNS só mascarado. Cada arquivo de teste faz o próprio vi.mock("…/lib/api").
import type { Family, Household, MicroArea, PersonRow, Registration, SessionUser, TerritoryAdminTeam, TerritoryContext } from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const TODAY24 = "2026-10-23";
export const TEAM_ESF = { id: "tm1", ine: "0001234567", name: "ESF Vila Verde" };
export const TEAM_EAP = { id: "tm2", ine: "0001234575", name: "EAP Boqueirão" };
export const ACS_ANA = { professional_id: "pr1", name: "Ana Prado" };

export function territoryUser(roles: string[] = [ "health_professional" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, { id: "us24", email_address: "acs@curitiba.demo", features: [ "clinical_record", "territory_registry" ], ...over });
}

export function microArea(over: Partial<MicroArea> = {}): MicroArea {
  return { id: "ma1", team: TEAM_ESF, code: "01", name: "Vila Verde de cima", acs: ACS_ANA, active: true, ...over };
}

export function adminTeam(over: Partial<TerritoryAdminTeam> = {}): TerritoryAdminTeam {
  return { ...TEAM_ESF, kind: "70", unit: { id: "u1", name: "UBS Vila Verde" },
    acs_candidates: [ { ...ACS_ANA, has_cns: true }, { professional_id: "pr2", name: "Bruno Lima", has_cns: false } ], ...over };
}

// A microárea 02 é de outro ACS (can_register false para a Ana); a Ana não lê a equipe toda (L27).
export function territoryContext(over: Partial<TerritoryContext> = {}): TerritoryContext {
  return { teams: [ { ...TEAM_ESF, unit: { id: "u1", name: "UBS Vila Verde" }, reads_whole_team: false,
    micro_areas: [ { ...microArea(), can_register: true },
      { ...microArea({ id: "ma2", code: "02", name: "Vila Verde de baixo", acs: { professional_id: "pr3", name: "Carla Mendes" } }), can_register: false } ]
  } ], ...over };
}

export function family(over: Partial<Family> = {}): Family {
  return { id: "fa1", responsible: { patient_id: "pa1", display_name: "Maria das Dores" }, income_band: "3", members_count: 3,
    living_since: "2019-05", moved_out: false, responsible_exited: false, ...over };
}

export function household(over: Partial<Household> = {}): Household {
  return {
    id: "hh1", micro_area: { id: "ma1", code: "01" },
    address: { zip: "81020000", street_type: "081", street: "das Flores", number: "120", no_number: false, complement: null,
      neighborhood_id: "nb1", district: null, reference: "perto da escola" },
    property_type: "1",
    living_conditions: { localizacao: 83, situacao_moradia_posse_terra: 75, nu_comodos: 4, nu_moradores: 3, st_disponibilidade_energia_eletrica: true },
    contact_phone: "41999990000", refused: false, status: "active", version: 2, registered_at: "2026-03-02T10:00:00-03:00",
    registered_by: { name: "Ana Prado" }, families: [ family() ], ...over
  };
}

export function registration(over: Partial<Registration> = {}): Registration {
  return {
    id: "rg1",
    patient: { id: "pa1", display_name: "Maria das Dores", full_name: "Maria das Dores", mother_name: "Joana das Dores",
      birth_date: "1968-04-12", sex: "female", has_cpf: true, no_cpf_reason: null, cns_masked: "*** **** **** 0004", identity_locked: true },
    patient_demographics: { race_color: "03", ethnicity: null },
    household_id: "hh1", family_id: "fa1", is_responsible: true, team: TEAM_ESF, micro_area: { id: "ma1", code: "01" },
    identification: { nacionalidade_cidadao: 1, codigo_ibge_municipio_nascimento: "4106902", pais_nascimento: 31,
      telefone_celular: "41999990000", desconhece_nome_pai: true },
    sociodemographic: { grau_instrucao_cidadao: 56, status_deseja_informar_orientacao_sexual: false,
      status_deseja_informar_identidade_genero: false },
    health_conditions: { status_tem_diabetes: true, status_tem_hipertensao_arterial: true },
    street_situation: { status_situacao_rua: false },
    refused: false, exit: null, status: "valid", version: 1, registered_at: "2026-03-02T10:00:00-03:00",
    registered_by: { name: "Ana Prado" }, identity_changed_at: null, identity_review_pending: false, ...over
  };
}

// Paciente criado pelo CPF a partir de par validado sem perfil (Patients::Resolve):
// sem nome, nascimento e sexo. As telas mostram o que houver, sem quebrar.
export function profilelessRegistration(over: Partial<Registration> = {}): Registration {
  const base = registration();
  return registration({
    id: "rg4", status: "valid", is_responsible: false, family_id: null,
    patient: { ...base.patient, id: "pa4", display_name: null, full_name: null, mother_name: null, birth_date: null, sex: null,
      has_cpf: true, cns_masked: null, identity_locked: true },
    ...over
  });
}

export function personRow(over: Partial<PersonRow> = {}): PersonRow {
  return { patient_id: "pa3", citizen_id: null, display_name: "Joaquim Ribeiro", age: 71, micro_area_code: "01", status: "expired",
    registered_at: "2024-09-01T10:00:00-03:00", registration_id: "rg3", identity_review_pending: false, ...over };
}
