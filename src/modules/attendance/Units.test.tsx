import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, listAllUnits: vi.fn(), createUnit: vi.fn(), updateUnit: vi.fn(), setUnitActive: vi.fn(), listNeighborhoods: vi.fn(),
    drainUnit: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { Units } from "./Units";
import { EMPTY_ADDRESS } from "../../lib/unitAddress";
import { expectFrozenNotice } from "../../test/frozenNotice";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const rows = [
  { id: "u1", name: "UBS Centro", kind: "ubs", active: true, address_street: "Rua A", address_number: "1",
    address_complement: null, address_zip: null, neighborhood_id: "n1" },
  { id: "u2", name: "UPA Norte", kind: "upa", active: false }
];
const centro = { id: "n1", name: "Centro", active: true, source: "seed" as const, units: [] };

function renderUnits(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<Units />, { wrapper });
  return client;
}

describe("Units", () => {
  beforeEach(() => {
    for (const fn of [ api.listAllUnits, api.createUnit, api.updateUnit, api.setUnitActive, api.listNeighborhoods, api.drainUnit ]) mocked(fn).mockReset();
    mocked(api.listAllUnits).mockResolvedValue(rows);
    mocked(api.listNeighborhoods).mockResolvedValue([ centro ]);
  });

  it("cria uma unidade com nome e tipo", async () => {
    mocked(api.createUnit).mockResolvedValue({ id: "u3", name: "Hospital Sul", kind: "hospital", active: true });
    mocked(api.listAllUnits).mockResolvedValueOnce(rows).mockResolvedValueOnce([
      ...rows, { id: "u3", name: "Hospital Sul", kind: "hospital", active: true }
    ]);
    renderUnits();
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Hospital Sul" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "hospital" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.createUnit).toHaveBeenCalledWith("Hospital Sul", "hospital", EMPTY_ADDRESS));
    expect(await screen.findByText("Hospital Sul")).not.toBeNull();
  });

  it("edita uma unidade", async () => {
    mocked(api.updateUnit).mockResolvedValue({ id: "u1", name: "UBS Centro Novo", kind: "ubs", active: true });
    mocked(api.listAllUnits).mockResolvedValueOnce(rows).mockResolvedValueOnce([
      { id: "u1", name: "UBS Centro Novo", kind: "ubs", active: true }, rows[1]
    ]);
    renderUnits();
    fireEvent.click(await screen.findAllByRole("button", { name: "Editar" }).then((btns) => btns[0]));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "UBS Centro Novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalledWith("u1", "UBS Centro Novo", "ubs", {
      address_street: "Rua A", address_number: "1", address_complement: null, address_zip: null, neighborhood_id: "n1"
    }));
    expect(await screen.findByText("UBS Centro Novo")).not.toBeNull();
  });

  it("desativa uma unidade ativa", async () => {
    mocked(api.setUnitActive).mockResolvedValue({ id: "u1", name: "UBS Centro", kind: "ubs", active: false });
    renderUnits();
    const btn = await screen.findByRole("button", { name: "Desativar" });
    fireEvent.click(btn);
    await waitFor(() => expect(api.setUnitActive).toHaveBeenCalledWith("u1", false));
  });

  it("reativa uma unidade inativa", async () => {
    mocked(api.setUnitActive).mockResolvedValue({ id: "u2", name: "UPA Norte", kind: "upa", active: true });
    renderUnits();
    const btn = await screen.findByRole("button", { name: "Reativar" });
    fireEvent.click(btn);
    await waitFor(() => expect(api.setUnitActive).toHaveBeenCalledWith("u2", true));
  });

  it("mostra a frase de unit_name_taken", async () => {
    mocked(api.createUnit).mockRejectedValue(new ApiError(422, { error: "unit_name_taken" }, "x"));
    renderUnits();
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "UBS Centro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("já existe uma unidade com este nome")).not.toBeNull();
  });

  it("mostra a frase de unit_has_open_attendances ao tentar desativar", async () => {
    mocked(api.setUnitActive).mockRejectedValue(new ApiError(409, { error: "unit_has_open_attendances" }, "x"));
    renderUnits();
    const btn = await screen.findByRole("button", { name: "Desativar" });
    fireEvent.click(btn);
    expect(await screen.findByText("há atendimentos abertos nesta unidade — encerre-os antes de desativar")).not.toBeNull();
  });

  it("mostra alerta quando listAllUnits falha, em vez de painel em branco" , async () => {
    mocked(api.listAllUnits).mockReset().mockRejectedValue(new ApiError(500, { error: "server_error" }, "x"));
    renderUnits();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("não foi possível concluir — tente de novo");
  });

  it("criar uma unidade invalida activeUnits (card dashboard#4)", async () => {
    mocked(api.createUnit).mockResolvedValue({ id: "u3", name: "Hospital Sul", kind: "hospital", active: true });
    const client = renderUnits();
    const spy = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Hospital Sul" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.createUnit).toHaveBeenCalled());
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: [ "activeUnits" ] }));
  });

  it("reativar uma unidade invalida activeUnits, mas desativar não", async () => {
    mocked(api.setUnitActive).mockResolvedValue({ id: "u2", name: "UPA Norte", kind: "upa", active: true });
    const client = renderUnits();
    const spy = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Reativar" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: [ "activeUnits" ] }));

    spy.mockClear();
    mocked(api.setUnitActive).mockResolvedValue({ id: "u1", name: "UBS Centro", kind: "ubs", active: false });
    fireEvent.click(await screen.findByRole("button", { name: "Desativar" }));
    await waitFor(() => expect(api.setUnitActive).toHaveBeenCalledWith("u1", false));
    expect(spy).not.toHaveBeenCalled();
  });

  it("mostra o endereço com o nome do bairro", async () => {
    renderUnits();
    expect(await screen.findByText("Rua A, 1 · Centro")).not.toBeNull();
  });

  it("cria uma unidade com endereço e o bairro sugerido pelo CEP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ logradouro: "Rua XV de Novembro", bairro: "Centro" }), { status: 200 })));
    mocked(api.createUnit).mockResolvedValue({ id: "u3", name: "UBS XV", kind: "ubs", active: true });
    renderUnits();
    await screen.findByText("Rua A, 1 · Centro");
    fireEvent.click(screen.getByRole("button", { name: "Nova unidade" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "UBS XV" } });
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "80010000" } });
    await screen.findByText("bairro segundo o CEP: Centro");
    fireEvent.change(screen.getByLabelText("Número"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.createUnit).toHaveBeenCalledWith("UBS XV", "ubs", {
      address_street: "Rua XV de Novembro", address_number: "100", address_complement: null,
      address_zip: "80010000", neighborhood_id: "n1"
    }));
  });

  describe("Esvaziar unidade (api#29)", () => {
    const busy = [
      { ...rows[0], live_requests_count: 3, live_appointments_count: 2 },
      { id: "u3", name: "UBS Vila Nova", kind: "ubs", active: true, live_requests_count: 0, live_appointments_count: 0 },
      rows[1]
    ];

    it("só aparece em unidade ativa com pedidos ou horários; move para a escolhida, com motivo e aviso", async () => {
      mocked(api.listAllUnits).mockResolvedValueOnce(busy).mockResolvedValueOnce([
        { ...busy[0], live_requests_count: 0, live_appointments_count: 0 }, busy[1], busy[2]
      ]);
      mocked(api.drainUnit).mockResolvedValue({ id: "d1", requests_count: 3, appointments_count: 2 });
      renderUnits();
      const buttons = await screen.findAllByRole("button", { name: "Esvaziar" });
      expect(buttons).toHaveLength(1);
      fireEvent.click(buttons[0]);

      expect(screen.getByText("3 pedidos e 2 horários marcados vão para a unidade escolhida. Os horários mantêm data e hora; se faltarem 48h ou mais, o cidadão confirma de novo.")).not.toBeNull();
      const destination = screen.getByLabelText("Unidade de destino") as HTMLSelectElement;
      expect([ ...destination.options ].map((o) => o.textContent)).toEqual([ "—", "UBS Vila Nova" ]);
      expectFrozenNotice(screen.getByLabelText("Motivo"));

      const confirm = screen.getByRole("button", { name: "Esvaziar unidade" }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.change(destination, { target: { value: "u3" } });
      fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
      expect((screen.getByRole("button", { name: "Esvaziar unidade" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "unidade fechada para reforma" } });
      fireEvent.click(screen.getByRole("button", { name: "Esvaziar unidade" }));

      await waitFor(() => expect(api.drainUnit).toHaveBeenCalledWith("u1", "u3", "unidade fechada para reforma"));
      expect(await screen.findByText("UBS Centro esvaziada: 3 pedidos e 2 horários foram para UBS Vila Nova. Agora ela pode ser desativada.")).not.toBeNull();
      expect(api.listAllUnits).toHaveBeenCalledTimes(2);
    });

    it("erro do api aparece no painel", async () => {
      mocked(api.listAllUnits).mockResolvedValue(busy);
      mocked(api.drainUnit).mockRejectedValue(new ApiError(422, { error: "invalid_target" }, "x"));
      renderUnits();
      fireEvent.click(await screen.findByRole("button", { name: "Esvaziar" }));
      fireEvent.change(screen.getByLabelText("Unidade de destino"), { target: { value: "u3" } });
      fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "unidade fechada para reforma" } });
      fireEvent.click(screen.getByRole("button", { name: "Esvaziar unidade" }));
      expect(await screen.findByText("escolha outra unidade ativa como destino")).not.toBeNull();
    });
  });
});
