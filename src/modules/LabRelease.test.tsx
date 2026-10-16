// src/modules/LabRelease.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listReleases: vi.fn(), getReleaseRequisition: vi.fn(),
    listUnnotifiedCriticals: vi.fn(), recordCriticalNotice: vi.fn(), chooseLabResult: vi.fn(), releaseRequisition: vi.fn(), listLabRequisitions: vi.fn() };
});

import * as api from "../lib/api";
import { LabRelease } from "./LabRelease";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW21B, labContext, labItem, labReport, labResultRow, labUser, releaseRequisition } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listReleases, api.getReleaseRequisition, api.listUnnotifiedCriticals,
  api.recordCriticalNotice, api.chooseLabResult, api.releaseRequisition, api.listLabRequisitions ];

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  // Relógio da cidade fixo ANTES de a sessão ser criada (mfa_verified_at e "quando" dependem dele).
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21B));
  mocked(api.fetchCurrentSession).mockResolvedValue(releaser());
  mocked(api.getLabContext).mockResolvedValue(labContext({ releaser_of: [ "pv9" ], council: "CRF" }));
  mocked(api.listReleases).mockResolvedValue([ releaseRequisition() ]);
  mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition());
  mocked(api.listUnnotifiedCriticals).mockResolvedValue([]);
  mocked(api.releaseRequisition).mockResolvedValue(labReport());
  mocked(api.listLabRequisitions).mockResolvedValue({ requisitions: [], next_before: null });
});

const FEATURES = [ "exam_tracking", "municipal_lab", "digital_signature" ];
const releaser = (features: string[] = FEATURES) => labUser([ "lab_releaser" ], { features });

async function openReview() {
  renderWithProviders(<LabRelease onNavigate={vi.fn()} />);
  const queue = await screen.findByRole("region", { name: "Fila de liberação" });
  fireEvent.click(await within(queue).findByRole("button", { name: "Conferir" }));
  return screen.findByRole("region", { name: "Conferência da requisição 00000123" });
}

describe("LabRelease", () => {
  it("assinatura avançada: manda o TOTP e apaga o código; laudo liberado relê a fila", async () => {
    const review = await openReview();
    fireEvent.click(within(review).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    await waitFor(() => expect(api.releaseRequisition).toHaveBeenCalledWith("rq1", { item_ids: [ "it2" ], signature: "advanced", totp: "123456" }));
    expect(await screen.findByText("Laudo liberado com assinatura eletrônica avançada.")).not.toBeNull();
    await waitFor(() => expect(api.listReleases).toHaveBeenCalledTimes(2));
  });

  it("assinatura avançada com código recusado: apaga o código e pede de novo", async () => {
    mocked(api.releaseRequisition).mockRejectedValueOnce(new api.ApiError(401, { error: "mfa_required" }, "x"));
    const review = await openReview();
    fireEvent.click(within(review).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "654321" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect((await within(review).findByRole("alert")).textContent).toBe("o código do autenticador não valeu — digite o código atual");
    expect((within(review).getByLabelText("Código do autenticador") as HTMLInputElement).value).toBe("");
    expect(api.releaseRequisition).toHaveBeenCalledTimes(1);
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect(within(review).getByRole("alert").textContent).toBe("digite os 6 dígitos do autenticador");
    expect(api.releaseRequisition).toHaveBeenCalledTimes(1);
  });

  it("409 invalid_transition na liberação: explica, limpa o código e relê a fila", async () => {
    mocked(api.releaseRequisition).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    const review = await openReview();
    fireEvent.click(within(review).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect(await screen.findByText("a situação mudou — a tela foi atualizada")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Conferência da requisição 00000123" })).toBeNull();
    await waitFor(() => expect(api.listReleases).toHaveBeenCalledTimes(2));
  });

  it("médico (CRM): só ICP; o laudo vai para Pendentes de assinatura", async () => {
    mocked(api.getLabContext).mockResolvedValue(labContext({ releaser_of: [ "pv9" ], council: "CRM" }));
    mocked(api.releaseRequisition).mockResolvedValue(labReport({ status: "pending_signature", signature_kind: "icp", pdf_url: null, released_at: null }));
    const onNavigate = vi.fn();
    renderWithProviders(<LabRelease onNavigate={onNavigate} />);
    fireEvent.click(await within(await screen.findByRole("region", { name: "Fila de liberação" })).findByRole("button", { name: "Conferir" }));
    const review = await screen.findByRole("region", { name: "Conferência da requisição 00000123" });
    expect(within(review).queryByLabelText("Assinatura eletrônica avançada (código do autenticador)")).toBeNull();
    expect(within(review).getByText("médico (CRM) libera só com ICP-Brasil")).not.toBeNull();
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    await waitFor(() => expect(api.releaseRequisition).toHaveBeenCalledWith("rq1", { item_ids: [ "it2" ], signature: "icp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ir para Pendentes de assinatura" }));
    expect(onNavigate).toHaveBeenCalledWith("signature-pending");
  });

  it("repetição: escolher o valor que vale relê a requisição", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({ items: [ {
      ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: "lipêmica",
      results: [ labResultRow({ id: "r1", value: "410", source: "hl7", chosen: true, effective: true, flag: "critical_high", notified: true }),
        labResultRow({ id: "r2", value: "98", chosen: false, effective: false }) ]
    } ] }));
    mocked(api.chooseLabResult).mockResolvedValue(labResultRow({ id: "r3", value: "98", chosen: true }));
    const review = await openReview();
    expect(within(review).getByText("restrição da amostra: lipêmica")).not.toBeNull();
    const values = within(review).getByRole("list", { name: "Glicose · valores" });
    expect(within(values).getAllByRole("listitem")[0].textContent).toContain("aparelho");
    fireEvent.click(within(values).getByRole("button", { name: "Usar 98" }));
    await waitFor(() => expect(api.chooseLabResult).toHaveBeenCalledWith("r2"));
    await waitFor(() => expect(api.getReleaseRequisition).toHaveBeenCalledTimes(2));
  });

  it("crítico sem aviso: confirma antes de liberar, ou registra o aviso", async () => {
    // "Quando" não pode ser no futuro: o relógio da cidade fica em 15/10/2026 10:00 (fixado no beforeEach).
    mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({ items: [ {
      ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: null,
      results: [ labResultRow({ id: "r1", value: "450", flag: "critical_high", chosen: true, notified: false }) ]
    } ] }));
    const review = await openReview();
    fireEvent.click(within(review).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect(within(review).getByText("1 valor crítico sem registro de aviso. Liberar mesmo assim? O aviso fica pendente em Críticos sem aviso.")).not.toBeNull();
    expect(api.releaseRequisition).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole("button", { name: "Registrar o aviso antes" }));
    const form = within(review).getByRole("region", { name: "Aviso do valor crítico — Glicose" });
    fireEvent.change(within(form).getByLabelText("Quem foi avisado"), { target: { value: "Dra. Ana" } });
    fireEvent.change(within(form).getByLabelText("Função"), { target: { value: "médica da UBS" } });
    fireEvent.change(within(form).getByLabelText("Como"), { target: { value: "telefone" } });
    fireEvent.change(within(form).getByLabelText("Quando"), { target: { value: "2026-10-15T09:40" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar aviso" }));
    await waitFor(() => expect(api.recordCriticalNotice).toHaveBeenCalledWith({
      result_id: "r1", notified_person: "Dra. Ana", notified_role: "médica da UBS", channel: "telefone", notified_at: "2026-10-15T09:40:00-03:00"
    }));
  });

  it("ICP não é padrão quando a cidade não tem assinatura digital: só a avançada, sem oferecer ICP", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(releaser([ "exam_tracking", "municipal_lab" ]));
    const review = await openReview();
    expect(within(review).queryByLabelText("ICP-Brasil (assina em Pendentes de assinatura)")).toBeNull();
    expect((within(review).getByLabelText("Assinatura eletrônica avançada (código do autenticador)") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    await waitFor(() => expect(api.releaseRequisition).toHaveBeenCalledWith("rq1", { item_ids: [ "it2" ], signature: "advanced", totp: "123456" }));
  });

  it("médico (CRM) em cidade sem assinatura digital: avisa que não libera aqui e não chama o api", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(releaser([ "exam_tracking", "municipal_lab" ]));
    mocked(api.getLabContext).mockResolvedValue(labContext({ releaser_of: [ "pv9" ], council: "CRM" }));
    const review = await openReview();
    expect(within(review).getByText("médico não libera nesta cidade — a assinatura ICP-Brasil não está ativa")).not.toBeNull();
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect((await within(review).findByRole("alert")).textContent).toBe("médico não libera nesta cidade — a assinatura ICP-Brasil não está ativa");
    expect(api.releaseRequisition).not.toHaveBeenCalled();
  });

  it("erro signature_unavailable: mostra a frase e passa para a avançada", async () => {
    mocked(api.releaseRequisition).mockRejectedValueOnce(new api.ApiError(422, { error: "signature_unavailable" }, "x"));
    const review = await openReview();
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect((await within(review).findByRole("alert")).textContent).toBe("a assinatura ICP-Brasil não está disponível nesta cidade — peça ao administrador para ativá-la");
    expect((within(review).getByLabelText("Assinatura eletrônica avançada (código do autenticador)") as HTMLInputElement).checked).toBe(true);
  });

  it("D1: o valor que vale é o effective — crítico sem aviso pede confirmação mesmo com chosen falso", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({ items: [ {
      ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: null,
      results: [
        labResultRow({ id: "r1", value: "450", flag: "critical_high", chosen: false, effective: false, notified: false }),
        labResultRow({ id: "r2", value: "460", flag: "critical_high", chosen: false, effective: true, notified: false })
      ]
    } ] }));
    const review = await openReview();
    const values = within(review).getByRole("list", { name: "Glicose · valores" });
    const [ first, second ] = within(values).getAllByRole("listitem");
    expect(within(second).getByText("vale")).not.toBeNull();
    expect(within(first).queryByText("vale")).toBeNull();
    expect(within(first).getByRole("button", { name: "Usar 450" })).not.toBeNull();
    expect(within(second).queryByRole("button", { name: /^Usar/ })).toBeNull();
    fireEvent.click(within(review).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect(within(review).getByText("1 valor crítico sem registro de aviso. Liberar mesmo assim? O aviso fica pendente em Críticos sem aviso.")).not.toBeNull();
    expect(api.releaseRequisition).not.toHaveBeenCalled();
  });

  it("fila: a tag crítico segue o valor que vale e as colunas têm rótulo único (sem aviso de chave do React)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocked(api.listReleases).mockResolvedValue([ releaseRequisition({ urgent: true, items: [ {
      ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: null,
      results: [ labResultRow({ id: "r1", value: "450", flag: "critical_high", chosen: false, effective: true }),
        labResultRow({ id: "r2", value: "98", chosen: true, effective: false }) ]
    } ] }) ]);
    renderWithProviders(<LabRelease onNavigate={vi.fn()} />);
    const queue = await screen.findByRole("region", { name: "Fila de liberação" });
    expect(await within(queue).findByText("crítico")).not.toBeNull();
    expect(within(queue).getByText("urgente")).not.toBeNull();
    expect(errors.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    expect(within(queue).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([ "Requisição", "Paciente", "Exames", "Marcas", "Ação" ]);
  });

  it("escolher o valor: se a releitura falhar, a escolha não é dada como falha", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValueOnce(releaseRequisition({ items: [ {
      ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: null,
      results: [ labResultRow({ id: "r1", value: "410", effective: true }), labResultRow({ id: "r2", value: "98", effective: false }) ]
    } ] }));
    mocked(api.chooseLabResult).mockResolvedValue(labResultRow({ id: "r3", value: "98" }));
    const review = await openReview();
    mocked(api.getReleaseRequisition).mockRejectedValue(new api.ApiError(500, { error: "boom" }, "x"));
    fireEvent.click(within(review).getByRole("button", { name: "Usar 98" }));
    const message = await within(review).findByRole("alert");
    expect(message.textContent).toContain("valor escolhido, mas não foi possível reler a requisição");
    expect(within(review).getByRole("list", { name: "Glicose · valores" })).not.toBeNull();
  });

  it("sem releitura automática: a fila e os críticos são lidos uma vez", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProviders(<LabRelease onNavigate={vi.fn()} />);
    await screen.findByRole("region", { name: "Fila de liberação" });
    await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
    expect(api.listReleases).toHaveBeenCalledTimes(1);
    expect(api.listUnnotifiedCriticals).toHaveBeenCalledTimes(1);
  });
});
