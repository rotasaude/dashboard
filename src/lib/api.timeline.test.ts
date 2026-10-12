// src/lib/api.timeline.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTimeline, type TimelineFilters } from "./api";

const ALL: TimelineFilters = { kinds: [], from: "", to: "" };
const PAGE = { person: { display_name: "Joana Lima", partial: false, patient_id: "pa1" }, entries: [], next_before: null };

describe("getTimeline (contrato §3)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(PAGE), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function urlOf(i = 0): URL {
    return new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  }

  it("em contexto: attendance_id, limit 50 e nada mais", async () => {
    expect(await getTimeline({ attendanceId: "a1" }, ALL, null)).toEqual(PAGE);
    const url = urlOf();
    expect(url.pathname).toBe("/attendance/timeline");
    expect([ ...url.searchParams.entries() ]).toEqual([ [ "attendance_id", "a1" ], [ "limit", "50" ] ]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBeUndefined();
    expect(init.credentials).toBe("include");
  });

  it("abertura e paciente; kinds[] repetido, período e o cursor como veio", async () => {
    await getTimeline({ openingId: "op1" }, { kinds: [ "consultation", "clinical_document" ], from: "2026-09-01", to: "2026-09-30" },
      "2026-09-10T14:40:00-03:00|clinical_document|dc1");
    const url = urlOf();
    expect(url.searchParams.get("opening_id")).toBe("op1");
    expect(url.searchParams.getAll("kinds[]")).toEqual([ "consultation", "clinical_document" ]);
    expect(url.searchParams.get("from")).toBe("2026-09-01");
    expect(url.searchParams.get("to")).toBe("2026-09-30");
    expect(url.searchParams.get("before")).toBe("2026-09-10T14:40:00-03:00|clinical_document|dc1");

    await getTimeline({ patientId: "pa1" }, ALL, null);
    expect(urlOf(1).searchParams.get("patient_id")).toBe("pa1");
    expect(urlOf(1).searchParams.has("before")).toBe(false);
  });

  it("nunca põe CPF, nome ou texto na URL", async () => {
    await getTimeline({ attendanceId: "a1" }, ALL, null);
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/cpf|name|nome|\d{11}/i);
  });

  it("recusa vira ApiError com o código do corpo", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "opening_required" }), { status: 403 })));
    await expect(getTimeline({ openingId: "op1" }, ALL, null)).rejects.toMatchObject({ status: 403, body: { error: "opening_required" } });
  });
});
