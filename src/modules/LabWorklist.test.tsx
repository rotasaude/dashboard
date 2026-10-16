import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listWorklist: vi.fn(), fetchWorklistPdf: vi.fn(), getLabEntry: vi.fn(), enterLabResults: vi.fn() };
});

import * as api from "../lib/api";
import { LabWorklist } from "./LabWorklist";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW21B, glucoseEntry, labResultRow, labContext, labUser } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ITEM = { item_id: "it2", requisition_id: "rq1", requisition_number: "20260123", barcode: "1000000005",
  patient_display_name: "Joana Lima", sigtap_code: "0202010473", label: "Glicose", urgent: true,
  received_at: "2026-10-15T08:00:00-03:00", status: "pending" };
const GROUP = "Bioquímica · bancada B1";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21B));
  for (const fn of [ api.fetchCurrentSession, api.getLabContext, api.listWorklist, api.fetchWorklistPdf, api.getLabEntry, api.enterLabResults ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
  mocked(api.getLabContext).mockResolvedValue(labContext());
  mocked(api.listWorklist).mockResolvedValue([ { sector: "biochemistry", bench: "B1", items: [ ITEM ] } ]);
  mocked(api.fetchWorklistPdf).mockResolvedValue({ blob: new Blob([ "%PDF" ]), filename: null });
  mocked(api.getLabEntry).mockResolvedValue([ glucoseEntry() ]);
  vi.spyOn(window, "open").mockReturnValue({ location: { href: "" }, close: vi.fn(), opener: null } as unknown as Window);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:x") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

describe("LabWorklist", () => {
  it("abre com hoje e só pendentes; agrupa por setor e bancada", async () => {
    renderWithProviders(<LabWorklist />);
    const group = await screen.findByRole("region", { name: GROUP });
    expect(within(group).getByText("20260123")).not.toBeNull();
    expect(within(group).getByText("urgente")).not.toBeNull();
    expect(api.listWorklist).toHaveBeenCalledWith({ providerId: "pv9", date: "2026-10-15", pending: true });
  });

  it("filtros vão para a consulta e o PDF usa os mesmos", async () => {
    renderWithProviders(<LabWorklist />);
    await screen.findByRole("region", { name: GROUP });
    fireEvent.change(screen.getByLabelText("Setor"), { target: { value: "hematology" } });
    fireEvent.change(screen.getByLabelText("Bancada"), { target: { value: "H2" } });
    fireEvent.click(screen.getByLabelText("Só urgentes"));
    const q = { providerId: "pv9", sector: "hematology", bench: "H2", urgent: true, date: "2026-10-15", pending: true };
    await waitFor(() => expect(api.listWorklist).toHaveBeenLastCalledWith(q));
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF do mapa" }));
    await waitFor(() => expect(api.fetchWorklistPdf).toHaveBeenCalledWith(q));
  });

  it("digitar pelo mapa abre o formulário do item", async () => {
    renderWithProviders(<LabWorklist />);
    const group = await screen.findByRole("region", { name: GROUP });
    fireEvent.click(within(group).getByRole("button", { name: "Digitar" }));
    await waitFor(() => expect(api.getLabEntry).toHaveBeenCalledWith({ itemId: "it2" }));
    expect(await screen.findByLabelText("Glicose (mg/dL)")).not.toBeNull();
  });

  it("o liberador vê o mapa, sem digitar", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_releaser" ]));
    renderWithProviders(<LabWorklist />);
    const group = await screen.findByRole("region", { name: GROUP });
    expect(within(group).queryByRole("button", { name: "Digitar" })).toBeNull();
  });

  it("duplo clique em Digitar consulta uma vez só", async () => {
    let resolve!: (v: unknown) => void;
    mocked(api.getLabEntry).mockReturnValue(new Promise((r) => { resolve = r; }));
    renderWithProviders(<LabWorklist />);
    const group = await screen.findByRole("region", { name: GROUP });
    const btn = within(group).getByRole("button", { name: "Digitar" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    resolve([ glucoseEntry() ]);
    expect(await screen.findByLabelText("Glicose (mg/dL)")).not.toBeNull();
    expect(api.getLabEntry).toHaveBeenCalledTimes(1);
  });

  it("o liberador nunca chama getLabEntry", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_releaser" ]));
    renderWithProviders(<LabWorklist />);
    await screen.findByRole("region", { name: GROUP });
    expect(api.getLabEntry).not.toHaveBeenCalled();
  });

  it("falha ao abrir mostra a mensagem e some ao mudar filtro", async () => {
    mocked(api.getLabEntry).mockRejectedValue(new Error("boom"));
    renderWithProviders(<LabWorklist />);
    const group = await screen.findByRole("region", { name: GROUP });
    fireEvent.click(within(group).getByRole("button", { name: "Digitar" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByLabelText("Só urgentes"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("exame que sumiu avisa para atualizar o mapa", async () => {
    mocked(api.getLabEntry).mockResolvedValue([]);
    renderWithProviders(<LabWorklist />);
    const group = await screen.findByRole("region", { name: GROUP });
    fireEvent.click(within(group).getByRole("button", { name: "Digitar" }));
    expect(await screen.findByText(/não está mais para digitar/)).not.toBeNull();
  });

  it("falha do PDF mostra a mensagem", async () => {
    mocked(api.fetchWorklistPdf).mockRejectedValue(new Error("boom"));
    renderWithProviders(<LabWorklist />);
    await screen.findByRole("region", { name: GROUP });
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF do mapa" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
  });

  async function openAndSave() {
    mocked(api.enterLabResults).mockResolvedValue([ labResultRow() ]);
    renderWithProviders(<LabWorklist />);
    const group = await screen.findByRole("region", { name: GROUP });
    fireEvent.click(within(group).getByRole("button", { name: "Digitar" }));
    fireEvent.change(await screen.findByLabelText("Glicose (mg/dL)"), { target: { value: "90" } });
  }

  it("depois de salvar relê o item e o mapa", async () => {
    await openAndSave();
    const before = mocked(api.listWorklist).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    expect(await screen.findByText("Resultado salvo.")).not.toBeNull();
    await waitFor(() => expect(api.getLabEntry).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocked(api.listWorklist).mock.calls.length).toBeGreaterThan(before));
  });

  it("falha ao reler depois de salvar diz que o resultado foi salvo", async () => {
    await openAndSave();
    mocked(api.getLabEntry).mockRejectedValue(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    expect(await screen.findByText(/resultado salvo, mas não foi possível reler/)).not.toBeNull();
  });

  it("invalid_transition não diz 'resultado salvo'", async () => {
    await openAndSave();
    mocked(api.enterLabResults).mockRejectedValue(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    mocked(api.getLabEntry).mockRejectedValue(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    expect(await screen.findByText(/não foi possível reler o exame/)).not.toBeNull();
    expect(screen.queryByText(/resultado salvo, mas/)).toBeNull();
  });
});
