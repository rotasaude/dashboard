// src/modules/ZooDemands.test.tsx
// Demandas do centro de zoonoses (módulo 35b, Task 7; F-35.13): fila sem extrato nem endereço, detalhe nominal lido uma vez,
// agendar, vistoriar, encerrar (inclusive direto de `open`), recusar e prorrogar; 409 com uma releitura e nenhum reenvio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getZoonosesDomains: vi.fn(), listDemands: vi.fn(), getDemand: vi.fn(), scheduleDemand: vi.fn(),
    inspectDemand: vi.fn(), closeDemand: vi.fn(), declineDemand: vi.fn(), extendDemand: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ZOONOSES_OMBUDSMAN_DISABLED } from "../lib/zoonosesErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY35B, ZOO_DOMAINS, ZOO_FEATURES, demand, demandDetail, zooUser } from "../test/zoonosesFixtures";
import { ZooDemands } from "./ZooDemands";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const MOCKS = [ api.fetchCurrentSession, api.getZoonosesDomains, api.listDemands, api.getDemand, api.scheduleDemand, api.inspectDemand, api.closeDemand, api.declineDemand, api.extendDemand ];
const FEATURES = [ ...ZOO_FEATURES, "ombudsman" ];
const TEXT20 = "Visita feita, o escorpião foi recolhido.";
const err = (status: number, body: object) => new ApiError(status, body, "x");

afterEach(cleanup);
beforeEach(() => {
  for (const fn of MOCKS) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "zoonoses_team" ], FEATURES));
  mocked(api.getZoonosesDomains).mockResolvedValue(ZOO_DOMAINS);
  mocked(api.listDemands).mockImplementation(async ({ state }: { state?: string }) => ({ items: state === "open" ? [ demand() ] : [], next_before: null }));
  mocked(api.getDemand).mockResolvedValue(demandDetail({ version: 1 }));
});

const view = () => renderWithProviders(<ZooDemands today={TODAY35B} />);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const send = async () => fireEvent.click(await screen.findByRole("button", { name: "Enviar" }));
const set = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function openDetail() {
  const r = view();
  fireEvent.click(await screen.findByRole("button", { name: "Ver demanda" }));
  await screen.findByText("Rua das Palmeiras, 45");
  return r;
}

describe("ZooDemands", () => {
  it("fila sem extrato nem endereço; detalhe lê uma vez e mostra os dois; nada disso em chave do cache", async () => {
    const { client, container } = view();
    await screen.findByText("Escorpião");
    expect(container.textContent).not.toContain(demandDetail().extract);
    expect(container.textContent).not.toContain("Rua das Palmeiras");
    expect(api.getDemand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver demanda" }));
    await screen.findByText("Rua das Palmeiras, 45");
    expect(screen.getByText(demandDetail().extract)).not.toBeNull();
    expect(api.getDemand).toHaveBeenCalledTimes(1);
    const keys = JSON.stringify(client.getQueryCache().getAll().map((q) => q.queryKey));
    expect(keys).not.toContain("Palmeiras");
    expect(keys).not.toContain("escorpião");
  });

  it("agendar → vistoriar → encerrar com desfecho e texto 20–4000; cada um com expected_version", async () => {
    mocked(api.getDemand)
      .mockResolvedValueOnce(demandDetail({ version: 1 }))
      .mockResolvedValueOnce(demandDetail({ version: 2, state: "scheduled", scheduled_on: "2026-11-25" }))
      .mockResolvedValueOnce(demandDetail({ version: 3, state: "inspected", inspected_on: "2026-11-25", inspection_note: "Vistoria feita" }));
    mocked(api.scheduleDemand).mockResolvedValue(demandDetail({ version: 2 }));
    mocked(api.inspectDemand).mockResolvedValue(demandDetail({ version: 3 }));
    mocked(api.closeDemand).mockResolvedValue(demandDetail({ version: 4, state: "closed" }));
    await openDetail();
    click("Agendar vistoria");
    set("Data da visita", "2026-11-25");
    await send();
    await waitFor(() => expect(api.scheduleDemand).toHaveBeenCalledWith("dm1", { scheduled_on: "2026-11-25", expected_version: 1 }));
    await screen.findByRole("button", { name: "Registrar vistoria" });
    click("Registrar vistoria");
    set("Data da vistoria", "2026-11-23");
    set("Nota da vistoria", "Vistoria feita no quintal");
    await send();
    await waitFor(() => expect(api.inspectDemand).toHaveBeenCalledWith("dm1", { inspected_on: "2026-11-23", inspection_note: "Vistoria feita no quintal", expected_version: 2 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Agendar vistoria" })).toBeNull());
    await screen.findByRole("button", { name: "Encerrar" });
    click("Encerrar");
    expect(screen.getByText("este texto vai à ouvidoria como a resposta do encaminhamento")).not.toBeNull();
    set("Desfecho", "resolved");
    set("Texto da resposta", TEXT20);
    await send();
    await waitFor(() => expect(api.closeDemand).toHaveBeenCalledWith("dm1", { outcome: "resolved", text: TEXT20, expected_version: 3 }));
  });

  it("encerrar direto de open (orientação por telefone)", async () => {
    mocked(api.closeDemand).mockResolvedValue(demandDetail({ state: "closed" }));
    await openDetail();
    click("Encerrar");
    set("Desfecho", "guidance");
    set("Texto da resposta", TEXT20);
    await send();
    await waitFor(() => expect(api.closeDemand).toHaveBeenCalledWith("dm1", { outcome: "guidance", text: TEXT20, expected_version: 1 }));
  });

  it("encerramento com 19 caracteres ou sem desfecho não envia", async () => {
    await openDetail();
    click("Encerrar");
    set("Texto da resposta", "x".repeat(19));
    await send();
    expect(api.closeDemand).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    set("Texto da resposta", "x".repeat(20));
    await send();
    expect(api.closeDemand).not.toHaveBeenCalled();
  });

  it("recusar: 9 caracteres não envia, 10 envia", async () => {
    mocked(api.declineDemand).mockResolvedValue(demandDetail({ state: "closed" }));
    await openDetail();
    click("Não é do centro");
    set("Texto da resposta", "x".repeat(9));
    await send();
    expect(api.declineDemand).not.toHaveBeenCalled();
    set("Texto da resposta", "x".repeat(10));
    await send();
    await waitFor(() => expect(api.declineDemand).toHaveBeenCalledWith("dm1", { text: "x".repeat(10), expected_version: 1 }));
  });

  it("prorrogar: motivo 10–4000; already_extended mostra a frase", async () => {
    mocked(api.extendDemand).mockRejectedValue(err(422, { error: "already_extended" }));
    await openDetail();
    click("Prorrogar prazo");
    set("Motivo", "curto");
    await send();
    expect(api.extendDemand).not.toHaveBeenCalled();
    set("Motivo", "Aguardando o proprietário do imóvel");
    await send();
    await waitFor(() => expect(api.extendDemand).toHaveBeenCalledWith("dm1", { reason: "Aguardando o proprietário do imóvel", expected_version: 1 }));
    await screen.findByText(/prorrogação já foi usada/);
  });

  it("409 forwarding_changed: frase e uma releitura, sem reenviar", async () => {
    mocked(api.closeDemand).mockRejectedValue(err(409, { error: "forwarding_changed" }));
    await openDetail();
    const before = mocked(api.getDemand).mock.calls.length;
    click("Encerrar");
    set("Desfecho", "resolved");
    set("Texto da resposta", TEXT20);
    await send();
    await screen.findByText(/encaminhamento mudou/);
    await waitFor(() => expect(mocked(api.getDemand).mock.calls.length).toBe(before + 1));
    expect(api.closeDemand).toHaveBeenCalledTimes(1);
  });

  it("encaminhamento já respondido: nenhuma ação", async () => {
    mocked(api.getDemand).mockResolvedValue(demandDetail({ state: "closed", forwarding_state: "replied" }));
    await openDetail();
    expect(screen.queryByRole("button", { name: "Encerrar" })).toBeNull();
  });

  it("ouvidoria desligada: frase fixa, sem leitura; 403 do api também", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "zoonoses_team" ], ZOO_FEATURES));
    view();
    await screen.findByText(ZOONOSES_OMBUDSMAN_DISABLED);
    expect(api.listDemands).not.toHaveBeenCalled();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "zoonoses_team" ], FEATURES));
    mocked(api.listDemands).mockRejectedValue(err(403, { error: "feature_disabled", feature: "ombudsman" }));
    view();
    await screen.findByText(ZOONOSES_OMBUDSMAN_DISABLED);
  });
  it("Abertas lê open, scheduled e inspected; Carregar mais avança o cursor de cada estado e mantém a ordem global", async () => {
    mocked(api.listDemands).mockImplementation(async ({ state, before }: { state?: string; before?: string | null }) => {
      if (state === "open") return before ? { items: [ demand({ id: "o2", due_on: "2026-12-05" }) ], next_before: null } : { items: [ demand({ id: "o1", due_on: "2026-12-01" }) ], next_before: "co" };
      if (state === "scheduled") return before ? { items: [ demand({ id: "s2", state: "scheduled", due_on: "2026-11-27" }) ], next_before: null } : { items: [ demand({ id: "s1", state: "scheduled", due_on: "2026-12-03" }) ], next_before: "cs" };
      return { items: [], next_before: null };
    });
    const { container } = view();
    await screen.findByRole("button", { name: "Carregar mais" });
    expect(mocked(api.listDemands).mock.calls.map((c) => c[0].state).sort()).toEqual([ "inspected", "open", "scheduled" ]);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull());
    const calls = mocked(api.listDemands).mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ state: "open", before: "co" });
    expect(calls).toContainEqual({ state: "scheduled", before: "cs" });
    expect(calls.filter((c) => c.state === "inspected")).toHaveLength(1);
    const dues = [ ...container.querySelectorAll("[role=row], tr") ].map((r) => /(\d{2}\/\d{2})/.exec(r.textContent ?? "")?.[1]).filter(Boolean);
    expect(dues).toEqual([ "27/11", "01/12", "03/12", "05/12" ]);
  });

  it("409 demand_changed: frase e uma releitura, sem reenviar", async () => {
    mocked(api.declineDemand).mockRejectedValue(err(409, { error: "demand_changed" }));
    await openDetail();
    const before = mocked(api.getDemand).mock.calls.length;
    click("Não é do centro");
    set("Texto da resposta", "x".repeat(10));
    await send();
    await screen.findByText(/demanda mudou/);
    await waitFor(() => expect(mocked(api.getDemand).mock.calls.length).toBe(before + 1));
    expect(api.declineDemand).toHaveBeenCalledTimes(1);
  });

  it("duplo clique em Enviar envia uma vez", async () => {
    let release: (v: unknown) => void = () => {};
    mocked(api.closeDemand).mockReturnValue(new Promise((r) => { release = r; }));
    await openDetail();
    click("Encerrar");
    set("Desfecho", "resolved");
    set("Texto da resposta", TEXT20);
    const b = await screen.findByRole("button", { name: "Enviar" });
    fireEvent.click(b);
    fireEvent.click(b);
    release(demandDetail({ state: "closed" }));
    await waitFor(() => expect(api.closeDemand).toHaveBeenCalledTimes(1));
  });

  it("desfecho de código desconhecido aparece cru; ações ficam visíveis e desabilitadas enquanto relê", async () => {
    mocked(api.getDemand).mockResolvedValue(demandDetail({ state: "closed", forwarding_state: "replied", outcome: "novo_codigo" as never }));
    await openDetail();
    expect(screen.getByText(/novo_codigo/)).not.toBeNull();
  });

  it("depois de sair do detalhe nada dele fica no cache", async () => {
    const { client } = await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await waitFor(() => expect(screen.queryByText("Rua das Palmeiras, 45")).toBeNull());
    expect(client.getQueryCache().getAll().some((q) => q.queryKey[0] === "zooDemand")).toBe(false);
  });

});
