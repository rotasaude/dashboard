// src/lib/api.analytics.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchAnalytics } from "./api";
import {
  calibrationData, demandData, envelope, failWith, paramsOf, qualityData, stubAnalyticsApi
} from "../test/analyticsFixtures";

afterEach(() => vi.unstubAllGlobals());

const RANGE = { from: "2026-07-13", to: "2026-09-29" };

describe("fetchAnalytics", () => {
  it("chama /admin/api/analytics/:front só com os parâmetros preenchidos, com o cookie", async () => {
    const fn = stubAnalyticsApi({ "/analytics/demand": envelope<"demand">(demandData()) });
    await fetchAnalytics("demand", {
      ...RANGE, granularity: "week", neighborhood_id: "none", health_unit_id: null, protocol_name: "arbovirose", protocol_version: null
    });
    const [ params ] = paramsOf(fn, "/analytics/demand");
    expect(Object.fromEntries(params)).toEqual({
      from: "2026-07-13", to: "2026-09-29", granularity: "week", neighborhood_id: "none", protocol_name: "arbovirose"
    });
    expect((fn.mock.calls[0][1] as RequestInit).credentials).toBe("include");
  });

  it("protocol_version só vai junto com protocol_name, e calibration nunca leva granularity", async () => {
    const fn = stubAnalyticsApi({ "/analytics/calibration": envelope<"calibration">(calibrationData()) });
    await fetchAnalytics("calibration", { ...RANGE, protocol_version: 2 });
    await fetchAnalytics("calibration", { ...RANGE, granularity: "week", protocol_name: "arbovirose", protocol_version: 2 });
    const [ alone, both ] = paramsOf(fn, "/analytics/calibration");
    expect(alone.has("protocol_version")).toBe(false);
    expect(both.get("protocol_version")).toBe("2");
    expect(both.has("granularity")).toBe(false);
  });

  it("devolve o envelope com as_of nulo e stale", async () => {
    stubAnalyticsApi({ "/analytics/quality": envelope<"quality">(qualityData(), { as_of: null, stale: true }) });
    const env = await fetchAnalytics("quality", { ...RANGE, granularity: "month" });
    expect(env.as_of).toBeNull();
    expect(env.stale).toBe(true);
    expect(env.data.wait.buckets).toHaveLength(5);
  });

  it("recusa vira ApiError com o código do corpo", async () => {
    stubAnalyticsApi({ "/analytics/demand": failWith(422, { error: "invalid_unit" }) });
    const err = await fetchAnalytics("demand", RANGE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).body).toEqual({ error: "invalid_unit" });
  });
});
