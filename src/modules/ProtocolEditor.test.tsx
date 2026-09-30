// src/modules/ProtocolEditor.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, listAuthorProtocols: vi.fn(), loadProtocolDefinition: vi.fn(), gateProtocol: vi.fn(),
    previewProtocol: vi.fn(), saveProtocolDraft: vi.fn()
  };
});

import * as api from "../lib/api";
import { ProtocolEditor } from "./ProtocolEditor";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const DEF = {
  name: "arbovirose", version: 3, start_step_id: "febre",
  steps: [
    { id: "febre", prompt: "Teve febre?", answer_type: "boolean", branches: { true: "dias", false: null } },
    { id: "dias", prompt: "Há quantos dias?", answer_type: "integer", branches: {} }
  ]
};

const definitionBox = () => screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
const typeDefinition = (value: unknown) =>
  fireEvent.change(definitionBox(), { target: { value: JSON.stringify(value, null, 2) } });

describe("ProtocolEditor — Usar em Analytics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked(api.listAuthorProtocols).mockResolvedValue([]);
    mocked(api.gateProtocol).mockResolvedValue({ valid: true });
    mocked(api.saveProtocolDraft).mockResolvedValue({ name: "arbovirose", version: 3, status: "draft" });
  });

  it("marcar a caixa grava analytic: true no JSON da pergunta", () => {
    render(<ProtocolEditor />);
    typeDefinition(DEF);
    fireEvent.click(within(screen.getByRole("group", { name: "Teve febre?" })).getByLabelText("Usar em Analytics"));
    expect(JSON.parse(definitionBox().value).steps[0].analytic).toBe(true);
    expect(screen.queryByRole("group", { name: "Há quantos dias?" })).toBeNull();
  });

  it("desmarcar tira a chave do JSON", () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, steps: [ { ...DEF.steps[0], analytic: true }, DEF.steps[1] ] });
    fireEvent.click(within(screen.getByRole("group", { name: "Teve febre?" })).getByLabelText("Usar em Analytics"));
    expect("analytic" in JSON.parse(definitionBox().value).steps[0]).toBe(false);
  });

  it("pergunta que virou integer perde a marca ao salvar, com aviso antes", async () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, steps: [ { ...DEF.steps[0], answer_type: "integer", analytic: true }, DEF.steps[1] ] });
    expect(screen.getByRole("alert").textContent).toContain("“Teve febre?” não é de sim/não nem de lista");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.saveProtocolDraft).toHaveBeenCalledTimes(1));
    const sent = mocked(api.saveProtocolDraft).mock.calls[0][0] as { steps: Array<Record<string, unknown>> };
    expect("analytic" in sent.steps[0]).toBe(false);
    expect(definitionBox().value).not.toContain("analytic");
    expect(await screen.findByText("Salvo: arbovirose@3 (draft)")).toBeTruthy();
  });

  it("marca válida vai inteira no rascunho", async () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, steps: [ { ...DEF.steps[0], analytic: true }, DEF.steps[1] ] });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.saveProtocolDraft).toHaveBeenCalledTimes(1));
    expect((mocked(api.saveProtocolDraft).mock.calls[0][0] as { steps: Array<{ analytic?: boolean }> }).steps[0].analytic).toBe(true);
  });
});
