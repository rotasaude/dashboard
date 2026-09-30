// src/test/analyticsFixtures.tsx
// Dados e harness dos testes do módulo 14. O fetch é trocado por um stub por
// rota (sem vi.mock do api): o cliente real monta a URL, e os testes leem os
// parâmetros que ela levou.
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AnalyticsDataMap, AnalyticsFront, CalibrationData, DemandData, EpidemiologyData, Granularity, QualityData
} from "../lib/api";

// 12:00Z = 09:00 de 30/09 em São Paulo (vitest.config.ts fixa o TZ).
export const NOW = new Date("2026-09-30T12:00:00Z");
// 05:02Z = 02:02 de 30/09 em São Paulo: a consolidação cobriu até 29/09.
export const AS_OF = "2026-09-30T05:02:11Z";
export const PERIODS = [ "2026-09-14", "2026-09-21", "2026-09-28" ];
export const HIDDEN = { suppressed: true } as const;

export const NB1 = "11111111-1111-4111-8111-111111111111";
export const NB2 = "22222222-2222-4222-8222-222222222222";
export const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const U3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// data.units de demand e quality: todas as unidades, por nome, com a inativa.
// U3 não tem atendimento no intervalo e mesmo assim entra no seletor.
export const UNITS = [
  { health_unit_id: U3, name: "UBS Antiga", active: false },
  { health_unit_id: U1, name: "UBS Centro", active: true },
  { health_unit_id: U2, name: "UPA Boqueirão", active: true }
];

export const NEIGHBORHOODS = [
  { id: NB1, name: "Boqueirão", active: true },
  { id: NB2, name: "Xaxim", active: false }
];

// Formato de GET /admin/api/protocols: `version` é string na API.
export const PROTOCOL_ROWS = [
  { name: "arbovirose", version: "3", status: "draft" },
  { name: "arbovirose", version: "2", status: "active" },
  { name: "arbovirose", version: "1", status: "retired" },
  { name: "respiratorio", version: "4", status: "active" }
];

// Calibração não tem agrupamento (contratos §1.3): chame com `null`.
function base<F extends AnalyticsFront>(front: F, granularity: Granularity | null = "week") {
  return {
    front, ...(granularity ? { granularity } : {}), from: "2026-09-14", to: "2026-09-29",
    filter: { neighborhood_id: null, health_unit_id: null, protocol_name: null, protocol_version: null },
    periods: PERIODS
  };
}

export function demandData(overrides: Partial<DemandData> = {}): DemandData {
  return {
    ...base("demand"),
    units: UNITS,
    triages: { started: [ 12, HIDDEN, 0 ], completed: [ 10, HIDDEN, 0 ], aborted: [ HIDDEN, 0, 0 ] },
    // Somado e suprimido na API: 12 + (1..4) + 0 dá >= 13, nunca um número que a tela calcule.
    triages_total: { started: 15, completed: 13, aborted: HIDDEN },
    by_tier: [
      { tier: "vermelho", series: [ 6, HIDDEN, 0 ], total: 8 },
      { tier: "verde", series: [ HIDDEN, 0, 0 ], total: HIDDEN }
    ],
    by_protocol: [ { protocol_name: "arbovirose", series: [ 10, HIDDEN, 0 ], total: 12 } ],
    by_neighborhood: [
      { neighborhood_id: NB1, name: "Boqueirão", total: 9 },
      { neighborhood_id: null, name: "Sem bairro", total: HIDDEN }
    ],
    attendances_by_unit: [
      { health_unit_id: U1, name: "UBS Centro", series: [ 7, 5, 0 ], total: 12 },
      { health_unit_id: U2, name: "UPA Boqueirão", series: [ HIDDEN, 0, 0 ], total: HIDDEN }
    ],
    requests_opened: [
      { kind: "return", series: [ 5, 0, 0 ], total: 5 },
      { kind: "referral", series: [ 0, 0, 0 ], total: 0 }
    ],
    requests_closed: [ { reason: "fulfilled", series: [ 0, 6, 0 ], total: 6 } ],
    ...overrides
  };
}

export function qualityData(overrides: Partial<QualityData> = {}): QualityData {
  return {
    ...base("quality"),
    units: UNITS,
    wait: {
      buckets: [
        { bucket: "0-15", series: [ 8, 6, 0 ], total: 14 },
        { bucket: "15-30", series: [ HIDDEN, 5, 0 ], total: 7 },
        { bucket: "30-60", series: [ 0, 0, 0 ], total: 0 },
        { bucket: "60-120", series: [ 0, 0, 0 ], total: 0 },
        { bucket: "120+", series: [ HIDDEN, 0, 0 ], total: HIDDEN }
      ],
      within_30_pct: [ 76.9, 100, null ],
      within_30_pct_total: 87.5
    },
    appointments: [
      { status: "checked_in", series: [ 10, 9, 0 ], total: 19 },
      { status: "no_show", series: [ HIDDEN, HIDDEN, 0 ], total: 5 },
      { status: "expired", series: [ 0, 0, 0 ], total: 0 },
      { status: "cancelled_by_citizen", series: [ 0, 0, 0 ], total: 0 }
    ],
    no_show_pct: [ HIDDEN, HIDDEN, null ],
    no_show_pct_total: 20.8,
    attendance_outcomes: [
      { outcome: "discharged", series: [ 9, 8, 0 ], total: 17 },
      { outcome: "referred", series: [ 0, 5, 0 ], total: 5 },
      { outcome: "return", series: [ 0, 0, 0 ], total: 0 },
      { outcome: "left", series: [ HIDDEN, 0, 0 ], total: HIDDEN }
    ],
    left_pct: [ HIDDEN, 0, null ],
    left_pct_total: HIDDEN,
    by_unit: [
      { health_unit_id: U1, name: "UBS Centro", attendances: 22, wait_within_30_pct: 87.5, no_show_pct: 20.8, left_pct: HIDDEN },
      { health_unit_id: U2, name: "UPA Boqueirão", attendances: HIDDEN, wait_within_30_pct: HIDDEN, no_show_pct: null, left_pct: HIDDEN }
    ],
    ...overrides
  };
}

export function calibrationData(overrides: Partial<CalibrationData> = {}): CalibrationData {
  return {
    ...base("calibration", null),
    versions: [
      { protocol_name: "arbovirose", protocol_version: 2, rows: [ {
        tier: "vermelho", total: 20,
        outcomes: { discharged: 10, referred: 6, return: 0, left: HIDDEN, none: HIDDEN },
        shares: { discharged: 50, referred: 30, return: 0, left: HIDDEN, none: HIDDEN }
      } ] },
      { protocol_name: "arbovirose", protocol_version: 1, rows: [ {
        tier: "verde", total: HIDDEN,
        outcomes: { discharged: HIDDEN, referred: 0, return: 0, left: 0, none: 0 },
        shares: { discharged: HIDDEN, referred: HIDDEN, return: HIDDEN, left: HIDDEN, none: HIDDEN }
      } ] }
    ],
    ...overrides
  };
}

export function epidemiologyData(overrides: Partial<EpidemiologyData> = {}): EpidemiologyData {
  return {
    ...base("epidemiology"),
    questions: [
      { protocol_name: "arbovirose", question_id: "febre", prompt: "Teve febre?", answer_type: "boolean", options: [
        { value: "true", label: "Sim", series: [ 7, HIDDEN, 0 ], total: 9 },
        { value: "false", label: "Não", series: [ HIDDEN, 0, 0 ], total: HIDDEN }
      ] },
      { protocol_name: "arbovirose", question_id: "sintoma", prompt: "Qual o sintoma principal?", answer_type: "enum", options: [
        { value: "dor de cabeça", label: "dor de cabeça", series: [ 5, 5, 0 ], total: 10 }
      ] }
    ],
    ...overrides
  };
}

export function envelope<F extends AnalyticsFront>(
  data: AnalyticsDataMap[F], opts: { as_of?: string | null; stale?: boolean } = {}
) {
  return { data, as_of: opts.as_of === undefined ? AS_OF : opts.as_of, stale: opts.stale ?? false };
}

export interface Failure { __status: number; body: unknown }
export const failWith = (status: number, body: unknown): Failure => ({ __status: status, body });

// routes: caminho sem "/admin/api" → corpo inteiro, Failure, ou função da URL
// que devolve um dos dois. /neighborhoods e /protocols já vêm preenchidos.
export function stubAnalyticsApi(routes: Record<string, unknown>) {
  const all: Record<string, unknown> = {
    "/neighborhoods": { neighborhoods: NEIGHBORHOODS },
    "/protocols": { data: { list: PROTOCOL_ROWS }, as_of: AS_OF },
    ...routes
  };
  const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    const entry = all[url.pathname.replace("/admin/api", "")];
    const body = typeof entry === "function" ? (entry as (u: URL) => unknown)(url) : entry;
    const headers = { "Content-Type": "application/json" };
    if (body === undefined) return new Response("", { status: 404 });
    if (body && typeof body === "object" && "__status" in body) {
      const failure = body as Failure;
      return new Response(JSON.stringify(failure.body), { status: failure.__status, headers });
    }
    return new Response(JSON.stringify(body), { status: 200, headers });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function paramsOf(fn: ReturnType<typeof stubAnalyticsApi>, path: string): URLSearchParams[] {
  return fn.mock.calls
    .map(([ input ]) => new URL(String(input), "http://x"))
    .filter((url) => url.pathname === `/admin/api${path}`)
    .map((url) => url.searchParams);
}

// Recharts (ResponsiveContainer) mede o pai por ResizeObserver; o jsdom não
// tem layout e o gráfico avisa "width(0) and height(0)". O stub informa um
// tamanho fixo ao observar.
class SizedResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const rect = { width: 600, height: 180, x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 180, toJSON() {} };
    this.callback([ { target, contentRect: rect } as unknown as ResizeObserverEntry ], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

// O provider vai como `wrapper` para o `rerender` também tê-lo.
export function renderWithQuery(ui: ReactElement) {
  vi.stubGlobal("ResizeObserver", SizedResizeObserver);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...render(ui, { wrapper }) };
}

// Texto da linha (role="row" do DataTable, ou <tr>) que contém `text`.
export function rowWith(container: HTMLElement, text: string): string {
  const rows = Array.from(container.querySelectorAll('[role="row"], tr'));
  const row = rows.find((r) => r.textContent?.includes(text));
  if (!row) throw new Error(`nenhuma linha com "${text}"`);
  return row.textContent ?? "";
}
