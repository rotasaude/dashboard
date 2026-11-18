// Dados dos testes do módulo 35a (vigilância ambiental de endemias). Agora: segunda, 2026-11-16, 10h.
// Formas do api JÁ mergeado (apps/api, app/services/vector_control/json.rb e os specs de request), não as do plano:
// onde os dois divergem, vale o api. Rótulos dos domínios copiados de apps/api/config/vector_control/domains.yml;
// parâmetros de apps/api/config/vector_control/defaults.yml (as 20 chaves, Q17); limites do Catalog::LIMITS (Q7(3)).
// Nunca morador: o imóvel só com o endereço curto do 24a; o caso do bloqueio só como número, doença e data.
import type {
  CaseAddress, CityBlock, DepositGroup, DueItem, HomeVisitContext, HomeVisitTeam, HouseholdVector, HouseholdVectorProfile, LiraaItem,
  LiraaSurvey, Ovitrap, OvitrapReading, SessionUser, TransmissionBlock, VectorControlDomains, VectorHousehold, VectorInspection,
  VectorInspectionInput, VectorMapResponse, VectorParameterVersion, VectorParameters, VectorProduct, VectorReport, VectorSample,
  VectorShortfall, VectorTask
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";
import { acsTeam, context } from "./homeVisitFixtures";
import { MAP_MANIFEST } from "./territoryMapFixtures";

export const NOW35 = new Date("2026-11-16T10:00:00-03:00");
export const TODAY35 = "2026-11-16";
export const VC_FEATURES = [ "clinical_record", "territory_registry", "home_visits", "vector_control" ];
export const vcUser = (roles: string[] = [ "health_professional" ], features: string[] = VC_FEATURES): SessionUser =>
  sessionWith(roles, { features });

// O agente de endemias (CBO 515140) só nas microáreas atribuídas, sem fora de área.
export const agentTeam = (o: Partial<HomeVisitTeam> = {}): HomeVisitTeam =>
  acsTeam({ cbo: "515140", out_of_area_allowed: false, micro_areas: [ { id: "ma1", code: "01", name: "Vila Verde", scope: "assigned" } ], ...o });
export const vcContext = (o: Partial<HomeVisitContext> = {}): HomeVisitContext => context({ today: TODAY35, teams: [ agentTeam() ], ...o });

// ── Produtos (Q15: carga em TEXTO, 2 casas) ──
export const LARVICIDE: VectorProduct = {
  id: "pr1", code: "PYR", name: "Pyriproxyfen 0,5% G", unit: "g", charge_size: "2.00", uses: [ "focal" ], active: true, in_use: false
};
export const ADULTICIDE: VectorProduct = {
  id: "pr2", code: "MAL", name: "Malationa 44% EW", unit: "ml", charge_size: "12.50", uses: [ "perifocal", "spatial" ], active: true, in_use: false
};
export const INACTIVE_PRODUCT: VectorProduct = {
  id: "pr3", code: "TEM", name: "Temefós 1% G", unit: "g", charge_size: "1.00", uses: [ "focal" ], active: false, in_use: true
};
// O produto como sai nos domínios (só os ativos, sem active/in_use).
export const domainProduct = ({ id, code, name, unit, charge_size, uses }: VectorProduct) => ({ id, code, name, unit, charge_size, uses });

export const VC_DOMAINS: VectorControlDomains = {
  activities: [
    { code: "li", label: "LI — Levantamento de índice" }, { code: "li_t", label: "LI+T — Levantamento de índice e tratamento" },
    { code: "pe", label: "PE — Ponto estratégico" }, { code: "ie", label: "IE — Imóvel especial" },
    { code: "transmission_block", label: "Bloqueio de transmissão" }, { code: "liraa", label: "LIRAa" }
  ],
  work_types: [ { code: "routine", label: "Rotina" }, { code: "pending", label: "Recuperação de pendência" } ],
  situations: [
    { code: "worked", label: "Trabalhado" }, { code: "closed", label: "Fechado" }, { code: "refused", label: "Recusado" },
    { code: "vacant", label: "Desocupado" }
  ],
  deposit_groups: [
    { code: "A1", label: "A1 — Depósito de água elevado" }, { code: "A2", label: "A2 — Depósito de armazenamento ao nível do solo" },
    { code: "B", label: "B — Depósito móvel" }, { code: "C", label: "C — Depósito fixo" },
    { code: "D1", label: "D1 — Pneu e outro material rodante" }, { code: "D2", label: "D2 — Lixo, sucata e entulho" },
    { code: "E", label: "E — Depósito natural" }
  ],
  measure_methods: [
    { code: "mechanical", label: "Mecânico (eliminação)" }, { code: "focal", label: "Focal (larvicida)" },
    { code: "perifocal", label: "Perifocal (adulticida residual)" }, { code: "spatial", label: "Espacial (UBV)" }
  ],
  risk_classes: [
    { code: "green", label: "Verde (baixo)" }, { code: "yellow", label: "Amarelo (médio)" }, { code: "red", label: "Vermelho (alto)" },
    { code: "gray", label: "Cinza (difícil acesso, com agendamento)" },
    { code: "purple", label: "Roxo (difícil acesso, exige intervenção legal ou VISA)" }
  ],
  products: [ LARVICIDE, ADULTICIDE ].map(domainProduct),
  cadences: [
    { neighborhood_id: null, risk_class: null, strategic_point: false, days: 60 },
    { neighborhood_id: null, risk_class: null, strategic_point: true, days: 15 }
  ],
  parameters: { default_days: 60, strategic_point_days: 15, ovitrap_collection_days_min: 3, ovitrap_collection_days_max: 10 },
  limits: { deposit_count_max: 999, charges_max: 999, samples_max: 99, larvae_collected_max: 10, measures_max: 20 }
};

// O padrão de fábrica (§11; Q17: 20 chaves, com liraa_half_household_fraction).
export const PARAMS: VectorParameters = {
  default_days: 60, strategic_point_days: 15, block_radius_rings: 1, block_grouping_days: 7, block_diseases: [ "dengue", "chikungunya", "zika" ],
  ubv_cycles_max: 3, ubv_cycle_days_min: 3, ubv_cycle_days_max: 5, ubv_cycle_interval_days: 5,
  ovitrap_collection_days_min: 3, ovitrap_collection_days_max: 10, ovitrap_alert_eggs: 100, ovitrap_radius_rings: 1,
  liraa_standard_min: 8100, liraa_standard_max: 12000, liraa_half_min: 2000, liraa_base_sample: 450,
  liraa_household_fraction: 0.2, liraa_half_household_fraction: 0.5, iip_bands: [ 1, 4 ]
};
// Q13(8): a versão 0 (sem gravação) tem created_at null.
export const parameterVersion = (o: Partial<VectorParameterVersion> = {}): VectorParameterVersion =>
  ({ version: 0, values: PARAMS, created_at: null, ...o });

// ── Imóvel e quarteirão ──
export const householdVector = (o: Partial<HouseholdVector> = {}): HouseholdVector => ({
  city_block_id: "cb1", risk_class: "yellow", risk_assessed_on: "2026-10-01", last_worked_on: "2026-09-10", last_situation: "worked", ...o
});
export const householdProfile = (o: Partial<HouseholdVectorProfile> = {}): HouseholdVectorProfile =>
  ({ id: "h1", neighborhood_id: "nb1", vector: householdVector(), ...o });
export const cityBlock = (o: Partial<CityBlock> = {}): CityBlock => ({
  id: "cb1", neighborhood: { id: "nb1", name: "Centro" }, number: "12", active: true, neighbor_ids: [ "cb2" ], households_count: 14, version: 1, ...o
});
export const vectorHousehold = (o: Partial<VectorHousehold> = {}): VectorHousehold => ({
  id: "h1", address_short: "Rua das Flores, 120", property_type: "1", neighborhood_id: "nb1", micro_area: { id: "ma1", code: "01" },
  block: { id: "cb1", number: "12", neighborhood_id: "nb1" }, risk_class: "yellow", risk_assessed_on: "2026-10-01",
  last_worked_on: "2026-09-10", last_situation: "worked", ...o
});
export const dueItem = (o: Partial<DueItem> = {}): DueItem => ({
  household_id: "h1", address_short: "Rua das Flores, 120", property_type: "1", block: { id: "cb1", number: "12" }, risk_class: "yellow",
  last_worked_on: "2026-09-10", due_since: "2026-11-09", reason: "due", liraa_draw_item_id: null, transmission_block_id: null, ...o
});

// ── Boletim (§3) ──
const A2 = (o: Partial<Record<"existing" | "with_water" | "with_larvae" | "eliminated" | "treated", number>> = {}) =>
  ({ group: "A2" as DepositGroup, existing: 3, with_water: 2, with_larvae: 1, eliminated: 1, treated: 1, ...o });
// O boletim completo: LI+T de rotina, trabalhado, A2 com foco tratado, focal com 2 cargas do pr1, uma amostra, ação educativa.
export const inspectionInput = (o: Partial<VectorInspectionInput> = {}): VectorInspectionInput => ({
  activity: "li_t", work_type: "routine", situation: "worked", educational_action: true,
  entered_at: "2026-11-16T09:40:00-03:00", left_at: "2026-11-16T10:20:00-03:00",
  deposits: [ A2() ], measures: [ { method: "focal", vector_product_id: "pr1", charges: 2 } ],
  samples: [ { number: 1, deposit_group: "A2", larvae_collected: 8 } ], ...o
});
// O boletim gravado (no <home_visit>): sem city_block_id e sem risk_class; etiqueta = client_uuid[0,8] em caixa alta + "-NN".
export const inspection = (o: Partial<VectorInspection> = {}): VectorInspection => ({
  id: "vi1", activity: "li_t", work_type: "routine", situation: "worked", educational_action: true,
  entered_at: "2026-11-16T09:40:00-03:00", left_at: "2026-11-16T10:20:00-03:00", recovered: false, city_block: { id: "cb1", number: "12" },
  deposits: [ A2() ],
  measures: [ { method: "focal", vector_product_id: "pr1", charges: 2, quantity: "4.00", product: { id: "pr1", code: "PYR", name: "Pyriproxyfen 0,5% G", unit: "g" } } ],
  samples: [ { id: "vs1", number: 1, deposit_group: "A2", larvae_collected: 8, label: "00000000-01", result: null } ], ...o
});

// ── Ovitrampas, amostras e tarefas ──
export const ovitrap = (o: Partial<Ovitrap> = {}): Ovitrap => ({
  id: "ov1", number: "OV-07", household: { id: "h1", address_short: "Rua das Flores, 120" }, city_block: { id: "cb1", number: "12" },
  status: "active", installed_on: "2026-11-09", removed_on: null, open_reading: { id: "or1", installed_on: "2026-11-09" },
  last_reading: { id: "or0", collected_on: "2026-11-09", condition: "ok", egg_count: 42, epi_week: "2026-45" }, version: 2, ...o
});
export const reading = (o: Partial<OvitrapReading> = {}): OvitrapReading => ({
  id: "or0", ovitrap: { id: "ov1", number: "OV-07" }, city_block: { id: "cb1", number: "12" }, neighborhood: { id: "nb1", name: "Centro" },
  installed_on: "2026-11-02", collected_on: "2026-11-09", condition: "ok", epi_week: "2026-45", egg_count: null, counted_at: null,
  corrected: false, version: 1, ...o
});
export const sample = (o: Partial<VectorSample> = {}): VectorSample => ({
  id: "vs1", label: "00000000-01", visit_on: TODAY35, deposit_group: "A2", larvae_collected: 8, city_block: { id: "cb1", number: "12" },
  result: null, version: 1, ...o
});
export const vectorTask = (o: Partial<VectorTask> = {}): VectorTask => ({
  id: "vt1", kind: "ovitrap_intensification", state: "open", created_at: "2026-11-15T12:00:00Z", ovitrap: { id: "ov1", number: "OV-07" },
  suggested_blocks: [ { id: "cb2", number: "13" } ], disease: null, case_on: null, transmission_block_id: null, closed_at: null, ...o
});

// ── LIRAa (Q24: no rascunho o N do estrato vem do api, sem PE; n, intervalo e início nulos) ──
export const liraaSurvey = (o: Partial<LiraaSurvey> = {}): LiraaSurvey => ({
  id: "s1", name: "LIRAa novembro", starts_on: "2026-11-23", ends_on: "2026-11-27", status: "draft", version: 1, parameters_version: null,
  drawn_at: null, closed_at: null,
  strata: [ { id: "st1", name: "Estrato 1", mode: "standard", block_ids: [ "cb1", "cb2" ], households_count: 9000, sample_target: null,
    block_interval: null, random_start: null } ], ...o
});
export const liraaItem = (o: Partial<LiraaItem> = {}): LiraaItem => ({
  id: "lit1", stratum_id: "st1", city_block: { id: "cb1", number: "12" }, household: { id: "h1", address_short: "Rua das Flores, 120" },
  position: 1, status: "pending", substitute_of_id: null, ...o
});

// ── Bloqueio de transmissão (o caso só como "caso N", doença e data) ──
export const transmissionBlock = (o: Partial<TransmissionBlock> = {}): TransmissionBlock => ({
  id: "tb1", status: "proposed", disease_group: "arbovirus", center_block: { id: "cb1", number: "12" },
  area: [ { id: "cb1", number: "12", suggested: true }, { id: "cb2", number: "13", suggested: true } ],
  cases: [ { id: "tc1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: true } ], cycles: [],
  created_at: "2026-11-14T13:00:00Z", confirmed_at: null, closed_at: null, ...o
});
// Só no diálogo do step-up; nunca em cache, URL, storage ou console.
export const caseAddress = (o: Partial<CaseAddress> = {}): CaseAddress =>
  ({ patient_address: "Rua das Palmeiras, 45, Centro", household_address: "Rua das Flores, 120", ...o });

// ── Estoque, relatórios e mapa ──
export const shortfall = (o: Partial<VectorShortfall> = {}): VectorShortfall => ({
  id: "sf1", created_at: "2026-11-16T13:20:00.000000Z", stock_location: { id: "loc-vc", name: "Almoxarifado de endemias" },
  product: { id: "pr1", code: "PYR", name: "Pyriproxyfen 0,5% G", unit: "g" }, quantity: "4.00", cause: "insufficient_balance",
  visit_on: TODAY35, reconciled_at: null, reconciled_by: null, ...o
});
export const report = (o: Partial<VectorReport> = {}): VectorReport => ({
  name: "situations",
  columns: [
    { key: "group", label: "Recorte", kind: "text" }, { key: "label", label: "Classe ou bairro", kind: "text" },
    { key: "visited", label: "Visitados", kind: "count" }, { key: "pending_percent", label: "Pendência %", kind: "percent" }
  ],
  rows: [ { group: "property_class", label: "R (residencial)", visited: 12, pending_percent: "8.3" } ], ...o
});
export const mapPoints = (o: Partial<VectorMapResponse> = {}): VectorMapResponse => ({
  map: MAP_MANIFEST, points: [ { id: "h1", latitude: -25.42851, longitude: -49.2733, category: "yellow", label: "12" } ], ...o
});
