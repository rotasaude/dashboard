// Tipos dos payloads de /admin/api/*. Espelham API_CONTRACTS.md.

// Módulo 11 (spec 2026-09-28 §4.3): com o filtro de bairro ligado, a API
// troca todo número de 1 a 4 por { suppressed: true } — KPI, contagem por
// categoria, ponto de série, percentual e média sobre total de 1 a 4, e taxa
// cujo numerador é 1 a 4 (mesmo com total >= 5). 0 e >= 5 continuam números.
// Sem filtro, nada muda.
export interface Suppressed { suppressed: true }
export type SmallCount = number | Suppressed;

// Eco do filtro aplicado (spec §4.1): null = sem filtro; "none" = sem bairro.
export type NeighborhoodFilterEcho = { id: string; name: string } | "none" | null;
export interface Filtered { filter?: { neighborhood: NeighborhoodFilterEcho } }

export interface ToneSegment {
  key?: string;
  label: string;
  count: SmallCount;
  tone?: string;
}

export interface OverviewKpi {
  id: string;
  label: string;
  value: SmallCount;
  unit: string;
  delta: string | null;
  tone: string;
  spark: SmallCount[];
  source: "live" | "proj";
}
export interface OverviewData extends Filtered {
  kpis: OverviewKpi[];
  // api#34: triagens revogadas do período, só a contagem (fora de concluídas,
  // urgentes e taxa). Ausente = api antiga.
  revoked?: SmallCount;
}

export interface IngestionData {
  inboundSeries: number[];
  inboundTotal: number;
  ack: Array<{ code: string; label: string; count: number; tone?: string }>;
  purge: { pending: number; oldestH: number; ttlH: number; overTtl: boolean };
}

export interface ConversationsData extends Filtered {
  live: SmallCount;
  funnel: ToneSegment[];
  exits: ToneSegment[];
  abandonRate: SmallCount | null;
  avgToCompleteMin: SmallCount | null;
  liveActive: { awaiting: SmallCount; inProgress: SmallCount };
}

export interface ConsentData {
  given: number;
  revoked: number;
  declined: number | null;
  byVersion: Array<{ version: string; given: number; share: number }>;
  revocationsSeries: number[];
}

export interface TriagesData extends Filtered {
  series: SmallCount[];
  started: SmallCount;
  completed: SmallCount;
  completionRate: SmallCount;
  byProtocol: Array<{ version: string; count: SmallCount; share: SmallCount; status: string }>;
}

export interface SampleTriage {
  id: string;
  tier: string | null;
  priority: number | null;
  urgent: boolean;
  mode: string | null;
  protocol: string;
  at: string | null;
}

export interface ClassificationData extends Filtered {
  tiers: ToneSegment[];
  tierKeys: string[];
  urgent: SmallCount;
  urgentMaxPriority: number;
  urgentTrend: SmallCount[];
  byProtocol: Array<{ protocol: string; counts: Record<string, SmallCount> }>;
  byMode: Array<{ mode: string; label: string; count: SmallCount; share: SmallCount }>;
  // null = oculta pela supressão (módulo 11) sempre que qualquer contagem ou
  // ponto do painel está suprimido, mesmo com total visível; ausente também é
  // tratado como oculta. [] = nenhuma no período.
  sampleTriages?: SampleTriage[] | null;
  // api#34: triagens revogadas do período, só a contagem (fora dos tiers e da
  // urgência). Ausente = api antiga.
  revoked?: SmallCount;
}

export interface TrailStep {
  ev: string;
  rule: string | null;
  ref: string | null;
  out: string | null;
  at: string;
}
export interface TriageTrailData {
  triageId: string;
  protocol: string;
  mode: string | null;
  steps: TrailStep[];
}

// Estado de assinatura de uma versão (spec de assinaturas §5/§6). Vem das três
// tabelas append-only, nunca de domain_events — o mesmo bloco aparece na lista
// e em cada versão do detalhe.
export interface SignatureBlock {
  signers: Array<{ id: string; email: string | null }>;
  missing: number;
}
export interface ProtocolEditor { kind: string; id: string; email: string | null }
export interface SignatureState {
  signatures: { publication: SignatureBlock; activation: SignatureBlock };
  eligibleReviewers: number;
  editors: ProtocolEditor[];
  revertible: boolean;
  // Opcional porque uma API anterior ao deploy deste campo simplesmente OMITE
  // a chave — declarar obrigatório aqui afirmava mais do que o fio garante, e
  // convidava o consumidor a comparar com `=== null`, que não pega `undefined`.
  // A normalização acontece num lugar só, ao abrir o painel de confirmação.
  revertTargetVersion?: string | null;
}

export interface ProtocolRow extends SignatureState {
  id: string;
  name: string;
  version: string;
  status: string;
  createdBy: string | null;
  publishedBy: string | null;
  fourEyes: boolean | null;
  publishedAt: string | null;
  retiredAt: string | null;
  schema: string;
  linter: string;
  gates: string;
}
export interface ProtocolsListData { list: ProtocolRow[] }

export interface ProtocolDetailData {
  id: string;
  name: string;
  versions: Array<SignatureState & {
    version: string;
    status: string;
    createdBy: string | null;
    publishedBy: string | null;
    fourEyes: boolean | null;
    at: string;
    schema: string;
    linter: string;
    gates: string;
  }>;
  events: Array<{ at: string; name: string; actor: string | null; ref: string }>;
}

export interface QueueRow {
  name: string;
  urgent: boolean;
  depth: number;
  oldestS: number;
  running: number;
  scheduled: number;
  failed: number;
  tone: string;
}
export interface FailedExecutionRow {
  jobClass: string;
  queue: string;
  error: string | null;
  attempts: number | null;
  at: string;
  ref: string | null;
}
export interface RecurringTaskRow {
  key: string;
  name: string;
  schedule: string;
  lastAgo: string;
  delayedMin: number;
  status: string;
  adr: string | null;
}
export interface QueuesData {
  queues: QueueRow[];
  oldestPendingS: number;
  failedExecutions: FailedExecutionRow[];
  recurring: RecurringTaskRow[];
}

export interface EventsData {
  total: number;
  retentionMonths: number;
  replayAnchor: { seq: string; at: string } | null;
  byType: Array<{ name: string; count: number }>;
  stream: Array<{
    at: string;
    name: string;
    actor: string;
    ref: string;
    muni: string | null;
  }>;
  filters: string[];
}

export interface HealthProjection {
  name: string;
  updatedAt: string | null;
  driftMin: number | null;
  thresholdMin: number;
  status: string;
}
export interface HealthData {
  projections: HealthProjection[];
  recurring: RecurringTaskRow[];
  driftOverall: number | null;
}

// ─── Cidades (Admin::Api::Cities) ────────────────────────────────────────────
export interface CityChannel { active: boolean; display_phone_number: string }

export interface CityMetrics {
  conversations_active: number;
  protocols_active: number;
  triages_done: number;
  triages_in_progress: number;
  inbound: number;
  outbound: number;
  consents: number;
  events: number;
}

export interface CitySummary {
  id: string;
  name: string;
  uf: string | null;
  slug: string;
  status: string;
  channel: CityChannel | null;
  last_activity_at: string | null;
  metrics: CityMetrics;
}

export interface CitiesData { cities: CitySummary[] }

export interface CityKpi { id: string; label: string; value: number; spark: number[] }
export interface CityResourceChannel { display_phone_number: string; phone_number_id: string; active: boolean }
export interface CityConsentTerm { version: string; published_at: string }
export interface CityAlertRecipient { channel: string; destination: string; escalation_order: number }
export interface CityProtocol { name: string; version: number }
export interface CityFirstAdmin { email: string; status: string }

export interface CityResources {
  channel: CityResourceChannel | null;
  consent_term: CityConsentTerm | null;
  alert_recipients: CityAlertRecipient[];
  protocols_active: CityProtocol[];
  first_admin: CityFirstAdmin | null;
}

export interface TimelineEntry { at: string; type: string; summary: string }

export interface CityDetailData {
  city: CitySummary & { ibge_code: string | null };
  resources: CityResources;
  kpis: CityKpi[];
  timeline: TimelineEntry[];
}

// ─── Relatórios (Admin::Api::Reports) — metadados apenas (LGPD) ─────────────
export interface ReportRow {
  id: string;
  createdAt: string;
  tier: string | null;
  protocol: string;
  expiresAt: string | null;
  live: boolean;
}
export interface ReportsData extends Filtered {
  // null = oculta pela supressão (qualquer contagem do painel suprimida, não só
  // o total); ausente também é tratado como oculta. [] = nenhum no período.
  reports?: ReportRow[] | null;
  total: SmallCount;
}
