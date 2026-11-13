// Dados dos testes do módulo 24b (visita domiciliar e atividade coletiva). Agora: quinta, 2026-11-12, 10h.
// Formas do api real (preflight-reconciliation §2.1, não as do plano). Códigos e rótulos copiados de
// apps/api/config/ledi/visit_activity_dictionaries.yml (Q39): a tela nunca escreve rótulo à mão.
import type {
  CollectiveActivity, CollectiveActivitySummary, CollectiveDomains, CollectiveOptions, FieldAssignment, FieldDevice, HomeVisit,
  HomeVisitContext, HomeVisitDay, HomeVisitDomains, HomeVisitTeam, SessionUser, VisitCandidate, VisitHousehold, VisitHouseholdDetail,
  VisitPerson, WhoToVisitItem
} from "../lib/api";
import { DOMAINS } from "../lib/territoryDictionaries.generated";
import { sessionWith } from "./campaignFixtures";

export const NOW24B = new Date("2026-11-12T10:00:00-03:00");
export const TODAY24B = "2026-11-12";
const ALL = [ "clinical_record", "territory_registry", "home_visits", "collective_activities" ];
export const hvUser = (roles: string[] = [ "health_professional" ], features: string[] = ALL): SessionUser => sessionWith(roles, { features });

const GROUP_LABEL = {
  TIPO_VISITA: "Tipo de visita", BUSCA_ATIVA: "Busca ativa", ACOMPANHAMENTO: "Acompanhamento",
  CONTROLE_AMBIENTAL_E_VETORIAL: "Controle ambiental e vetorial", OUTROS: "Outros"
} as const;
const M = (group: keyof typeof GROUP_LABEL, rows: [ number, string ][]) =>
  rows.map(([ code, label ]) => ({ code, label, group, group_label: GROUP_LABEL[group] }));

export const VISIT_DOMAINS: HomeVisitDomains = {
  motivo_visita: [
    ...M("TIPO_VISITA", [ [ 1, "Cadastramento / Atualização" ], [ 29, "Visita periódica" ] ]),
    ...M("BUSCA_ATIVA", [ [ 2, "Consulta" ], [ 3, "Exame" ], [ 4, "Vacina" ], [ 30, "Condicionalidades do bolsa família" ] ]),
    ...M("ACOMPANHAMENTO", [
      [ 5, "Gestante" ], [ 6, "Puérpera" ], [ 7, "Recém-nascido" ], [ 8, "Criança" ], [ 9, "Pessoa com desnutrição" ],
      [ 10, "Pessoa em reabilitação ou com deficiência" ], [ 11, "Pessoa com hipertensão" ], [ 12, "Pessoa com diabetes" ],
      [ 13, "Pessoa com asma" ], [ 14, "Pessoa com DPOC / enfisema" ], [ 15, "Pessoa com câncer" ],
      [ 16, "Pessoa com outras doenças crônicas" ], [ 17, "Pessoa com hanseníase" ], [ 18, "Pessoa com tuberculose" ],
      [ 32, "Sintomáticos respiratórios" ], [ 33, "Tabagista" ], [ 19, "Domiciliados / Acamados" ],
      [ 20, "Condições de vulnerabilidade social" ], [ 21, "Condicionalidades do bolsa família" ], [ 22, "Saúde mental" ],
      [ 23, "Usuário de álcool" ], [ 24, "Usuário de outras drogas" ], [ 38, "Pessoa idosa" ]
    ]),
    ...M("CONTROLE_AMBIENTAL_E_VETORIAL", [ [ 34, "Ação educativa" ], [ 35, "Imóvel com foco" ], [ 36, "Ação mecânica" ], [ 37, "Tratamento focal" ] ]),
    ...M("OUTROS", [
      [ 25, "Egresso de internação" ], [ 27, "Convite para atividades coletivas / campanha de saúde" ], [ 31, "Orientação / Prevenção" ], [ 28, "Outros" ]
    ])
  ],
  desfecho: [ { code: 1, label: "Visita realizada" }, { code: 2, label: "Visita recusada" }, { code: 3, label: "Ausente" } ],
  turno: [ { code: 1, label: "Manhã" }, { code: 2, label: "Tarde" }, { code: 3, label: "Noite" } ],
  tipo_glicemia: [ { code: 0, label: "Jejum" }, { code: 1, label: "Pós-prandial" }, { code: 2, label: "Pré-prandial" }, { code: 3, label: "Não especificado" } ],
  // O api manda o código do tipo de imóvel em TEXTO (home_visits/json.rb:165).
  tipo_de_imovel: DOMAINS.tipo_de_imovel.map((e) => ({ code: String(e.code), label: e.label })),
  non_residential_property_types: [ "2", "3", "4", "5", "6", "12", "13" ],
  non_residential_reasons: [ 1, 34, 35, 36, 37, 27, 31, 28 ],
  male_forbidden_reasons: [ 5, 6 ],
  without_person_allowed_reasons: [ 1, 27, 28 ],
  responsible_document_reasons: [ 29, 34, 35, 36, 37 ],
  reasons_max: 36,
  measurement_ranges: {
    weight_kg: { min: 0.5, max: 500, decimals: 3 }, height_cm: { min: 20, max: 250, decimals: 1 }, systolic: { min: 0, max: 999, decimals: 0 },
    diastolic: { min: 0, max: 999, decimals: 0 }, temperature_c: { min: 20, max: 45, decimals: 1 }, glucose_mg_dl: { min: 0, max: 800, decimals: 0 }
  }
};

const R = (meeting: string, audience: string, topics: string, practices: string, participants: string) =>
  ({ meeting_topics: meeting, target_audience: audience, health_topics: topics, health_practices: practices, participants }) as never;
const MEETING = R("required", "forbidden", "forbidden", "forbidden", "optional");
const L = (rows: [ number, string ][]) => rows.map(([ code, label ]) => ({ code, label }));
export const COLLECTIVE_DOMAINS: CollectiveDomains = {
  activity_types: L([
    [ 1, "Reunião de equipe" ], [ 2, "Reunião com outras equipes de saúde" ], [ 3, "Reunião intersetorial / Conselho local de saúde / Controle social" ],
    [ 4, "Educação em saúde" ], [ 5, "Atendimento em grupo" ], [ 6, "Avaliação / Procedimento coletivo" ], [ 7, "Mobilização social" ]
  ]),
  meeting_topics: L([
    [ 1, "Questões administrativas / funcionamento" ], [ 2, "Processo de trabalho" ], [ 3, "Diagnóstico / Monitoramento do território" ],
    [ 4, "Planejamento / Monitoramento das ações da equipe" ], [ 5, "Discussão de caso ou projeto terapêutico singular" ],
    [ 6, "Educação permanente" ], [ 7, "Outros" ], [ 8, "Vigilância em saúde" ]
  ]),
  target_audience: L([
    [ 1, "Comunidade em geral" ], [ 2, "Criança de 0 a 3 anos" ], [ 3, "Criança de 4 a 5 anos" ], [ 4, "Criança de 6 a 11 anos" ], [ 5, "Adolescente" ],
    [ 6, "Mulher" ], [ 7, "Gestante" ], [ 8, "Homem" ], [ 9, "Familiares" ], [ 10, "Pessoa idosa" ], [ 12, "Pessoas com doenças crônicas" ],
    [ 13, "Usuário de tabaco" ], [ 14, "Usuário de álcool" ], [ 15, "Usuário de outras drogas" ],
    [ 16, "Pessoas com sofrimento ou transtorno mental" ], [ 17, "Profissional da educação" ], [ 18, "Outros" ]
  ]),
  health_topics: L([
    [ 29, "Ações de combate ao Aedes aegypti" ], [ 19, "Agravos e Doenças Negligenciadas" ], [ 1, "Alimentação saudável" ],
    [ 4, "Autocuidado de pessoas com doenças crônicas" ], [ 5, "Cidadania e direitos humanos" ], [ 15, "Saúde bucal" ], [ 16, "Saúde mental" ], [ 21, "Outros" ]
  ]),
  health_practices: L([
    [ 20, "Antropometria" ], [ 2, "Aplicação tópica de flúor" ], [ 9, "Escovação dental supervisionada" ], [ 11, "Práticas corporais e Atividade física" ],
    [ 25, "Programa Nacional de Controle do Tabagismo 1" ], [ 26, "Programa Nacional de Controle do Tabagismo 2" ],
    [ 27, "Programa Nacional de Controle do Tabagismo 3" ], [ 28, "Programa Nacional de Controle do Tabagismo 4" ],
    [ 12, "Outras" ], [ 30, "Outro procedimento coletivo" ], [ 33, "Fornecimento de kit bucal" ]
  ]),
  // Códigos SIGTAP em TEXTO, da lista fechada do api (collective_activities/json.rb:106).
  procedures: [
    { code: "0101050178", label: "ATIVIDADE COLETIVA DE ANTROPOSOFIA APLICADA À SAÚDE" },
    { code: "0101050046", label: "YOGA" },
    { code: "0101050020", label: "TERAPIA COMUNITÁRIA" }
  ],
  rules: {
    list_max: { meeting_topics: 7, target_audience: 17, health_topics: 16, health_practices: 14 },
    by_type: {
      "1": MEETING, "2": MEETING, "3": MEETING,
      "4": R("forbidden", "required", "required", "forbidden", "optional"),
      "5": R("forbidden", "required", "required", "optional", "required"),
      "6": R("forbidden", "required", "optional", "required", "required"),
      "7": R("forbidden", "required", "required", "forbidden", "optional")
    },
    health_topics_with_meeting_topic: [ 6 ], practices_only_in_type: [ { type: 6, practices: [ 2, 9, 33 ] } ],
    procedure_practices: [ 30 ], smoking_practices: [ 25, 26, 27, 28 ],
    participant_measurements: { weight_kg: { min: 0.5, max: 500, decimals: 3 }, height_cm: { min: 20, max: 250, decimals: 1 } }
  }
};

const MA01 = { id: "ma1", code: "01", name: "Vila Verde" };
export const acsTeam = (o: Partial<HomeVisitTeam> = {}): HomeVisitTeam => ({
  id: "t1", ine: "0001234567", name: "ESF Vila Verde", cbo: "515105", can_register: true, reads_whole_team: false, out_of_area_allowed: true,
  can_assign: false, can_register_device: true, micro_areas: [ { ...MA01, scope: "responsible" } ], professionals: [], ...o
});
export const tacsTeam = (o: Partial<HomeVisitTeam> = {}) =>
  acsTeam({ cbo: "322255", out_of_area_allowed: false, micro_areas: [ { id: "ma2", code: "02", name: "Jardim Sul", scope: "assigned" } ], ...o });
export const nurseTeam = (o: Partial<HomeVisitTeam> = {}) =>
  acsTeam({ cbo: "223505", can_register: false, reads_whole_team: true, out_of_area_allowed: false, can_assign: true, can_register_device: false,
    micro_areas: [ { ...MA01, scope: "team" }, { id: "ma2", code: "02", name: "Jardim Sul", scope: "team" } ],
    professionals: [ { id: "p-acs", name: "Joana ACS", cbo: "515105" }, { id: "p-tacs", name: "Rui TACS", cbo: "322255" } ], ...o });
export const context = (o: Partial<HomeVisitContext> = {}): HomeVisitContext =>
  ({ today: TODAY24B, min_date: "2026-10-01", teams: [ acsTeam() ], domains: VISIT_DOMAINS, ...o });

export const visit = (o: Partial<HomeVisit> = {}): HomeVisit => ({
  id: "v1", client_uuid: "00000000-0000-4000-8000-000000000001", day_id: "d1", occurred_at: "2026-11-12T09:15:00-03:00", shift: 1, origin: "dashboard",
  property_type: "1", micro_area: { id: "ma1", code: "01" }, out_of_area: false, household: { id: "h1", address_short: "Rua das Flores, 120" },
  family_id: "f1", subject: "resident", patient: { id: "pa1", display_name: "Maria Lima", has_cpf: true, cns_masked: null },
  outcome: 1, reasons: [ 29, 11 ], shared: false, measurements: { systolic: 130, diastolic: 85 }, state: "recorded", withdrawn: null,
  recorded_by: { name: "Joana ACS" }, can_withdraw: true, ...o
});
export const day = (o: Partial<HomeVisitDay> = {}): HomeVisitDay => ({
  id: "d1", professional: { id: "p-acs", name: "Joana ACS" }, team: { id: "t1", ine: "0001234567", name: "ESF Vila Verde" }, day: TODAY24B,
  sequence: 1, state: "open", closed_at: null, closed_by: null, visits_count: 1, withdrawn_count: 0, ficha: { status: "open", reasons: [] },
  blockers: [], own: true, ledi_export_enabled: true, visits: [ visit() ], ...o
});

export const household = (o: Partial<VisitHousehold> = {}): VisitHousehold => ({
  id: "h1", address_short: "Rua das Flores, 120", property_type: "1", status: "active", micro_area: { id: "ma1", code: "01" },
  families: [ { id: "f1", responsible: { patient_id: "pa2", display_name: "José Lima", sex: "male" }, moved_out: false, responsible_exited: false } ],
  has_active_family: true, ...o
});
export const householdDetail = (o: Partial<VisitHouseholdDetail> = {}): VisitHouseholdDetail => ({
  ...household(), residents: [ { patient_id: "pa1", display_name: "Maria Lima", sex: "female", family_id: "f1", unidentified: false },
    { patient_id: "pa2", display_name: "José Lima", sex: "male", family_id: "f1", unidentified: false } ], ...o
});
export const person = (o: Partial<VisitPerson> = {}): VisitPerson =>
  ({ patient_id: "pa9", display_name: "Ana Prado", birth_date: "1990-04-02", has_cpf: true, cns_masked: null, sex: "female", ...o });
export const candidate = (o: Partial<VisitCandidate> = {}): VisitCandidate =>
  ({ patient_id: "pa8", display_name: "Ana Prado", birth_date: "1990-04-02", has_cpf: false, has_cns: true, sex: "female", ...o });

export const assignment = (o: Partial<FieldAssignment> = {}): FieldAssignment => ({
  id: "as1", micro_area: { id: "ma2", code: "02", name: "Jardim Sul" }, professional: { id: "p-tacs", name: "Rui TACS", cbo: "322255" },
  assigned_at: "2026-11-10T08:00:00-03:00", assigned_by: { name: "Rita Enfermeira" }, ...o
});

export const whoItem = (o: Partial<WhoToVisitItem> = {}): WhoToVisitItem => ({
  patient_id: "pa1", display_name: "Maria Lima", age: 67, household: { id: "h1", address_short: "Rua das Flores, 120" }, family_id: "f1",
  micro_area: { id: "ma1", code: "01" }, last_visit_on: "2026-09-30",
  reasons: [ { code: "care_line", care_line: "Pessoa com hipertensão", practice: "Visitas do agente de saúde", status: "overdue", due_on: "2026-11-01" },
    { code: "registration_due", status: "due_soon", due_on: "2026-12-20" } ], ...o
});

// Q57c: os profissionais vêm POR EQUIPE (quem registra fora o próprio usuário), os da equipe primeiro.
export const options = (o: Partial<CollectiveOptions> = {}): CollectiveOptions => ({
  today: TODAY24B, min_date: "2026-10-01",
  teams: [ { id: "t1", ine: "0001234567", name: "ESF Vila Verde", cbo: "223505", can_register: true,
    professionals: [ { id: "p-acs", name: "Joana ACS", cbo: "515105", has_cns: true, in_team: true },
      { id: "p-sem", name: "Caio Sem CNS", cbo: "515105", has_cns: false, in_team: true },
      { id: "p-out", name: "Lia de Outra Equipe", cbo: "225125", has_cns: true, in_team: false } ] } ],
  units: [ { id: "u1", name: "UBS Vila Verde", has_cnes: true }, { id: "u2", name: "Posto Novo", has_cnes: false } ],
  domains: COLLECTIVE_DOMAINS, ...o
});
export const activity = (o: Partial<CollectiveActivity> = {}): CollectiveActivity => ({
  id: "ca1", client_uuid: "00000000-0000-4000-8000-0000000000c1", team: { id: "t1", ine: "0001234567", name: "ESF Vila Verde" },
  unit: { id: "u1", name: "UBS Vila Verde" }, held_on: TODAY24B, shift: 1, activity_type: 5, place: { health_unit: { id: "u1", name: "UBS Vila Verde" } },
  participants_count: 12, altered_count: 1, meeting_topics: [], target_audience: [ 10 ], health_topics: [ 4 ], health_practices: [ 20 ], procedure_code: null,
  professionals: [ { id: "p-acs", name: "Joana ACS", cbo: "515105" } ],
  participants: [ { patient: { id: "pa1", display_name: "Maria Lima", has_cpf: true, cns_masked: null }, altered_evaluation: true,
    measurements: { weight_kg: 72.5, height_cm: 160 }, smoking: null } ],
  recorded_by: { name: "Rita Enfermeira" }, state: "recorded", mistaken: null, ficha: { status: "pending", reasons: [] }, can_mark_mistaken: true, ...o
});
// Q57a: a lista NÃO traz as quatro listas, o procedimento nem os participantes (as chaves não existem).
export const listActivity = (o: Partial<CollectiveActivitySummary> = {}): CollectiveActivitySummary => {
  const { meeting_topics: _m, target_audience: _t, health_topics: _h, health_practices: _p, procedure_code: _c, participants: _n, ...summary } = activity();
  return { ...summary, ...o };
};
export const device = (o: Partial<FieldDevice> = {}): FieldDevice =>
  ({ id: "fd1", name: "Celular da Joana", created_at: "2026-11-10T08:00:00-03:00", last_used_at: null, status: "active", revoked_at: null, revoked_reason: null, ...o });
