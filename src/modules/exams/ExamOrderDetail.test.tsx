// src/modules/exams/ExamOrderDetail.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getExamOrder: vi.fn(), listEnabledProviders: vi.fn(), scheduleExam: vi.fn(),
    collectExam: vi.fn(), registerExamResult: vi.fn(), cancelExam: vi.fn(), acknowledgeExam: vi.fn(), fetchExamPdf: vi.fn(),
    uploadExamFile: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ExamOrderDetail } from "./ExamOrderDetail";
import { renderWithProviders } from "../../test/campaignFixtures";
import { NOW21, examOrder, examResult, examUser } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getExamOrder, api.listEnabledProviders, api.scheduleExam, api.collectExam,
  api.registerExamResult, api.cancelExam, api.acknowledgeExam, api.fetchExamPdf, api.uploadExamFile ];
let win: { location: { href: string }; close: ReturnType<typeof vi.fn> };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function sessionAs(roles: string[], id = "us1") { mocked(api.fetchCurrentSession).mockResolvedValue(examUser(roles, { id })); }
async function detail() { return screen.findByRole("region", { name: "Exame Hemograma completo" }); }

describe("ExamOrderDetail", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW21));
    for (const fn of ALL) mocked(fn).mockReset();
    sessionAs([ "health_professional" ]);
    win = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockImplementation(() => win as unknown as Window);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:laudo-1") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("mostra situação, andamento com motivo e o resultado com os valores", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({
      status: "resulted", result: examResult({ critical: true }),
      events: [
        { kind: "requested", occurred_at: "2026-10-10T09:00:00-03:00", actor: { type: "user", name: "Dra. Ana Souza" }, reason: null },
        { kind: "escalated", occurred_at: "2026-10-12T08:00:00-03:00", actor: { type: "system", name: null }, reason: "critical" }
      ]
    }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const region = await detail();
    expect(within(region).getByText("resultado registrado")).not.toBeNull();
    const steps = within(within(region).getByRole("list", { name: "andamento" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([ "10/10/2026, 09:00 · solicitado · Dra. Ana Souza", "12/10/2026, 08:00 · enviado à equipe · Sistema — resultado crítico" ]);
    const result = within(region).getByRole("region", { name: "Resultado" });
    expect(within(result).getByText("Resultado liberado em 12/10/2026")).not.toBeNull();
    expect(within(result).getByText("crítico")).not.toBeNull();
    expect(within(result).getByText("13.5 g/dL")).not.toBeNull();
  });

  it("recepção agenda um exame sem prestador: escolhe da lista e manda a hora da cidade", async () => {
    sessionAs([ "citizen_verifier" ], "us9");
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ provider: null }));
    mocked(api.listEnabledProviders).mockResolvedValue([ { id: "pv1", name: "Laboratório Simulado" } ]);
    mocked(api.scheduleExam).mockResolvedValue(undefined);
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Agendar" }));
    const form = await screen.findByRole("form", { name: "Agendar exame" });
    await within(form).findByRole("option", { name: "Laboratório Simulado" });
    expect(api.listEnabledProviders).toHaveBeenCalledWith("0202020380");
    fireEvent.change(within(form).getByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.change(within(form).getByLabelText("Data e hora"), { target: { value: "2026-10-20T08:30" } });
    fireEvent.change(within(form).getByLabelText("Local"), { target: { value: "Laboratório Simulado — Rua XV, 100" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() => expect(api.scheduleExam).toHaveBeenCalledWith("eo1", {
      provider_id: "pv1", scheduled_at: "2026-10-20T08:30:00-03:00", scheduled_place: "Laboratório Simulado — Rua XV, 100"
    }));
    expect((await screen.findByText("Exame agendado.")).getAttribute("role")).toBe("status");
    expect(screen.queryByRole("form", { name: "Agendar exame" })).toBeNull();
  });

  it("prestador já autorizado: agenda sem seletor, com o prestador do exame", async () => {
    sessionAs([ "citizen_verifier" ], "us9");
    mocked(api.getExamOrder).mockResolvedValue(examOrder());
    mocked(api.scheduleExam).mockResolvedValue(undefined);
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Agendar" }));
    const form = await screen.findByRole("form", { name: "Agendar exame" });
    expect(within(form).queryByLabelText("Prestador")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Data e hora"), { target: { value: "2026-10-20T08:30" } });
    fireEvent.change(within(form).getByLabelText("Local"), { target: { value: "Posto" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() => expect(mocked(api.scheduleExam).mock.calls[0][1]).toMatchObject({ provider_id: "pv1" }));
    expect(api.listEnabledProviders).not.toHaveBeenCalled();
  });

  it("exame agendado: Reagendar mantém o prestador atual (sem seletor)", async () => {
    sessionAs([ "citizen_verifier" ], "us9");
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "scheduled", scheduled_at: "2026-10-20T08:30:00-03:00", scheduled_place: "Posto" }));
    mocked(api.scheduleExam).mockResolvedValue(undefined);
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const region = await detail();
    expect(within(region).queryByRole("button", { name: "Agendar" })).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Reagendar" }));
    const form = await screen.findByRole("form", { name: "Agendar exame" });
    expect(within(form).queryByLabelText("Prestador")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Data e hora"), { target: { value: "2026-10-22T10:00" } });
    fireEvent.change(within(form).getByLabelText("Local"), { target: { value: "Posto Norte" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() => expect(api.scheduleExam).toHaveBeenCalledWith("eo1", {
      provider_id: "pv1", scheduled_at: "2026-10-22T10:00:00-03:00", scheduled_place: "Posto Norte"
    }));
    expect(api.listEnabledProviders).not.toHaveBeenCalled();
  });

  it("409 invalid_transition: explica, fecha o formulário e relê", async () => {
    sessionAs([ "citizen_verifier" ], "us9");
    let reread!: (o: ReturnType<typeof examOrder>) => void;
    mocked(api.getExamOrder).mockResolvedValueOnce(examOrder({ status: "scheduled", scheduled_at: "2026-10-20T08:30:00-03:00", scheduled_place: "Posto" }))
      .mockImplementationOnce(() => new Promise((resolve) => { reread = resolve; }));
    mocked(api.registerExamResult).mockRejectedValue(new ApiError(409, { error: "invalid_transition", status: "collected" }, "x"));
    mocked(api.uploadExamFile).mockResolvedValue("up1");
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Registrar resultado" }));
    const form = await screen.findByRole("form", { name: "Registrar resultado" });
    fireEvent.change(within(form).getByLabelText("Laudo (PDF, até 10 MB)"),
      { target: { files: [ new File([ "%PDF" ], "l.pdf", { type: "application/pdf" }) ] } });
    await within(form).findByText("anexado: l.pdf");
    fireEvent.change(within(form).getByLabelText("Laboratório"), { target: { value: "Lab" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar resultado" }));
    expect((await screen.findByText("a situação do exame mudou; a tela foi atualizada")).getAttribute("role")).toBe("alert");
    expect(screen.queryByRole("form", { name: "Registrar resultado" })).toBeNull();
    await waitFor(() => expect(api.getExamOrder).toHaveBeenCalledTimes(2));
    expect(screen.getByText("relendo o exame…")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar|Agendar|Cancelar exame|Fechar/ })).toBeNull();
    reread(examOrder({ status: "collected" }));
    expect(await screen.findByText("coletado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar coleta" })).toBeNull();
    expect(screen.getByRole("button", { name: "Registrar resultado" })).not.toBeNull();
  });

  it("depois de uma ação certa, nenhum botão até a releitura do exame", async () => {
    sessionAs([ "citizen_verifier" ], "us9");
    let reread!: (o: ReturnType<typeof examOrder>) => void;
    mocked(api.getExamOrder).mockResolvedValueOnce(examOrder({ status: "scheduled" }))
      .mockImplementationOnce(() => new Promise((resolve) => { reread = resolve; }));
    mocked(api.collectExam).mockResolvedValue(undefined);
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Registrar coleta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("relendo o exame…")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar|Agendar|Cancelar exame|Fechar/ })).toBeNull();
    reread(examOrder({ status: "collected" }));
    expect(await screen.findByRole("button", { name: "Registrar resultado" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar coleta" })).toBeNull();
    expect(screen.queryByText("relendo o exame…")).toBeNull();
  });

  it("registrar coleta pede confirmação", async () => {
    sessionAs([ "citizen_verifier" ], "us9");
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "scheduled" }));
    mocked(api.collectExam).mockResolvedValue(undefined);
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Registrar coleta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.collectExam).toHaveBeenCalledWith("eo1"));
    expect(await screen.findByText("Coleta registrada.")).not.toBeNull();
  });

  it("quem pediu dá ciência sem motivo", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "resulted", result: examResult() }));
    mocked(api.acknowledgeExam).mockResolvedValue(undefined);
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Dar ciência" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.acknowledgeExam).toHaveBeenCalledWith("eo1"));
    expect(await screen.findByText("Ciência registrada.")).not.toBeNull();
  });

  it("a equipe dá ciência do exame escalado só com motivo; exame alheio não escalado não tem botão", async () => {
    sessionAs([ "health_professional" ], "us2");
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "resulted", result: examResult(), escalated: true }));
    mocked(api.acknowledgeExam).mockResolvedValue(undefined);
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Dar ciência pela equipe" }));
    const form = screen.getByRole("form", { name: "Motivo da ciência pela equipe" });
    fireEvent.change(within(form).getByLabelText("Motivo da ciência pela equipe"), { target: { value: "Paciente avisado por telefone" } });
    fireEvent.click(within(form).getByRole("button", { name: "Dar ciência" }));
    await waitFor(() => expect(api.acknowledgeExam).toHaveBeenCalledWith("eo1", "Paciente avisado por telefone"));

    cleanup();
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "resulted", result: examResult(), escalated: false }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const region = await detail();
    expect(within(region).queryByRole("button", { name: /Dar ciência/ })).toBeNull();
  });

  it("cancelar pede o motivo", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder());
    mocked(api.cancelExam).mockResolvedValue(undefined);
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Cancelar exame" }));
    const form = screen.getByRole("form", { name: "Motivo do cancelamento" });
    fireEvent.change(within(form).getByLabelText("Motivo do cancelamento"), { target: { value: "pedido em duplicidade" } });
    fireEvent.click(within(form).getByRole("button", { name: "Cancelar exame" }));
    await waitFor(() => expect(api.cancelExam).toHaveBeenCalledWith("eo1", "pedido em duplicidade"));
  });

  it("abre o laudo numa janela nova por blob:", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "resulted", result: examResult() }));
    mocked(api.fetchExamPdf).mockResolvedValue({ blob: new Blob([ "%PDF" ], { type: "application/pdf" }), filename: null });
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Abrir laudo" }));
    await waitFor(() => expect(win.location.href).toBe("blob:laudo-1"));
    expect(api.fetchExamPdf).toHaveBeenCalledWith("/exams/files/tok-er1");
  });

  it("laudo com link vencido: avisa e relê o exame", async () => {
    mocked(api.getExamOrder).mockResolvedValueOnce(examOrder({ status: "resulted", result: examResult() }))
      .mockResolvedValue(examOrder({ status: "resulted", result: examResult({ pdf_url: "/exams/files/tok-er1-new" }) }));
    mocked(api.fetchExamPdf).mockRejectedValueOnce(new ApiError(410, { error: "link_expired" }, "x"))
      .mockResolvedValue({ blob: new Blob([ "%PDF" ], { type: "application/pdf" }), filename: null });
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Abrir laudo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o link do laudo expirou — abra de novo");
    expect(win.close).toHaveBeenCalled();
    await waitFor(() => expect(api.getExamOrder).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Abrir laudo" }));
    await waitFor(() => expect(api.fetchExamPdf).toHaveBeenLastCalledWith("/exams/files/tok-er1-new"));
    await waitFor(() => expect(win.location.href).toBe("blob:laudo-1"));
  });

  it("visão administrativa (unidade): resultado sem valores, sem crítico e sem laudo", async () => {
    sessionAs([ "citizen_verifier" ], "us9");
    mocked(api.getExamOrder).mockResolvedValue(examOrder({
      status: "resulted", result: { id: "er1", origin: "order", source: "fhir", released_on: "2026-10-12", laboratory_name: "Laboratório Simulado" }
    }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const result = within(await detail()).getByRole("region", { name: "Resultado" });
    expect(within(result).getByText("valores e laudo ficam com quem pediu e com a equipe")).not.toBeNull();
    expect(within(result).queryByRole("button", { name: "Abrir laudo" })).toBeNull();
    expect(within(result).queryByText("crítico")).toBeNull();
  });

  it("exame que o api não deixa ler: a frase da recusa e Fechar", async () => {
    mocked(api.getExamOrder).mockRejectedValue(new ApiError(403, { error: "out_of_context" }, "x"));
    const onClose = vi.fn();
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={onClose} />);
    expect((await screen.findByRole("alert")).textContent).toBe("esta pessoa não está em atendimento com você");
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalled();
  });
  it("crítico vem também do evento de escalada por crítico (A31)", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({
      status: "resulted", escalated: true, result: examResult({ critical: false }),
      events: [ { kind: "escalated", occurred_at: "2026-10-12T08:00:00-03:00", actor: { type: "system", name: null }, reason: "critical" } ]
    }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const result = within(await detail()).getByRole("region", { name: "Resultado" });
    expect(within(result).getByText("crítico")).not.toBeNull();
  });

  // B63: o motivo gravado pelo api (escalation_reasons) vale mesmo sem a trilha.
  it("motivos gravados: crítico retificado para normal segue crítico, e o motivo aparece na marca", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({
      status: "resulted", escalated: true, escalation_reasons: [ "critical" ], result: examResult({ critical: false }), events: []
    }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const region = await detail();
    expect(within(within(region).getByRole("region", { name: "Resultado" })).getByText("crítico")).not.toBeNull();
    expect(within(region).getByText("na fila da equipe · resultado crítico")).not.toBeNull();
  });

  it("motivo da negação aparece; ator de sistema nunca vira 'null'; CID e CNS só quando vêm", async () => {
    sessionAs([ "exam_regulator" ], "us7");
    mocked(api.getExamOrder).mockResolvedValue(examOrder({
      status: "denied", cid10_justification: "E119", requester: { user_id: "us1", name: "Dra. Ana Souza", cns: null },
      events: [
        { kind: "denied", occurred_at: "2026-10-11T10:00:00-03:00", actor: { type: "user", name: "Reg. Bia" }, reason: "sem indicação" },
        { kind: "escalated", occurred_at: "2026-10-12T08:00:00-03:00", actor: { type: "system", name: null }, reason: null }
      ]
    }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const region = await detail();
    const steps = within(within(region).getByRole("list", { name: "andamento" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([ "11/10/2026, 10:00 · negado · Reg. Bia — sem indicação", "12/10/2026, 08:00 · enviado à equipe · Sistema" ]);
    expect(region.textContent).not.toContain("null");
    expect(within(region).getByText("E119")).not.toBeNull();
    expect(within(region).queryByText("CNS do solicitante")).toBeNull();
  });

  it("CNS do solicitante digitado aparece na visão clínica quando vem", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ requester: { user_id: null, name: "Dr. Externo", cns: "702002887429583" } }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const region = await detail();
    expect(within(region).getByText("Dr. Externo (digitado)")).not.toBeNull();
    expect(within(region).getByText("702002887429583")).not.toBeNull();
  });

  it("laudo não achado (404): frase do laudo, relê e não expõe o token do link", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "resulted", result: examResult() }));
    mocked(api.fetchExamPdf).mockRejectedValue(new ApiError(404, { error: "not_found" }, "404 on /exams/files/tok-er1"));
    const log = vi.spyOn(console, "error");
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Abrir laudo" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("laudo não encontrado — abra o exame de novo");
    expect(win.close).toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("tok-er1");
    expect(log.mock.calls.flat().join(" ")).not.toContain("tok-er1");
    await waitFor(() => expect(api.getExamOrder).toHaveBeenCalledTimes(2));
  });

  it("falha que não é do api: frase genérica, nunca a mensagem do erro", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "resulted", result: examResult() }));
    mocked(api.fetchExamPdf).mockRejectedValue(new TypeError("Failed to fetch /exams/files/tok-er1"));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Abrir laudo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("sem conexão com o servidor — tente de novo");
    expect(document.body.textContent).not.toContain("tok-er1");
  });

  it("janela bloqueada: avisa sem baixar o laudo", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "resulted", result: examResult() }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(within(await detail()).getByRole("button", { name: "Abrir laudo" }));
    expect((await screen.findByRole("alert")).textContent).toContain("o navegador bloqueou a janela nova");
    expect(api.fetchExamPdf).not.toHaveBeenCalled();
  });

  it("visão clínica sem valores e sem laudo não manda ver o laudo", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({
      status: "resulted", result: { id: "er1", origin: "order", source: "unit", released_on: "2026-10-12", laboratory_name: "Lab", critical: false, values: [] }
    }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const result = within(await detail()).getByRole("region", { name: "Resultado" });
    expect(within(result).getByText("sem valores digitados")).not.toBeNull();
    expect(result.textContent).not.toContain("veja o laudo");
    expect(result.textContent).not.toContain("ficam com quem pediu");
  });

  it("visão administrativa ignora crítico da trilha mesmo com campos inesperados", async () => {
    sessionAs([ "citizen_verifier" ], "us9");
    mocked(api.getExamOrder).mockResolvedValue(examOrder({
      status: "resulted", escalated: true,
      result: { id: "er1", origin: "order", source: "fhir", released_on: "2026-10-12", laboratory_name: "Lab", acknowledged_at: null },
      events: [ { kind: "escalated", occurred_at: "2026-10-12T08:00:00-03:00", actor: { type: "system", name: null }, reason: "critical" } ]
    }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    const result = within(await detail()).getByRole("region", { name: "Resultado" });
    expect(within(result).queryByText("crítico")).toBeNull();
    expect(within(result).getByText("valores e laudo ficam com quem pediu e com a equipe")).not.toBeNull();
  });

  it("visão administrativa do regulador traz o CID quando vem (A42)", async () => {
    sessionAs([ "exam_regulator" ], "us7");
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "awaiting_authorization", cid10_justification: "E119", events: [] }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    expect(within(await detail()).getByText("E119")).not.toBeNull();
  });
});
