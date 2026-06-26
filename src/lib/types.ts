// Tipos dos payloads de /admin/api/*. Espelham API_CONTRACTS.md.

export interface ToneSegment {
  key?: string;
  label: string;
  count: number;
  tone?: string;
}

export interface OverviewKpi {
  id: string;
  label: string;
  value: number;
  unit: string;
  delta: string | null;
  tone: string;
  spark: number[];
  source: "live" | "proj";
}
export interface OverviewData { kpis: OverviewKpi[] }

export interface IngestionData {
  inboundSeries: number[];
  inboundTotal: number;
  ack: Array<{ code: string; label: string; count: number; tone?: string }>;
  dedup: number | null;
  purge: { pending: number; oldestH: number; ttlH: number; overTtl: boolean };
}

export interface ConversationsData {
  live: number;
  funnel: ToneSegment[];
  exits: ToneSegment[];
  abandonRate: number | null;
  avgToCompleteMin: number | null;
  liveActive: { awaiting: number; inProgress: number };
}

export interface ConsentData {
  given: number;
  revoked: number;
  declined: number | null;
  byVersion: Array<{ version: string; given: number; share: number }>;
  revocationsSeries: number[];
}

export interface TriagesData {
  series: number[];
  started: number;
  completed: number;
  completionRate: number;
  byProtocol: Array<{ version: string; count: number; share: number; status: string }>;
}

export interface ClassificationData {
  tiers: ToneSegment[];
  byProtocol: Array<{ protocol: string; low: number; medium: number; high: number }>;
  priorityTrue: number;
  priorityTrend: number[];
  byMode: Array<{ mode: string; label: string; count: number; share: number }>;
  sampleTriages: Array<{
    id: string;
    tier: string | null;
    priority: boolean;
    mode: string | null;
    protocol: string;
    at: string | null;
  }>;
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

export interface ProtocolRow {
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
  versions: Array<{
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
