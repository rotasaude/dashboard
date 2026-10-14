// src/modules/ExamsAdmin.providers.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listCatalogItems: vi.fn(), listExamProviders: vi.fn(), createExamProvider: vi.fn(),
    updateExamProvider: vi.fn(), rotateFhirToken: vi.fn(), revokeFhirToken: vi.fn(), inviteProviderUser: vi.fn() };
});

import * as api from "../lib/api";
import { ExamsAdmin } from "./ExamsAdmin";
import { renderWithProviders } from "../test/campaignFixtures";
import { examCatalogItem, examProvider, examUser } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listCatalogItems, api.listExamProviders, api.createExamProvider, api.updateExamProvider,
  api.rotateFhirToken, api.revokeFhirToken, api.inviteProviderUser ];
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function providersPanel() { return screen.findByRole("region", { name: "Prestadores" }); }
async function access(panel: HTMLElement) {
  fireEvent.click(await within(panel).findByRole("button", { name: "Acesso de Laboratório Simulado" }));
  return within(panel).getByRole("region", { name: "Acesso de Laboratório Simulado" });
}

describe("ExamsAdmin — prestadores", () => {
  beforeEach(() => {
    for (const fn of ALL) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "municipal_admin" ], { id: "ad1" }));
    mocked(api.listCatalogItems).mockResolvedValue([ examCatalogItem() ]);
    mocked(api.listExamProviders).mockResolvedValue([ examProvider() ]);
    mocked(api.createExamProvider).mockResolvedValue(examProvider({ id: "pv2" }));
    mocked(api.updateExamProvider).mockResolvedValue(examProvider());
    mocked(api.rotateFhirToken).mockResolvedValue("tok_abc123");
    mocked(api.revokeFhirToken).mockResolvedValue(undefined);
    mocked(api.inviteProviderUser).mockResolvedValue({ id: "iv1", email: "lab@exemplo.com", role: "exam_provider", expires_at: "2026-10-20T10:00:00-03:00" });
  });

  it("lista tipo, CNES, número de exames e o estado do token", async () => {
    renderWithProviders(<ExamsAdmin />);
    const row = (await within(await providersPanel()).findAllByRole("row"))[1];
    expect(within(row).getByText("Credenciado")).not.toBeNull();
    expect(within(row).getByText("1234567")).not.toBeNull();
    expect(within(row).getByText("1")).not.toBeNull();
    expect(within(row).getByText("sem token")).not.toBeNull();
    expect(within(row).queryByText("simulado")).toBeNull();
  });

  it("marca o laboratório simulado (só leitura)", async () => {
    mocked(api.listExamProviders).mockResolvedValue([ examProvider({ simulated: true }) ]);
    renderWithProviders(<ExamsAdmin />);
    const row = (await within(await providersPanel()).findAllByRole("row"))[1];
    expect(within(row).getByText("simulado")).not.toBeNull();
  });

  it("inclui um prestador com o exame e um prazo próprio", async () => {
    renderWithProviders(<ExamsAdmin />);
    const panel = await providersPanel();
    fireEvent.click(await within(panel).findByRole("button", { name: "Novo prestador" }));
    const form = within(panel).getByRole("form", { name: "Novo prestador" });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("informe o nome do prestador");
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Lab Bairro" } });
    fireEvent.change(within(form).getByLabelText("CNES (opcional)"), { target: { value: "123" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("o CNES tem 7 dígitos");
    fireEvent.change(within(form).getByLabelText("CNES (opcional)"), { target: { value: "" } });
    fireEvent.change(within(form).getByLabelText("Tipo"), { target: { value: "municipal" } });
    fireEvent.click(within(form).getByLabelText("Faz Hemograma completo"));
    const prazos = within(form).getByRole("group", { name: "Prazos — Hemograma completo" });
    expect((within(prazos).getByLabelText("Prazo de resultado") as HTMLInputElement).placeholder).toBe("herda 10");
    fireEvent.change(within(prazos).getByLabelText("Prazo de resultado"), { target: { value: "5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Incluir o prestador Lab Bairro" })).getByRole("button", { name: "Salvar prestador" }));
    await waitFor(() => expect(api.createExamProvider).toHaveBeenCalledWith({
      name: "Lab Bairro", cnes: null, kind: "municipal", active: true,
      items: [ { catalog_item_id: "ci1", deadlines: { authorize: null, schedule: null, collect: null, result: 5, acknowledge: null } } ]
    }));
    expect(await within(panel).findByText("Prestador salvo.")).not.toBeNull();
  });

  it("edita um prestador simulado sem mandar simulated; recusa do api volta ao rascunho", async () => {
    mocked(api.listExamProviders).mockResolvedValue([ examProvider({ simulated: true }) ]);
    mocked(api.updateExamProvider).mockRejectedValueOnce(new api.ApiError(422, { error: "duplicate_name" }, "422"));
    renderWithProviders(<ExamsAdmin />);
    const panel = await providersPanel();
    fireEvent.click(await within(panel).findByRole("button", { name: "Editar Laboratório Simulado" }));
    const form = within(panel).getByRole("form", { name: "Editar Laboratório Simulado" });
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Lab Central" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    const confirm = screen.getByRole("region", { name: "Salvar Laboratório Simulado" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Salvar prestador" }));
    expect((await within(confirm).findByRole("alert")).textContent).toBe("já existe um prestador com este nome");
    expect(api.updateExamProvider).toHaveBeenCalledWith("pv1", {
      name: "Lab Central", cnes: "1234567", kind: "accredited", active: true,
      items: [ { catalog_item_id: "ci1", deadlines: { authorize: null, schedule: null, collect: null, result: 5, acknowledge: null } } ]
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    expect((within(panel).getByLabelText("Nome") as HTMLInputElement).value).toBe("Lab Central");
  });

  it("token FHIR: aparece uma vez, some com Já guardei e nunca vai ao cache, console nem storage", async () => {
    const spies = [ "log", "info", "warn", "error", "debug" ].map((m) => vi.spyOn(console, m as "log"));
    const { client } = renderWithProviders(<ExamsAdmin />);
    const box = await access(await providersPanel());
    fireEvent.click(within(box).getByRole("button", { name: "Gerar token FHIR" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Gerar token FHIR — Laboratório Simulado" })).getByRole("button", { name: "Gerar token" }));
    const shown = await screen.findByRole("region", { name: "Token FHIR novo" });
    expect(within(shown).getByText("tok_abc123")).not.toBeNull();
    expect(within(shown).getByText("Copie agora: o token não aparece de novo. Ele substitui o anterior, que deixa de funcionar.")).not.toBeNull();
    expect(api.rotateFhirToken).toHaveBeenCalledTimes(1);
    expect(api.rotateFhirToken).toHaveBeenCalledWith("pv1");
    // Espera a releitura disparada pela troca, para conferir o cache depois dela.
    await waitFor(() => expect(api.listExamProviders).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state))).not.toContain("tok_abc123");
    expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state))).not.toContain("tok_abc123");
    expect(JSON.stringify({ ...localStorage })).not.toContain("tok_abc123");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("tok_abc123");
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("tok_abc123");
    fireEvent.click(within(shown).getByRole("button", { name: "Já guardei" }));
    expect(screen.queryByText("tok_abc123")).toBeNull();
    expect(document.body.innerHTML).not.toContain("tok_abc123");
  });

  it("token FHIR: fechar o acesso também descarta o token; reabrir não o mostra", async () => {
    renderWithProviders(<ExamsAdmin />);
    const panel = await providersPanel();
    const box = await access(panel);
    fireEvent.click(within(box).getByRole("button", { name: "Gerar token FHIR" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Gerar token FHIR — Laboratório Simulado" })).getByRole("button", { name: "Gerar token" }));
    await screen.findByRole("region", { name: "Token FHIR novo" });
    fireEvent.click(within(box).getByRole("button", { name: "Fechar" }));
    expect(document.body.innerHTML).not.toContain("tok_abc123");
    await access(panel);
    expect(document.body.innerHTML).not.toContain("tok_abc123");
    expect(screen.queryByRole("region", { name: "Token FHIR novo" })).toBeNull();
  });

  it("trocar o token avisa que o atual deixa de funcionar", async () => {
    mocked(api.listExamProviders).mockResolvedValue([ examProvider({ has_fhir_token: true }) ]);
    renderWithProviders(<ExamsAdmin />);
    const box = await access(await providersPanel());
    fireEvent.click(within(box).getByRole("button", { name: "Trocar token FHIR" }));
    const confirm = screen.getByRole("region", { name: "Trocar token FHIR — Laboratório Simulado" });
    expect(within(confirm).getByText("O token atual deixa de funcionar na hora.")).not.toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "Trocar token" }));
    expect(within(await screen.findByRole("region", { name: "Token FHIR novo" })).getByText("tok_abc123")).not.toBeNull();
  });

  it("revoga o token que existe", async () => {
    mocked(api.listExamProviders).mockResolvedValue([ examProvider({ has_fhir_token: true }) ]);
    renderWithProviders(<ExamsAdmin />);
    const box = await access(await providersPanel());
    expect(within(box).getByRole("button", { name: "Trocar token FHIR" })).not.toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Revogar token FHIR" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Revogar token FHIR — Laboratório Simulado" })).getByRole("button", { name: "Revogar token" }));
    await waitFor(() => expect(api.revokeFhirToken).toHaveBeenCalledWith("pv1"));
    expect(await within(box).findByText("Token revogado.")).not.toBeNull();
  });

  it("convida o usuário do prestador; e-mail inválido não abre a confirmação", async () => {
    renderWithProviders(<ExamsAdmin />);
    const box = await access(await providersPanel());
    fireEvent.change(within(box).getByLabelText("E-mail do usuário do prestador"), { target: { value: "lab@" } });
    fireEvent.click(within(box).getByRole("button", { name: "Convidar" }));
    expect((await within(box).findByRole("alert")).textContent).toBe("e-mail inválido");
    expect(screen.queryByRole("region", { name: "Convidar usuário do prestador — Laboratório Simulado" })).toBeNull();
    fireEvent.change(within(box).getByLabelText("E-mail do usuário do prestador"), { target: { value: "lab@exemplo.com" } });
    fireEvent.click(within(box).getByRole("button", { name: "Convidar" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Convidar usuário do prestador — Laboratório Simulado" }))
      .getByRole("button", { name: "Enviar convite" }));
    await waitFor(() => expect(api.inviteProviderUser).toHaveBeenCalledWith("pv1", "lab@exemplo.com"));
    expect(await within(box).findByText("Convite enviado para lab@exemplo.com.")).not.toBeNull();
  });

  it("quem já tem conta na cidade: a recusa do convite aparece na confirmação", async () => {
    mocked(api.inviteProviderUser).mockRejectedValueOnce(new api.ApiError(422, { error: "already_member" }, "422"));
    renderWithProviders(<ExamsAdmin />);
    const box = await access(await providersPanel());
    fireEvent.change(within(box).getByLabelText("E-mail do usuário do prestador"), { target: { value: "lab@exemplo.com" } });
    fireEvent.click(within(box).getByRole("button", { name: "Convidar" }));
    const confirm = screen.getByRole("region", { name: "Convidar usuário do prestador — Laboratório Simulado" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Enviar convite" }));
    expect((await within(confirm).findByRole("alert")).textContent).toBe("Essa pessoa já faz parte da equipe");
  });
});
