// Ações do técnico (módulo 33; F-33.5, F-33.6): classificar, encaminhar (com extrato), cancelar encaminhamento, pedir e
// registrar complemento, respostas intermediária e conclusiva. Todo corpo leva `expected_state`; 409/`invalid_transition`
// mostram a frase, releem uma vez e não reenviam (dois técnicos na mesma manifestação).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";
import { NOW33, forwarding, manifestation, ombudsmanUser, options, preserved } from "../../test/ombudsmanFixtures";
import * as api from "../../lib/api";
import { ApiError, type OmbudsmanManifestation } from "../../lib/api";
import { ANONYMOUS_INTERNAL, EXTRACT_NOTICE, MANIFESTATION_CHANGED, OMBUDSMAN_ERRORS, ombudsmanRoles } from "../../lib/ombudsman";
import { ManifestationView } from "./ManifestationView";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getOmbudsmanManifestation: vi.fn(),
  runOmbudsmanAction: vi.fn(), cancelOmbudsmanForwarding: vi.fn(), getOmbudsmanOptions: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function mount(m: OmbudsmanManifestation, roles = [ "ombudsman_staff" ]) {
  const user = ombudsmanUser(roles);
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.getOmbudsmanOptions).mockResolvedValue(options());
  vi.mocked(api.getOmbudsmanManifestation).mockResolvedValue(m);
  return renderWithProviders(<ManifestationView id={m.id} roles={ombudsmanRoles(user)} now={NOW33} onBack={() => {}} />);
}
async function forward(dest: string, text: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Encaminhar" }));
  fireEvent.change(screen.getByLabelText("Destino"), { target: { value: dest } });
  fireEvent.change(screen.getByLabelText("Extrato para o destino"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Encaminhar agora" }));
}
async function sendInterim(text: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Resposta intermediária" }));
  fireEvent.change(screen.getByLabelText("Texto ao cidadão"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar resposta intermediária" }));
}
const optionNames = (label: string) =>
  within(screen.getByLabelText(label)).getAllByRole("option").map((o) => o.textContent);

describe("ações do técnico", () => {
  it("classificar: subassunto obrigatório; o corpo leva expected_state e só o que mudou", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation());
    mount(manifestation({ state: "received", subject: null }));
    fireEvent.click(await screen.findByRole("button", { name: "Classificar" }));
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "s1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar classificação" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.subject_not_leaf)).not.toBeNull();
    expect(api.runOmbudsmanAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Subassunto"), { target: { value: "s11" } });
    fireEvent.click(screen.getByLabelText("Urgente"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar classificação" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "classify", { expected_state: "received", subject_id: "s11", urgent: true } ]));
  });

  it("classificar: profissional das opções filtrado pela unidade (sem rota de profissionais); unidade trocada vai no corpo", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation());
    mount(manifestation());
    fireEvent.click(await screen.findByRole("button", { name: "Classificar" }));
    expect(optionNames("Profissional")).toEqual([ "sem profissional", "Carlos Mendes", "Beatriz Rocha" ]);
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "upa1" } });
    expect(optionNames("Profissional")).toEqual([ "sem profissional", "Beatriz Rocha" ]);
    fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar classificação" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "classify", { expected_state: "in_analysis", subject_id: "s11", health_unit_id: "upa1", professional_id: "p2" } ]));
  });

  it("classificar a anônima: o tipo não é oferecido (o api a mantém denúncia)", async () => {
    mount(preserved({ identification_mode: "anonymous" }));
    fireEvent.click(await screen.findByRole("button", { name: "Classificar" }));
    expect(screen.getByLabelText("Assunto")).not.toBeNull();
    expect(screen.queryByLabelText("Tipo")).toBeNull();
  });

  it("encaminhar: avisos no extrato antes do envio, destino sem respondente indisponível, extrato curto não sai", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "forwarded" }));
    mount(manifestation());
    fireEvent.click(await screen.findByRole("button", { name: "Encaminhar" }));
    const extract = screen.getByLabelText("Extrato para o destino");
    expectFrozenNotice(extract);
    const ids = extract.getAttribute("aria-describedby")!.split(/\s+/).map((i) => document.getElementById(i)?.textContent);
    expect(ids).toContain(EXTRACT_NOTICE);
    expect((screen.getByRole("option", { name: /Regulação/ }) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole("option", { name: /UPA Boqueirão/ }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Destino"), { target: { value: "department:dep1" } });
    fireEvent.change(extract, { target: { value: "x".repeat(19) } });
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar agora" }));
    expect(api.runOmbudsmanAction).not.toHaveBeenCalled();
    fireEvent.change(extract, { target: { value: "Usuária relata falta de losartana na farmácia da UBS Centro." } });
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar agora" }));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar agora" }));
    await waitFor(() => expect(api.runOmbudsmanAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0][2])
      .toEqual({ expected_state: "in_analysis", department_id: "dep1", extract: "Usuária relata falta de losartana na farmácia da UBS Centro." });
  });

  it("encaminhar a uma unidade: o corpo leva health_unit_id e não department_id", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "forwarded" }));
    mount(manifestation());
    await forward("health_unit:ubs1", "Usuária relata falta de losartana na farmácia da UBS Centro.");
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "forward", { expected_state: "in_analysis", health_unit_id: "ubs1", extract: "Usuária relata falta de losartana na farmácia da UBS Centro." } ]));
  });

  it("destination_without_responder do api: a frase no destino e o extrato mantido", async () => {
    vi.mocked(api.runOmbudsmanAction).mockRejectedValue(new ApiError(422, { error: "destination_without_responder" }, "x"));
    mount(manifestation());
    await forward("department:dep1", "Usuária relata falta de losartana na farmácia da UBS Centro.");
    expect(await screen.findByText(OMBUDSMAN_ERRORS.destination_without_responder)).not.toBeNull();
    expect((screen.getByLabelText("Destino")).getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText("Extrato para o destino") as HTMLTextAreaElement).value).toMatch(/losartana/);
  });

  it("409 manifestation_changed: frase, uma releitura, texto mantido se a ação ainda cabe", async () => {
    vi.mocked(api.getOmbudsmanManifestation).mockResolvedValueOnce(manifestation()).mockResolvedValueOnce(manifestation({ state: "forwarded" }));
    vi.mocked(api.runOmbudsmanAction).mockRejectedValue(new ApiError(409, { error: "manifestation_changed" }, "x"));
    mount(manifestation());
    await forward("department:dep1", "Usuária relata falta de losartana na farmácia da UBS Centro.");
    expect(await screen.findByText(MANIFESTATION_CHANGED)).not.toBeNull();
    await waitFor(() => expect(api.getOmbudsmanManifestation).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Extrato para o destino") as HTMLTextAreaElement).value).toMatch(/losartana/); // forward cabe em forwarded
    expect(api.runOmbudsmanAction).toHaveBeenCalledTimes(1);
  });

  it("depois da releitura, o próximo envio leva o estado novo", async () => {
    vi.mocked(api.getOmbudsmanManifestation).mockResolvedValueOnce(manifestation()).mockResolvedValueOnce(manifestation({ state: "forwarded" }));
    vi.mocked(api.runOmbudsmanAction).mockRejectedValueOnce(new ApiError(409, { error: "manifestation_changed" }, "x"))
      .mockResolvedValueOnce(manifestation({ state: "forwarded" }));
    mount(manifestation());
    await forward("department:dep1", "Usuária relata falta de losartana na farmácia da UBS Centro.");
    await waitFor(() => expect(api.getOmbudsmanManifestation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("encaminhada")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar agora" }));
    await waitFor(() => expect(api.runOmbudsmanAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.runOmbudsmanAction).mock.calls[1][2]).toMatchObject({ expected_state: "forwarded" });
  });

  it("422 invalid_transition: mesma releitura, sem reenvio", async () => {
    vi.mocked(api.getOmbudsmanManifestation).mockResolvedValueOnce(manifestation()).mockResolvedValueOnce(manifestation({ state: "forwarded" }));
    vi.mocked(api.runOmbudsmanAction).mockRejectedValue(new ApiError(422, { error: "invalid_transition" }, "x"));
    mount(manifestation());
    await forward("department:dep1", "Usuária relata falta de losartana na farmácia da UBS Centro.");
    expect(await screen.findByText(OMBUDSMAN_ERRORS.invalid_transition)).not.toBeNull();
    await waitFor(() => expect(api.getOmbudsmanManifestation).toHaveBeenCalledTimes(2));
    expect(api.runOmbudsmanAction).toHaveBeenCalledTimes(1);
  });

  it("409 manifestation_changed: formulário fecha quando a ação não cabe mais", async () => {
    vi.mocked(api.getOmbudsmanManifestation).mockResolvedValueOnce(manifestation()).mockResolvedValueOnce(manifestation({ state: "archived", color: null }));
    vi.mocked(api.runOmbudsmanAction).mockRejectedValue(new ApiError(409, { error: "manifestation_changed" }, "x"));
    mount(manifestation());
    await sendInterim("Estamos verificando com a farmácia e retornamos.");
    expect(await screen.findByText(MANIFESTATION_CHANGED)).not.toBeNull();
    await waitFor(() => expect(screen.queryByLabelText("Texto ao cidadão")).toBeNull());
    expect(screen.getByText(MANIFESTATION_CHANGED)).not.toBeNull();
    expect(api.runOmbudsmanAction).toHaveBeenCalledTimes(1);
  });

  it("sucesso: o detalhe vem da resposta (sem nova leitura) e o formulário fecha", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "in_analysis" }));
    mount(manifestation());
    await sendInterim("Estamos verificando com a farmácia e retornamos.");
    await waitFor(() => expect(screen.queryByLabelText("Texto ao cidadão")).toBeNull());
    expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "interim_response", { expected_state: "in_analysis", text: "Estamos verificando com a farmácia e retornamos." } ]);
    expect(api.getOmbudsmanManifestation).toHaveBeenCalledTimes(1);
  });

  it("conclusiva bloqueada com encaminhamento pendente; resolutividade só onde cabe; anônima interna", async () => {
    mount(manifestation({ state: "forwarded", pending_forwardings: 1 }));
    expect((await screen.findByRole("button", { name: "Resposta conclusiva" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(OMBUDSMAN_ERRORS.forwarding_pending)).not.toBeNull();
    cleanup();
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "answered" }));
    mount(manifestation({ kind: "praise" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resposta conclusiva" }));
    expect(screen.getByLabelText("Texto ao cidadão")).not.toBeNull();
    expect(screen.queryByLabelText("Resolvida?")).toBeNull();
    cleanup();
    mount(preserved({ identification_mode: "anonymous", state: "in_analysis" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resposta conclusiva" }));
    expect(screen.getByText(ANONYMOUS_INTERNAL)).not.toBeNull();
    expect(screen.getByLabelText("Conclusão interna")).not.toBeNull();
    expect(screen.queryByLabelText("Texto ao cidadão")).toBeNull();
    expect(screen.getByLabelText("Resolvida?")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Resposta intermediária" })).toBeNull();
  });

  it("conclusiva: texto e resolutividade conferidos juntos; o corpo leva resolution", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "answered", color: null }));
    mount(manifestation());
    fireEvent.click(await screen.findByRole("button", { name: "Resposta conclusiva" }));
    expectFrozenNotice(screen.getByLabelText("Texto ao cidadão"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta conclusiva" }));
    expect(await screen.findByText("o texto ao cidadão tem de ter de 10 a 4000 caracteres")).not.toBeNull();
    expect(screen.getByText(/informe se foi resolvida/)).not.toBeNull();
    expect(api.runOmbudsmanAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Texto ao cidadão"), { target: { value: "A farmácia recebeu o estoque em 10/11." } });
    fireEvent.change(screen.getByLabelText("Resolvida?"), { target: { value: "resolved" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta conclusiva" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "final_response", { expected_state: "in_analysis", text: "A farmácia recebeu o estoque em 10/11.", resolution: "resolved" } ]));
  });

  it("cancelar encaminhamento pendente: confirmação em dois passos e uma chamada", async () => {
    vi.mocked(api.cancelOmbudsmanForwarding).mockResolvedValue(manifestation());
    mount(manifestation({ state: "forwarded", pending_forwardings: 1, forwardings: [ forwarding() ] }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar encaminhamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.cancelOmbudsmanForwarding).toHaveBeenCalledWith("f1", "pending"));
    expect(api.cancelOmbudsmanForwarding).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancelar encaminhamento" })).toBeNull());
  });

  it("cancelar com 409 forwarding_changed: frase do encaminhamento e uma releitura", async () => {
    vi.mocked(api.getOmbudsmanManifestation)
      .mockResolvedValueOnce(manifestation({ state: "forwarded", pending_forwardings: 1, forwardings: [ forwarding() ] }))
      .mockResolvedValueOnce(manifestation({ forwardings: [ forwarding({ state: "replied", color: null, reply: "Estoque chega dia 12." }) ] }));
    vi.mocked(api.cancelOmbudsmanForwarding).mockRejectedValue(new ApiError(409, { error: "forwarding_changed" }, "x"));
    mount(manifestation());
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar encaminhamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.forwarding_changed)).not.toBeNull();
    await waitFor(() => expect(api.getOmbudsmanManifestation).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Estoque chega dia 12.")).not.toBeNull();
    expect(api.cancelOmbudsmanForwarding).toHaveBeenCalledTimes(1);
  });

  it("o cancelamento não aparece para encaminhamento que não está pendente", async () => {
    mount(manifestation({ forwardings: [ forwarding({ state: "replied", color: null, reply: "Estoque chega dia 12." }) ] }));
    expect(await screen.findByText("Estoque chega dia 12.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar encaminhamento" })).toBeNull();
  });

  it("pedido de complemento: uma vez por ciclo, nunca na anônima; registrar complemento recebido", async () => {
    mount(manifestation({ complement_used: true }));
    expect((await screen.findByRole("button", { name: "Pedir complemento" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(OMBUDSMAN_ERRORS.complement_already_used)).not.toBeNull();
    cleanup();
    mount(preserved({ identification_mode: "anonymous" }));
    await screen.findByRole("button", { name: "Classificar" });
    expect(screen.queryByRole("button", { name: "Pedir complemento" })).toBeNull();
    cleanup();
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation());
    mount(manifestation({ state: "awaiting_complement", color: "paused", complement_used: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar complemento recebido" }));
    expectFrozenNotice(screen.getByLabelText("Complemento recebido"));
    fireEvent.change(screen.getByLabelText("Complemento recebido"), { target: { value: "Por telefone: a falta foi nos dias 2, 4 e 9 de novembro." } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "complement", { expected_state: "awaiting_complement", text: "Por telefone: a falta foi nos dias 2, 4 e 9 de novembro." } ]));
  });

  it("pedir complemento: texto ao cidadão com aviso; a recusa do api nomeia o campo", async () => {
    vi.mocked(api.runOmbudsmanAction).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "text" }, "x"));
    mount(manifestation());
    fireEvent.click(await screen.findByRole("button", { name: "Pedir complemento" }));
    const field = screen.getByLabelText("Texto ao cidadão");
    expectFrozenNotice(field);
    fireEvent.change(field, { target: { value: "Informe os dias em que faltou o remédio." } });
    fireEvent.click(screen.getByRole("button", { name: "Pedir complemento ao cidadão" }));
    expect(await screen.findByText("o texto ao cidadão tem de ter de 10 a 4000 caracteres")).not.toBeNull();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "request_complement", { expected_state: "in_analysis", text: "Informe os dias em que faltou o remédio." } ]);
  });

  it("uma ação aberta por vez; quem não é da equipe não vê ações", async () => {
    mount(manifestation());
    fireEvent.click(await screen.findByRole("button", { name: "Encaminhar" }));
    expect(screen.getByLabelText("Extrato para o destino")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resposta intermediária" }));
    expect(screen.queryByLabelText("Extrato para o destino")).toBeNull();
    expect(screen.getByLabelText("Texto ao cidadão")).not.toBeNull();
    cleanup();
    vi.mocked(api.getOmbudsmanOptions).mockClear();
    mount(manifestation(), [ "ombudsman_responder" ]);
    await screen.findByRole("heading", { name: /2026-000123/ });
    expect(screen.queryByRole("button", { name: "Classificar" })).toBeNull();
    expect(api.getOmbudsmanOptions).not.toHaveBeenCalled();
  });
});
