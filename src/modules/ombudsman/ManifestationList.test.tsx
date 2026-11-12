import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { NOW33, listItem, manifestation, ombudsmanUser, options, page } from "../../test/ombudsmanFixtures";
import * as api from "../../lib/api";
import { OMBUDSMAN_NO_ROLE } from "../../lib/ombudsman";
import { OmbudsmanManifestations } from "../OmbudsmanManifestations";
import { DeadlineTag } from "./DeadlineTag";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(),
  listOmbudsmanManifestations: vi.fn(), getOmbudsmanOptions: vi.fn(), getOmbudsmanManifestation: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(user = ombudsmanUser([ "ombudsman_staff" ]), props: { initialId?: string | null } = {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.getOmbudsmanOptions).mockResolvedValue(options());
  return renderWithProviders(<OmbudsmanManifestations now={NOW33} {...props} />);
}
const lastCall = () => vi.mocked(api.listOmbudsmanManifestations).mock.calls.at(-1)![0];

describe("DeadlineTag", () => {
  it("mostra o texto da cor com o dia, e nada sem cor", () => {
    const { container } = renderWithProviders(<DeadlineTag color="yellow" dueOn="2026-12-03" />);
    expect(screen.getByText("perto do prazo · 03/12")).not.toBeNull();
    cleanup();
    const none = renderWithProviders(<DeadlineTag color={null} dueOn="2026-12-03" />);
    expect(none.container.textContent).toBe("");
    expect(container).not.toBeNull();
  });
});

describe("caixa da ouvidoria", () => {
  it("lista com protocolo, tipo, modo, estado, assunto, unidade e prazo com texto da cor", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValue(page({ items: [
      listItem(), listItem({ id: "m3", protocol: "2026-000125", color: "red", due_on: "2026-11-09", urgent: true, pending_forwardings: 2 }),
      listItem({ id: "m4", protocol: "2026-000126", state: "awaiting_complement", color: "paused" }),
      listItem({ id: "m5", protocol: "2026-000127", state: "answered", color: null, due_on: "2026-11-10" })
    ] }));
    mount();
    const row = (await screen.findByText("2026-000125")).closest("[role='row']") as HTMLElement;
    expect(within(row).getByText(/vencida/)).not.toBeNull();
    expect(within(row).getByText("urgente")).not.toBeNull();
    expect(within(row).getByText("2 encaminhamentos pendentes")).not.toBeNull();
    expect(screen.getByText(/prazo suspenso/)).not.toBeNull();
    const done = screen.getByText("2026-000127").closest("[role='row']") as HTMLElement;
    expect(within(done).queryByText(/prazo/)).toBeNull();
  });

  it("a lista não mostra texto nem identidade, mesmo que o api mande", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValue(page({ items: [
      { ...listItem(), body: "Fui à UBS Centro três vezes", identity: { name: "Maria Lima" }, manifestant_name: "Maria Lima" } as never
    ] }));
    mount();
    await screen.findByText("2026-000123");
    expect(screen.queryByText(/Maria Lima|três vezes/)).toBeNull();
  });

  it("filtros viram a consulta; protocolo só no campo q; trocar filtro recomeça do início", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValue(page({ next_before: "c2" }));
    mount();
    await screen.findByText("2026-000123");
    fireEvent.click(screen.getByLabelText("vencida"));
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "ubs1" } });
    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "2026-000123" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(lastCall())
      .toMatchObject({ color: [ "red" ], subject_id: "s1", health_unit_id: "ubs1", q: "2026-000123", before: null }));
  });

  it("a consulta só muda no clique de Filtrar", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValue(page());
    mount();
    await screen.findByText("2026-000123");
    fireEvent.click(screen.getByLabelText("vencida"));
    expect(vi.mocked(api.listOmbudsmanManifestations)).toHaveBeenCalledTimes(1);
  });

  it("aceita o prefixo do ano; outro texto nunca sai do formulário", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValue(page());
    mount();
    await screen.findByText("2026-000123");
    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "Maria Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    expect(screen.getByText("use o protocolo AAAA-NNNNNN ou só o ano AAAA-")).not.toBeNull();
    expect(vi.mocked(api.listOmbudsmanManifestations)).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "2026-" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(lastCall()).toMatchObject({ q: "2026-" }));
    expect(screen.queryByText("use o protocolo AAAA-NNNNNN ou só o ano AAAA-")).toBeNull();
  });

  it("Carregar mais usa o cursor e acrescenta", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValueOnce(page({ next_before: "c2" }))
      .mockResolvedValueOnce(page({ items: [ listItem({ id: "m8", protocol: "2026-000099" }) ], next_before: null }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("2026-000099")).not.toBeNull();
    expect(screen.getByText("2026-000123")).not.toBeNull();
    expect(vi.mocked(api.listOmbudsmanManifestations).mock.calls[1][0].before).toBe("c2");
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("cursor recusado: mostra a frase e recomeça do início", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValueOnce(page({ next_before: "velho" }))
      .mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_cursor" }, "422"))
      .mockResolvedValue(page({ items: [ listItem({ protocol: "2026-000200" }) ] }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("2026-000200")).not.toBeNull();
    expect(lastCall().before).toBeNull();
    expect(screen.getByText("a lista mudou — ela será lida do início")).not.toBeNull();
  });

  it("o dia de recebimento vem do fuso da cidade", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValue(page({ items: [ listItem({ received_at: "2026-11-12T01:30:00Z" }) ] }));
    mount();
    const row = (await screen.findByText("2026-000123")).closest("[role='row']") as HTMLElement;
    expect(within(row).getByText("11/11/2026")).not.toBeNull();
  });

  it("lista vazia", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValue(page({ items: [] }));
    mount();
    expect(await screen.findByText("Nenhuma manifestação com esses filtros")).not.toBeNull();
  });

  it("clicar abre a manifestação e voltar mostra a caixa; respondente sem técnico nem chega a ler", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValue(page());
    vi.mocked(api.getOmbudsmanManifestation).mockResolvedValue(manifestation());
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir 2026-000123" }));
    expect(await screen.findByRole("heading", { name: /2026-000123/ })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Voltar à caixa" }));
    expect(await screen.findByRole("button", { name: "Abrir 2026-000123" })).not.toBeNull();
    cleanup();
    vi.clearAllMocks();
    mount(ombudsmanUser([ "ombudsman_responder" ]));
    expect(await screen.findByText(OMBUDSMAN_NO_ROLE)).not.toBeNull();
    expect(api.listOmbudsmanManifestations).not.toHaveBeenCalled();
  });

  it("abre direto na manifestação do handoff", async () => {
    vi.mocked(api.listOmbudsmanManifestations).mockResolvedValue(page());
    vi.mocked(api.getOmbudsmanManifestation).mockResolvedValue(manifestation());
    mount(undefined, { initialId: "m1" });
    expect(await screen.findByRole("heading", { name: /2026-000123/ })).not.toBeNull();
    expect(vi.mocked(api.getOmbudsmanManifestation).mock.calls[0][0]).toBe("m1");
  });
});
