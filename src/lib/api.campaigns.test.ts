// src/lib/api.campaigns.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelCampaign, createCampaign, getCampaign, getCampaignOptions, getSmsSetting, listCampaigns, previewAudience,
  scheduleCampaign, sendCampaign, setSmsSetting, unscheduleCampaign, updateCampaign
} from "./api";
import { CITY_AUDIENCE, OPTIONS, campaign } from "../test/campaignFixtures";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof stub>, i = 0) => fn.mock.calls[i] as [ string, RequestInit ];
const contentType = (init: RequestInit) => (init.headers as Record<string, string>)["Content-Type"];

describe("cliente /campaigns", () => {
  it("lista desembrulha { campaigns } e manda o cookie", async () => {
    const fn = stub({ campaigns: [ campaign() ] });
    expect((await listCampaigns()).map((c) => c.title)).toEqual([ "Vacinação contra a gripe" ]);
    expect(call(fn)[0]).toBe("/campaigns");
    expect(call(fn)[1].credentials).toBe("include");
  });

  it("opções vêm soltas, sem envelope", async () => {
    const fn = stub(OPTIONS);
    expect((await getCampaignOptions()).tiers).toEqual([ "vermelha", "amarela" ]);
    expect(call(fn)[0]).toBe("/campaigns/options");
  });

  it("prévia manda o público e devolve a contagem ou below_minimum", async () => {
    const fn = stub({ citizens: 12, phones: 9 });
    expect(await previewAudience(CITY_AUDIENCE)).toEqual({ citizens: 12, phones: 9 });
    expect(call(fn)[0]).toBe("/campaigns/preview");
    expect(call(fn)[1].method).toBe("POST");
    expect(JSON.parse(call(fn)[1].body as string)).toEqual({ audience: CITY_AUDIENCE });

    stub({ below_minimum: true });
    expect(await previewAudience(CITY_AUDIENCE)).toEqual({ below_minimum: true });
  });

  it("cria com POST e desembrulha { campaign } do 201", async () => {
    const fn = stub({ campaign: campaign() }, 201);
    const fields = { title: "Vacinação contra a gripe", body: "Vacinação no sábado.", audience: CITY_AUDIENCE };
    expect((await createCampaign(fields)).id).toBe("c1");
    expect(call(fn)[0]).toBe("/campaigns");
    expect(call(fn)[1].method).toBe("POST");
    expect(JSON.parse(call(fn)[1].body as string)).toEqual(fields);
  });

  it("lê e edita no id escapado; editar é PATCH", async () => {
    const fn = stub({ campaign: campaign({ id: "c/1" }) });
    await getCampaign("c/1");
    await updateCampaign("c/1", { title: "Novo título" });
    expect(call(fn, 0)[0]).toBe("/campaigns/c%2F1");
    expect(call(fn, 1)[0]).toBe("/campaigns/c%2F1");
    expect(call(fn, 1)[1].method).toBe("PATCH");
    expect(JSON.parse(call(fn, 1)[1].body as string)).toEqual({ title: "Novo título" });
  });

  it("enviar, desagendar e cancelar mandam '{}' como JSON (a API recusa escrita sem JSON com 415)", async () => {
    const fn = stub({ campaign: campaign({ status: "sending" }) });
    await sendCampaign("c1");
    await unscheduleCampaign("c1");
    await cancelCampaign("c1");
    expect([ 0, 1, 2 ].map((i) => call(fn, i)[0])).toEqual([
      "/campaigns/c1/send", "/campaigns/c1/unschedule", "/campaigns/c1/cancel"
    ]);
    for (const i of [ 0, 1, 2 ]) {
      expect(call(fn, i)[1].method).toBe("POST");
      expect(call(fn, i)[1].body).toBe("{}");
      expect(contentType(call(fn, i)[1])).toBe("application/json");
    }
  });

  it("agendar manda send_at", async () => {
    const fn = stub({ campaign: campaign({ status: "scheduled", send_at: "2026-09-30T12:00:00.000Z" }) });
    expect((await scheduleCampaign("c1", "2026-09-30T12:00:00.000Z")).status).toBe("scheduled");
    expect(call(fn)[0]).toBe("/campaigns/c1/schedule");
    expect(JSON.parse(call(fn)[1].body as string)).toEqual({ send_at: "2026-09-30T12:00:00.000Z" });
  });

  it("chave de SMS: GET lê, PUT grava enabled", async () => {
    const fn = stub({ enabled: true, gateway_configured: false });
    expect(await getSmsSetting()).toEqual({ enabled: true, gateway_configured: false });
    await setSmsSetting(true);
    expect(call(fn, 0)[0]).toBe("/campaigns/sms_setting");
    expect(call(fn, 1)[0]).toBe("/campaigns/sms_setting");
    expect(call(fn, 1)[1].method).toBe("PUT");
    expect(JSON.parse(call(fn, 1)[1].body as string)).toEqual({ enabled: true });
  });
});
