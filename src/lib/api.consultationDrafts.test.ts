// src/lib/api.consultationDrafts.test.ts
// Cliente dos rascunhos abertos (fix51, api#51): motivo e user_id só no corpo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { discardDraft, listDraftCandidates, listOpenDrafts, reassignDraft } from "./api";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof stub>) => fn.mock.calls[0] as [ string, RequestInit ];

describe("cliente dos rascunhos abertos", () => {
  it("lista é GET sem corpo e devolve o array", async () => {
    const draft = { consultation_id: "c1", attendance_id: "a1", health_unit: { id: "u1", name: "UBS Centro" },
      author: { user_id: "us1", name: "Dra. Helena" }, author_linked: true, patient_initials: "J.L.", issued_documents: 0,
      started_at: "2026-10-09T09:00:00Z", last_saved_at: "2026-10-09T09:30:00Z" };
    const fn = stub({ drafts: [ draft ] });
    expect(await listOpenDrafts()).toEqual([ draft ]);
    expect(call(fn)[0]).toBe("/clinical_record/consultation_drafts");
    expect(call(fn)[1].method).toBeUndefined();
    expect(call(fn)[1].credentials).toBe("include");
  });

  it("candidatos: GET com o id escapado na URL", async () => {
    const cand = { user_id: "us2", name: "Dr. Caio", cbo_code: "225142", cbo_title: "Médico da estratégia de saúde da família",
      council: "CRM", council_state: "PR", registration_number: "123" };
    const fn = stub({ candidates: [ cand ] });
    expect(await listDraftCandidates("c/1")).toEqual([ cand ]);
    expect(call(fn)[0]).toBe("/clinical_record/consultation_drafts/c%2F1/candidates");
  });

  it("descartar: POST JSON com o motivo só no corpo", async () => {
    const fn = stub({ consultation_id: "c1", status: "discarded" });
    expect((await discardDraft("c1", "paciente foi embora")).status).toBe("discarded");
    const [ url, init ] = call(fn);
    expect(url).toBe("/clinical_record/consultation_drafts/c1/discard");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "paciente foi embora" });
    expect(url).not.toContain("paciente");
  });

  it("designar: POST JSON com user_id e motivo no corpo", async () => {
    const fn = stub({ consultation_id: "c1", author: { user_id: "us2", name: "Dr. Caio" } });
    expect((await reassignDraft("c1", "us2", "profissional saiu da unidade")).author.user_id).toBe("us2");
    const [ url, init ] = call(fn);
    expect(url).toBe("/clinical_record/consultation_drafts/c1/reassign");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ user_id: "us2", reason: "profissional saiu da unidade" });
    expect(url).not.toContain("us2?");
  });
});
