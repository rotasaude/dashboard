// src/modules/LabRelease.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listReleases: vi.fn(), getReleaseRequisition: vi.fn(),
    listUnnotifiedCriticals: vi.fn(), recordCriticalNotice: vi.fn(), chooseLabResult: vi.fn(), releaseRequisition: vi.fn(), listLabRequisitions: vi.fn(), rectifyLabReport: vi.fn() };
});

import * as api from "../lib/api";
import { LabRelease } from "./LabRelease";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW21B, labContext, labItem, labReport, labResultRow, labUser, releaseRequisition } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listReleases, api.getReleaseRequisition, api.listUnnotifiedCriticals,
  api.recordCriticalNotice, api.chooseLabResult, api.releaseRequisition, api.listLabRequisitions, api.rectifyLabReport ];

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
    const button = within(review).getByRole("button", { name: "Liberar laudo" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
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

  const critItem = (over: object = {}) => releaseRequisition({ items: [ {
    ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: null,
    results: [ labResultRow({ id: "r1", value: "450", flag: "critical_high", notified: false }) ], ...over
  } ] });
  const fillAdvanced = (review: HTMLElement) => {
    fireEvent.click(within(review).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
  };

  it("I1: com uma liberação em andamento, nenhum outro liberar nem Usar sai", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValue(critItem());
    let finish: (v: unknown) => void = () => {};
    mocked(api.releaseRequisition).mockReturnValue(new Promise((res) => { finish = res; }));
    const review = await openReview();
    fillAdvanced(review);
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    fireEvent.click(within(review).getByRole("button", { name: "Liberar sem aviso" }));
    await waitFor(() => expect(api.releaseRequisition).toHaveBeenCalledTimes(1));
    fillAdvanced(review);
    fireEvent.click(within(review).getByRole("button", { name: /^Liberar laudo/ }));
    fireEvent.click(within(review).queryByRole("button", { name: "Liberar sem aviso" }) ?? review);
    expect(within(review).queryByRole("group", { name: "crítico sem aviso" })).toBeNull();
    expect(api.releaseRequisition).toHaveBeenCalledTimes(1);
    finish(labReport());
    expect(await screen.findByText("Laudo liberado com assinatura eletrônica avançada.")).not.toBeNull();
  });

  it("I1: Usar X em clique duplo ou em sequência manda uma escolha só", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({ items: [ {
      ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: null,
      results: [ labResultRow({ id: "r1", value: "410", effective: true }), labResultRow({ id: "r2", value: "98", effective: false }),
        labResultRow({ id: "r3", value: "120", effective: false }) ]
    } ] }));
    let finish: (v: unknown) => void = () => {};
    mocked(api.chooseLabResult).mockReturnValue(new Promise((res) => { finish = res; }));
    const review = await openReview();
    const use98 = within(review).getByRole("button", { name: "Usar 98" });
    const use120 = within(review).getByRole("button", { name: "Usar 120" });
    fireEvent.click(use98);
    fireEvent.click(use98);
    fireEvent.click(use120);
    expect(api.chooseLabResult).toHaveBeenCalledTimes(1);
    await act(async () => { finish(labResultRow({ id: "r9" })); });
  });

  it("final I2: 409 invalid_transition em Usar X explica e relê a conferência", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({ items: [ {
      ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: null,
      results: [ labResultRow({ id: "r1", value: "410", effective: true }), labResultRow({ id: "r2", value: "98", effective: false }) ]
    } ] }));
    mocked(api.chooseLabResult).mockRejectedValue(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    const review = await openReview();
    fireEvent.click(within(review).getByRole("button", { name: "Usar 98" }));
    expect(await screen.findByText("a situação mudou — a tela foi atualizada")).not.toBeNull();
    await waitFor(() => expect(api.listReleases).toHaveBeenCalledTimes(2));
  });

  it("final L1: com um aviso crítico sendo gravado, Liberar não grava", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValue(critItem());
    let finish: (v: unknown) => void = () => {};
    mocked(api.recordCriticalNotice).mockReturnValue(new Promise((res) => { finish = res; }) as never);
    const review = await openReview();
    fireEvent.click(within(review).getByRole("button", { name: "Registrar aviso" }));
    const form = within(review).getByRole("region", { name: "Aviso do valor crítico — Glicose" });
    fireEvent.change(within(form).getByLabelText("Quem foi avisado"), { target: { value: "Dra. Ana" } });
    fireEvent.change(within(form).getByLabelText("Função"), { target: { value: "médica" } });
    fireEvent.change(within(form).getByLabelText("Como"), { target: { value: "telefone" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar aviso" }));
    await waitFor(() => expect(api.recordCriticalNotice).toHaveBeenCalledTimes(1));
    fillAdvanced(review);
    fireEvent.click(within(review).getByRole("button", { name: /^Liberar laudo/ }));
    fireEvent.click(within(review).queryByRole("button", { name: "Liberar sem aviso" }) ?? review);
    expect(api.releaseRequisition).not.toHaveBeenCalled();
    await act(async () => { finish(undefined); });
  });

  it("I2: trocar de crítico zera o formulário de aviso", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({ items: [ {
      ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: null,
      results: [ labResultRow({ id: "r1", analyte_key: "a", name: "Glicose", flag: "critical_high", notified: false }),
        labResultRow({ id: "r2", analyte_key: "b", name: "Potássio", flag: "critical_high", notified: false }) ]
    } ] }));
    const review = await openReview();
    fireEvent.click(within(review).getAllByRole("button", { name: "Registrar aviso" })[0]);
    fireEvent.change(within(review).getByLabelText("Quem foi avisado"), { target: { value: "Dra. Ana" } });
    fireEvent.click(within(review).getAllByRole("button", { name: "Registrar aviso" })[1]);
    const form = within(review).getByRole("region", { name: "Aviso do valor crítico — Potássio" });
    expect((within(form).getByLabelText("Quem foi avisado") as HTMLInputElement).value).toBe("");
  });

  it("I3/L8: limites de tamanho dos campos do aviso", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValue(critItem());
    const review = await openReview();
    fireEvent.click(within(review).getByRole("button", { name: "Registrar aviso" }));
    expect(within(review).getByLabelText("Quem foi avisado").getAttribute("maxlength")).toBe("120");
    expect(within(review).getByLabelText("Função").getAttribute("maxlength")).toBe("60");
  });

  it("L2: Liberar sem aviso libera; depois de avisar e reler, Liberar vai direto ao api", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValueOnce(critItem());
    const review = await openReview();
    fillAdvanced(review);
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    fireEvent.click(within(review).getByRole("button", { name: "Liberar sem aviso" }));
    await waitFor(() => expect(api.releaseRequisition).toHaveBeenCalledWith("rq1", { item_ids: [ "it2" ], signature: "advanced", totp: "123456" }));
  });

  it("L2: aviso registrado e releitura com notified: true — Liberar não pede confirmação", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValueOnce(critItem()).mockResolvedValue(
      critItem({ results: [ labResultRow({ id: "r1", value: "450", flag: "critical_high", notified: true }) ] }));
    mocked(api.recordCriticalNotice).mockResolvedValue(undefined as never);
    const review = await openReview();
    fireEvent.click(within(review).getByRole("button", { name: "Registrar aviso" }));
    const form = within(review).getByRole("region", { name: "Aviso do valor crítico — Glicose" });
    fireEvent.change(within(form).getByLabelText("Quem foi avisado"), { target: { value: "Dra. Ana" } });
    fireEvent.change(within(form).getByLabelText("Função"), { target: { value: "médica" } });
    fireEvent.change(within(form).getByLabelText("Como"), { target: { value: "telefone" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar aviso" }));
    await waitFor(() => expect(within(review).queryByRole("button", { name: "Registrar aviso" })).toBeNull());
    fillAdvanced(review);
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    await waitFor(() => expect(api.releaseRequisition).toHaveBeenCalledTimes(1));
  });

  it("L2: no_active_certificate mostra o atalho para Assinatura digital; icp_required passa a ICP", async () => {
    mocked(api.releaseRequisition).mockRejectedValueOnce(new api.ApiError(422, { error: "no_active_certificate" }, "x"));
    const onNavigate = vi.fn();
    renderWithProviders(<LabRelease onNavigate={onNavigate} />);
    fireEvent.click(await within(await screen.findByRole("region", { name: "Fila de liberação" })).findByRole("button", { name: "Conferir" }));
    const review = await screen.findByRole("region", { name: "Conferência da requisição 00000123" });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    fireEvent.click(await within(review).findByRole("button", { name: "Ir para Assinatura digital" }));
    expect(onNavigate).toHaveBeenCalledWith("signature");
    mocked(api.releaseRequisition).mockRejectedValueOnce(new api.ApiError(422, { error: "icp_required" }, "x"));
    fireEvent.click(within(review).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(review).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    await waitFor(() => expect((within(review).getByLabelText("ICP-Brasil (assina em Pendentes de assinatura)") as HTMLInputElement).checked).toBe(true));
  });

  it("L3: signature_unavailable para médico mostra a frase do médico e bloqueia Liberar", async () => {
    mocked(api.getLabContext).mockResolvedValue(labContext({ releaser_of: [ "pv9" ], council: "CRM" }));
    mocked(api.releaseRequisition).mockRejectedValueOnce(new api.ApiError(422, { error: "signature_unavailable" }, "x"));
    const review = await openReview();
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect((await within(review).findByRole("alert")).textContent).toBe("médico não libera nesta cidade — a assinatura ICP-Brasil não está ativa");
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect(api.releaseRequisition).toHaveBeenCalledTimes(1);
  });

  it("L3: signature_unavailable para outro conselho esconde a ICP", async () => {
    mocked(api.releaseRequisition).mockRejectedValueOnce(new api.ApiError(422, { error: "signature_unavailable" }, "x"));
    const review = await openReview();
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    await within(review).findByRole("alert");
    expect(within(review).queryByLabelText("ICP-Brasil (assina em Pendentes de assinatura)")).toBeNull();
  });

  it("L4: desmarcar o exame crítico fecha a confirmação", async () => {
    mocked(api.getReleaseRequisition).mockResolvedValue(critItem());
    const review = await openReview();
    fillAdvanced(review);
    fireEvent.click(within(review).getByRole("button", { name: "Liberar laudo" }));
    expect(within(review).getByRole("group", { name: "crítico sem aviso" })).not.toBeNull();
    fireEvent.click(within(review).getByRole("checkbox"));
    expect(within(review).queryByRole("group", { name: "crítico sem aviso" })).toBeNull();
  });

  it("L7: conferência com erro de leitura tem Fechar", async () => {
    mocked(api.getReleaseRequisition).mockRejectedValue(new api.ApiError(500, { error: "boom" }, "x"));
    renderWithProviders(<LabRelease onNavigate={vi.fn()} />);
    fireEvent.click(await within(await screen.findByRole("region", { name: "Fila de liberação" })).findByRole("button", { name: "Conferir" }));
    fireEvent.click(await screen.findByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("alert")).toBeNull();
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

  describe("Laudo já liberado", () => {
    async function panel() {
      renderWithProviders(<LabRelease onNavigate={vi.fn()} />);
      return within(await screen.findByRole("region", { name: "Laudo já liberado" }));
    }

    it("número de 8 dígitos abre a conferência com os laudos", async () => {
      mocked(api.listLabRequisitions).mockResolvedValue({ requisitions: [ { id: "rq1" } as never ], next_before: null });
      mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({ items: [ { ...labItem({ id: "it2", label: "Glicose", status: "released" }), restriction_note: null, results: [ labResultRow() ] } ],
        reports: [ labReport() ] }));
      const p = await panel();
      fireEvent.change(p.getByLabelText("Número da requisição"), { target: { value: "00000123" } });
      fireEvent.click(p.getByRole("button", { name: "Abrir" }));
      const review = await screen.findByRole("region", { name: "Conferência da requisição 00000123" });
      expect(api.listLabRequisitions).toHaveBeenCalledWith(expect.objectContaining({ number: "00000123", providerId: "pv9" }));
      expect(within(review).getByRole("list", { name: "laudos" })).not.toBeNull();
      expect(within(review).queryByRole("button", { name: "Liberar laudo" })).toBeNull();
      fireEvent.click(within(review).getByRole("button", { name: "Retificar" }));
      expect(within(review).getByRole("region", { name: "Retificar laudo v1" })).not.toBeNull();
    });

    it("código de barras de 10 dígitos busca pela etiqueta", async () => {
      mocked(api.listLabRequisitions).mockResolvedValue({ requisitions: [], next_before: null });
      const p = await panel();
      fireEvent.change(p.getByLabelText("Número da requisição"), { target: { value: "0000012301" } });
      fireEvent.click(p.getByRole("button", { name: "Abrir" }));
      expect((await p.findByRole("alert")).textContent).toBe("nenhuma requisição com este número neste laboratório");
      expect(api.listLabRequisitions).toHaveBeenCalledWith(expect.objectContaining({ barcode: "0000012301" }));
    });

    it("número fora de 8 ou 10 dígitos não consulta", async () => {
      const p = await panel();
      fireEvent.change(p.getByLabelText("Número da requisição"), { target: { value: "123" } });
      fireEvent.click(p.getByRole("button", { name: "Abrir" }));
      expect(p.getByRole("alert").textContent).toBe("informe o número da requisição (8 dígitos) ou o código de barras (10 dígitos)");
      expect(api.listLabRequisitions).not.toHaveBeenCalled();
    });

    it("laudo retificado liberado mostra a mensagem de retificação", async () => {
      mocked(api.listLabRequisitions).mockResolvedValue({ requisitions: [ { id: "rq1" } as never ], next_before: null });
      mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({ items: [ { ...labItem({ id: "it2", label: "Glicose", status: "released" }), restriction_note: null, results: [ labResultRow() ] } ],
        reports: [ labReport() ] }));
      mocked(api.rectifyLabReport).mockResolvedValue(labReport({ id: "lr2", version: 2, replaces_report_id: "lr1" }));
      const p = await panel();
      fireEvent.change(p.getByLabelText("Número da requisição"), { target: { value: "00000123" } });
      fireEvent.click(p.getByRole("button", { name: "Abrir" }));
      const review = await screen.findByRole("region", { name: "Conferência da requisição 00000123" });
      fireEvent.click(within(review).getByRole("button", { name: "Retificar" }));
      const form = within(review).getByRole("region", { name: "Retificar laudo v1" });
      fireEvent.change(within(form).getByLabelText("Motivo da retificação"), { target: { value: "valor de glicose digitado trocado" } });
      fireEvent.click(within(form).getByRole("button", { name: "Incluir contato" }));
      const c = within(form).getByRole("group", { name: "Contato 1" });
      fireEvent.change(within(c).getByLabelText("Quem foi avisado"), { target: { value: "Dra. Ana" } });
      fireEvent.change(within(c).getByLabelText("Como"), { target: { value: "telefone" } });
      fireEvent.click(within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
      fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
      fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
      expect(await screen.findByText("Laudo retificado liberado com assinatura eletrônica avançada.")).not.toBeNull();
    });

    it("I1: com a retificação em curso, valor/liberação ficam bloqueados e Cancelar também", async () => {
      mocked(api.listLabRequisitions).mockResolvedValue({ requisitions: [ { id: "rq1" } as never ], next_before: null });
      mocked(api.getReleaseRequisition).mockResolvedValue(releaseRequisition({
        items: [
          { ...labItem({ id: "it1", label: "Hemoglobina", status: "released" }), restriction_note: null, results: [ labResultRow({ id: "r1", analyte_key: "hb", name: "Hb" }) ] },
          { ...labItem({ id: "it2", label: "Glicose", status: "typed" }), restriction_note: null, results: [
            labResultRow({ id: "r2", value: "90", effective: true }), labResultRow({ id: "r3", value: "95", effective: false }) ] }
        ],
        reports: [ labReport({ item_ids: [ "it1" ] }) ]
      }));
      mocked(api.rectifyLabReport).mockReturnValue(new Promise(() => {}));
      const p = await panel();
      fireEvent.change(p.getByLabelText("Número da requisição"), { target: { value: "00000123" } });
      fireEvent.click(p.getByRole("button", { name: "Abrir" }));
      const review = await screen.findByRole("region", { name: "Conferência da requisição 00000123" });
      fireEvent.click(within(review).getByRole("button", { name: "Retificar" }));
      const form = within(review).getByRole("region", { name: "Retificar laudo v1" });
      fireEvent.change(within(form).getByLabelText("Motivo da retificação"), { target: { value: "valor de glicose digitado trocado" } });
      fireEvent.click(within(form).getByRole("button", { name: "Incluir contato" }));
      const c = within(form).getByRole("group", { name: "Contato 1" });
      fireEvent.change(within(c).getByLabelText("Quem foi avisado"), { target: { value: "Dra. Ana" } });
      fireEvent.change(within(c).getByLabelText("Como"), { target: { value: "telefone" } });
      const adv = within(form).getAllByLabelText("Assinatura eletrônica avançada (código do autenticador)");
      fireEvent.click(adv[adv.length - 1]);
      fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
      fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
      await waitFor(() => expect(api.rectifyLabReport).toHaveBeenCalledTimes(1));
      expect(within(review).getByRole("button", { name: /Usar 95/ }).getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(within(review).getByRole("button", { name: /Usar 95/ }));
      expect(api.chooseLabResult).not.toHaveBeenCalled();
      expect(within(review).getByRole("button", { name: /Liberar laudo/ }).getAttribute("aria-disabled")).toBe("true");
      expect(within(form).getByRole("button", { name: "Cancelar" }).hasAttribute("disabled")).toBe(true);
    });

    it("a busca é uma por vez: dois cliques consultam uma vez", async () => {
      mocked(api.listLabRequisitions).mockReturnValue(new Promise(() => {}));
      const p = await panel();
      fireEvent.change(p.getByLabelText("Número da requisição"), { target: { value: "00000123" } });
      const open = p.getByRole("button", { name: "Abrir" });
      fireEvent.click(open);
      fireEvent.click(open);
      expect(api.listLabRequisitions).toHaveBeenCalledTimes(1);
    });
  });
});
