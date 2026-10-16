import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), getLabEntry: vi.fn(), enterLabResults: vi.fn(),
    listLabRequisitions: vi.fn(), getLabRequisition: vi.fn()
  };
});

import * as api from "../lib/api";
import { LabEntry } from "./LabEntry";
import { renderWithProviders } from "../test/campaignFixtures";
import { glucoseEntry, labContext, labItem, labRequisition, labResultRow, labSample, labUser, lipidEntry } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const requisition = () => labRequisition({
  items: [
    labItem({ id: "it2", sigtap_code: "0202010473", label: "Glicose", sample_id: "sa1" }),
    labItem({ id: "it3", sigtap_code: "0202010295", label: "Colesterol total e frações", sample_id: "sa1" }),
    labItem({ id: "it9", sigtap_code: "0202020380", label: "Hemograma completo", sample_id: "sa9" })
  ],
  samples: [ labSample({ id: "sa1", barcode: "0000012301" }), labSample({ id: "sa9", barcode: "0000012309" }) ]
});

async function scan(code: string) {
  const input = await screen.findByLabelText("Etiqueta do tubo");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getLabContext, api.getLabEntry, api.enterLabResults, api.listLabRequisitions, api.getLabRequisition ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
  mocked(api.getLabContext).mockResolvedValue(labContext());
  const { items: _i, samples: _s, ...row } = requisition();
  mocked(api.listLabRequisitions).mockResolvedValue({ requisitions: [ row ], next_before: null });
  mocked(api.getLabRequisition).mockResolvedValue(requisition());
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
    await waitFor(() => expect(api.listLabRequisitions).toHaveBeenCalledWith(expect.objectContaining({ barcode: "0000012301" })));
    expect(await screen.findByText("0000012301 · 2 exames nesta amostra")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Hemograma completo" })).toBeNull();
    expect(api.getLabEntry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Colesterol total e frações" }));
    expect(await screen.findByLabelText("Colesterol total (mg/dL)")).not.toBeNull();
    expect(api.getLabEntry).toHaveBeenCalledWith({ barcode: "0000012301", sigtapCode: "0202010295" });
  });

  it("etiqueta que não existe: diz e não abre nada", async () => {
    mocked(api.listLabRequisitions).mockResolvedValue({ requisitions: [], next_before: null });
    renderWithProviders(<LabEntry />);
    await scan("0000012301");
    expect(await screen.findByText("0000012301 · etiqueta não encontrada")).not.toBeNull();
  });

  it("sem exame para digitar: diz e não abre nada", async () => {
    mocked(api.getLabRequisition).mockResolvedValue(labRequisition({ items: [], samples: [ labSample() ] }));
    renderWithProviders(<LabEntry />);
    await scan("0000012301");
    expect(await screen.findByText("0000012301 · nenhum exame para digitar nesta amostra")).not.toBeNull();
  });

  it("salvar relê o item pelo id; falha ao rereler não desfaz o salvar", async () => {
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
});
