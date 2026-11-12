import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { NOW33, can33, event, forwarding, manifestation, ombudsmanUser, preserved } from "../../test/ombudsmanFixtures";
import * as api from "../../lib/api";
import { ApiError, type OmbudsmanManifestation } from "../../lib/api";
import { ANONYMOUS_NO_IDENTITY, IDENTITY_PRESERVED, OMBUDSMAN_ERRORS, OMB_DETAIL_KEY, ombudsmanRoles } from "../../lib/ombudsman";
import { POPUP_BLOCKED } from "../documents/printDocument";
import { ManifestationView } from "./ManifestationView";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(),
  getOmbudsmanManifestation: vi.fn(), getOmbudsmanAttachmentUrl: vi.fn(), fetchOmbudsmanFile: vi.fn(),
  revealOmbudsmanIdentity: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

function mount(m: OmbudsmanManifestation, roles = [ "ombudsman_staff" ]) {
  const user = ombudsmanUser(roles);
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.getOmbudsmanManifestation).mockResolvedValue(m);
  return renderWithProviders(<ManifestationView id={m.id} roles={ombudsmanRoles(user)} now={NOW33} onBack={() => {}} />);
}
// O que o api manda a um técnico (sem os poderes do ouvidor).
const forStaff = (m: OmbudsmanManifestation): OmbudsmanManifestation => ({ ...m, can: can33(m, false) });
// Dado pessoal que o api poderia mandar por engano, no topo do detalhe e dentro de `identity`.
const LEAK = {
  name: "Joana Prado", full_name: "Joana Prado Lima", cpf: "529.982.247-25", phone: "(41) 99876-1234",
  manifestant_name: "Joana Prado", manifestant_cpf: "529.982.247-25", manifestant_contact: "joana@exemplo.com",
  manifestant_phone: "(41) 99876-1234"
};
const LEAKED = /Joana|529\.982|99876|joana@exemplo/;
function installWindow() {
  const win = { location: { href: "" }, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(win as never);
  URL.createObjectURL = vi.fn(() => "blob:1");
  URL.revokeObjectURL = vi.fn();
  return { win, open };
}

describe("detalhe da manifestação", () => {
  it("identificada: dados, identidade mascarada, texto e prazo", async () => {
    mount(manifestation({ urgent: true, referred_professional: { id: "p1", name: "Dr. Caio" } }));
    expect(await screen.findByRole("heading", { name: "Manifestação 2026-000123" })).not.toBeNull();
    expect(screen.getByText("Reclamação")).not.toBeNull();
    expect(screen.getByText("Identificada")).not.toBeNull();
    expect(screen.getByText("Maria Lima")).not.toBeNull();
    expect(screen.getByText("***.***.***-25")).not.toBeNull();
    expect(screen.getByText("(41) *****-1234")).not.toBeNull();
    expect(screen.getByText(/não havia losartana/)).not.toBeNull();
    expect(screen.getByText("Atendimento › Demora")).not.toBeNull();
    expect(screen.getByText("UBS Centro")).not.toBeNull();
    expect(screen.getByText("Dr. Caio")).not.toBeNull();
    expect(screen.getByText("no prazo · 03/12")).not.toBeNull();
    expect(screen.getByText("urgente")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ver identidade" })).toBeNull();
  });

  it("identificada: lê campo a campo — CPF e telefone inteiros nunca aparecem; contato digitado aparece sem máscara", async () => {
    mount({ ...manifestation({ identity: { name: "Maria Lima", cpf_masked: null, phone_masked: "(41) *****-1234",
      contact: "(41) 3333-4444", cpf: "529.982.247-25", phone: "(41) 99876-1234", full_name: "Joana Prado Lima" } as never }),
      manifestant_cpf: "529.982.247-25" } as never);
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
    expect(screen.getByText("(41) 3333-4444")).not.toBeNull();
    expect(screen.queryByText(LEAKED)).toBeNull();
  });

  it("identificada: CPF ou telefone sem máscara no campo mascarado não chegam à tela", async () => {
    mount(manifestation({ identity: { name: "Maria Lima", cpf_masked: "529.982.247-25", phone_masked: "(41) 99876-1234" } }));
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
    expect(screen.queryByText(LEAKED)).toBeNull();
  });

  it("preservada: o técnico vê a frase e nada mais, mesmo com dado vazado no detalhe", async () => {
    mount(forStaff({ ...preserved(), ...LEAK, identity: "preserved" } as never));
    expect(await screen.findByText(IDENTITY_PRESERVED)).not.toBeNull();
    expect(screen.queryByText(LEAKED)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver identidade" })).toBeNull();
  });

  it("preservada e anônima: identidade em objeto por engano também não aparece", async () => {
    mount(preserved({ ...LEAK, identity: { ...LEAK, cpf_masked: "***.***.***-25", phone_masked: "(41) *****-1234",
      contact: "joana@exemplo.com" } } as never), [ "ombudsman" ]);
    expect(await screen.findByText(IDENTITY_PRESERVED)).not.toBeNull();
    expect(screen.queryByText(LEAKED)).toBeNull();
    expect(screen.queryByText(/\*\*\*/)).toBeNull();
    cleanup();
    mount(preserved({ identification_mode: "anonymous", identity_available: false, ...LEAK,
      identity: { ...LEAK, cpf_masked: "***.***.***-25" } } as never), [ "ombudsman" ]);
    expect(await screen.findByText(ANONYMOUS_NO_IDENTITY)).not.toBeNull();
    expect(screen.queryByText(LEAKED)).toBeNull();
    expect(screen.queryByText(/\*\*\*/)).toBeNull();
  });

  it("preservada: o ouvidor vê o botão; anônima sem dados não oferece nada", async () => {
    mount(preserved(), [ "ombudsman" ]);
    expect(await screen.findByRole("button", { name: "Ver identidade" })).not.toBeNull();
    cleanup();
    mount(preserved({ identification_mode: "anonymous", identity_available: false }), [ "ombudsman" ]);
    expect(await screen.findByText(ANONYMOUS_NO_IDENTITY)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ver identidade" })).toBeNull();
  });

  it("o ouvidor abre a identidade em qualquer modo (Q50); o técnico nunca; o botão não chama /identity aqui", async () => {
    mount(manifestation(), [ "ombudsman" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Ver identidade" }));
    expect(api.revealOmbudsmanIdentity).not.toHaveBeenCalled();
    cleanup();
    // Mesmo se o `can` viesse aberto, o técnico não vê o botão.
    mount(preserved(), [ "ombudsman_staff" ]);
    expect(await screen.findByText(IDENTITY_PRESERVED)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ver identidade" })).toBeNull();
  });

  it("linha do tempo com quem fez, o que vai ao cidadão marcado, e código desconhecido cru", async () => {
    mount(manifestation({ events: [ event(), event({ id: "e3", kind: "interim_response", actor: "staff", actor_name: "Ana Souza",
      text: "Estamos verificando com a farmácia.", visible_to_citizen: true }),
    event({ id: "e4", kind: "brand_new_event", actor: "system", visible_to_citizen: false, data: { secret: "dado-interno" } }),
    event({ id: "e5", kind: "reopen_rejected", actor: "staff", actor_name: "Rita Prado", visible_to_citizen: false }) ] }));
    const item = (await screen.findByText("Estamos verificando com a farmácia.")).closest("li") as HTMLElement;
    expect(within(item).getByText("Resposta intermediária")).not.toBeNull();
    expect(within(item).getByText("Ana Souza")).not.toBeNull();
    expect(within(item).getByText("enviada ao cidadão")).not.toBeNull();
    const unknown = screen.getByText("brand_new_event").closest("li") as HTMLElement;
    expect(within(unknown).getByText("sistema")).not.toBeNull();
    expect(within(unknown).queryByText("enviada ao cidadão")).toBeNull();
    expect(screen.queryByText(/dado-interno/)).toBeNull();
    const received = screen.getByText("Manifestação recebida").closest("li") as HTMLElement;
    expect(within(received).getByText("cidadão")).not.toBeNull();
    const rejected = screen.getByText("Reabertura recusada").closest("li") as HTMLElement;
    expect(within(rejected).getByText("Rita Prado")).not.toBeNull();
  });

  it("encaminhamentos com destino, extrato, prazo e resposta; recusa com o motivo", async () => {
    mount(manifestation({ state: "forwarded", pending_forwardings: 1, forwardings: [ forwarding(),
      forwarding({ id: "f2", state: "replied", reply: "Reposição feita.", replied_by_name: "Bruno Melo",
        replied_at: "2026-11-07T10:00:00-03:00", color: null }),
      forwarding({ id: "f3", destination: { kind: "health_unit", id: "upa1", name: "UPA Boqueirão" }, state: "declined",
        reply: "Não é desta unidade.", color: null }) ] }));
    expect((await screen.findAllByText("Setor: Assistência Farmacêutica")).length).toBe(2);
    expect(screen.getAllByText(/falta de losartana/).length).toBe(3);
    expect(screen.getByText("Reposição feita.")).not.toBeNull();
    expect(screen.getByText(/Bruno Melo/)).not.toBeNull();
    expect(screen.getByText("aguardando resposta")).not.toBeNull();
    expect(screen.getByText("no prazo · 25/11")).not.toBeNull();
    const declined = screen.getByText("Unidade: UPA Boqueirão").closest("li") as HTMLElement;
    expect(within(declined).getByText("recusado pelo destino")).not.toBeNull();
    expect(within(declined).getByText("Motivo da recusa")).not.toBeNull();
    expect(within(declined).getByText("Não é desta unidade.")).not.toBeNull();
  });

  it("anexo da identificada abre sem justificativa; janela bloqueada não lê", async () => {
    const { win, open } = installWindow();
    vi.mocked(api.getOmbudsmanAttachmentUrl).mockResolvedValue("/ombudsman/files/tok1");
    vi.mocked(api.fetchOmbudsmanFile).mockResolvedValue({ blob: new Blob([ "x" ]), filename: null });
    mount(manifestation({ attachments: [ { id: "a1", uploaded_by: "citizen" }, { id: "a2", uploaded_by: "staff" } ] }));
    expect(await screen.findByText("Anexo 1")).not.toBeNull();
    expect(screen.getByText("enviado pelo cidadão")).not.toBeNull();
    expect(screen.getByText("enviado pela equipe")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir anexo 1" }));
    await waitFor(() => expect(win.location.href).toBe("blob:1"));
    expect(vi.mocked(api.getOmbudsmanAttachmentUrl).mock.calls[0]).toEqual([ "a1" ]);
    expect(vi.mocked(api.fetchOmbudsmanFile).mock.calls[0]).toEqual([ "/ombudsman/files/tok1" ]);
    open.mockReturnValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Abrir anexo 1" }));
    expect(await screen.findByText(POPUP_BLOCKED)).not.toBeNull();
    expect(api.getOmbudsmanAttachmentUrl).toHaveBeenCalledTimes(1);
  });

  it("endereço vencido (410 link_expired): a frase, e a janela fecha", async () => {
    const { win } = installWindow();
    vi.mocked(api.getOmbudsmanAttachmentUrl).mockResolvedValue("/ombudsman/files/tok1");
    vi.mocked(api.fetchOmbudsmanFile).mockRejectedValue(new ApiError(410, { error: "link_expired" }, "410"));
    mount(manifestation({ attachments: [ { id: "a1", uploaded_by: "citizen" } ] }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir anexo 1" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.link_expired)).not.toBeNull();
    expect(win.close).toHaveBeenCalled();
  });

  it("anexo da preservada: o ouvidor justifica (sem ler aqui); o técnico vê que é protegido; nunca o nome do arquivo", async () => {
    installWindow();
    const att = { id: "a1", uploaded_by: "citizen", filename: "rg-joana-prado.pdf", content_type: "application/pdf" } as never;
    mount(preserved({ attachments: [ att ] }), [ "ombudsman" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir anexo 1 (justificar)" }));
    expect(api.getOmbudsmanAttachmentUrl).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(screen.queryByText(/rg-joana|\.pdf|PDF/)).toBeNull();
    cleanup();
    mount(forStaff(preserved({ attachments: [ att ] })));
    expect(await screen.findByText("anexo protegido — só o ouvidor abre")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Abrir anexo/ })).toBeNull();
    expect(screen.queryByText(/rg-joana|\.pdf|PDF/)).toBeNull();
  });

  it("dados de arquivamento, OuvidorSUS, resolutividade e complemento", async () => {
    mount(manifestation({ channel: "ouvidorsus", ouvidorsus_number: "OS-778899", state: "archived", color: null,
      archive_reason: "duplicate", duplicate_of: { id: "m0", protocol: "2026-000100" }, concluded_at: "2026-11-06T10:00:00-03:00" }));
    expect(await screen.findByText("OuvidorSUS nº OS-778899")).not.toBeNull();
    expect(screen.getByText("Duplicidade — original 2026-000100")).not.toBeNull();
    cleanup();
    mount(manifestation({ state: "archived", color: null, archive_reason: "forwarded_elsewhere", external_body_name: "Ministério Público" }));
    expect(await screen.findByText("Encaminhada a outro órgão — Ministério Público")).not.toBeNull();
    cleanup();
    mount(manifestation({ state: "answered", color: null, resolution: "not_resolved", cycle: 2, extended: true,
      extension_reason: "Aguardando a farmácia central." }));
    expect(await screen.findByText("não resolvida")).not.toBeNull();
    expect(screen.getByText("Aguardando a farmácia central.")).not.toBeNull();
    cleanup();
    mount(manifestation({ state: "awaiting_complement", color: "paused", complement_due_on: "2026-11-30" }));
    expect(await screen.findByText("complemento até 30/11/2026")).not.toBeNull();
  });

  it("pedido de reabertura pendente: motivo e estado, sem decisão", async () => {
    mount(manifestation({ state: "answered", color: null, reopen_request: { id: "r1", cycle: 1, state: "pending",
      reason: "O remédio continua em falta.", created_at: "2026-11-10T09:00:00-03:00" } }), [ "ombudsman" ]);
    const panel = await screen.findByRole("region", { name: "Pedido de reabertura" });
    expect(within(panel).getByText("O remédio continua em falta.")).not.toBeNull();
    expect(within(panel).getByText("pendente")).not.toBeNull();
  });

  it("erro na leitura mostra a frase", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(ombudsmanUser([ "ombudsman_staff" ]));
    vi.mocked(api.getOmbudsmanManifestation).mockRejectedValue(new ApiError(404, { error: "not_found" }, "404"));
    renderWithProviders(<ManifestationView id="m9" roles={ombudsmanRoles(ombudsmanUser([ "ombudsman_staff" ]))} now={NOW33} onBack={() => {}} />);
    expect(await screen.findByText(OMBUDSMAN_ERRORS.not_found)).not.toBeNull();
  });

  it("o detalhe sai do cache ao sair (leitura nominal, gcTime 0)", async () => {
    const { client, unmount } = mount(manifestation());
    await screen.findByText(/não havia losartana/);
    expect(client.getQueryCache().findAll({ queryKey: [ OMB_DETAIL_KEY ] }).length).toBe(1);
    unmount();
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: [ OMB_DETAIL_KEY ] }).length).toBe(0));
  });
});
