import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listExamOrders: vi.fn(), getExamOrder: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ConsultationExamStatus } from "./ConsultationExamStatus";
import { ConsultationView } from "../consultation/ConsultationView";
import { renderWithProviders } from "../../test/campaignFixtures";
import { finalized, options } from "../../test/consultationFixtures";
import { examOrder, examUser } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const REQUESTS = [
  { sigtap_code: "0202020380", label: "Hemograma completo", priority: "urgent" as const },
  { sigtap_code: "0202010503", label: "Dosagem de hemoglobina glicosilada" }
];

afterEach(cleanup);

describe("ConsultationExamStatus", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listExamOrders, api.getExamOrder ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser());
    mocked(api.listExamOrders).mockResolvedValue({ orders: [ examOrder({ status: "scheduled" }) ], next_before: null });
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "scheduled" }));
  });

  it("cada exame pedido com a situação; sem exame acompanhado diz isso; Acompanhar abre o exame", async () => {
    renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={REQUESTS} />);
    const items = (await screen.findAllByRole("listitem"));
    await within(items[0]).findByText("agendado");
    expect(within(items[0]).getByText("urgente")).not.toBeNull();
    expect(within(items[1]).getByText("sem acompanhamento")).not.toBeNull();
    expect(api.listExamOrders).toHaveBeenCalledWith({ consultationId: "c1" });
    fireEvent.click(within(items[0]).getByRole("button", { name: "Acompanhar Hemograma completo" }));
    expect(await screen.findByRole("region", { name: "Exame Hemograma completo" })).not.toBeNull();
  });

  it.each([ [ "cancelada antes" ], [ "cancelada depois" ] ])("mesmo código com duas ordens (%s): mostra a não cancelada e abre essa", async (which) => {
    const cancelled = examOrder({ id: "eo-old", status: "cancelled", status_changed_at: "2026-10-11T09:00:00-03:00" });
    const live = examOrder({ id: "eo-new", status: "scheduled", status_changed_at: "2026-10-12T09:00:00-03:00" });
    mocked(api.listExamOrders).mockResolvedValue({ orders: which === "cancelada antes" ? [ cancelled, live ] : [ live, cancelled ], next_before: null });
    mocked(api.getExamOrder).mockImplementation(async (id: string) => (id === "eo-new" ? live : cancelled));
    renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={[ REQUESTS[0] ]} />);
    const item = (await screen.findAllByRole("listitem"))[0];
    await within(item).findByText("agendado");
    expect(within(item).queryByText("cancelado")).toBeNull();
    fireEvent.click(within(item).getByRole("button", { name: "Acompanhar Hemograma completo" }));
    await screen.findByRole("region", { name: "Exame Hemograma completo" });
    expect(api.getExamOrder).toHaveBeenCalledWith("eo-new");
  });

  it("duas ordens do mesmo código ligadas a pedidos distintos: cada linha mostra a sua", async () => {
    const o1 = examOrder({ id: "eo-1", status: "scheduled", consultation_exam_request_id: "rq1" });
    const o2 = examOrder({ id: "eo-2", status: "collected", consultation_exam_request_id: "rq2" });
    mocked(api.listExamOrders).mockResolvedValue({ orders: [ o1, o2 ], next_before: null });
    mocked(api.getExamOrder).mockImplementation(async (id: string) => (id === "eo-1" ? o1 : o2));
    const reqs = [ { id: "rq1", sigtap_code: "0202020380", label: "Hemograma completo" }, { id: "rq2", sigtap_code: "0202020380", label: "Hemograma completo" } ];
    renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={reqs} />);
    const items = await screen.findAllByRole("listitem");
    await within(items[0]).findByText("agendado");
    await within(items[1]).findByText("coletado");
    fireEvent.click(within(items[1]).getByRole("button", { name: "Acompanhar Hemograma completo" }));
    await screen.findByRole("region", { name: "Exame Hemograma completo" });
    expect(api.getExamOrder).toHaveBeenCalledWith("eo-2");
  });

  it("pedido com id sem ordem ligada não pega a ordem de outro pedido; sem id usa a heurística", async () => {
    const o1 = examOrder({ id: "eo-1", status: "scheduled", consultation_exam_request_id: "rq1" });
    mocked(api.listExamOrders).mockResolvedValue({ orders: [ o1 ], next_before: null });
    const reqs = [ { id: "rq9", sigtap_code: "0202020380", label: "Hemograma completo" }, { sigtap_code: "0202020380", label: "Hemograma completo" } ];
    renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={reqs} />);
    const items = await screen.findAllByRole("listitem");
    await within(items[1]).findByText("agendado");
    expect(within(items[0]).getByText("sem acompanhamento")).not.toBeNull();
  });

  it("linha sem id não pega a ordem já ligada a uma linha com id; pega a do adendo", async () => {
    const a = examOrder({ id: "eo-a", status: "cancelled", status_changed_at: "2026-10-12T09:00:00-03:00", consultation_exam_request_id: "rq1" });
    const b = examOrder({ id: "eo-b", status: "scheduled", status_changed_at: "2026-10-11T09:00:00-03:00", consultation_exam_request_id: "rq-hidden" });
    const reqs = [ { id: "rq1", sigtap_code: "0202020380", label: "Hemograma completo" }, { sigtap_code: "0202020380", label: "Hemograma completo" } ];
    mocked(api.listExamOrders).mockResolvedValue({ orders: [ a, b ], next_before: null });
    const { unmount } = renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={reqs} />);
    let items = await screen.findAllByRole("listitem");
    await within(items[1]).findByText("agendado");
    expect(within(items[0]).getByText("cancelado")).not.toBeNull();
    unmount();
    mocked(api.listExamOrders).mockResolvedValue({ orders: [ a ], next_before: null });
    renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={reqs} />);
    items = await screen.findAllByRole("listitem");
    await within(items[0]).findByText("cancelado");
    expect(within(items[1]).getByText("sem acompanhamento")).not.toBeNull();
    expect(within(items[1]).queryByText("cancelado")).toBeNull();
  });

  it("pedido com id sem ordem e lista cortada: 'veja na tela Exames'", async () => {
    mocked(api.listExamOrders).mockResolvedValue({ orders: [], next_before: "cursor-1" });
    renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={[ { id: "rq1", sigtap_code: "0202020380", label: "Hemograma completo" } ]} />);
    const item = (await screen.findAllByRole("listitem"))[0];
    await within(item).findByText("veja na tela Exames");
  });

  it("todas canceladas: a de mudança de situação mais recente", async () => {
    const a = examOrder({ id: "eo-a", status: "cancelled", status_changed_at: "2026-10-11T09:00:00-03:00" });
    const b = examOrder({ id: "eo-b", status: "cancelled", status_changed_at: "2026-10-12T09:00:00-03:00" });
    mocked(api.listExamOrders).mockResolvedValue({ orders: [ b, a ], next_before: null });
    mocked(api.getExamOrder).mockImplementation(async (id: string) => (id === "eo-b" ? b : a));
    renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={[ REQUESTS[0] ]} />);
    const item = (await screen.findAllByRole("listitem"))[0];
    fireEvent.click(await within(item).findByRole("button", { name: "Acompanhar Hemograma completo" }));
    await screen.findByRole("region", { name: "Exame Hemograma completo" });
    expect(api.getExamOrder).toHaveBeenCalledWith("eo-b");
  });

  it("lista cortada (next_before): exame ausente não diz 'sem acompanhamento'", async () => {
    mocked(api.listExamOrders).mockResolvedValue({ orders: [ examOrder({ status: "scheduled" }) ], next_before: "cursor-1" });
    renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={REQUESTS} />);
    const items = await screen.findAllByRole("listitem");
    await within(items[0]).findByText("agendado");
    expect(within(items[1]).queryByText("sem acompanhamento")).toBeNull();
    expect(within(items[1]).getByText("veja na tela Exames")).not.toBeNull();
  });

  it("a leitura falha: a lista continua e a frase aparece", async () => {
    mocked(api.listExamOrders).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "exam_tracking" }, "x"));
    renderWithProviders(<ConsultationExamStatus consultationId="c1" requests={REQUESTS} />);
    expect((await screen.findByRole("alert")).textContent).toBe("o rastreamento de exames está desligado nesta cidade");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("ConsultationView usa o acompanhamento só com o rastreamento ligado e fora da leitura administrativa", async () => {
    const c = finalized({ exam_requests: REQUESTS });
    renderWithProviders(<ConsultationView consultation={c} options={options()} patientProblems={[]} onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("agendado");
    cleanup();
    mocked(api.listExamOrders).mockClear();
    renderWithProviders(<ConsultationView consultation={c} options={options()} patientProblems={[]} readOnly onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("list", { name: "exames solicitados" });
    expect(api.listExamOrders).not.toHaveBeenCalled();
  });
});
