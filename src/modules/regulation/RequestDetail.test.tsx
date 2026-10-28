import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  getRegulationRequest: vi.fn(), listCareOffers: vi.fn(), authorizeRegulationRequest: vi.fn(), returnRegulationRequest: vi.fn(),
  denyRegulationRequest: vi.fn(), cancelRegulationRequest: vi.fn(), fetchRegulationGuide: vi.fn(), scheduleRegulationRequest: vi.fn(),
  recordRegulationOutcome: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { RequestDetail } from "./RequestDetail";
import { POPUP_BLOCKED } from "./openGuide";
import { fmtDateTime } from "../../lib/format";
import { QUOTA_EXHAUSTED_TEXT, SKIP_REASON_TEXT, STALE_TEXT } from "../../lib/regulation";
import { renderWithProviders } from "../../test/campaignFixtures";
import { TODAY26, offer, regRequest, regUser } from "../../test/regulationFixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const OWN = offer();
const FULL = offer({ id: "of2", provider: { id: "pr2", name: "Clínica do Coração", kind: "contracted" }, used: 6, quantity: 6, available: 0 });
const CONTRACTED = offer({ id: "of3", provider: { id: "pr3", name: "Consórcio Leste", kind: "consortium" }, available: 4 });
const AUTHORIZED_OWN = { offer_id: "of1", provider: { id: "pr1", name: "Ambulatório de Especialidades", kind: "own" }, month: "2026-10",
  skip_reason: null, at: "2026-10-20T10:00:00-03:00", by: { name: "Regulador" } };

describe("RequestDetail", () => {
  let onChanged: ReturnType<typeof vi.fn>;
  let onBack: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    for (const fn of [ api.getRegulationRequest, api.listCareOffers, api.authorizeRegulationRequest, api.returnRegulationRequest,
      api.denyRegulationRequest, api.cancelRegulationRequest, api.fetchRegulationGuide, api.scheduleRegulationRequest, api.recordRegulationOutcome ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser());
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest({ ciap2: "K86" }));
    mocked(api.listCareOffers).mockResolvedValue([ OWN, FULL, CONTRACTED ]);
    mocked(api.authorizeRegulationRequest).mockResolvedValue(regRequest({ status: "authorized" }));
    onChanged = vi.fn();
    onBack = vi.fn();
  });
  const mount = () => renderWithProviders(<RequestDetail id="rr1" today={TODAY26} onBack={onBack} onChanged={onChanged} />);
  const openAuthorize = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Autorizar" }));
    return screen.findByRole("form", { name: "Autorizar o pedido" });
  };

  it("mostra o pedido com andamento; as ofertas do mês e do alvo, esgotada desabilitada", async () => {
    mount();
    const detail = await screen.findByRole("region", { name: "Cardiologia" });
    for (const t of [ "Joana Lima", "I209", "K86", "Dor torácica aos esforços há 3 meses, teste ergométrico alterado.", "Dra. Helena Prado", "UBS Centro", "20 dias", "até 07/11" ])
      expect(within(detail).getAllByText(t).length).toBeGreaterThan(0);
    expect(within(screen.getByRole("list", { name: "Andamento" })).getByText(/aguardando regulação/)).not.toBeNull();
    const form = await openAuthorize();
    expect(mocked(api.listCareOffers)).toHaveBeenCalledWith({ month: "2026-10", targetCode: "225120" });
    expect((within(form).getByLabelText(/Clínica do Coração/) as HTMLInputElement).disabled).toBe(true);
    expect(within(form).getByText("esgotada")).not.toBeNull();
    expect(within(form).getByLabelText(/Ambulatório de Especialidades · rede própria · saldo 2 de 10/)).not.toBeNull();
  });

  it("pedido de enfermeira: CID-10 mostra traço e CIAP-2 mostra o código", async () => {
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest({ cid10: null, ciap2: "K86" }));
    mount();
    await screen.findByRole("region", { name: "Cardiologia" });
    expect(screen.getByText("CID-10").nextSibling?.textContent).toBe("—");
    expect(screen.getByText("CIAP-2").nextSibling?.textContent).toBe("K86");
  });

  it("autorizar na rede própria: corpo com a versão e a frase do pedido de agendamento", async () => {
    mount();
    const form = await openAuthorize();
    fireEvent.click(within(form).getByLabelText(/Ambulatório de Especialidades/));
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
    await waitFor(() => expect(mocked(api.authorizeRegulationRequest)).toHaveBeenCalledWith("rr1", { offer_id: "of1", version: 3 }));
    expect(onChanged).toHaveBeenCalledWith("Autorizado em Ambulatório de Especialidades. A unidade vai marcar o horário pelo pedido de agendamento.");
  });

  it("mudar a cor pede motivo antes; 422 skip_reason_required pede o motivo e reenvia com ele", async () => {
    mount();
    const form = await openAuthorize();
    fireEvent.click(within(form).getByLabelText(/Consórcio Leste/));
    text("Cor confirmada", "red");
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("ao mudar a cor, informe o motivo");
    expect(mocked(api.authorizeRegulationRequest)).not.toHaveBeenCalled();
    text("Motivo da mudança de cor", "Piora da dor em repouso relatada hoje");
    mocked(api.authorizeRegulationRequest).mockRejectedValueOnce(new ApiError(422, { error: "skip_reason_required" }, "x"));
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
    expect(await within(form).findByText(SKIP_REASON_TEXT)).not.toBeNull();
    expect((within(form).getByLabelText(/Consórcio Leste/) as HTMLInputElement).checked).toBe(true);
    text("Motivo para autorizar fora da ordem", "Risco maior que o dos pedidos mais antigos");
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
    await waitFor(() => expect(mocked(api.authorizeRegulationRequest)).toHaveBeenLastCalledWith("rr1", { offer_id: "of3", color: "red",
      color_reason: "Piora da dor em repouso relatada hoje", skip_reason: "Risco maior que o dos pedidos mais antigos", version: 3 }));
    expect(onChanged.mock.calls[0][0]).toBe("Autorizado em Consórcio Leste. Registre a data e o local quando o prestador marcar.");
  });

  it("voltar à cor sugerida some com o motivo e ele não vai no corpo", async () => {
    mount();
    const form = await openAuthorize();
    fireEvent.click(within(form).getByLabelText(/Consórcio Leste/));
    text("Cor confirmada", "red");
    expect(screen.getByLabelText("Motivo da mudança de cor")).not.toBeNull();
    text("Cor confirmada", "yellow");
    expect(screen.queryByLabelText("Motivo da mudança de cor")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
    await waitFor(() => expect(mocked(api.authorizeRegulationRequest)).toHaveBeenCalledWith("rr1", { offer_id: "of3", version: 3 }));
  });

  it("409 quota_exhausted: frase, ofertas relidas, oferta limpa, o resto fica", async () => {
    mount();
    const form = await openAuthorize();
    fireEvent.click(within(form).getByLabelText(/Consórcio Leste/));
    text("Cor confirmada", "red"); text("Motivo da mudança de cor", "Piora da dor em repouso relatada hoje");
    mocked(api.authorizeRegulationRequest).mockRejectedValueOnce(new ApiError(409, { error: "quota_exhausted" }, "x"));
    mocked(api.listCareOffers).mockResolvedValue([ OWN, FULL, { ...CONTRACTED, used: 10, available: 0 } ]);
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
    expect((await within(form).findByRole("alert")).textContent).toBe(QUOTA_EXHAUSTED_TEXT);
    await waitFor(() => expect(mocked(api.listCareOffers)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((within(form).getByLabelText(/Consórcio Leste/) as HTMLInputElement).disabled).toBe(true));
    expect((within(form).getByLabelText(/Consórcio Leste/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Motivo da mudança de cor") as HTMLTextAreaElement).value).toBe("Piora da dor em repouso relatada hoje");
    expect(mocked(api.authorizeRegulationRequest)).toHaveBeenCalledTimes(1);
  });

  it("outras recusas ficam no formulário, com a frase própria e sem dado do corpo", async () => {
    mount();
    const form = await openAuthorize();
    fireEvent.click(within(form).getByLabelText(/Ambulatório de Especialidades/));
    for (const [ status, error, phrase ] of [
      [ 409, "citizen_not_verified", /o paciente não tem cadastro validado no posto/ ],
      [ 422, "invalid_offer", /esta oferta não serve para este pedido/ ],
      [ 422, "color_reason_required", /ao mudar a cor, informe o motivo/ ]
    ] as [ number, string, RegExp ][]) {
      mocked(api.authorizeRegulationRequest).mockRejectedValueOnce(new ApiError(status, { error }, "x"));
      fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
      await waitFor(() => expect(within(form).getByRole("alert").textContent).toMatch(phrase));
    }
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("sem oferta com saldo: aviso e botão desabilitado", async () => {
    mocked(api.listCareOffers).mockResolvedValue([ FULL ]);
    mount();
    const form = await openAuthorize();
    expect(await within(form).findByText("nenhuma oferta com saldo para este alvo neste mês — cadastre em Prestadores e cotas")).not.toBeNull();
    expect((within(form).getByRole("button", { name: "Confirmar autorização" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("409 stale_version: frase, nada reenviado, Recarregar relê", async () => {
    mount();
    const form = await openAuthorize();
    fireEvent.click(within(form).getByLabelText(/Ambulatório de Especialidades/));
    mocked(api.authorizeRegulationRequest).mockRejectedValueOnce(new ApiError(409, { error: "stale_version" }, "x"));
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(mocked(api.getRegulationRequest)).toHaveBeenCalledTimes(2));
    expect(mocked(api.authorizeRegulationRequest)).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("form", { name: "Autorizar o pedido" })).not.toBeNull();
  });

  it("devolver, negar e cancelar: motivo de 10 a 500, só no corpo", async () => {
    mocked(api.returnRegulationRequest).mockResolvedValue(regRequest({ status: "returned" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Devolver para complementar" }));
    text("Motivo da devolução", "falta");
    fireEvent.click(screen.getByRole("button", { name: "Devolver" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o motivo precisa de 10 a 500 caracteres");
    text("Motivo da devolução", "Falta o resultado do teste ergométrico");
    fireEvent.click(screen.getByRole("button", { name: "Devolver" }));
    await waitFor(() => expect(mocked(api.returnRegulationRequest)).toHaveBeenCalledWith("rr1", "Falta o resultado do teste ergométrico", 3));
    expect(onChanged).toHaveBeenCalledWith("Pedido devolvido à unidade solicitante para complementar.");
  });

  it("negar: 501 caracteres é recusado sem cortar; o motivo vai inteiro e a frase de sucesso é a do pedido negado", async () => {
    mocked(api.denyRegulationRequest).mockResolvedValue(regRequest({ status: "denied" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Negar" }));
    text("Motivo da negativa", "x".repeat(501));
    fireEvent.click(screen.getByRole("button", { name: "Negar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o motivo precisa de 10 a 500 caracteres");
    expect((screen.getByLabelText("Motivo da negativa") as HTMLTextAreaElement).value).toHaveLength(501);
    expect(mocked(api.denyRegulationRequest)).not.toHaveBeenCalled();
    text("Motivo da negativa", "Não há indicação clínica para a especialidade");
    fireEvent.click(screen.getByRole("button", { name: "Negar pedido" }));
    await waitFor(() => expect(mocked(api.denyRegulationRequest)).toHaveBeenCalledWith("rr1", "Não há indicação clínica para a especialidade", 3));
    expect(onChanged).toHaveBeenCalledWith("Pedido negado.");
  });

  it("cancelar: pedido sem autorização diz só 'cancelado'; com autorização, que a vaga volta para a cota", async () => {
    mocked(api.cancelRegulationRequest).mockResolvedValue(regRequest({ status: "cancelled" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar o pedido" }));
    text("Motivo do cancelamento", "O paciente mudou de cidade");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    await waitFor(() => expect(mocked(api.cancelRegulationRequest)).toHaveBeenCalledWith("rr1", "O paciente mudou de cidade", 3));
    expect(onChanged).toHaveBeenCalledWith("Pedido cancelado.");
    cleanup();
    onChanged.mockClear();
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest({ status: "authorized", authorization: AUTHORIZED_OWN }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar o pedido" }));
    text("Motivo do cancelamento", "O paciente mudou de cidade");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("Pedido cancelado; a vaga volta para a cota do mês."));
  });

  it("cancelar com o horário marcado na rede própria: 422 appointment_scheduled, frase no formulário, motivo mantido", async () => {
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest({ status: "authorized", authorization: AUTHORIZED_OWN }));
    mocked(api.cancelRegulationRequest).mockRejectedValue(new ApiError(422, { error: "appointment_scheduled" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar o pedido" }));
    text("Motivo do cancelamento", "O paciente mudou de cidade");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/^a unidade já marcou o horário/);
    expect((screen.getByLabelText("Motivo do cancelamento") as HTMLTextAreaElement).value).toBe("O paciente mudou de cidade");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("invalid_transition numa ação: frase de recarregar, formulário aberto, Recarregar relê", async () => {
    mocked(api.denyRegulationRequest).mockRejectedValue(new ApiError(422, { error: "invalid_transition" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Negar" }));
    text("Motivo da negativa", "Não há indicação clínica para a especialidade");
    fireEvent.click(screen.getByRole("button", { name: "Negar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toBe("este pedido mudou de situação — recarregue");
    expect((screen.getByLabelText("Motivo da negativa") as HTMLTextAreaElement).value).toBe("Não há indicação clínica para a especialidade");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(mocked(api.getRegulationRequest)).toHaveBeenCalledTimes(2));
  });

  it("invalid_transition e Recarregar com a situação nova: o formulário que não vale mais some", async () => {
    mocked(api.denyRegulationRequest).mockRejectedValue(new ApiError(422, { error: "invalid_transition" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Negar" }));
    text("Motivo da negativa", "Não há indicação clínica para a especialidade");
    fireEvent.click(screen.getByRole("button", { name: "Negar pedido" }));
    await screen.findByRole("alert");
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest({ status: "authorized", authorization: AUTHORIZED_OWN, version: 4 }));
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(screen.queryByLabelText("Motivo da negativa")).toBeNull());
    expect(screen.queryByRole("button", { name: "Negar" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancelar o pedido" })).not.toBeNull();
  });

  it("Recarregar com outra cor confirmada: o motivo da mudança não acende sozinho e a escolha de oferta fica", async () => {
    mount();
    const form = await openAuthorize();
    fireEvent.click(within(form).getByLabelText(/Consórcio Leste/));
    mocked(api.authorizeRegulationRequest).mockRejectedValueOnce(new ApiError(409, { error: "stale_version" }, "x"));
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
    await screen.findByRole("alert");
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest({ color: "red", version: 4 }));
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect((screen.getByLabelText("Cor confirmada") as HTMLSelectElement).value).toBe("red"));
    expect(screen.queryByLabelText("Motivo da mudança de cor")).toBeNull();
    expect((within(form).getByLabelText(/Consórcio Leste/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar autorização" }));
    await waitFor(() => expect(mocked(api.authorizeRegulationRequest)).toHaveBeenLastCalledWith("rr1", { offer_id: "of3", version: 4 }));
  });

  it("extra recebe o pedido e `applied`: mostra a situação nova sem leitura a mais e Voltar à fila passa changed = true", async () => {
    const next = regRequest({ status: "authorized", authorization: AUTHORIZED_OWN, version: 4 });
    renderWithProviders(<RequestDetail id="rr1" today={TODAY26} onBack={onBack} onChanged={onChanged}
      extra={({ request, applied }) => <button type="button" onClick={() => applied(next)}>{`aplicar sobre v${request.version}`}</button>} />);
    fireEvent.click(await screen.findByRole("button", { name: "aplicar sobre v3" }));
    expect(await screen.findByRole("button", { name: "aplicar sobre v4" })).not.toBeNull();
    expect(screen.getByText("autorizado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Autorizar" })).toBeNull();
    expect(mocked(api.getRegulationRequest)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Voltar à fila" }));
    expect(onBack).toHaveBeenLastCalledWith(true);
  });

  const AUTHORIZED_EXTERNAL = { ...AUTHORIZED_OWN, offer_id: "of3", provider: { id: "pr3", name: "Consórcio Leste", kind: "consortium" } };

  it("agendar (F-26.5): o detalhe fica aberto na situação nova, com a frase, sem leitura nominal a mais", async () => {
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest({ status: "authorized", authorization: AUTHORIZED_EXTERNAL, version: 4 }));
    mocked(api.scheduleRegulationRequest).mockResolvedValue(regRequest({ status: "scheduled", authorization: AUTHORIZED_EXTERNAL, version: 5,
      schedule: { at: "2026-11-10T14:30:00-03:00", place: "Consórcio Leste", notes: null } }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar agendamento" }));
    text("Data e hora", "2026-11-10T14:30");
    text("Local", "Consórcio Leste");
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    expect((await screen.findByRole("status")).textContent).toBe("Agendamento registrado: o cidadão vê a data e o local no celular.");
    expect(await screen.findByRole("button", { name: "Remarcar" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Faltou" })).not.toBeNull();
    expect(screen.getByText(fmtDateTime("2026-11-10T14:30:00-03:00"))).not.toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
    expect(mocked(api.getRegulationRequest)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Voltar à fila" }));
    expect(onBack).toHaveBeenLastCalledWith(true);
  });

  it("agendar com versão velha: a frase do Recarregar sobe ao detalhe, que relê e some com a frase", async () => {
    mocked(api.getRegulationRequest).mockResolvedValueOnce(regRequest({ status: "authorized", authorization: AUTHORIZED_EXTERNAL, version: 4 }))
      .mockResolvedValue(regRequest({ status: "authorized", authorization: AUTHORIZED_EXTERNAL, version: 6 }));
    mocked(api.scheduleRegulationRequest).mockRejectedValue(new ApiError(409, { error: "stale_version" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar agendamento" }));
    text("Data e hora", "2026-11-10T14:30");
    text("Local", "Consórcio Leste");
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    expect((screen.getByLabelText("Local") as HTMLInputElement).value).toBe("Consórcio Leste");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(screen.queryByText(STALE_TEXT)).toBeNull());
    expect(mocked(api.getRegulationRequest)).toHaveBeenCalledTimes(2);
  });

  it("rede própria autorizada: a frase do módulo 17 e nenhum formulário", async () => {
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest({ status: "authorized", authorization: AUTHORIZED_OWN, appointment_request_id: "ar9" }));
    mount();
    expect(await screen.findByText("O agendamento é feito pela unidade de destino (pedido de agendamento do módulo 17).")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar agendamento" })).toBeNull();
  });

  it("ações por situação: autorizado não nega nem autoriza", async () => {
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest({ status: "authorized", authorization: AUTHORIZED_OWN }));
    mount();
    await screen.findByRole("button", { name: "Cancelar o pedido" });
    expect(screen.queryByRole("button", { name: "Autorizar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Negar" })).toBeNull();
    const detail = screen.getByRole("region", { name: "Cardiologia" });
    expect(within(detail).getByText("Ambulatório de Especialidades")).not.toBeNull();
  });

  it("Voltar à fila informa se houve decisão", async () => {
    mocked(api.returnRegulationRequest).mockResolvedValue(regRequest({ status: "returned" }));
    mount();
    await screen.findByRole("region", { name: "Cardiologia" });
    fireEvent.click(screen.getByRole("button", { name: "Voltar à fila" }));
    expect(onBack).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Devolver para complementar" }));
    text("Motivo da devolução", "Falta o resultado do teste ergométrico");
    fireEvent.click(screen.getByRole("button", { name: "Devolver" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Voltar à fila" }));
    expect(onBack).toHaveBeenLastCalledWith(true);
  });

  it("Guia em PDF: janela bloqueada mostra a frase; o slot extra aparece", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    renderWithProviders(<RequestDetail id="rr1" today={TODAY26} onBack={onBack} onChanged={onChanged} extra={() => <p>espaço das próximas tasks</p>} />);
    fireEvent.click(await screen.findByRole("button", { name: "Guia em PDF" }));
    expect((await screen.findByRole("alert")).textContent).toBe(POPUP_BLOCKED);
    expect(screen.getByText("espaço das próximas tasks")).not.toBeNull();
  });

  it("volta à aba e reconecta: o detalhe não relê", async () => {
    mount();
    await screen.findByRole("region", { name: "Cardiologia" });
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.getRegulationRequest)).toHaveBeenCalledTimes(1);
  });

  it("falha na leitura: frase e Recarregar", async () => {
    mocked(api.getRegulationRequest).mockRejectedValueOnce(new ApiError(404, { error: "not_found" }, "x"));
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe("pedido não encontrado");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(await screen.findByRole("region", { name: "Cardiologia" })).not.toBeNull();
  });
});
