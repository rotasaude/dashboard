import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listWorklist: vi.fn(), fetchWorklistPdf: vi.fn(), getLabEntry: vi.fn() };
});

import * as api from "../lib/api";
import { LabWorklist } from "./LabWorklist";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW21B, glucoseEntry, labContext, labUser } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ITEM = { item_id: "it2", requisition_id: "rq1", requisition_number: "20260123", barcode: "1000000005",
  patient_display_name: "Joana Lima", sigtap_code: "0202010473", label: "Glicose", urgent: true,
  received_at: "2026-10-15T08:00:00-03:00", status: "pending" };
const GROUP = "Bioquímica · bancada B1";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21B));
  for (const fn of [ api.fetchCurrentSession, api.getLabContext, api.listWorklist, api.fetchWorklistPdf, api.getLabEntry ]) mocked(fn).mockReset();
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
});
