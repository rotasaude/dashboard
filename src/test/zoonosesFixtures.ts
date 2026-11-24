// Dados dos testes do módulo 35b (centro de zoonoses). Agora: segunda, 2026-11-23, 10h.
// Formas do api JÁ pronto (api-shapes.md, Q25), não as do plano: onde os dois divergem, vale o api. Rótulos dos domínios
// copiados de apps/api/config/zoonoses/domains.yml; parâmetros de config/zoonoses/defaults.yml (sem `leish_expected_prevalence`, Q18).
// Nunca o número do microchip, CPF/CNS, nome do morador nem o endereço do lugar fora da fixture que o api realmente traz.
import type {
  Animal, AnimalHistory, BiteObservation, Collar, DueCollar, Euthanasia, LeishSurvey, LeishTest, MyProfessional, ObservationContact,
  RabiesCampaign, RabiesVaccination, SessionUser, ShelterStay, VectorProduct, ZooPerson, ZoonosesDemand, ZoonosesDemandDetail, ZoonosesDomains,
  ZoonosesParameters, ZoonosesReport
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const NOW35B = new Date("2026-11-23T10:00:00-03:00");
export const TODAY35B = "2026-11-23";
export const ZOO_FEATURES = [ "clinical_record", "territory_registry", "zoonoses" ];
export const zooUser = (roles: string[] = [ "zoonoses_team" ], features: string[] = ZOO_FEATURES): SessionUser =>
  sessionWith(roles, { features });

// ── Produtos (o 35a: unidade "un"; no `domains` do 35b o produto não traz `unit`) ──
export const VACCINE: VectorProduct & { use: "rabies_vaccine" } = {
  id: "pz1", code: "VAR", name: "Vacina antirrábica animal", unit: "un", use: "rabies_vaccine", charge_size: "1.00", uses: [ "rabies_vaccine" ],
  active: true, in_use: false
};
export const COLLAR: VectorProduct & { use: "collar" } = {
  id: "pz2", code: "COL", name: "Coleira deltametrina 4%", unit: "un", use: "collar", charge_size: "1.00", uses: [ "collar" ], active: true, in_use: false
};
const domainProduct = ({ id, code, name, use }: { id: string; code: string; name: string; use: "rabies_vaccine" | "collar" }) => ({ id, code, name, use });

export const ZOO_DOMAINS: ZoonosesDomains = {
  units: [ { id: "uvz1", name: "UVZ Central" }, { id: "u1", name: "UVZ Norte" } ],
  // Q43: todas as unidades ativas (qualquer tipo) para a dose; o canil continua com `units`.
  vaccination_units: [ { id: "ubs7", name: "UBS Jardim Botânico" }, { id: "uvz1", name: "UVZ Central" }, { id: "u1", name: "UVZ Norte" } ],
  species: [ { code: "dog", label: "Cão" }, { code: "cat", label: "Gato" }, { code: "other", label: "Outro" } ],
  sexes: [ { code: "male", label: "Macho" }, { code: "female", label: "Fêmea" }, { code: "unknown", label: "Não informado" } ],
  sizes: [ { code: "small", label: "Pequeno" }, { code: "medium", label: "Médio" }, { code: "large", label: "Grande" } ],
  animal_statuses: [
    { code: "active", label: "Ativo" }, { code: "deceased", label: "Óbito" }, { code: "missing", label: "Desaparecido" },
    { code: "transferred", label: "Transferido" }
  ],
  subtypes: [
    { code: "scorpion", label: "Escorpião" }, { code: "bat", label: "Morcego" }, { code: "rodent", label: "Rato ou outro roedor" },
    { code: "tick", label: "Carrapato" }, { code: "aggressive_animal", label: "Animal que mordeu ou atacou" },
    { code: "neurological_animal", label: "Animal com comportamento estranho ou paralisia" },
    { code: "sporotrichosis", label: "Gato com feridas (esporotricose)" }, { code: "other", label: "Outro problema com animal" }
  ],
  dpp_results: [ { code: "reactive", label: "Reagente" }, { code: "non_reactive", label: "Não reagente" }, { code: "invalid", label: "Inválido" } ],
  elisa_results: [ { code: "reactive", label: "Reagente" }, { code: "non_reactive", label: "Não reagente" }, { code: "inconclusive", label: "Inconclusivo" } ],
  leish_decisions: [
    { code: "tutor_treatment", label: "Tratamento pelo tutor" }, { code: "euthanasia", label: "Eutanásia" }, { code: "refused", label: "Recusa do tutor" }
  ],
  leish_survey_kinds: [ { code: "sample", label: "Amostral" }, { code: "census", label: "Censitário" }, { code: "focus", label: "Foco" } ],
  product_uses: [ { code: "rabies_vaccine", label: "Vacina antirrábica animal" }, { code: "collar", label: "Coleira inseticida" } ],
  entry_kinds: [
    { code: "collection", label: "Recolhimento" }, { code: "voluntary_surrender", label: "Entrega voluntária" },
    { code: "observation", label: "Observação" }, { code: "other", label: "Outro" }
  ],
  exit_kinds: [
    { code: "returned", label: "Devolução" }, { code: "adopted", label: "Adoção" }, { code: "death", label: "Óbito" },
    { code: "euthanasia", label: "Eutanásia" }, { code: "transferred", label: "Transferência para outro abrigo ou instituição" }
  ],
  euthanasia_reasons: [
    { code: "leishmaniasis", label: "Leishmaniose visceral canina" }, { code: "rabies_suspect", label: "Suspeita de raiva" },
    { code: "untreatable_suffering", label: "Sofrimento irreversível, sem controle possível" },
    { code: "public_health_risk", label: "Ameaça à saúde pública" }, { code: "other", label: "Outro" }
  ],
  legal_bases: [ { code: "cfmv_1000_2012", label: "Resolução CFMV nº 1.000/2012" }, { code: "law_14228_2021", label: "Lei nº 14.228/2021" } ],
  removal_reasons: [
    { code: "replaced", label: "Substituída" }, { code: "lost", label: "Perdida" }, { code: "death", label: "Óbito" }, { code: "other", label: "Outro" }
  ],
  modalities: [ { code: "house", label: "Casa a casa" }, { code: "fixed_post", label: "Posto fixo" }, { code: "routine", label: "Rotina" } ],
  demand_states: [
    { code: "open", label: "Aberta" }, { code: "scheduled", label: "Agendada" }, { code: "inspected", label: "Vistoriada" }, { code: "closed", label: "Encerrada" }
  ],
  demand_outcomes: [
    { code: "resolved", label: "Resolvida" }, { code: "guidance", label: "Orientação ao cidadão" },
    { code: "not_found", label: "Problema não encontrado no local" }, { code: "referred", label: "Encaminhada a outro órgão" }
  ],
  deadline_colors: [
    { code: "green", label: "No prazo" }, { code: "yellow", label: "Perto do prazo" }, { code: "red", label: "Vencida" }, { code: "none", label: "Sem prazo" }
  ],
  observation_outcomes: [
    { code: "open", label: "Em observação" }, { code: "healthy", label: "Sadio" }, { code: "died", label: "Morreu" },
    { code: "missing", label: "Desapareceu" }, { code: "rabies_signs", label: "Sinais de raiva" }, { code: "sent_to_exam", label: "Enviado a exame" },
    { code: "euthanized", label: "Eutanasiado" }
  ],
  products: [ domainProduct(VACCINE), domainProduct(COLLAR) ],
  open_campaign: { id: "cp1", name: "Campanha antirrábica 2026", starts_on: "2026-10-05", ends_on: "2026-11-30" },
  parameters: { collar_months: 6 },
  limits: { name_max: 60, coat_max: 40, breed_max: 60, microchip_digits: 15, registry_number_max: 20, adverse_note_min: 10, adverse_note_max: 500 }
};

// O padrão de fábrica (config/zoonoses/defaults.yml), sem `leish_expected_prevalence` (Q18).
export const ZOO_PARAMS: ZoonosesParameters = {
  observation_days: 10, collar_months: 6,
  leish_sample_table: [
    { population: 599, sample: 300, min_population: 500 }, { population: 699, sample: 334 }, { population: 799, sample: 363 },
    { population: 899, sample: 388 }, { population: 999, sample: 410 }, { population: 1000, sample: 430, a_conferir: true }
  ],
  leish_focus_min_dogs: 100, dogs_per_block: 16, rabies_coverage_target: 0.8, dog_population_estimate: null, cat_population_estimate: null
};

export const PERSON: ZooPerson = {
  patient: { id: "pt1", display_name: "M. S." }, household: { id: "h1", address_short: "R. das Flores, 10" }
};

export const animal = (o: Partial<Animal> = {}): Animal => ({
  id: "an1", version: 1, species: "dog", name: "Thor", sex: "male", size: "medium", coat: "caramelo", breed: null, birth_estimate_on: "2023-05-01",
  has_microchip: true, registry_number: null, household_id: "h1", has_tutor: true, community: false, status: "active", status_on: null,
  neutered: false, created_at: "2026-10-01T09:00:00-03:00", ...o
});
export const history = (o: Partial<AnimalHistory> = {}): AnimalHistory => ({
  ...animal(), tutor: { id: "pt1", display_name: "M. S." },
  vaccinations: [ { id: "v1", vaccinated_on: "2026-11-10", modality: "house", campaign_id: "cp1", vector_product_id: "pz1", adverse_event: false, cancelled: false } ],
  observations: [], tests: [], collars: [], stays: [], neuterings: [], euthanasia: null, ...o
});
export const campaign = (o: Partial<RabiesCampaign> = {}): RabiesCampaign => ({
  id: "cp1", version: 3, name: "Campanha antirrábica 2026", year: 2026, starts_on: "2026-10-05", ends_on: "2026-11-30", goal_dogs: 800, goal_cats: 300,
  stage: "open", created_at: "2026-09-20T09:00:00-03:00", ...o
});
export const vaccination = (o: Partial<RabiesVaccination> = {}): RabiesVaccination => ({
  id: "v1", modality: "house", campaign_id: "cp1", animal_id: "an1", species: "dog", vaccinated_on: "2026-11-10", health_unit_id: null,
  household_id: "h1", vector_product_id: "pz1", stock_lot_id: "lot1", adverse_event: false, cancelled: false, cancelled_at: null,
  recorded_by_user_id: "u-1", created_at: "2026-11-10T10:00:00-03:00", ...o
});
export const demand = (o: Partial<ZoonosesDemand> = {}): ZoonosesDemand => ({
  id: "dm1", version: 1, subtype: "scorpion", state: "open", due_on: "2026-11-30", color: "green", forwarding_state: "pending", ...o
});
export const demandDetail = (o: Partial<ZoonosesDemandDetail> = {}): ZoonosesDemandDetail => ({
  ...demand(), scheduled_on: null, inspected_on: null, outcome: null, extract: "Achei um escorpião no quintal.", place_address: "Rua das Palmeiras, 45",
  inspection_note: null, created_at: "2026-11-20T09:00:00-03:00", ...o
});
export const observation = (o: Partial<BiteObservation> = {}): BiteObservation => ({
  id: "ob1", version: 1, species: "dog", condition: "healthy", exposure_on: "2026-11-15", ends_on: "2026-11-25", days_left: 2, state: "open",
  place: "home", animal_id: "an1", ...o
});
export const CONTACT: ObservationContact = { animal_tutor_name: "João Silva", animal_tutor_phone: "41999990000", animal_address: "Rua das Palmeiras, 45, Centro" };
export const survey = (o: Partial<LeishSurvey> = {}): LeishSurvey => ({
  id: "sv1", version: 1, name: "Inquérito Centro", kind: "sample", neighborhood_id: "nb1", neighborhood: { id: "nb1", name: "Centro" },
  city_block_ids: [ "cb1", "cb2" ], dog_population: 900, target_dogs: 388, below_focus_min: false, starts_on: "2026-11-23", ends_on: "2026-12-04",
  stage: "draft", parameters_version: 1, created_at: "2026-11-20T09:00:00-03:00", ...o
});
export const leishTest = (o: Partial<LeishTest> = {}): LeishTest => ({
  id: "lt1", version: 1, leish_survey_id: "sv1", animal: { id: "an1", has_tutor: true }, label: "LV-2026-0A1B2C-0001", collected_on: "2026-11-23",
  dpp_result: "reactive", dpp_on: "2026-11-23", elisa_result: null, elisa_on: null, elisa_request: null, result_by_user_id: "u-1", outcome: null,
  created_at: "2026-11-23T09:30:00-03:00", ...o
});
export const collar = (o: Partial<Collar> = {}): Collar => ({
  id: "co1", animal_id: "an1", vector_product_id: "pz2", placed_on: "2026-05-20", due_on: "2026-11-20", removed_on: null, removal_reason: null, ...o
});
export const dueCollar = (o: Partial<DueCollar> = {}): DueCollar => ({
  id: "co1", animal_id: "an1", household_id: "h1", vector_product_id: "pz2", placed_on: "2026-05-20", due_on: "2026-11-20",
  animal: { id: "an1", name: "Thor", species: "dog" }, ...o
});
export const stay = (o: Partial<ShelterStay> = {}): ShelterStay => ({
  id: "st1", version: 1, animal_id: "an1", animal: { id: "an1", name: "Thor", species: "dog" }, species: "dog", health_unit_id: "uvz1", entry_kind: "collection", entered_on: "2026-11-20",
  bite_observation_id: null, exit_kind: null, exited_on: null, created_at: "2026-11-20T11:00:00-03:00", ...o
});
export const euthanasia = (o: Partial<Euthanasia> = {}): Euthanasia => ({
  id: "eu1", animal_id: "an1", performed_on: "2026-11-23", reason: "leishmaniasis", legal_basis: [ "cfmv_1000_2012" ], shelter_stay_id: null,
  bite_observation_id: null, veterinarian: { name: "Dra. Ana Lima", crmv: "CRMV-PR 12345" }, created_at: "2026-11-23T10:00:00-03:00", ...o
});
// O perfil de veterinária do 35b: CBO 223305 e CRMV.
export const vetProfessional = (o: Partial<MyProfessional> = {}): MyProfessional => ({
  professional: {
    id: "p1", user_id: "u-1", email_address: "vet@curitiba.demo", professional_name: "Dra. Ana Lima", council: "CRMV", council_state: "PR",
    registration_number: "12345", cns_masked: "*** **** **** 1234"
  },
  links: [ {
    id: "l1", health_unit_id: "uvz1", unit_name: "Unidade de Vigilância de Zoonoses", cbo_code: "223305", cbo_title: "Médico veterinário",
    started_at: "2026-01-01", started_by: "admin", ended_at: null, ended_by: null
  } ],
  shifts: [], ...o
});
export const zooReport = (o: Partial<ZoonosesReport> = {}): ZoonosesReport => ({
  name: "rabies_modalities",
  columns: [ { key: "modality", label: "Modalidade", kind: "text" }, { key: "species", label: "Espécie", kind: "text" }, { key: "doses", label: "Doses", kind: "count" } ],
  rows: [ { modality: "Posto fixo", species: "Cão", doses: 12 } ], ...o
});
