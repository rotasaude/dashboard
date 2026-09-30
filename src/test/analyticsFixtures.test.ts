// src/test/analyticsFixtures.test.ts
// Os fixtures padrão do módulo 14 obedecem ao "Total do grupo" dos contratos §0:
// um valor composto de partes da mesma resposta fica oculto se qualquer parte
// estiver oculta. Checador puro, sem render.
import { describe, expect, it } from "vitest";
import { calibrationData, demandData, epidemiologyData, qualityData } from "./analyticsFixtures";

type V = number | null | { suppressed: true };
const hidden = (v: unknown): boolean => typeof v === "object" && v !== null && "suppressed" in v;
const anyHidden = (vs: unknown[]) => vs.some(hidden);

// Se alguma parte está oculta, o composto tem de estar oculto.
function mustHide(errors: string[], label: string, composite: unknown, parts: unknown[]) {
  if (anyHidden(parts) && !hidden(composite)) errors.push(`${label} exibido com parte oculta`);
}

function rowTotal(errors: string[], label: string, row: { series: V[]; total: V }) {
  mustHide(errors, `${label}.total`, row.total, row.series);
}

export function demandViolations(d: ReturnType<typeof demandData>): string[] {
  const e: string[] = [];
  const { triages: t, triages_total: tt } = d;
  // started/aborted: só a própria série.
  mustHide(e, "triages_total.started", tt.started, t.started);
  mustHide(e, "triages_total.aborted", tt.aborted, t.aborted);
  // completed[p]: qualquer parte daquele período em by_tier/by_protocol.
  t.completed.forEach((cell, p) => {
    mustHide(e, `triages.completed[${p}]`, cell, [ ...d.by_tier.map((r) => r.series[p]), ...d.by_protocol.map((r) => r.series[p]) ]);
  });
  mustHide(e, "triages_total.completed", tt.completed, [
    ...t.completed, ...d.by_tier.map((r) => r.total), ...d.by_protocol.map((r) => r.total), ...d.by_neighborhood.map((r) => r.total)
  ]);
  [ ...d.by_tier.map((r) => [ `by_tier.${r.tier}`, r ] as const),
    ...d.by_protocol.map((r) => [ `by_protocol.${r.protocol_name}`, r ] as const),
    ...d.attendances_by_unit.map((r) => [ `attendances_by_unit.${r.name}`, r ] as const),
    ...d.requests_opened.map((r) => [ `requests_opened.${r.kind}`, r ] as const),
    ...d.requests_closed.map((r) => [ `requests_closed.${r.reason}`, r ] as const)
  ].forEach(([ label, r ]) => rowTotal(e, label, r));
  return e;
}

export function qualityViolations(q: ReturnType<typeof qualityData>): string[] {
  const e: string[] = [];
  const { wait, appointments, attendance_outcomes: outs } = q;
  wait.buckets.forEach((b) => rowTotal(e, `wait.${b.bucket}`, b));
  appointments.forEach((a) => rowTotal(e, `appointments.${a.status}`, a));
  outs.forEach((o) => rowTotal(e, `outcomes.${o.outcome}`, o));
  const rate = (label: string, series: V[], total: V, rows: { series: V[]; total: V }[]) => {
    series.forEach((cell, p) => mustHide(e, `${label}[${p}]`, cell, rows.map((r) => r.series[p])));
    mustHide(e, `${label}_total`, total, rows.map((r) => r.total));
  };
  rate("within_30_pct", wait.within_30_pct, wait.within_30_pct_total, wait.buckets);
  rate("no_show_pct", q.no_show_pct, q.no_show_pct_total,
    appointments.filter((a) => a.status === "checked_in" || a.status === "no_show"));
  rate("left_pct", q.left_pct, q.left_pct_total, outs);
  return e;
}

export function calibrationViolations(c: ReturnType<typeof calibrationData>): string[] {
  const e: string[] = [];
  c.versions.forEach((v) => v.rows.forEach((r) => {
    const label = `${v.protocol_name}@${v.protocol_version}.${r.tier}`;
    const outcomes = Object.values(r.outcomes);
    mustHide(e, `${label}.total`, r.total, outcomes);
    Object.entries(r.shares).forEach(([ k, s ]) => mustHide(e, `${label}.shares.${k}`, s, outcomes));
  }));
  return e;
}

export function epidemiologyViolations(d: ReturnType<typeof epidemiologyData>): string[] {
  const e: string[] = [];
  d.questions.forEach((q) => q.options.forEach((o) => rowTotal(e, `${q.question_id}.${o.value}`, o)));
  return e;
}

describe("fixtures do módulo 14 × total do grupo (contratos §0)", () => {
  it("demand", () => expect(demandViolations(demandData())).toEqual([]));
  it("quality", () => expect(qualityViolations(qualityData())).toEqual([]));
  it("calibration", () => expect(calibrationViolations(calibrationData())).toEqual([]));
  it("epidemiology", () => expect(epidemiologyViolations(epidemiologyData())).toEqual([]));

  it("o checador pega a violação (parte oculta, total visível)", () => {
    const d = demandData();
    d.triages_total = { ...d.triages_total, started: 13 };
    expect(demandViolations(d)).toEqual([ "triages_total.started exibido com parte oculta" ]);
    const c = calibrationData();
    c.versions[0].rows[1].shares.discharged = 50;
    expect(calibrationViolations(c)).toEqual([ "arbovirose@2.amarelo.shares.discharged exibido com parte oculta" ]);
  });
});
