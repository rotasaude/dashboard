import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), enterLabResults: vi.fn() };
});

import * as api from "../../lib/api";
import { ResultEntryForm, referenceText } from "./ResultEntryForm";
import { renderWithProviders } from "../../test/campaignFixtures";
import { glucoseEntry, labResultRow, labUser, lipidEntry } from "../../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(labUser([ "lab_staff" ]));
  mocked(api.enterLabResults).mockReset().mockResolvedValue([ labResultRow() ]);
});

describe("ResultEntryForm", () => {
  it("referência da faixa aplicável, prévia da marca e vírgula convertida no envio", async () => {
    const onSaved = vi.fn();
    renderWithProviders(<ResultEntryForm item={glucoseEntry()} onSaved={onSaved} onClose={vi.fn()} />);
    const field = await screen.findByLabelText("Glicose (mg/dL)");
    expect(screen.getByText("referência 70 a 99 mg/dL · limite de digitação 10 a 1500")).not.toBeNull();
    fireEvent.change(field, { target: { value: "120,5" } });
    expect(screen.getByText("alto")).not.toBeNull();
    fireEvent.change(field, { target: { value: "450" } });
    expect(screen.getByText("crítico alto")).not.toBeNull();
    fireEvent.change(field, { target: { value: "98,0" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    await waitFor(() => expect(api.enterLabResults).toHaveBeenCalledWith({ item_id: "it2", values: [ { analyte_key: "glicose", value: "98.0" } ] }));
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText("Resultado salvo.")).not.toBeNull();
    expect((screen.getByLabelText("Glicose (mg/dL)") as HTMLInputElement).value).toBe("");
  });

  it("crítico no limite é crítico (B27) e o limite da faixa é normal", async () => {
    renderWithProviders(<ResultEntryForm item={glucoseEntry()} onSaved={vi.fn()} onClose={vi.fn()} />);
    const field = await screen.findByLabelText("Glicose (mg/dL)");
    fireEvent.change(field, { target: { value: "400" } });
    expect(screen.getByText("crítico alto")).not.toBeNull();
    fireEvent.change(field, { target: { value: "99" } });
    expect(screen.queryByText("alto")).toBeNull();
  });

  it("422 invalid_values: frase própria e marca o componente calculado", async () => {
    mocked(api.enterLabResults).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_values", analyte_key: "glicose" }, "x"));
    renderWithProviders(<ResultEntryForm item={glucoseEntry()} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Glicose (mg/dL)"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    expect((await screen.findByRole("alert")).textContent).toBe("falta um valor que entra no cálculo de um componente calculado — digite os componentes da conta juntos");
    expect(screen.getByText("falta um valor da conta deste componente — digite os componentes juntos")).not.toBeNull();
  });

  it("bloqueia fora do limite sem chamar o api", async () => {
    renderWithProviders(<ResultEntryForm item={glucoseEntry()} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Glicose (mg/dL)"), { target: { value: "1600" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    expect(screen.getByRole("alert").textContent).toBe("corrija os valores marcados");
    expect(screen.getByText("fora do limite de digitação (10 a 1500 mg/dL) — confira o valor")).not.toBeNull();
    expect(api.enterLabResults).not.toHaveBeenCalled();
  });

  it("422 out_of_entry_range: marca o componente e mantém os valores", async () => {
    mocked(api.enterLabResults).mockRejectedValueOnce(new api.ApiError(422, { error: "out_of_entry_range", analyte_key: "glicose" }, "x"));
    renderWithProviders(<ResultEntryForm item={glucoseEntry()} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Glicose (mg/dL)"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    expect((await screen.findByRole("alert")).textContent).toBe("valor fora do limite de digitação — confira");
    expect(screen.getByText("fora do limite de digitação da versão atual — confira")).not.toBeNull();
    expect((screen.getByLabelText("Glicose (mg/dL)") as HTMLInputElement).value).toBe("900");
  });

  it("calculado não se digita; nada digitado não envia", async () => {
    renderWithProviders(<ResultEntryForm item={lipidEntry()} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("Não-HDL (calculado) · calculado ao salvar")).not.toBeNull();
    expect(screen.queryByLabelText("Não-HDL (calculado) (mg/dL)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    expect(screen.getByRole("alert").textContent).toBe("digite ao menos um valor");
  });

  it("repetições: histórico com a origem e qual vale (effective, não chosen)", async () => {
    const item = glucoseEntry({ results: [
      labResultRow({ id: "r1", value: "410", flag: "critical_high", source: "hl7", chosen: true, effective: false, entered_by: null }),
      labResultRow({ id: "r2", value: "405", flag: "critical_high", source: "typed", chosen: false, effective: true })
    ] });
    renderWithProviders(<ResultEntryForm item={item} onSaved={vi.fn()} onClose={vi.fn()} />);
    const hist = await screen.findByRole("list", { name: "valores de Glicose" });
    const lines = within(hist).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines[0]).toContain("410 mg/dL");
    expect(lines[0]).toContain("aparelho");
    expect(lines[0]).not.toContain("vale");
    expect(lines[1]).toContain("vale");
  });

  it("item com laudo liberado avisa que o valor novo só vale numa retificação", async () => {
    renderWithProviders(<ResultEntryForm item={glucoseEntry({ status: "released" })} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("laudo já liberado — o valor novo só entra numa retificação")).not.toBeNull();
  });

  it("clique repetido durante o salvar grava uma vez só", async () => {
    let finish: (v: unknown) => void = () => undefined;
    mocked(api.enterLabResults).mockReturnValue(new Promise((r) => { finish = r; }));
    renderWithProviders(<ResultEntryForm item={glucoseEntry()} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Glicose (mg/dL)"), { target: { value: "90" } });
    const save = screen.getByRole("button", { name: /Salvar resultado/ });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(api.enterLabResults).toHaveBeenCalledTimes(1);
    finish([ labResultRow() ]);
    expect(await screen.findByText("Resultado salvo.")).not.toBeNull();
  });

  it("onSaved que falha depois de gravar não vira erro de salvar", async () => {
    const onSaved = vi.fn(() => { throw new Error("reload"); });
    renderWithProviders(<ResultEntryForm item={glucoseEntry()} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Glicose (mg/dL)"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar resultado" }));
    expect(await screen.findByText("Resultado salvo.")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("referência em texto quando a faixa não tem números", () => {
    expect(referenceText({ ...glucoseEntry().analytes[0], reference: { low: null, high: null, text: "negativo" }, entry_min: null, entry_max: null })).toBe("referência negativo");
  });
});
