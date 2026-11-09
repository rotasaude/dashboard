// Local da chamada (módulo 32a, F-32.5; contrato §6, §14 Q7; D6): só com `waiting_room_display`; a lista traz `location_required`;
// a escolha fica lembrada na sessão do navegador por usuário e unidade; local desativado some da escolha.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), listCallLocations: vi.fn() }));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { readCallLocation, writeCallLocation } from "../../lib/urgency";
import { CallLocationPicker, useCallLocation, type CallLocationState } from "./CallLocationPicker";

afterEach(cleanup);
// Com chaves: o retorno do beforeEach vira teardown no vitest.
beforeEach(() => { vi.mocked(api.listCallLocations).mockReset(); sessionStorage.clear(); });

const LOCS = { items: [ { id: "loc1", health_unit_id: "upa1", name: "Consultório 1", active: true },
  { id: "loc2", health_unit_id: "upa1", name: "Sala de medicação", active: false } ], location_required: true };

let last: CallLocationState | null = null;
function Harness({ enabled, unitId }: { enabled: boolean; unitId: string }) {
  const state = useCallLocation("u-1", unitId, enabled);
  last = state;
  return <CallLocationPicker state={state} />;
}
function mountPicker({ enabled = true, unitId = "upa1" }: { enabled?: boolean; unitId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Harness enabled={enabled} unitId={unitId} /></QueryClientProvider>);
}

it("lembra o local na sessão por unidade; local desativado some da escolha", async () => {
  vi.mocked(api.listCallLocations).mockResolvedValue(LOCS);
  writeCallLocation("u-1", "upa1", "loc2");
  mountPicker();
  const select = await screen.findByLabelText("Local da chamada") as HTMLSelectElement;
  await screen.findByRole("option", { name: "Consultório 1" });
  expect(select.value).toBe("");
  expect([ ...select.options ].map((o) => o.text)).toEqual([ "— escolha —", "Consultório 1" ]);
  fireEvent.change(select, { target: { value: "loc1" } });
  expect(readCallLocation("u-1", "upa1")).toBe("loc1");
  expect(select.value).toBe("loc1");
  expect(vi.mocked(api.listCallLocations).mock.calls[0]).toEqual([ "upa1" ]);
});

it("o local lembrado volta ao montar de novo; outra unidade não herda", async () => {
  vi.mocked(api.listCallLocations).mockResolvedValue(LOCS);
  writeCallLocation("u-1", "upa1", "loc1");
  const { unmount } = mountPicker();
  await screen.findByRole("option", { name: "Consultório 1" });
  expect((screen.getByLabelText("Local da chamada") as HTMLSelectElement).value).toBe("loc1");
  expect(last?.selected).toBe("loc1");
  unmount();
  vi.mocked(api.listCallLocations).mockResolvedValue({ ...LOCS, items: [ { ...LOCS.items[0], health_unit_id: "upa2" } ] });
  mountPicker({ unitId: "upa2" });
  await screen.findByRole("option", { name: "Consultório 1" });
  expect((screen.getByLabelText("Local da chamada") as HTMLSelectElement).value).toBe("");
});

it("sem waiting_room_display não busca nem aparece", () => {
  mountPicker({ enabled: false });
  expect(screen.queryByLabelText("Local da chamada")).toBeNull();
  expect(api.listCallLocations).not.toHaveBeenCalled();
  expect(last?.required).toBe(false);
  let ok = false;
  act(() => { ok = last!.ready(); });
  expect(ok).toBe(true);
});

it("obrigatório e sem escolha: ready() recusa com a frase e o foco no seletor", async () => {
  vi.mocked(api.listCallLocations).mockResolvedValue(LOCS);
  mountPicker();
  await screen.findByRole("option", { name: "Consultório 1" });
  let ok = true;
  act(() => { ok = last!.ready(); });
  expect(ok).toBe(false);
  expect(screen.getByRole("alert").textContent).toBe("escolha o local da chamada — a unidade tem TV na sala de espera");
  expect(document.activeElement).toBe(screen.getByLabelText("Local da chamada"));
  // Escolher limpa a frase.
  fireEvent.change(screen.getByLabelText("Local da chamada"), { target: { value: "loc1" } });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("sem local obrigatório (unidade sem TV ativa), a chamada sai sem escolha", async () => {
  vi.mocked(api.listCallLocations).mockResolvedValue({ ...LOCS, location_required: false });
  mountPicker();
  await screen.findByRole("option", { name: "Consultório 1" });
  let ok = false;
  act(() => { ok = last!.ready(); });
  expect(ok).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("obrigatório e nenhum local ativo: diz onde cadastrar", async () => {
  vi.mocked(api.listCallLocations).mockResolvedValue({ items: [ LOCS.items[1] ], location_required: true });
  mountPicker();
  expect(await screen.findByText("cadastre os locais de chamada em Urgência → Senhas, locais e TVs")).not.toBeNull();
});

it("invalid_call_location do api: a frase, esquece o lembrado e relê a lista; call_location_required põe a frase", async () => {
  vi.mocked(api.listCallLocations).mockResolvedValue(LOCS);
  writeCallLocation("u-1", "upa1", "loc1");
  mountPicker();
  await screen.findByRole("option", { name: "Consultório 1" });
  vi.mocked(api.listCallLocations).mockResolvedValue({ ...LOCS, items: [ { ...LOCS.items[0], active: false } ] });
  let handled = false;
  act(() => { handled = last!.refused(new ApiError(422, { error: "invalid_call_location" }, "x")); });
  expect(handled).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe("o local escolhido não está ativo nesta unidade — escolha outro");
  expect(readCallLocation("u-1", "upa1")).toBeNull();
  await waitFor(() => expect(api.listCallLocations).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("option", { name: "Consultório 1" })).toBeNull());
  act(() => { handled = last!.refused(new ApiError(422, { error: "call_location_required" }, "x")); });
  expect(handled).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe("escolha o local da chamada — a unidade tem TV na sala de espera");
  expect(document.activeElement).toBe(screen.getByLabelText("Local da chamada"));
  act(() => { handled = last!.refused(new ApiError(409, { error: "already_called" }, "x")); });
  expect(handled).toBe(false);
});

it("dois seletores da mesma unidade andam juntos (a mesa e o painel de antes da urgência)", async () => {
  vi.mocked(api.listCallLocations).mockResolvedValue(LOCS);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Two() {
    const a = useCallLocation("u-1", "upa1", true);
    const b = useCallLocation("u-1", "upa1", true);
    return <><CallLocationPicker state={a} label="Local A" /><CallLocationPicker state={b} label="Local B" /></>;
  }
  render(<QueryClientProvider client={client}><Two /></QueryClientProvider>);
  await screen.findAllByRole("option", { name: "Consultório 1" });
  fireEvent.change(screen.getByLabelText("Local A"), { target: { value: "loc1" } });
  expect((screen.getByLabelText("Local B") as HTMLSelectElement).value).toBe("loc1");
});
