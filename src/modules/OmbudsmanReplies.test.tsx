// Respostas à ouvidoria (módulo 33; F-33.5): a caixa do ponto de resposta lê só destino, extrato, prazo e estado.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { expectFrozenNotice } from "../test/frozenNotice";
import { inboxItem, ombudsmanUser } from "../test/ombudsmanFixtures";
import * as api from "../lib/api";
import { ApiError, type SessionUser } from "../lib/api";
import { OMBUDSMAN_ERRORS, OMBUDSMAN_NO_ROLE } from "../lib/ombudsman";
import { OmbudsmanReplies } from "./OmbudsmanReplies";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listOmbudsmanInbox: vi.fn(),
  replyOmbudsmanInbox: vi.fn(), declineOmbudsmanInbox: vi.fn(), extendOmbudsmanInbox: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const page = (items: api.OmbudsmanInboxItem[], next_before: string | null = null) => ({ items, next_before });
const REPLY = "Reposição feita em 10/11; a UBS já tem o medicamento.";

function mount(user: SessionUser = ombudsmanUser([ "ombudsman_responder" ])) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(<OmbudsmanReplies />);
}
async function sendReply(text: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Responder à ouvidoria" }));
  fireEvent.change(screen.getByLabelText("Resposta à ouvidoria"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
}

describe("respostas à ouvidoria", () => {
  it("lê campo a campo: destino, extrato, prazo e estado — nunca protocolo, texto, assunto, identidade ou anexos", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ { ...inboxItem(), protocol: "2026-000123", body: "Fui à UBS três vezes",
      subject: { name: "Demora" }, identity: { name: "Maria Lima" }, attachments: [ { id: "a1" } ] } as never ]));
    const { client, container } = mount();
    expect(await screen.findByText(/falta de losartana/)).not.toBeNull();
    expect(screen.getByText("Setor: Assistência Farmacêutica")).not.toBeNull();
    expect(screen.getByText("aguardando resposta")).not.toBeNull();
    expect(screen.queryByText(/2026-000123|três vezes|Demora|Maria Lima|Anexo/)).toBeNull();
    expect(container.textContent).not.toMatch(/2026-000123|três vezes|Demora|Maria Lima/);
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toMatch(/2026-000123|três vezes|Demora|Maria Lima|a1/);
    expect(screen.getByText(/Não entre em contato com quem fez a manifestação/)).not.toBeNull();
  });

  it("pendentes primeiro, com a ordem do api dentro de cada grupo; Carregar mais manda before", async () => {
    vi.mocked(api.listOmbudsmanInbox)
      .mockResolvedValueOnce(page([ inboxItem({ id: "r1", state: "replied", color: null, extract: "Extrato respondido" }),
        inboxItem({ id: "p1", extract: "Extrato pendente um" }) ], "2026-11-01T00:00:00Z"))
      .mockResolvedValueOnce(page([ inboxItem({ id: "p2", extract: "Extrato pendente dois" }) ]));
    mount();
    await screen.findByText("Extrato pendente um");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await screen.findByText("Extrato pendente dois");
    expect(vi.mocked(api.listOmbudsmanInbox).mock.calls[1]).toEqual([ { before: "2026-11-01T00:00:00Z" } ]);
    const order = screen.getAllByRole("article").map((a) => a.textContent ?? "");
    expect(order[0]).toContain("Extrato pendente um");
    expect(order[1]).toContain("Extrato pendente dois");
    expect(order[2]).toContain("Extrato respondido");
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("cursor recusado (invalid_cursor) em Carregar mais: a frase e a leitura recomeça do início", async () => {
    vi.mocked(api.listOmbudsmanInbox)
      .mockResolvedValueOnce(page([ inboxItem({ id: "p1", extract: "Extrato pendente um" }) ], "velho"))
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_cursor" }, "x"))
      .mockResolvedValue(page([ inboxItem({ id: "p9", extract: "Extrato relido do início" }) ]));
    mount();
    await screen.findByText("Extrato pendente um");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Extrato relido do início")).not.toBeNull();
    expect(screen.getByText(OMBUDSMAN_ERRORS.invalid_cursor)).not.toBeNull();
    const calls = vi.mocked(api.listOmbudsmanInbox).mock.calls;
    expect(calls[1]).toEqual([ { before: "velho" } ]);
    expect(calls[calls.length - 1]).toEqual([ {} ]);
    expect(screen.queryByText("Extrato pendente um")).toBeNull();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("sem encaminhamentos: frase de vazio", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([]));
    mount();
    expect(await screen.findByText("Nenhum encaminhamento para o seu destino")).not.toBeNull();
  });

  it("responder: aviso de texto congelado, uma chamada no duplo clique, o cartão vira respondido", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem() ]));
    vi.mocked(api.replyOmbudsmanInbox).mockResolvedValue(inboxItem({ state: "replied", color: null }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Responder à ouvidoria" }));
    const field = screen.getByLabelText("Resposta à ouvidoria");
    expectFrozenNotice(field);
    fireEvent.change(field, { target: { value: REPLY } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    await waitFor(() => expect(api.replyOmbudsmanInbox).toHaveBeenCalledTimes(1));
    expect(api.replyOmbudsmanInbox).toHaveBeenCalledWith("f1", "pending", REPLY);
    expect(await screen.findByText("respondido")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Responder à ouvidoria" })).toBeNull();
    expect(api.listOmbudsmanInbox).toHaveBeenCalledTimes(1);
  });

  it("resposta curta é recusada na tela, com a frase do campo, sem chamar o api", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem() ]));
    mount();
    await sendReply("curta");
    expect(await screen.findByText(/a resposta tem de ter de 10 a 4000 caracteres/)).not.toBeNull();
    expect(api.replyOmbudsmanInbox).not.toHaveBeenCalled();
  });

  it("recusa do api no campo usa a frase do campo (body) e não relê", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem() ]));
    vi.mocked(api.replyOmbudsmanInbox).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "body" }, "x"));
    mount();
    await sendReply(REPLY);
    expect(await screen.findByText(/a resposta tem de ter de 10 a 4000 caracteres/)).not.toBeNull();
    expect(api.listOmbudsmanInbox).toHaveBeenCalledTimes(1);
  });

  it("recusar com motivo; prorrogar só uma vez", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem(), inboxItem({ id: "f2", extended: true }) ]));
    vi.mocked(api.declineOmbudsmanInbox).mockResolvedValue(inboxItem({ state: "declined", color: null }));
    mount();
    const [ first, second ] = await screen.findAllByRole("article");
    expect(within(second).queryByRole("button", { name: "Prorrogar prazo" })).toBeNull();
    expect(within(first).getByRole("button", { name: "Prorrogar prazo" })).not.toBeNull();
    fireEvent.click(within(first).getByRole("button", { name: "Não é do nosso destino" }));
    const field = within(first).getByLabelText("Motivo");
    expectFrozenNotice(field);
    fireEvent.change(field, { target: { value: "Quem cuida é a farmácia central." } });
    fireEvent.click(within(first).getByRole("button", { name: "Devolver à ouvidoria" }));
    fireEvent.click(within(first).getByRole("button", { name: "Devolver à ouvidoria" }));
    await waitFor(() => expect(api.declineOmbudsmanInbox).toHaveBeenCalledWith("f1", "pending", "Quem cuida é a farmácia central."));
    expect(api.declineOmbudsmanInbox).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("recusado pelo destino")).not.toBeNull();
  });

  it("prorrogar: uma chamada, o item volta com extended; já prorrogado (422) mostra a frase", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem() ]));
    vi.mocked(api.extendOmbudsmanInbox).mockResolvedValueOnce(inboxItem({ extended: true, due_on: "2026-12-15" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Prorrogar prazo" }));
    fireEvent.change(screen.getByLabelText("Motivo da prorrogação"), { target: { value: "Aguardamos o inventário da central." } });
    fireEvent.click(screen.getByRole("button", { name: "Prorrogar" }));
    fireEvent.click(screen.getByRole("button", { name: "Prorrogar" }));
    await waitFor(() => expect(api.extendOmbudsmanInbox).toHaveBeenCalledTimes(1));
    expect(api.extendOmbudsmanInbox).toHaveBeenCalledWith("f1", "pending", "Aguardamos o inventário da central.");
    expect(await screen.findByText("prazo prorrogado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Prorrogar prazo" })).toBeNull();
  });

  it("prorrogação repetida (422 already_extended) mostra a frase no formulário", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem() ]));
    vi.mocked(api.extendOmbudsmanInbox).mockRejectedValue(new ApiError(422, { error: "already_extended" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Prorrogar prazo" }));
    fireEvent.change(screen.getByLabelText("Motivo da prorrogação"), { target: { value: "Aguardamos o inventário da central." } });
    fireEvent.click(screen.getByRole("button", { name: "Prorrogar" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.already_extended)).not.toBeNull();
    expect(api.listOmbudsmanInbox).toHaveBeenCalledTimes(1);
  });

  it("encaminhamento cancelado no meio (409): frase, uma releitura, texto não reenviado", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValueOnce(page([ inboxItem() ])).mockResolvedValueOnce(page([]));
    vi.mocked(api.replyOmbudsmanInbox).mockRejectedValue(new ApiError(409, { error: "forwarding_changed" }, "x"));
    mount();
    await sendReply(REPLY);
    expect(await screen.findByText(OMBUDSMAN_ERRORS.forwarding_changed)).not.toBeNull();
    await waitFor(() => expect(api.listOmbudsmanInbox).toHaveBeenCalledTimes(2));
    await screen.findByText("Nenhum encaminhamento para o seu destino");
    expect(screen.getByText(OMBUDSMAN_ERRORS.forwarding_changed)).not.toBeNull();
    expect(api.replyOmbudsmanInbox).toHaveBeenCalledTimes(1);
    expect(api.listOmbudsmanInbox).toHaveBeenCalledTimes(2);
  });

  it("409 e a releitura traz o mesmo encaminhamento cancelado: o formulário fecha, o texto some e não há segunda chamada", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValueOnce(page([ inboxItem() ]))
      .mockResolvedValueOnce(page([ inboxItem({ state: "cancelled", color: null }) ]));
    vi.mocked(api.replyOmbudsmanInbox).mockRejectedValue(new ApiError(409, { error: "forwarding_changed" }, "x"));
    const { container } = mount();
    await sendReply(REPLY);
    expect(await screen.findByText(OMBUDSMAN_ERRORS.forwarding_changed)).not.toBeNull();
    await waitFor(() => expect(api.listOmbudsmanInbox).toHaveBeenCalledTimes(2));
    await screen.findByText("cancelado");
    expect(screen.queryByLabelText("Resposta à ouvidoria")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar resposta" })).toBeNull();
    expect(container.textContent).not.toContain(REPLY);
    expect(screen.getByText(OMBUDSMAN_ERRORS.forwarding_changed)).not.toBeNull();
    expect(api.replyOmbudsmanInbox).toHaveBeenCalledTimes(1);
  });

  it("encaminhamento que saiu do destino (404): a mesma frase e uma releitura", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValueOnce(page([ inboxItem() ])).mockResolvedValueOnce(page([]));
    vi.mocked(api.declineOmbudsmanInbox).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Não é do nosso destino" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Quem cuida é a farmácia central." } });
    fireEvent.click(screen.getByRole("button", { name: "Devolver à ouvidoria" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.forwarding_changed)).not.toBeNull();
    await waitFor(() => expect(api.listOmbudsmanInbox).toHaveBeenCalledTimes(2));
    expect(api.declineOmbudsmanInbox).toHaveBeenCalledTimes(1);
  });

  it("uma ação aberta por vez", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem() ]));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Responder à ouvidoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Não é do nosso destino" }));
    expect(screen.queryByLabelText("Resposta à ouvidoria")).toBeNull();
    expect(screen.getByLabelText("Motivo")).not.toBeNull();
  });

  it("técnico sem papel de respondente não lê a caixa", async () => {
    mount(ombudsmanUser([ "ombudsman_staff" ]));
    expect(await screen.findByText(OMBUDSMAN_NO_ROLE)).not.toBeNull();
    expect(api.listOmbudsmanInbox).not.toHaveBeenCalled();
  });
});

describe("ajustes da revisão", () => {
  it("o dia vem do fuso da cidade: 01:30Z de 12/11 é 11/11", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem({ created_at: "2026-11-12T01:30:00Z" }) ]));
    mount();
    expect(await screen.findByRole("article", { name: "Encaminhamento de 11/11/2026" })).not.toBeNull();
    expect(screen.getByText("recebido em 11/11/2026")).not.toBeNull();
  });

  it("o aviso de texto congelado também está na prorrogação", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem() ]));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Prorrogar prazo" }));
    expectFrozenNotice(screen.getByLabelText("Motivo da prorrogação"));
  });

  it("item da segunda página é trocado dentro dela", async () => {
    vi.mocked(api.listOmbudsmanInbox)
      .mockResolvedValueOnce(page([ inboxItem({ id: "p1", extract: "Extrato da página um" }) ], "2026-11-01T00:00:00Z"))
      .mockResolvedValueOnce(page([ inboxItem({ id: "p2", extract: "Extrato da página dois" }) ]));
    vi.mocked(api.replyOmbudsmanInbox).mockResolvedValue(inboxItem({ id: "p2", extract: "Extrato da página dois", state: "replied", color: null, reply: REPLY }));
    mount();
    await screen.findByText("Extrato da página um");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    const second = (await screen.findByText("Extrato da página dois")).closest("article") as HTMLElement;
    fireEvent.click(within(second).getByRole("button", { name: "Responder à ouvidoria" }));
    fireEvent.change(within(second).getByLabelText("Resposta à ouvidoria"), { target: { value: REPLY } });
    fireEvent.click(within(second).getByRole("button", { name: "Enviar resposta" }));
    expect(await screen.findByText("respondido")).not.toBeNull();
    expect(screen.getByText("Extrato da página um")).not.toBeNull();
    expect(screen.getByText("Resposta enviada")).not.toBeNull();
    expect(screen.getByText(REPLY)).not.toBeNull();
    expect(api.listOmbudsmanInbox).toHaveBeenCalledTimes(2);
  });

  it("a recusa mostra o rótulo do motivo", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem({ state: "declined", color: null, reply: "Quem cuida é a central." }) ]));
    mount();
    expect(await screen.findByText("Motivo da recusa")).not.toBeNull();
  });

  it("depois de already_extended o botão Prorrogar prazo some", async () => {
    vi.mocked(api.listOmbudsmanInbox).mockResolvedValue(page([ inboxItem() ]));
    vi.mocked(api.extendOmbudsmanInbox).mockRejectedValue(new ApiError(422, { error: "already_extended" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Prorrogar prazo" }));
    fireEvent.change(screen.getByLabelText("Motivo da prorrogação"), { target: { value: "Aguardamos o inventário da central." } });
    fireEvent.click(screen.getByRole("button", { name: "Prorrogar" }));
    await screen.findByText(OMBUDSMAN_ERRORS.already_extended);
    expect(screen.queryByRole("button", { name: "Prorrogar prazo" })).toBeNull();
  });

  it("stale no primeiro cartão relê sem desmontar o texto digitado no segundo", async () => {
    vi.mocked(api.listOmbudsmanInbox)
      .mockResolvedValueOnce(page([ inboxItem(), inboxItem({ id: "f2", extract: "Outro extrato" }) ]))
      .mockResolvedValueOnce(page([ inboxItem({ id: "f2", extract: "Outro extrato" }) ]));
    vi.mocked(api.replyOmbudsmanInbox).mockRejectedValue(new ApiError(409, { error: "forwarding_changed" }, "x"));
    mount();
    const [ first, second ] = await screen.findAllByRole("article");
    fireEvent.click(within(second).getByRole("button", { name: "Responder à ouvidoria" }));
    fireEvent.change(within(second).getByLabelText("Resposta à ouvidoria"), { target: { value: "Texto ainda em edição aqui." } });
    fireEvent.click(within(first).getByRole("button", { name: "Responder à ouvidoria" }));
    fireEvent.change(within(first).getByLabelText("Resposta à ouvidoria"), { target: { value: REPLY } });
    fireEvent.click(within(first).getByRole("button", { name: "Enviar resposta" }));
    await waitFor(() => expect(api.listOmbudsmanInbox).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect((screen.getByLabelText("Resposta à ouvidoria") as HTMLTextAreaElement).value).toBe("Texto ainda em edição aqui.");
  });
});
