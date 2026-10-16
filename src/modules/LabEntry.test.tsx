import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), getLabEntry: vi.fn(), enterLabResults: vi.fn(), listLabEntryItems: vi.fn() };
});

import * as api from "../lib/api";
import { LabEntry } from "./LabEntry";
import { renderWithProviders } from "../test/campaignFixtures";
import { glucoseEntry, labContext, labEntryListItem, labResultRow, labUser, lipidEntry } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

async function scan(code: string) {
  const input = await screen.findByLabelText("Etiqueta do tubo");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getLabContext, api.getLabEntry, api.enterLabResults, api.listLabEntryItems ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
  mocked(api.getLabContext).mockResolvedValue(labContext());
  mocked(api.listLabEntryItems).mockResolvedValue([
    labEntryListItem(), labEntryListItem({ item_id: "it3", sigtap_code: "0202010295", name: "Colesterol total e frações" })
  ]);
  mocked(api.getLabEntry).mockImplementation(async (by: unknown) => {
    const b = by as { sigtapCode?: string; itemId?: string };
    if (b.sigtapCode === "0202010295" || b.itemId === "it3") return [ lipidEntry() ];
    return [ glucoseEntry() ];
  });
});

describe("LabEntry", () => {
  it("a leitura lista os exames da amostra; escolher um abre o formulário pela etiqueta e o código SIGTAP", async () => {
    renderWithProviders(<LabEntry />);
    await scan("0000012301");
    await waitFor(() => expect(api.listLabEntryItems).toHaveBeenCalledWith("0000012301"));
    expect(await screen.findByText("0000012301 · 2 exames nesta amostra")).not.toBeNull();
    expect(api.getLabEntry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Colesterol total e frações" }));
    expect(await screen.findByLabelText("Colesterol total (mg/dL)")).not.toBeNull();
    expect(api.getLabEntry).toHaveBeenCalledWith({ barcode: "0000012301", sigtapCode: "0202010295" });
  });

  it("etiqueta que não existe: mostra a mensagem do api e não abre nada", async () => {
    mocked(api.listLabEntryItems).mockRejectedValue(new api.ApiError(404, { error: "not_found" }, "x"));
    renderWithProviders(<LabEntry />);
    await scan("0000012301");
    expect(await screen.findByText(/^0000012301 · /)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Glicose" })).toBeNull();
  });

  it("sem exame para digitar: diz e não abre nada", async () => {
    mocked(api.listLabEntryItems).mockResolvedValue([]);
    renderWithProviders(<LabEntry />);
    await scan("0000012301");
    expect(await screen.findByText("0000012301 · nenhum exame para digitar nesta amostra")).not.toBeNull();
  });

  it("clique rápido em dois exames: só o primeiro abre enquanto carrega", async () => {
    let finish: (v: unknown) => void = () => undefined;
    mocked(api.getLabEntry).mockReturnValueOnce(new Promise((r) => { finish = r; }));
    renderWithProviders(<LabEntry />);
    await scan("0000012301");
    fireEvent.click(await screen.findByRole("button", { name: "Glicose" }));
    fireEvent.click(screen.getByRole("button", { name: "Colesterol total e frações" }));
    expect(api.getLabEntry).toHaveBeenCalledTimes(1);
    finish([ glucoseEntry() ]);
    expect(await screen.findByLabelText("Glicose (mg/dL)")).not.toBeNull();
    expect(screen.queryByLabelText("Colesterol total (mg/dL)")).toBeNull();
  });

  it("salvar relê o item pelo id; falha ao reler não desfaz o salvar", async () => {
    mocked(api.enterLabResults).mockResolvedValue([ labResultRow() ]);
    renderWithProviders(<LabEntry />);
    await scan("0000012301");
    fireEvent.click(await screen.findByRole("button", { name: "Glicose" }));
    fireEvent.change(await screen.findByLabelText("Glicose (mg/dL)"), { target: { value: "90" } });
    mocked(api.getLabEntry).mockRejectedValue(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    expect(await screen.findByText("Resultado salvo.")).not.toBeNull();
    await waitFor(() => expect(api.getLabEntry).toHaveBeenCalledWith({ itemId: "it2" }));
    expect(await screen.findByText(/resultado salvo, mas não foi possível reler/)).not.toBeNull();
  });

  it("salvar que falha (invalid_transition) não diz 'resultado salvo' nem se a releitura falhar", async () => {
    mocked(api.enterLabResults).mockRejectedValue(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<LabEntry />);
    await scan("0000012301");
    fireEvent.click(await screen.findByRole("button", { name: "Glicose" }));
    fireEvent.change(await screen.findByLabelText("Glicose (mg/dL)"), { target: { value: "90" } });
    mocked(api.getLabEntry).mockRejectedValue(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    await waitFor(() => expect(api.getLabEntry).toHaveBeenCalledWith({ itemId: "it2" }));
    expect(await screen.findByText(/não foi possível reler o exame/)).not.toBeNull();
    expect(screen.queryByText(/resultado salvo/)).toBeNull();
    expect(screen.queryByText("Resultado salvo.")).toBeNull();
  });
});
