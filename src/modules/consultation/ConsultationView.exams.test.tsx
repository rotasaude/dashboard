import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listExamOrders: vi.fn(), getExamOrder: vi.fn() };
});

import * as api from "../../lib/api";
import { ConsultationView } from "./ConsultationView";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { consultation, finalized, options } from "../../test/consultationFixtures";
import { examOrder } from "../../test/examFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const REQ = [ { sigtap_code: "0202020380", label: "Hemograma completo", priority: "urgent" as const } ];
const session = (features: string[]) => sessionWith([ "health_professional" ], { id: "us1", features });
const view = (c = finalized({ exam_requests: REQ })) =>
  renderWithProviders(<ConsultationView consultation={c} options={options()} patientProblems={[]} onAddendumAdded={() => undefined} onClose={() => undefined} />);

describe("ConsultationView — situação dos exames (guardas)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listExamOrders, api.getExamOrder ]) mocked(fn).mockReset();
    mocked(api.listExamOrders).mockResolvedValue({ orders: [ examOrder({ status: "scheduled" }) ], next_before: null });
  });

  it("exam_tracking desligado: não lê os exames e mostra a lista de sempre", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session([ "clinical_record" ]));
    view();
    const list = await screen.findByRole("list", { name: "exames solicitados" });
    await new Promise((r) => setTimeout(r, 30));
    expect(list.textContent).toBe("0202020380 — Hemograma completo");
    expect(api.listExamOrders).not.toHaveBeenCalled();
    expect(screen.queryByText("urgente")).toBeNull();
  });

  it("rascunho (não finalizada): sem situação dos exames", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session([ "clinical_record", "exam_tracking" ]));
    view(consultation({ exam_requests: REQ }));
    await screen.findByRole("list", { name: "exames solicitados" });
    await new Promise((r) => setTimeout(r, 30));
    expect(api.listExamOrders).not.toHaveBeenCalled();
  });
});
