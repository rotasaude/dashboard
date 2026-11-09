import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW32, UBS, UPA, callLocation, urgencyUser, waitingRoomDisplay } from "../test/urgencyFixtures";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { URGENCY_ERRORS, WAITING_ROOM_DISABLED } from "../lib/urgency";
import { WAITING_ROOM_NO_ROLE, WaitingRoomSettings } from "./WaitingRoomSettings";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listActiveUnits: vi.fn(),
  listCallLocations: vi.fn(), createCallLocation: vi.fn(), updateCallLocation: vi.fn(), listWaitingRoomDisplays: vi.fn(),
  createWaitingRoomDisplay: vi.fn(), updateWaitingRoomDisplay: vi.fn(), createPairingCode: vi.fn(), revokeWaitingRoomDisplay: vi.fn() }));

beforeEach(() => { vi.useFakeTimers({ now: NOW32, toFake: [ "Date" ] }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); });

const TV_URL = `${window.location.origin}${window.location.pathname}#/tv`;

function mount(user = urgencyUser([ "municipal_admin" ], [ "waiting_room_display" ])) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  if (!vi.mocked(api.listActiveUnits).getMockImplementation()) vi.mocked(api.listActiveUnits).mockResolvedValue([ UPA, UBS ]);
  if (!vi.mocked(api.listCallLocations).getMockImplementation()) vi.mocked(api.listCallLocations).mockResolvedValue({ items: [], location_required: false });
  if (!vi.mocked(api.listWaitingRoomDisplays).getMockImplementation()) vi.mocked(api.listWaitingRoomDisplays).mockResolvedValue([]);
  return renderWithProviders(<WaitingRoomSettings onGoToSecurity={() => {}} />);
}
// As opções chegam com a lista de unidades: espera a da unidade antes de escolher.
const pickUnit = async (id = "upa1") => {
  const select = await screen.findByLabelText("Unidade") as HTMLSelectElement;
  await waitFor(() => expect([ ...select.options ].some((o) => o.value === id)).toBe(true));
  fireEvent.change(select, { target: { value: id } });
};
const confirm = async () => fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
const refused = (status: number, error: string) => new ApiError(status, { error }, error);

describe("portão", () => {
  it("interruptor desligado e papel sem acesso", async () => {
    const off = mount(urgencyUser([ "municipal_admin" ], [ "urgency_care" ]));
    expect(await screen.findByText(WAITING_ROOM_DISABLED)).not.toBeNull();
    off.unmount();
    mount(urgencyUser([ "citizen_verifier" ], [ "waiting_room_display" ]));
    expect(await screen.findByText(WAITING_ROOM_NO_ROLE)).not.toBeNull();
    expect(api.listActiveUnits).not.toHaveBeenCalled();
  });
});

describe("locais de chamada", () => {
  it("locais: criar, renomear e desativar, com step-up", async () => {
    vi.mocked(api.listCallLocations).mockResolvedValue({ items: [ callLocation() ], location_required: false });
    vi.mocked(api.createCallLocation).mockResolvedValue(callLocation({ id: "loc2", name: "Consultório 2" }));
    vi.mocked(api.updateCallLocation).mockResolvedValue(callLocation({ name: "Sala 1" }));
    mount();
    await pickUnit();
    expect(await screen.findByText("Consultório 1")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Nome do local"), { target: { value: "Consultório 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar local" }));
    await confirm();
    await waitFor(() => expect(vi.mocked(api.createCallLocation).mock.calls[0][0]).toEqual({ health_unit_id: "upa1", name: "Consultório 2", active: true }));
    expect(await screen.findByText("Local adicionado.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Renomear Consultório 1" }));
    fireEvent.change(screen.getByLabelText("Novo nome de Consultório 1"), { target: { value: "Sala 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
    await confirm();
    await waitFor(() => expect(vi.mocked(api.updateCallLocation).mock.calls[0]).toEqual([ "loc1", { name: "Sala 1", active: true } ]));

    fireEvent.click(await screen.findByRole("button", { name: "Desativar Consultório 1" }));
    await confirm();
    await waitFor(() => expect(vi.mocked(api.updateCallLocation).mock.calls[1]).toEqual([ "loc1", { name: "Consultório 1", active: false } ]));
    expect(await screen.findByText("Local desativado.")).not.toBeNull();
  });
  it("nome de 1 a 40 sem chamar o api; nome repetido mostra a frase do api", async () => {
    vi.mocked(api.createCallLocation).mockRejectedValue(refused(409, "call_location_name_taken"));
    mount();
    await pickUnit();
    fireEvent.change(await screen.findByLabelText("Nome do local"), { target: { value: "x".repeat(41) } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar local" }));
    expect(screen.getByText("o nome tem de 1 a 40 caracteres")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Nome do local"), { target: { value: "Consultório 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar local" }));
    await confirm();
    expect(await screen.findByText(URGENCY_ERRORS.call_location_name_taken)).not.toBeNull();
  });
  it("TV pareada sem local ativo: avisa que ninguém consegue chamar", async () => {
    vi.mocked(api.listCallLocations).mockResolvedValue({ items: [ callLocation({ active: false }) ], location_required: true });
    mount();
    await pickUnit();
    expect(await screen.findByText(/sem local ativo, ninguém consegue chamar/)).not.toBeNull();
  });
});

describe("TVs", () => {
  it("TV: cadastrar, gerar o código de 6 dígitos com validade e as instruções; revogar com confirmação", async () => {
    vi.mocked(api.listWaitingRoomDisplays).mockResolvedValue([ waitingRoomDisplay() ]);
    vi.mocked(api.createWaitingRoomDisplay).mockResolvedValue(waitingRoomDisplay({ id: "d2", name: "TV do corredor", paired: false, paired_at: null, last_seen_at: null }));
    vi.mocked(api.createPairingCode).mockResolvedValue({ code: "082913", expires_at: "2026-11-05T10:10:00-03:00" });
    vi.mocked(api.revokeWaitingRoomDisplay).mockResolvedValue(waitingRoomDisplay({ paired: false, revoked: true, revoked_at: "2026-11-05T10:00:00-03:00" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const logs = [ vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "debug"), vi.spyOn(console, "warn") ];
    mount();
    await pickUnit();
    const row = (await screen.findByText("TV da recepção")).closest("[role='row']") as HTMLElement;
    expect(within(row).getByText("pareada")).not.toBeNull();
    expect(within(row).getByText("visto há 1 min")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Nome da TV"), { target: { value: "TV do corredor" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar TV" }));
    await confirm();
    await waitFor(() => expect(vi.mocked(api.createWaitingRoomDisplay).mock.calls[0][0]).toEqual({ health_unit_id: "upa1", name: "TV do corredor", active: true, show_wait_times: true }));

    fireEvent.click(await screen.findByRole("button", { name: "Gerar código para TV da recepção" }));
    await confirm();
    expect(await screen.findByText("082913")).not.toBeNull();
    expect(api.createPairingCode).toHaveBeenCalledWith("d1");
    expect(screen.getByText(`Vale até 10:10. Na TV, abra ${TV_URL} e digite o código.`)).not.toBeNull();
    expect(screen.getByText("expira em 10:00")).not.toBeNull();
    expect(window.location.href).not.toContain("082913");
    for (const call of setItem.mock.calls) expect(String(call[1])).not.toContain("082913");
    for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("082913");

    fireEvent.click(screen.getByRole("button", { name: "Revogar TV da recepção" }));
    expect(screen.getByText("Revogar a TV? Ela volta a pedir código.")).not.toBeNull();
    await confirm();
    await waitFor(() => expect(api.revokeWaitingRoomDisplay).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText("TV da recepção revogada: a tela volta a pedir código.")).not.toBeNull();
    expect(screen.queryByText("082913")).toBeNull();
    const after = screen.getByText("TV da recepção").closest("[role='row']") as HTMLElement;
    expect(within(after).getByText("revogada")).not.toBeNull();
    expect(within(after).queryByRole("button", { name: "Revogar TV da recepção" })).toBeNull();
  });
  it("situação: aguardando pareamento, nunca visto; desativada não oferece código", async () => {
    vi.mocked(api.listWaitingRoomDisplays).mockResolvedValue([
      waitingRoomDisplay({ id: "d1", name: "TV nova", paired: false, paired_at: null, last_seen_at: null }),
      waitingRoomDisplay({ id: "d2", name: "TV velha", active: false, paired: false })
    ]);
    mount();
    await pickUnit();
    const fresh = (await screen.findByText("TV nova")).closest("[role='row']") as HTMLElement;
    expect(within(fresh).getByText("aguardando pareamento")).not.toBeNull();
    expect(within(fresh).getByText("nunca visto")).not.toBeNull();
    const old = screen.getByText("TV velha").closest("[role='row']") as HTMLElement;
    expect(within(old).getByText("desativada")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Gerar código para TV velha" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ativar TV velha" })).not.toBeNull();
  });
  it("display_inactive no código mostra a frase", async () => {
    vi.mocked(api.listWaitingRoomDisplays).mockResolvedValue([ waitingRoomDisplay() ]);
    vi.mocked(api.createPairingCode).mockRejectedValue(refused(422, "display_inactive"));
    mount();
    await pickUnit();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar código para TV da recepção" }));
    await confirm();
    expect(await screen.findByText(URGENCY_ERRORS.display_inactive)).not.toBeNull();
    await waitFor(() => expect(api.listWaitingRoomDisplays).toHaveBeenCalledTimes(2));
  });
  it("o código vence e some da tela", async () => {
    vi.mocked(api.listWaitingRoomDisplays).mockResolvedValue([ waitingRoomDisplay() ]);
    vi.mocked(api.createPairingCode).mockResolvedValue({ code: "482913", expires_at: "2026-11-05T10:10:00-03:00" });
    mount();
    await pickUnit();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar código para TV da recepção" }));
    await confirm();
    expect(await screen.findByText("482913")).not.toBeNull();
    vi.setSystemTime(new Date("2026-11-05T10:10:01-03:00"));
    expect(await screen.findByText("código vencido — gere outro", {}, { timeout: 2500 })).not.toBeNull();
    expect(screen.queryByText("482913")).toBeNull();
  });
  it("ao sair da tela com o código à vista, o relógio do código é limpo", async () => {
    vi.mocked(api.listWaitingRoomDisplays).mockResolvedValue([ waitingRoomDisplay() ]);
    vi.mocked(api.createPairingCode).mockResolvedValue({ code: "482913", expires_at: "2026-11-05T10:10:00-03:00" });
    const view = mount();
    await pickUnit();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar código para TV da recepção" }));
    await confirm();
    expect(await screen.findByText("482913")).not.toBeNull();
    const cleared = vi.spyOn(window, "clearInterval");
    view.unmount();
    expect(cleared).toHaveBeenCalled();
  });
  it("'Mostrar o tempo de espera por cor' é por TV", async () => {
    vi.mocked(api.listWaitingRoomDisplays).mockResolvedValue([ waitingRoomDisplay({ name: "TV", paired: false, last_seen_at: null }) ]);
    vi.mocked(api.updateWaitingRoomDisplay).mockResolvedValue(waitingRoomDisplay({ name: "TV", show_wait_times: false, paired: false, last_seen_at: null }));
    mount();
    await pickUnit();
    fireEvent.click(await screen.findByLabelText("Mostrar o tempo de espera por cor em TV"));
    await confirm();
    await waitFor(() => expect(vi.mocked(api.updateWaitingRoomDisplay).mock.calls[0]).toEqual([ "d1", { name: "TV", active: true, show_wait_times: false } ]));
    await waitFor(() => expect((screen.getByLabelText("Mostrar o tempo de espera por cor em TV") as HTMLInputElement).checked).toBe(false));
  });
  it("tempos de espera: explica os dois interruptores na UPA; a UBS mostra só as chamadas", async () => {
    vi.mocked(api.listActiveUnits).mockResolvedValue([ { ...UPA, show_wait_times: false }, UBS ]);
    vi.mocked(api.listWaitingRoomDisplays).mockResolvedValue([ waitingRoomDisplay({ health_unit_id: "ubs1" }) ]);
    mount();
    await pickUnit();
    expect(await screen.findByText(/os tempos estão desligados no cadastro da unidade/i)).not.toBeNull();
    await pickUnit("ubs1");
    expect(await screen.findByText("Na UBS, a TV mostra só as chamadas, sem tempos de espera.")).not.toBeNull();
    await screen.findByText("TV da recepção");
    expect(screen.queryByLabelText("Mostrar o tempo de espera por cor em TV da recepção")).toBeNull();
  });
  it("CAPS não aparece entre as unidades", async () => {
    vi.mocked(api.listActiveUnits).mockResolvedValue([ UPA, UBS, { id: "caps1", name: "CAPS II", kind: "caps" } ]);
    mount();
    const select = await screen.findByLabelText("Unidade") as HTMLSelectElement;
    await waitFor(() => expect([ ...select.options ].map((o) => o.text)).toContain("UPA Boqueirão"));
    expect([ ...select.options ].map((o) => o.text)).not.toContain("CAPS II");
  });
});
