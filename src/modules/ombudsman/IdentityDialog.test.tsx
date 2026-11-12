// Identidade com justificativa e anexo protegido (módulo 33; F-33.7; Q50, Q24, Q2, Q14, U4). A identidade vive só no estado do
// diálogo: nunca no cache do TanStack Query, nunca em storage, nunca no console; sai do DOM ao fechar; reabrir pede outra
// justificativa e faz outra chamada; clique duplo envia uma vez; o técnico nunca vê o botão. Sem step-up (U4).
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";
import { NOW33, can33, fullIdentity, manifestation, ombudsmanUser, options, preserved } from "../../test/ombudsmanFixtures";
import * as api from "../../lib/api";
import { ApiError, type OmbudsmanAttachment, type OmbudsmanFullIdentity, type OmbudsmanManifestation } from "../../lib/api";
import { OMBUDSMAN_ERRORS, OMBUDSMAN_NO_ROLE, ombudsmanRoles } from "../../lib/ombudsman";
import { ManifestationView } from "./ManifestationView";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(),
  getOmbudsmanManifestation: vi.fn(), revealOmbudsmanIdentity: vi.fn(), getOmbudsmanAttachmentUrl: vi.fn(),
  fetchOmbudsmanFile: vi.fn(), getOmbudsmanOptions: vi.fn() }));
// O jsdom não tem `URL.createObjectURL`/`revokeObjectURL`: o teste os põe e devolve o original ao fim.
const ORIGINAL_URL = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
afterEach(() => {
  cleanup(); vi.resetAllMocks(); vi.restoreAllMocks();
  URL.createObjectURL = ORIGINAL_URL.create;
  URL.revokeObjectURL = ORIGINAL_URL.revoke;
});

function mountView(m: OmbudsmanManifestation, roles: string[]) {
  const user = ombudsmanUser(roles);
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.getOmbudsmanManifestation).mockResolvedValue(m);
  vi.mocked(api.getOmbudsmanOptions).mockResolvedValue(options());
  return renderWithProviders(<ManifestationView id={m.id} roles={ombudsmanRoles(user)} now={NOW33} onBack={() => {}} />);
}
const FIELD = "Justificativa (fica registrada)";
// Abre o diálogo pelo botão do bloco de identidade, escreve e clica em "Ver identidade" do diálogo.
async function reveal(text: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Ver identidade" }));
  const dialog = screen.getByRole("dialog", { name: "Ver identidade" });
  fireEvent.change(within(dialog).getByLabelText(FIELD), { target: { value: text } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Ver identidade" }));
  return dialog;
}
const goButton = (dialog: HTMLElement, name = "Ver identidade") => within(dialog).getByRole("button", { name }) as HTMLButtonElement;
const LEAKED = /Joana|529\.982|99876/;
const CONSOLE = [ "log", "info", "warn", "error", "debug" ] as const;
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("identidade com justificativa", () => {
  it("preservada: o ouvidor vê com justificativa; fechar apaga; reabrir pede de novo; nada no cache", async () => {
    const spies = CONSOLE.map((k) => vi.spyOn(console, k));
    vi.mocked(api.revealOmbudsmanIdentity).mockResolvedValue(fullIdentity());
    const { client } = mountView(preserved(), [ "ombudsman" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Ver identidade" }));
    const dialog = screen.getByRole("dialog", { name: "Ver identidade" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const field = within(dialog).getByLabelText(FIELD);
    expectFrozenNotice(field);
    const go = goButton(dialog);
    fireEvent.change(field, { target: { value: "curta" } });
    expect(go.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "conferir se é o mesmo autor da denúncia 2026-000101" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go); fireEvent.click(go);
    expect(await within(dialog).findByText("Joana Prado")).not.toBeNull();
    expect(within(dialog).getByText("Joana Prado Lima")).not.toBeNull();
    expect(within(dialog).getByText("529.982.247-25")).not.toBeNull();
    expect(within(dialog).getByText("(41) 99876-1234")).not.toBeNull();
    expect(within(dialog).getByText("Este acesso foi registrado com a sua justificativa.")).not.toBeNull();
    // Depois de ver, o foco vai para "Fechar" (o anel de foco do tema continua valendo: nada de outline zerado).
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Fechar"));
    expect(api.revealOmbudsmanIdentity).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.revealOmbudsmanIdentity).mock.calls[0]).toEqual([ "m2", "conferir se é o mesmo autor da denúncia 2026-000101" ]);
    // Nada no cache (consultas e mutações), nada em storage, nada no console.
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => [ q.queryKey, q.state.data ]))).not.toMatch(LEAKED);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toMatch(LEAKED);
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(LEAKED)).toBeNull();
    expect(document.body.innerHTML).not.toMatch(LEAKED);
    // Reabrir: campo vazio, nada à vista, outra chamada com a justificativa nova.
    fireEvent.click(screen.getByRole("button", { name: "Ver identidade" }));
    const again = screen.getByRole("dialog", { name: "Ver identidade" });
    const field2 = within(again).getByLabelText(FIELD) as HTMLTextAreaElement;
    expect(field2.value).toBe("");
    expect(within(again).queryByText(LEAKED)).toBeNull();
    fireEvent.change(field2, { target: { value: "segunda conferência pedida pela promotoria" } });
    fireEvent.click(goButton(again));
    expect(await within(again).findByText("Joana Prado")).not.toBeNull();
    expect(api.revealOmbudsmanIdentity).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.revealOmbudsmanIdentity).mock.calls[1]).toEqual([ "m2", "segunda conferência pedida pela promotoria" ]);
  });

  it("justificativa em code points, de 10 a 500, depois do strip", async () => {
    mountView(preserved(), [ "ombudsman" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Ver identidade" }));
    const dialog = screen.getByRole("dialog", { name: "Ver identidade" });
    const field = within(dialog).getByLabelText(FIELD);
    const go = goButton(dialog);
    expect(go.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "   123456789   " } });
    expect(go.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "😀".repeat(9) } });
    expect(go.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "😀".repeat(10) } });
    expect(go.disabled).toBe(false);
    fireEvent.change(field, { target: { value: "a".repeat(500) } });
    expect(go.disabled).toBe(false);
    fireEvent.change(field, { target: { value: "a".repeat(501) } });
    expect(go.disabled).toBe(true);
    expect(within(dialog).getByText(OMBUDSMAN_ERRORS.justification_range)).not.toBeNull();
    fireEvent.submit(go.closest("form")!);
    expect(api.revealOmbudsmanIdentity).not.toHaveBeenCalled();
  });

  it("registro sem cidadão: mostra os manifestant_* e os vazios como 'não informado', inclusive o nome civil", async () => {
    vi.mocked(api.revealOmbudsmanIdentity).mockResolvedValue(fullIdentity({ name: null, full_name: null, cpf: null, phone: null,
      manifestant_name: "José Alves", manifestant_contact: "(41) 3333-0000" }));
    mountView(preserved({ channel: "phone" }), [ "ombudsman" ]);
    const dialog = await reveal("ligou para confirmar a denúncia por telefone");
    expect(await within(dialog).findByText("José Alves")).not.toBeNull();
    expect(within(dialog).getByText("(41) 3333-0000")).not.toBeNull();
    expect(within(dialog).getAllByText("não informado").length).toBeGreaterThan(0);
    // O par "Nome civil" está lá, com "não informado" (overrides T8).
    const civil = within(dialog).getByText("Nome civil").parentElement!;
    expect(within(civil).getByText("não informado")).not.toBeNull();
  });

  it("identificada: o ouvidor também abre (Q50) e vê CPF e telefone sem máscara só no diálogo", async () => {
    vi.mocked(api.revealOmbudsmanIdentity).mockResolvedValue(fullIdentity({ name: "Maria Lima", full_name: "Maria Lima Souza",
      cpf: "529.982.247-25", phone: "(41) 99876-1234" }));
    mountView(manifestation(), [ "ombudsman" ]);
    const dialog = await reveal("conferir o telefone para a resposta por carta");
    expect(await within(dialog).findByText("529.982.247-25")).not.toBeNull();
    expect(within(dialog).getByText("Nome civil")).not.toBeNull();
    expect(within(dialog).getByText("Maria Lima Souza")).not.toBeNull();
    expect(vi.mocked(api.revealOmbudsmanIdentity).mock.calls[0][0]).toBe("m1");
    // O bloco do detalhe continua mascarado.
    expect(screen.getByText("***.982.247-**")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText("529.982.247-25")).toBeNull();
    expect(screen.queryByText("Maria Lima Souza")).toBeNull();
  });

  it("403 do api: a frase, sem identidade; Escape fecha e devolve o foco", async () => {
    vi.mocked(api.revealOmbudsmanIdentity).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    mountView(preserved(), [ "ombudsman" ]);
    await reveal("conferir se é o mesmo autor da denúncia");
    expect(await screen.findByText(OMBUDSMAN_NO_ROLE)).not.toBeNull();
    expect(screen.queryByText(LEAKED)).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Ver identidade"));
  });

  it("422 no_identity: a frase, sem identidade nem nota de acesso", async () => {
    vi.mocked(api.revealOmbudsmanIdentity).mockRejectedValue(new ApiError(422, { error: "no_identity" }, "x"));
    mountView(preserved({ identification_mode: "anonymous" }), [ "ombudsman" ]);
    const dialog = await reveal("conferir se há dado de quem denunciou");
    expect(await within(dialog).findByText(OMBUDSMAN_ERRORS.no_identity)).not.toBeNull();
    expect(within(dialog).queryByText("Este acesso foi registrado com a sua justificativa.")).toBeNull();
  });

  it("fechar com a chamada em voo: a resposta que chega depois não aparece em lugar nenhum", async () => {
    const late = deferred<OmbudsmanFullIdentity>();
    vi.mocked(api.revealOmbudsmanIdentity).mockReturnValue(late.promise);
    const { client } = mountView(preserved(), [ "ombudsman" ]);
    await reveal("conferir se é o mesmo autor da denúncia");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await act(async () => { late.resolve(fullIdentity()); await late.promise; });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(LEAKED);
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toMatch(LEAKED);
    fireEvent.click(screen.getByRole("button", { name: "Ver identidade" }));
    expect(within(screen.getByRole("dialog")).queryByText(LEAKED)).toBeNull();
  });

  it("no StrictMode (como no main.tsx) a identidade aparece: o diálogo remontado volta a valer", async () => {
    vi.mocked(api.revealOmbudsmanIdentity).mockResolvedValue(fullIdentity());
    const user = ombudsmanUser([ "ombudsman" ]);
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
    vi.mocked(api.getOmbudsmanManifestation).mockResolvedValue(preserved());
    vi.mocked(api.getOmbudsmanOptions).mockResolvedValue(options());
    renderWithProviders(<StrictMode><ManifestationView id="m2" roles={ombudsmanRoles(user)} now={NOW33} onBack={() => {}} /></StrictMode>);
    const dialog = await reveal("conferir se é o mesmo autor da denúncia");
    expect(await within(dialog).findByText("Joana Prado")).not.toBeNull();
    expect(api.revealOmbudsmanIdentity).toHaveBeenCalledTimes(1);
  });

  it("o técnico nunca vê o botão, mesmo com o can aberto", async () => {
    mountView(preserved(), [ "ombudsman_staff" ]);
    expect(await screen.findByRole("heading", { name: "Manifestação 2026-000124" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ver identidade" })).toBeNull();
    cleanup();
    const m = preserved();
    mountView({ ...m, can: can33(m, false) }, [ "ombudsman_staff" ]);
    expect(await screen.findByRole("heading", { name: "Manifestação 2026-000124" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ver identidade" })).toBeNull();
    expect(api.revealOmbudsmanIdentity).not.toHaveBeenCalled();
  });
});

describe("anexo protegido com justificativa", () => {
  const att: OmbudsmanAttachment = { id: "a9", uploaded_by: "citizen" };
  function installWindow() {
    const win = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(win as never);
    URL.createObjectURL = vi.fn(() => "blob:9");
    URL.revokeObjectURL = vi.fn();
    return win;
  }

  it("anexo protegido: só o ouvidor, com justificativa no corpo do link; o diálogo fecha", async () => {
    const win = installWindow();
    vi.mocked(api.getOmbudsmanAttachmentUrl).mockResolvedValue("/ombudsman/files/tok9");
    vi.mocked(api.fetchOmbudsmanFile).mockResolvedValue({ blob: new Blob([ "x" ]), filename: null });
    mountView(preserved({ attachments: [ att ] }), [ "ombudsman" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir anexo 1 (justificar)" }));
    const dialog = screen.getByRole("dialog", { name: "Abrir anexo protegido" });
    const field = within(dialog).getByLabelText(FIELD);
    expectFrozenNotice(field);
    const go = goButton(dialog, "Abrir anexo");
    expect(go.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "ver a foto da sala citada na denúncia" } });
    fireEvent.click(go); fireEvent.click(go);
    await waitFor(() => expect(vi.mocked(api.getOmbudsmanAttachmentUrl).mock.calls[0]).toEqual([ "a9", "ver a foto da sala citada na denúncia" ]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(win.location.href).toBe("blob:9");
    expect(api.getOmbudsmanAttachmentUrl).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(api.revealOmbudsmanIdentity).not.toHaveBeenCalled();
    cleanup();
    mountView(preserved({ attachments: [ att ] }), [ "ombudsman_staff" ]);
    expect(await screen.findByText("anexo protegido — só o ouvidor abre")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Abrir anexo/ })).toBeNull();
  });

  it("fechar com o link em voo: o arquivo não abre quando a resposta chega; a janela fecha", async () => {
    const win = installWindow();
    const link = deferred<string>();
    vi.mocked(api.getOmbudsmanAttachmentUrl).mockReturnValue(link.promise);
    vi.mocked(api.fetchOmbudsmanFile).mockResolvedValue({ blob: new Blob([ "x" ]), filename: null });
    mountView(preserved({ attachments: [ att ] }), [ "ombudsman" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir anexo 1 (justificar)" }));
    const dialog = screen.getByRole("dialog", { name: "Abrir anexo protegido" });
    fireEvent.change(within(dialog).getByLabelText(FIELD), { target: { value: "ver a foto da sala citada na denúncia" } });
    fireEvent.click(goButton(dialog, "Abrir anexo"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { link.resolve("/ombudsman/files/tok9"); await link.promise; });
    await waitFor(() => expect(win.close).toHaveBeenCalled());
    expect(win.location.href).toBe("");
    expect(api.fetchOmbudsmanFile).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    // Reabrir depois não é fechado por uma resposta velha.
    fireEvent.click(screen.getByRole("button", { name: "Abrir anexo 1 (justificar)" }));
    expect(screen.getByRole("dialog", { name: "Abrir anexo protegido" })).not.toBeNull();
  });

  it("recusa do link: a frase no diálogo, que fica aberto; a janela fecha", async () => {
    const win = installWindow();
    vi.mocked(api.getOmbudsmanAttachmentUrl).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    mountView(preserved({ attachments: [ att ] }), [ "ombudsman" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir anexo 1 (justificar)" }));
    const dialog = screen.getByRole("dialog", { name: "Abrir anexo protegido" });
    fireEvent.change(within(dialog).getByLabelText(FIELD), { target: { value: "ver a foto da sala citada na denúncia" } });
    fireEvent.click(goButton(dialog, "Abrir anexo"));
    expect(await within(dialog).findByText(OMBUDSMAN_NO_ROLE)).not.toBeNull();
    expect(win.close).toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Abrir anexo protegido" })).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Abrir anexo 1 (justificar)"));
  });
});
