import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getNotification: vi.fn(), transitionNotification: vi.fn(), dismissNotification: vi.fn(),
    fetchNotificationPdf: vi.fn(), updateNotificationForm: vi.fn() };
});
vi.mock("../lab/saveFile", () => ({ saveFile: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { saveFile } from "../lab/saveFile";
import { NotificationDetail } from "./NotificationDetail";
import { NOTIFICATIONS_KEY, NOTIFICATION_KEY, SURVEILLANCE_COUNT_KEY, STALE_TEXT } from "../../lib/surveillance";
import { renderWithProviders } from "../../test/campaignFixtures";
import { notification, survUser } from "../../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const open = (props: Partial<Parameters<typeof NotificationDetail>[0]> = {}) =>
  renderWithProviders(<NotificationDetail id="nt1" onClose={vi.fn()} {...props} />);

describe("NotificationDetail", () => {
  beforeEach(() => {
    for (const fn of [ api.getNotification, api.transitionNotification, api.dismissNotification, api.fetchNotificationPdf, api.updateNotificationForm, saveFile ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser());
    mocked(api.getNotification).mockResolvedValue(notification({ status: "investigating", version: 4 }));
  });

  it("mostra a pessoa, o prazo, o bairro e o andamento", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ resident_elsewhere: true, residence_ibge: "4106902", neighborhood: null }));
    open();
    expect(await screen.findByText("Dengue")).not.toBeNull();
    expect(screen.getByText("residente em outro município (IBGE 4106902)")).not.toBeNull();
    expect(screen.getByText("não informado")).not.toBeNull();
    expect(screen.getByText("UBS Centro · CNES 2384299")).not.toBeNull();
    expect(screen.getByText("notificada · 26/10/2026, 10:00 · Dra. Helena Prado")).not.toBeNull();
    expect(mocked(api.getNotification)).toHaveBeenCalledWith("nt1");
  });

  it("andamento: motivo no fim da linha, e sem autor é o sistema; vencida aparece no cabeçalho", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ overdue: true, status: "dismissed", events: [
      { status: "possible", at: "2026-10-26T09:00:00-03:00", by: null, reason: null },
      { status: "dismissed", at: "2026-10-26T10:00:00-03:00", by: { name: "Dra. Helena Prado" }, reason: "CID registrado por engano" } ] }));
    open();
    expect(await screen.findByText("possível notificação não feita · 26/10/2026, 09:00 · sistema")).not.toBeNull();
    expect(screen.getByText("descartada (não era caso) · 26/10/2026, 10:00 · Dra. Helena Prado · CID registrado por engano")).not.toBeNull();
    expect(screen.getByText("vencida")).not.toBeNull();
    // Descartada não tem passo seguinte.
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
  });

  it("situação desconhecida do api não derruba a tela: aparece crua e sem passo seguinte", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "archived", classification: "mystery" }));
    open();
    expect(await screen.findAllByText("archived")).not.toBeNull();
    expect(screen.getByText("mystery")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar investigação" })).toBeNull();
  });

  it("encerrar pede a classificação; o corpo leva só to, classificação e versão", async () => {
    mocked(api.transitionNotification).mockResolvedValue(notification({ status: "closed", classification: "confirmed", version: 5 }));
    const onChanged = vi.fn();
    open({ onChanged });
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("escolha a classificação final para encerrar");
    expect(mocked(api.transitionNotification)).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Classificação final"), { target: { value: "confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.transitionNotification).mock.calls[0]).toEqual([ "nt1", { to: "closed", classification: "confirmed", version: 4 } ]));
    expect((await screen.findByRole("status")).textContent).toBe("Andamento registrado.");
    // A resposta vira o detalhe: a nova situação e o próximo passo.
    expect(await screen.findByRole("button", { name: "Registrar número oficial" })).not.toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(mocked(api.getNotification)).toHaveBeenCalledTimes(1);
  });

  it("o motivo opcional vai quando preenchido, sem espaços nas pontas; passo que não pede nada não leva classificação", async () => {
    mocked(api.transitionNotification).mockResolvedValue(notification({ status: "investigating", version: 5 }));
    mocked(api.getNotification).mockResolvedValue(notification({ status: "notified", version: 4 }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar investigação" }));
    expect(screen.queryByLabelText("Classificação final")).toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo (opcional)"), { target: { value: "  contato com o caso  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.transitionNotification).mock.calls[0]).toEqual([ "nt1", { to: "investigating", reason: "contato com o caso", version: 4 } ]));
  });

  it("motivo com mais de 500 caracteres é recusado antes de enviar", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "notified", version: 4 }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar investigação" }));
    fireEvent.change(screen.getByLabelText("Motivo (opcional)"), { target: { value: "a".repeat(501) } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("motivo com mais de 500 caracteres");
    expect(mocked(api.transitionNotification)).not.toHaveBeenCalled();
  });

  it("número oficial: formato antes; vai com a transição para entered", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "closed", classification: "confirmed", version: 6 }));
    mocked(api.transitionNotification).mockResolvedValue(notification({ status: "entered", official_number: "1234567", version: 7 }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar número oficial" }));
    fireEvent.change(screen.getByLabelText("Número da notificação no sistema oficial"), { target: { value: "12 34" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("número oficial de 1 a 30 caracteres: letras, números, ponto, barra ou hífen");
    fireEvent.change(screen.getByLabelText("Número da notificação no sistema oficial"), { target: { value: "1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.transitionNotification).mock.calls[0][1]).toEqual({ to: "entered", official_number: "1234567", version: 6 }));
    // Digitada: não há mais passo, e o número aparece.
    expect(await screen.findByText("1234567")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar número oficial" })).toBeNull();
  });

  it("motivo opcional de 1 ou 2 caracteres é aceito na transição (o api não pede mínimo)", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "notified", version: 4 }));
    mocked(api.transitionNotification).mockResolvedValue(notification({ status: "investigating", version: 5 }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar investigação" }));
    fireEvent.change(screen.getByLabelText("Motivo (opcional)"), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.transitionNotification).mock.calls[0]).toEqual([ "nt1", { to: "investigating", reason: "ok", version: 4 } ]));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("número oficial com espaço, inclusive nas pontas, é recusado e nada é enviado", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "closed", classification: "confirmed", version: 6 }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar número oficial" }));
    fireEvent.change(screen.getByLabelText("Número da notificação no sistema oficial"), { target: { value: " 1234 " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("número oficial de 1 a 30 caracteres: letras, números, ponto, barra ou hífen");
    expect(mocked(api.transitionNotification)).not.toHaveBeenCalled();
  });

  it("depois de um andamento a fila e a contagem são invalidadas (transição)", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "notified", version: 4 }));
    mocked(api.transitionNotification).mockResolvedValue(notification({ status: "investigating", version: 5 }));
    const { client } = open();
    const spy = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar investigação" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByRole("status");
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual([ NOTIFICATIONS_KEY ]);
    expect(keys).toContainEqual([ SURVEILLANCE_COUNT_KEY ]);
  });

  it("depois do descarte a fila e a contagem são invalidadas", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "possible", version: 1 }));
    mocked(api.dismissNotification).mockResolvedValue(notification({ status: "dismissed", version: 2 }));
    const { client } = open();
    const spy = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Descartar possível" }));
    fireEvent.change(screen.getByLabelText("Motivo do descarte"), { target: { value: "não era caso" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar descarte" }));
    await screen.findByRole("status");
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual([ NOTIFICATIONS_KEY ]);
    expect(keys).toContainEqual([ SURVEILLANCE_COUNT_KEY ]);
  });

  it("falha no andamento não invalida a fila nem a contagem", async () => {
    mocked(api.transitionNotification).mockRejectedValue(new ApiError(422, { error: "invalid_transition" }, "x"));
    const { client } = open();
    const spy = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
    fireEvent.change(screen.getByLabelText("Classificação final"), { target: { value: "confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByRole("alert");
    expect(spy).not.toHaveBeenCalled();
  });

  it("409 stale_version na transição: frase, o formulário fica, recarregar relê", async () => {
    mocked(api.transitionNotification).mockRejectedValue(new ApiError(409, { error: "stale_version" }, "x"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
    fireEvent.change(screen.getByLabelText("Classificação final"), { target: { value: "discarded" } });
    fireEvent.change(screen.getByLabelText("Motivo (opcional)"), { target: { value: "exame negativo" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    expect((screen.getByLabelText("Motivo (opcional)") as HTMLTextAreaElement).value).toBe("exame negativo");
    expect((screen.getByLabelText("Classificação final") as HTMLSelectElement).value).toBe("discarded");
    // Nada é reenviado sozinho.
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.transitionNotification)).toHaveBeenCalledTimes(1);
    mocked(api.getNotification).mockResolvedValue(notification({ status: "investigating", version: 5 }));
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(mocked(api.getNotification)).toHaveBeenCalledTimes(2));
    // Depois da leitura, a frase some e o que foi digitado continua; o envio seguinte leva a versão nova.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect((screen.getByLabelText("Motivo (opcional)") as HTMLTextAreaElement).value).toBe("exame negativo");
    expect(mocked(api.transitionNotification)).toHaveBeenCalledTimes(1);
    mocked(api.transitionNotification).mockResolvedValue(notification({ status: "closed", classification: "discarded", version: 6 }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.transitionNotification).mock.calls[1]).toEqual(
      [ "nt1", { to: "closed", classification: "discarded", reason: "exame negativo", version: 5 } ]));
  });

  it("outra recusa do api vira frase, sem o corpo", async () => {
    mocked(api.transitionNotification).mockRejectedValue(new ApiError(422, { error: "invalid_transition" }, "x"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
    fireEvent.change(screen.getByLabelText("Classificação final"), { target: { value: "confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("essa mudança não vale para a situação atual da notificação — recarregue");
    expect(screen.queryByRole("button", { name: "Recarregar" })).toBeNull();
  });

  it("possível: descartar exige motivo; confirmar vira notificada", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "possible", origin: "safety_net", version: 1 }));
    mocked(api.dismissNotification).mockResolvedValue(notification({ status: "dismissed", version: 2 }));
    open();
    expect(await screen.findByRole("button", { name: "Confirmar notificação" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Descartar possível" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar descarte" }));
    expect((await screen.findByRole("alert")).textContent).toBe("informe o motivo");
    fireEvent.change(screen.getByLabelText("Motivo do descarte"), { target: { value: "CID registrado por engano" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar descarte" }));
    await waitFor(() => expect(mocked(api.dismissNotification).mock.calls[0]).toEqual([ "nt1", "CID registrado por engano", 1 ]));
    // O descarte nunca passa por /transition (o api recusa to: "dismissed").
    expect(mocked(api.transitionNotification)).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toBe("Andamento registrado.");
  });

  it("possível: confirmar notificação usa a transição para notified", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "possible", origin: "safety_net", version: 1 }));
    mocked(api.transitionNotification).mockResolvedValue(notification({ status: "notified", version: 2 }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar notificação" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.transitionNotification).mock.calls[0]).toEqual([ "nt1", { to: "notified", version: 1 } ]));
    expect(mocked(api.dismissNotification)).not.toHaveBeenCalled();
  });

  it("409 stale_version no descarte: frase, o motivo fica, nada é reenviado", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "possible", version: 1 }));
    mocked(api.dismissNotification).mockRejectedValue(new ApiError(409, { error: "stale_version" }, "x"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Descartar possível" }));
    fireEvent.change(screen.getByLabelText("Motivo do descarte"), { target: { value: "não era caso" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar descarte" }));
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    expect((screen.getByLabelText("Motivo do descarte") as HTMLTextAreaElement).value).toBe("não era caso");
    expect(screen.getByRole("button", { name: "Recarregar" })).not.toBeNull();
    expect(mocked(api.dismissNotification)).toHaveBeenCalledTimes(1);
  });

  it("ficha em PDF baixa com nome sem dado pessoal", async () => {
    mocked(api.fetchNotificationPdf).mockResolvedValue({ blob: new Blob([ "%PDF" ]), filename: null });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Ficha em PDF" }));
    await waitFor(() => expect(mocked(saveFile).mock.calls[0][1]).toBe("notificacao-nt1.pdf"));
    expect(mocked(api.fetchNotificationPdf)).toHaveBeenCalledWith("nt1");
  });

  it("ficha em PDF usa o nome que o api mandou; a recusa vira frase", async () => {
    mocked(api.fetchNotificationPdf).mockResolvedValueOnce({ blob: new Blob([ "%PDF" ]), filename: "notificacao-nt1.pdf" });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Ficha em PDF" }));
    await waitFor(() => expect(mocked(saveFile).mock.calls[0][1]).toBe("notificacao-nt1.pdf"));
    mocked(api.fetchNotificationPdf).mockRejectedValueOnce(new ApiError(403, { error: "feature_disabled", feature: "surveillance" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Ficha em PDF" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a vigilância epidemiológica está desligada nesta cidade");
  });

  it("leitura com falha vira frase; Fechar chama onClose; o espaço da ficha recebe a notificação", async () => {
    mocked(api.getNotification).mockRejectedValueOnce(new ApiError(404, { error: "not_found" }, "x"));
    const onClose = vi.fn();
    open({ onClose });
    expect((await screen.findByRole("alert")).textContent).toBe("não encontrado — recarregue");
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    open({ formSlot: (n) => <p>ficha de {n.id}</p> });
    expect(await screen.findByText("ficha de nt1")).not.toBeNull();
  });

  it("a ficha complementar vem por padrão: salvar grava no detalhe, avisa quem abriu e invalida a fila", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "notified", version: 2, form: { race_color: "4" } }));
    mocked(api.updateNotificationForm).mockResolvedValue(notification({ status: "notified", version: 3, form: { race_color: "4", phone: "4133334444" } }));
    const onChanged = vi.fn();
    const { client } = open({ onChanged });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(await screen.findByLabelText("(DDD) Telefone"), { target: { value: "(41) 3333-4444" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ficha" }));
    await waitFor(() => expect(mocked(api.updateNotificationForm).mock.calls[0][2]).toBe(2));
    expect((await screen.findByText("Ficha salva.")).textContent).toBe("Ficha salva.");
    expect(onChanged.mock.calls[0][0].version).toBe(3);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ NOTIFICATIONS_KEY ] });
    expect((client.getQueryData([ NOTIFICATION_KEY, "nt1" ]) as { version: number }).version).toBe(3);
  });

  it("encerrada no sistema oficial: a ficha aparece só em leitura", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "entered", form: { race_color: "4" } }));
    open();
    expect(await screen.findByText("Parda")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Salvar ficha" })).toBeNull();
  });
});
