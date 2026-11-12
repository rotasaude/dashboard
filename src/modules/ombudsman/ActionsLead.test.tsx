// Ações do ouvidor (módulo 33; F-33.6, F-33.7): prorrogar, arquivar, reabrir, resolutividade, decisão do pedido de reabertura
// do cidadão e consentimento. Nomes de campo e códigos do api (overrides T7): `text`, `duplicate_of_protocol`, 409 `already_decided`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";
import { NOW33, manifestation, ombudsmanUser, options, preserved } from "../../test/ombudsmanFixtures";
import * as api from "../../lib/api";
import { ApiError, type OmbudsmanManifestation } from "../../lib/api";
import { MANIFESTATION_CHANGED, OMBUDSMAN_ERRORS, ombudsmanRoles } from "../../lib/ombudsman";
import { ManifestationView } from "./ManifestationView";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getOmbudsmanManifestation: vi.fn(),
  runOmbudsmanAction: vi.fn(), getOmbudsmanOptions: vi.fn(), decideReopenRequest: vi.fn(), recordIdentityConsent: vi.fn(),
  listOmbudsmanManifestations: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function mount(m: OmbudsmanManifestation, roles = [ "ombudsman_staff" ]) {
  const user = ombudsmanUser(roles);
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.getOmbudsmanOptions).mockResolvedValue(options());
  vi.mocked(api.getOmbudsmanManifestation).mockResolvedValue(m);
  return renderWithProviders(<ManifestationView id={m.id} roles={ombudsmanRoles(user)} now={NOW33} onBack={() => {}} />);
}
const LEAD = [ "ombudsman" ];
const TEXT = "A reposição foi confirmada pela farmácia em 10/11.";

describe("ações do ouvidor", () => {
  it("prorrogar: justificativa 10–4000 vai ao cidadão; uma vez por ciclo", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ extended: true }));
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Prorrogar prazo" }));
    const field = screen.getByLabelText("Justificativa (vai ao cidadão)");
    expectFrozenNotice(field);
    fireEvent.change(field, { target: { value: "curta" } });
    fireEvent.click(screen.getByRole("button", { name: "Prorrogar" }));
    expect(api.runOmbudsmanAction).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "Aguardamos o inventário da farmácia central." } });
    fireEvent.click(screen.getByRole("button", { name: "Prorrogar" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "extend", { expected_state: "in_analysis", text: "Aguardamos o inventário da farmácia central." } ]));
    cleanup();
    mount(manifestation({ extended: true }), LEAD);
    expect((await screen.findByRole("button", { name: "Prorrogar prazo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("prorrogar: 422 already_extended mostra a frase no formulário", async () => {
    vi.mocked(api.runOmbudsmanAction).mockRejectedValueOnce(new ApiError(422, { error: "already_extended" }, "x"));
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Prorrogar prazo" }));
    fireEvent.change(screen.getByLabelText("Justificativa (vai ao cidadão)"), { target: { value: "Aguardamos o inventário da farmácia central." } });
    fireEvent.click(screen.getByRole("button", { name: "Prorrogar" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.already_extended)).not.toBeNull();
  });

  it("ação do ouvidor com 409 manifestation_changed: frase, uma releitura, nenhum reenvio", async () => {
    vi.mocked(api.runOmbudsmanAction).mockRejectedValue(new ApiError(409, { error: "manifestation_changed" }, "x"));
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Prorrogar prazo" }));
    fireEvent.change(screen.getByLabelText("Justificativa (vai ao cidadão)"), { target: { value: "Aguardamos o inventário da farmácia central." } });
    fireEvent.click(screen.getByRole("button", { name: "Prorrogar" }));
    expect(await screen.findByText(MANIFESTATION_CHANGED)).not.toBeNull();
    await waitFor(() => expect(api.getOmbudsmanManifestation).toHaveBeenCalledTimes(2));
    expect(api.runOmbudsmanAction).toHaveBeenCalledTimes(1);
  });

  it("clique duplo em Confirmar envia o arquivamento uma vez só", async () => {
    vi.mocked(api.runOmbudsmanAction).mockImplementation(() => new Promise(() => {}));
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "improper" } });
    fireEvent.click(screen.getByRole("button", { name: "Arquivar agora" }));
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.runOmbudsmanAction).toHaveBeenCalledTimes(1));
  });

  it("a frase do aviso some na próxima ação que dá certo", async () => {
    vi.mocked(api.decideReopenRequest).mockRejectedValueOnce(new ApiError(409, { error: "already_decided" }, "x"));
    mount(answered(), LEAD);
    fireEvent.click(await screen.findByLabelText("Recusar"));
    fireEvent.change(screen.getByLabelText("Texto ao cidadão"), { target: { value: TEXT } });
    fireEvent.click(screen.getByRole("button", { name: "Decidir pedido" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.already_decided)).not.toBeNull();
    vi.mocked(api.decideReopenRequest).mockResolvedValue(manifestation({ state: "in_analysis", cycle: 2 }));
    fireEvent.click(await screen.findByLabelText("Aceitar"));
    fireEvent.change(screen.getByLabelText("Texto interno (não vai ao cidadão)"), { target: { value: TEXT } });
    fireEvent.click(screen.getByRole("button", { name: "Decidir pedido" }));
    await waitFor(() => expect(screen.queryByText(OMBUDSMAN_ERRORS.already_decided)).toBeNull());
  });

  it("o técnico não vê as ações do ouvidor", async () => {
    mount(manifestation({ state: "answered", color: null, concluded_at: "2026-11-10T10:00:00-03:00" }));
    await screen.findByRole("heading", { name: /2026-000123/ });
    for (const name of [ "Reabrir", "Alterar resolutividade", "Arquivar", "Prorrogar prazo", "Registrar consentimento do cidadão" ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("arquivar: motivo da lista sem no_complement; duplicidade manda o protocolo do original; confirmação em dois passos", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "archived", color: null }));
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    const reason = screen.getByLabelText("Motivo");
    expect(Array.from(reason.querySelectorAll("option")).map((o) => o.getAttribute("value"))).not.toContain("no_complement");
    fireEvent.change(reason, { target: { value: "duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: "Arquivar agora" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("informe o protocolo da manifestação original, como 2026-000100")).not.toBeNull();
    expect(api.runOmbudsmanAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Protocolo da manifestação original"), { target: { value: "2026-000100" } });
    fireEvent.click(screen.getByRole("button", { name: "Arquivar agora" }));
    expect(screen.getByText("Arquivar? O cidadão recebe o aviso com o motivo.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "archive", { expected_state: "in_analysis", reason: "duplicate", duplicate_of_protocol: "2026-000100" } ]));
    expect(api.listOmbudsmanManifestations).not.toHaveBeenCalled();
  });

  it("arquivar em outro órgão pede o nome", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "archived", color: null }));
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "forwarded_elsewhere" } });
    fireEvent.click(screen.getByRole("button", { name: "Arquivar agora" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("informe o órgão para onde foi encaminhada (até 120 caracteres)")).not.toBeNull();
    expectFrozenNotice(screen.getByLabelText("Órgão"));
    fireEvent.change(screen.getByLabelText("Órgão"), { target: { value: "Secretaria Estadual de Saúde" } });
    fireEvent.click(screen.getByRole("button", { name: "Arquivar agora" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0][2])
      .toEqual({ expected_state: "in_analysis", reason: "forwarded_elsewhere", external_body_name: "Secretaria Estadual de Saúde" }));
  });

  it("arquivar: protocolo longo demais é recusado na tela, sem cortar o que foi digitado", async () => {
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "duplicate" } });
    const long = "2026-" + "1".repeat(13);
    const input = screen.getByLabelText("Protocolo da manifestação original") as HTMLInputElement;
    fireEvent.change(input, { target: { value: long } });
    fireEvent.click(screen.getByRole("button", { name: "Arquivar agora" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("informe o protocolo da manifestação original, como 2026-000100")).not.toBeNull();
    expect(api.runOmbudsmanAction).not.toHaveBeenCalled();
    expect(input.value).toBe(long);
    expect(input.hasAttribute("maxlength")).toBe(false);
  });

  it("arquivar: órgão com 121 caracteres é recusado na tela, sem cortar o que foi digitado", async () => {
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "forwarded_elsewhere" } });
    const long = "ó".repeat(121);
    const input = screen.getByLabelText("Órgão") as HTMLInputElement;
    fireEvent.change(input, { target: { value: long } });
    fireEvent.click(screen.getByRole("button", { name: "Arquivar agora" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("informe o órgão para onde foi encaminhada (até 120 caracteres)")).not.toBeNull();
    expect(api.runOmbudsmanAction).not.toHaveBeenCalled();
    expect(input.value).toBe(long);
    expect(input.hasAttribute("maxlength")).toBe(false);
  });

  it("arquivar: a recusa do api de duplicate_of_id cai no campo do protocolo", async () => {
    vi.mocked(api.runOmbudsmanAction).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "duplicate_of_id" }, "x"));
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "duplicate" } });
    fireEvent.change(screen.getByLabelText("Protocolo da manifestação original"), { target: { value: "2026-000123" } });
    fireEvent.click(screen.getByRole("button", { name: "Arquivar agora" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("protocolo da manifestação original não encontrado")).not.toBeNull();
    expect(screen.getByLabelText("Protocolo da manifestação original").getAttribute("aria-invalid")).toBe("true");
  });

  it("reabrir de ofício: a justificativa é opcional, mas se vier tem 10–4000, e vai como text", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "in_analysis", cycle: 2 }));
    mount(manifestation({ state: "answered", color: null, resolution: "resolved" }), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Reabrir" }));
    const field = screen.getByLabelText("Justificativa (opcional)");
    expectFrozenNotice(field);
    fireEvent.change(field, { target: { value: "curta" } });
    fireEvent.click(screen.getByRole("button", { name: "Reabrir agora" }));
    expect(api.runOmbudsmanAction).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "A falta voltou na semana seguinte." } });
    fireEvent.click(screen.getByRole("button", { name: "Reabrir agora" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "reopen", { expected_state: "answered", text: "A falta voltou na semana seguinte." } ]));
  });

  it("reabrir sem justificativa não manda text", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "in_analysis", cycle: 2 }));
    mount(manifestation({ state: "archived", color: null }), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Reabrir" }));
    fireEvent.click(screen.getByRole("button", { name: "Reabrir agora" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0]).toEqual([ "m1", "reopen", { expected_state: "archived" } ]));
  });

  it("mudar resolutividade com justificativa", async () => {
    vi.mocked(api.runOmbudsmanAction).mockResolvedValue(manifestation({ state: "answered", color: null, resolution: "not_resolved" }));
    mount(manifestation({ state: "answered", color: null, resolution: "resolved" }), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Alterar resolutividade" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar resolutividade" }));
    expect(api.runOmbudsmanAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("não resolvida"));
    expectFrozenNotice(screen.getByLabelText("Justificativa"));
    expect(screen.getByText("Alterar resolutividade", { selector: "p" })).not.toBeNull();
    expect(screen.getByText("Resolutividade atual: resolvida")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Justificativa"), { target: { value: "A falta voltou na semana seguinte." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar resolutividade" }));
    await waitFor(() => expect(vi.mocked(api.runOmbudsmanAction).mock.calls[0])
      .toEqual([ "m1", "change_resolution", { expected_state: "answered", resolution: "not_resolved", text: "A falta voltou na semana seguinte." } ]));
  });

  const pendingRequest = { id: "r1", cycle: 1, reason: "A falta continua.", state: "pending", created_at: "2026-11-10T08:00:00-03:00" } as const;
  const answered = (o: Partial<OmbudsmanManifestation> = {}) => manifestation({ state: "answered", color: null, reopen_request: pendingRequest, ...o });

  it("pedido de reabertura: o rótulo do texto muda com a escolha; aceitar manda o texto interno", async () => {
    vi.mocked(api.decideReopenRequest).mockResolvedValue(manifestation({ state: "in_analysis", cycle: 2 }));
    mount(answered(), LEAD);
    expect(await screen.findByText("A falta continua.")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Recusar"));
    expect(screen.getByLabelText("Texto ao cidadão")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Aceitar"));
    expect(screen.queryByLabelText("Texto ao cidadão")).toBeNull();
    const field = screen.getByLabelText("Texto interno (não vai ao cidadão)");
    expectFrozenNotice(field);
    fireEvent.click(screen.getByRole("button", { name: "Decidir pedido" }));
    expect(api.decideReopenRequest).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "Pedido procede, reaberto para nova análise." } });
    fireEvent.click(screen.getByRole("button", { name: "Decidir pedido" }));
    await waitFor(() => expect(api.decideReopenRequest).toHaveBeenCalledWith("r1", { decision: "accept", text: "Pedido procede, reaberto para nova análise." }));
  });

  it("pedido de reabertura recusado: texto ao cidadão; já decidido (409 already_decided) mostra a frase e relê", async () => {
    vi.mocked(api.decideReopenRequest).mockRejectedValueOnce(new ApiError(409, { error: "already_decided" }, "x"));
    mount(answered(), LEAD);
    fireEvent.click(await screen.findByLabelText("Recusar"));
    fireEvent.change(screen.getByLabelText("Texto ao cidadão"), { target: { value: TEXT } });
    fireEvent.click(screen.getByRole("button", { name: "Decidir pedido" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.already_decided)).not.toBeNull();
    expect(api.decideReopenRequest).toHaveBeenCalledWith("r1", { decision: "reject", text: TEXT });
    await waitFor(() => expect(api.getOmbudsmanManifestation).toHaveBeenCalledTimes(2));
  });

  it("pedido de reabertura: tela velha (invalid_transition) mostra a frase da tela velha e relê uma vez", async () => {
    vi.mocked(api.decideReopenRequest).mockRejectedValueOnce(new ApiError(422, { error: "invalid_transition" }, "x"));
    mount(answered(), LEAD);
    fireEvent.click(await screen.findByLabelText("Aceitar"));
    fireEvent.change(screen.getByLabelText("Texto interno (não vai ao cidadão)"), { target: { value: TEXT } });
    fireEvent.click(screen.getByRole("button", { name: "Decidir pedido" }));
    expect(await screen.findByText(MANIFESTATION_CHANGED)).not.toBeNull();
    await waitFor(() => expect(api.getOmbudsmanManifestation).toHaveBeenCalledTimes(2));
  });

  it("o técnico não decide o pedido de reabertura", async () => {
    mount(answered({ can: { ...answered().can, decide_reopen: false } }));
    expect(await screen.findByText("A falta continua.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Decidir pedido" })).toBeNull();
  });

  it("consentimento para revelar fora da ouvidoria: registra sem mostrar nada", async () => {
    vi.mocked(api.recordIdentityConsent).mockResolvedValue(preserved());
    mount(preserved(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar consentimento do cidadão" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(api.recordIdentityConsent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("O cidadão consentiu"));
    const field = screen.getByLabelText("Como o consentimento foi dado");
    expectFrozenNotice(field);
    fireEvent.change(field, { target: { value: "Por telefone, em 11/11, ao ouvidor." } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(api.recordIdentityConsent).toHaveBeenCalledWith("m2", { granted: true, text: "Por telefone, em 11/11, ao ouvidor." }));
    expect(screen.queryByText(/Joana/)).toBeNull();
  });

  it("consentimento: aparece em qualquer modo com alguém a identificar (can), e a anônima sem dado recebe no_identity", async () => {
    vi.mocked(api.recordIdentityConsent).mockRejectedValueOnce(new ApiError(422, { error: "no_identity" }, "x"));
    mount(manifestation(), LEAD);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar consentimento do cidadão" }));
    fireEvent.click(screen.getByLabelText("O cidadão não consentiu"));
    fireEvent.change(screen.getByLabelText("Como o consentimento foi dado"), { target: { value: "Recusou ao telefone, em 11/11." } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.no_identity)).not.toBeNull();
    expect(api.recordIdentityConsent).toHaveBeenCalledWith("m1", { granted: false, text: "Recusou ao telefone, em 11/11." });
  });

  it("sem identidade a registrar (can falso) o botão de consentimento não aparece", async () => {
    const m = preserved();
    mount({ ...m, can: { ...m.can, record_identity_consent: false } }, LEAD);
    await screen.findByRole("heading", { name: /2026-000124/ });
    expect(screen.queryByRole("button", { name: "Registrar consentimento do cidadão" })).toBeNull();
  });
});
