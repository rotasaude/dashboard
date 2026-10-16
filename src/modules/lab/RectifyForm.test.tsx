// src/modules/lab/RectifyForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), rectifyLabReport: vi.fn(), fetchExamPdf: vi.fn() };
});

import * as api from "../../lib/api";
import { RectifyForm } from "./RectifyForm";
import { LabReportList } from "./LabReportList";
import { renderWithProviders } from "../../test/campaignFixtures";
import { NOW21B, labItem, labReport, labResultRow, labUser } from "../../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const NOGUARD = { begin: () => true, end: () => {}, busy: false };
const ITEMS = [ { ...labItem({ id: "it2", label: "Glicose", status: "released" }), restriction_note: null, results: [ labResultRow() ] } ];

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21B));
  mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(labUser([ "lab_releaser" ]));
  mocked(api.rectifyLabReport).mockReset().mockResolvedValue(labReport({ id: "lr2", version: 2, replaces_report_id: "lr1" }));
});

function fill(form: HTMLElement) {
  fireEvent.change(within(form).getByLabelText("Motivo da retificação"), { target: { value: "valor de glicose digitado trocado" } });
  fireEvent.click(within(form).getByRole("button", { name: "Incluir contato" }));
  const contact = within(form).getByRole("group", { name: "Contato 1" });
  fireEvent.change(within(contact).getByLabelText("Quem foi avisado"), { target: { value: "Dra. Ana" } });
  fireEvent.change(within(contact).getByLabelText("Como"), { target: { value: "telefone" } });
  fireEvent.change(within(contact).getByLabelText("Quando"), { target: { value: "2026-10-15T09:00" } });
}

describe("RectifyForm", () => {
  it("exige motivo e quem foi avisado antes de enviar", async () => {
    renderWithProviders(<RectifyForm guard={NOGUARD} report={labReport()} items={ITEMS} council="CRF" onDone={vi.fn()} onConflict={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("escreva o motivo da retificação (ao menos 10 caracteres)");
    fireEvent.change(within(form).getByLabelText("Motivo da retificação"), { target: { value: "valor de glicose digitado trocado" } });
    fireEvent.click(await within(form).findByRole("button", { name: "Emitir laudo retificado" }));
    await waitFor(() => expect(within(form).getByRole("alert").textContent).toBe("registre quem foi avisado da retificação"));
    expect(api.rectifyLabReport).not.toHaveBeenCalled();
  });

  it("assinatura avançada: contatos com a hora da cidade e o código só no corpo", async () => {
    const onDone = vi.fn();
    renderWithProviders(<RectifyForm guard={NOGUARD} report={labReport()} items={ITEMS} council="CRF" onDone={onDone} onConflict={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    fireEvent.click(within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    await waitFor(() => expect(api.rectifyLabReport).toHaveBeenCalledWith("lr1", {
      item_ids: [ "it2" ], reason: "valor de glicose digitado trocado",
      contacts: [ { person: "Dra. Ana", channel: "telefone", at: "2026-10-15T09:00:00-03:00" } ], signature: "advanced", totp: "123456"
    }));
    expect(onDone).toHaveBeenCalledWith(labReport({ id: "lr2", version: 2, replaces_report_id: "lr1" }));
  });

  it("código recusado: apaga e pede de novo; 409 devolve a quem chamou", async () => {
    mocked(api.rectifyLabReport)
      .mockRejectedValueOnce(new api.ApiError(401, { error: "mfa_required" }, "x"))
      .mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    const onConflict = vi.fn();
    renderWithProviders(<RectifyForm guard={NOGUARD} report={labReport()} items={ITEMS} council="CRF" onDone={vi.fn()} onConflict={onConflict} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    fireEvent.click(within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("o código do autenticador não valeu — digite o código atual");
    expect((within(form).getByLabelText("Código do autenticador") as HTMLInputElement).value).toBe("");
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "222222" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith("a situação mudou — a tela foi atualizada"));
  });
});

describe("LabReportList", () => {
  it("liberado pode ser retificado; retificado e pendente não", async () => {
    const onRectify = vi.fn();
    renderWithProviders(<LabReportList onRectify={onRectify} onExpired={vi.fn()} reports={[
      labReport({ id: "lr2", version: 2, replaces_report_id: "lr1" }),
      labReport({ id: "lr1", status: "rectified" }),
      labReport({ id: "lr3", version: 3, status: "pending_signature", signature_kind: "icp", pdf_url: null })
    ]} />);
    const list = await screen.findByRole("list", { name: "laudos" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0].textContent).toContain("substitui a v1");
    expect(items[1].textContent).toContain("retificado (substituído)");
    expect(items[2].textContent).toContain("aguardando assinatura ICP");
    expect(within(items[1]).queryByRole("button", { name: "Retificar" })).toBeNull();
    expect(within(items[2]).queryByRole("button", { name: "Retificar" })).toBeNull();
    fireEvent.click(within(items[0]).getByRole("button", { name: "Retificar" }));
    expect(onRectify).toHaveBeenCalledWith(expect.objectContaining({ id: "lr2" }));
  });
});

describe("RectifyForm — assinatura e gravação", () => {
  const ICP_FEATURES = [ "exam_tracking", "municipal_lab", "digital_signature" ];
  const props = (council: string | null) => ({ report: labReport(), items: ITEMS, council, onConflict: vi.fn(), onCancel: vi.fn() });

  it("com assinatura digital na cidade a ICP é a escolha inicial e vai sem código", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_releaser" ], { features: ICP_FEATURES }));
    const onDone = vi.fn();
    renderWithProviders(<RectifyForm guard={NOGUARD} {...props("CRF")} onDone={onDone} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    await waitFor(() => expect((within(form).getByLabelText("ICP-Brasil (assina em Pendentes de assinatura)") as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    await waitFor(() => expect(api.rectifyLabReport).toHaveBeenCalledWith("lr1", {
      item_ids: [ "it2" ], reason: "valor de glicose digitado trocado",
      contacts: [ { person: "Dra. Ana", channel: "telefone", at: "2026-10-15T09:00:00-03:00" } ], signature: "icp"
    }));
  });

  it("sem assinatura digital a ICP não é oferecida e a avançada é a escolha inicial", async () => {
    renderWithProviders(<RectifyForm guard={NOGUARD} {...props("CRF")} onDone={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    expect(within(form).queryByLabelText("ICP-Brasil (assina em Pendentes de assinatura)")).toBeNull();
    expect((within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)") as HTMLInputElement).checked).toBe(true);
  });

  it("médico (CRM) sem assinatura digital: não retifica e nada é enviado", async () => {
    renderWithProviders(<RectifyForm guard={NOGUARD} {...props("CRM")} onDone={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    expect(within(form).getByText("médico não libera nesta cidade — a assinatura ICP-Brasil não está ativa")).not.toBeNull();
    const button = within(form).getByRole("button", { name: "Emitir laudo retificado" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(within(form).getByText("sem assinatura ICP o médico não consegue retificar")).not.toBeNull();
    fireEvent.click(button);
    expect(api.rectifyLabReport).not.toHaveBeenCalled();
  });

  it("médico (CRM) com assinatura digital: só ICP", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_releaser" ], { features: ICP_FEATURES }));
    renderWithProviders(<RectifyForm guard={NOGUARD} {...props("CRM")} onDone={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    await waitFor(() => expect(within(form).getByText("médico (CRM) libera só com ICP-Brasil")).not.toBeNull());
    expect(within(form).queryByLabelText("Assinatura eletrônica avançada (código do autenticador)")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    await waitFor(() => expect(api.rectifyLabReport).toHaveBeenCalledWith("lr1", expect.objectContaining({ signature: "icp" })));
  });

  it("uma gravação por vez: dois cliques enviam uma vez e o sucesso vai a quem chamou uma só vez", async () => {
    let resolve!: (r: ReturnType<typeof labReport>) => void;
    mocked(api.rectifyLabReport).mockReset().mockReturnValue(new Promise((r) => { resolve = r; }));
    const onDone = vi.fn();
    renderWithProviders(<RectifyForm guard={NOGUARD} {...props("CRF")} onDone={onDone} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    fireEvent.click(within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    const button = within(form).getByRole("button", { name: "Emitir laudo retificado" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.rectifyLabReport).toHaveBeenCalledTimes(1);
    resolve(labReport({ id: "lr2", version: 2 }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(within(form).queryByRole("alert")).toBeNull();
  });

  it("falha apaga o código digitado", async () => {
    mocked(api.rectifyLabReport).mockReset().mockRejectedValue(new api.ApiError(422, { error: "invalid_version" }, "x"));
    renderWithProviders(<RectifyForm guard={NOGUARD} {...props("CRF")} onDone={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    fireEvent.click(within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    await within(form).findByRole("alert");
    expect((within(form).getByLabelText("Código do autenticador") as HTMLInputElement).value).toBe("");
  });
});

describe("LabReportList — situações", () => {
  it("devolvido (withdrawn) mostra o texto do contrato e não tem Retificar nem PDF", async () => {
    renderWithProviders(<LabReportList onRectify={vi.fn()} onExpired={vi.fn()}
      reports={[ labReport({ id: "lr4", status: "withdrawn", pdf_url: null }) ]} />);
    const item = within(await screen.findByRole("list", { name: "laudos" })).getByRole("listitem");
    expect(item.textContent).toContain("devolvido — assinatura digital desligada; libere de novo");
    expect(within(item).queryByRole("button", { name: "Retificar" })).toBeNull();
    expect(within(item).queryByRole("button", { name: "Abrir laudo" })).toBeNull();
  });
});

describe("RectifyForm — itens, erros de assinatura e guarda", () => {
  const two = [
    { ...labItem({ id: "it1", label: "Hemoglobina", status: "released" }), restriction_note: null, results: [ labResultRow() ] },
    { ...labItem({ id: "it2", label: "Glicose", status: "released" }), restriction_note: null, results: [ labResultRow() ] }
  ];
  const ICP = [ "exam_tracking", "municipal_lab", "digital_signature" ];

  it("I2: oferece e marca só os exames liberados do laudo retificado", async () => {
    renderWithProviders(<RectifyForm guard={NOGUARD} report={labReport({ item_ids: [ "it1" ] })} items={two} council="CRF" onDone={vi.fn()} onConflict={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    expect(within(form).getByLabelText("Hemoglobina")).not.toBeNull();
    expect(within(form).queryByLabelText("Glicose")).toBeNull();
    fill(form);
    fireEvent.click(within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    await waitFor(() => expect(api.rectifyLabReport).toHaveBeenCalledWith("lr1", expect.objectContaining({ item_ids: [ "it1" ] })));
  });

  it("signature_unavailable: some a ICP e passa à avançada", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_releaser" ], { features: ICP }));
    mocked(api.rectifyLabReport).mockReset().mockRejectedValue(new api.ApiError(422, { error: "signature_unavailable" }, "x"));
    renderWithProviders(<RectifyForm guard={NOGUARD} report={labReport()} items={ITEMS} council="CRF" onDone={vi.fn()} onConflict={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    await waitFor(() => expect(within(form).getByLabelText("ICP-Brasil (assina em Pendentes de assinatura)")).not.toBeNull());
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("a assinatura ICP-Brasil não está disponível nesta cidade — peça ao administrador para ativá-la");
    expect(within(form).queryByLabelText("ICP-Brasil (assina em Pendentes de assinatura)")).toBeNull();
    expect((within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)") as HTMLInputElement).checked).toBe(true);
  });

  it("signature_unavailable para médico (CRM): mensagem do médico", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_releaser" ], { features: ICP }));
    mocked(api.rectifyLabReport).mockReset().mockRejectedValue(new api.ApiError(422, { error: "signature_unavailable" }, "x"));
    renderWithProviders(<RectifyForm guard={NOGUARD} report={labReport()} items={ITEMS} council="CRM" onDone={vi.fn()} onConflict={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    await waitFor(() => expect(within(form).getByText("médico (CRM) libera só com ICP-Brasil")).not.toBeNull());
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("médico não libera nesta cidade — a assinatura ICP-Brasil não está ativa");
  });

  it("icp_required: passa a ICP", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_releaser" ], { features: ICP }));
    mocked(api.rectifyLabReport).mockReset().mockRejectedValue(new api.ApiError(422, { error: "icp_required" }, "x"));
    renderWithProviders(<RectifyForm guard={NOGUARD} report={labReport()} items={ITEMS} council="CRF" onDone={vi.fn()} onConflict={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    await waitFor(() => expect(within(form).getByLabelText("ICP-Brasil (assina em Pendentes de assinatura)")).not.toBeNull());
    fireEvent.click(within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("médico libera só com ICP-Brasil — escolha ICP");
    expect((within(form).getByLabelText("ICP-Brasil (assina em Pendentes de assinatura)") as HTMLInputElement).checked).toBe(true);
  });

  it("I1: pede a guarda do pai e a devolve ao fim", async () => {
    let resolve!: (r: ReturnType<typeof labReport>) => void;
    mocked(api.rectifyLabReport).mockReset().mockReturnValue(new Promise((r) => { resolve = r; }));
    const begin = vi.fn(() => true), end = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(<RectifyForm guard={{ begin, end, busy: false }} report={labReport()} items={ITEMS} council="CRF" onDone={vi.fn()} onConflict={vi.fn()} onCancel={onCancel} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    fireEvent.click(within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: "Emitir laudo retificado" }));
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
    resolve(labReport({ id: "lr2" }));
    await waitFor(() => expect(end).toHaveBeenCalledTimes(1));
  });

  it("guarda do pai ocupada: não envia", async () => {
    renderWithProviders(<RectifyForm guard={{ begin: () => false, end: vi.fn(), busy: true }} report={labReport()} items={ITEMS} council="CRF" onDone={vi.fn()} onConflict={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Retificar laudo v1" });
    fill(form);
    fireEvent.click(within(form).getByLabelText("Assinatura eletrônica avançada (código do autenticador)"));
    fireEvent.change(within(form).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(form).getByRole("button", { name: /Emitir laudo retificado/ }));
    expect(api.rectifyLabReport).not.toHaveBeenCalled();
  });
});

describe("LabReportList — PDF", () => {
  it("link vencido: mostra a frase e pede releitura; link válido não relê", async () => {
    const onExpired = vi.fn();
    const win = { opener: null, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    mocked(api.fetchExamPdf).mockReset().mockRejectedValueOnce(new api.ApiError(410, { error: "link_expired" }, "x"));
    renderWithProviders(<LabReportList onRectify={vi.fn()} onExpired={onExpired} reports={[ labReport() ]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir laudo" }));
    expect((await screen.findByRole("alert")).textContent).toBeTruthy();
    expect(api.fetchExamPdf).toHaveBeenCalledWith("/lab/files/tok-lr1");
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
