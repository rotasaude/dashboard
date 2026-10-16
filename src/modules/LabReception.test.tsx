// src/modules/LabReception.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), receiveSample: vi.fn(), listActiveRejectionReasons: vi.fn() };
});

vi.mock("../lib/lab", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/lab")>();
  return { ...real, refreshLab: vi.fn(real.refreshLab) };
});

import * as api from "../lib/api";
import * as lab from "../lib/lab";
import { LabReception } from "./LabReception";
import { renderWithProviders } from "../test/campaignFixtures";
import { labContext, labSample, labUser } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const CODE = "0000012301";
const read = (code: string) => {
  const input = screen.getByLabelText("Etiqueta do tubo");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getLabContext, api.receiveSample, api.listActiveRejectionReasons ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
  mocked(api.getLabContext).mockResolvedValue(labContext());
  mocked(api.listActiveRejectionReasons).mockResolvedValue([ { id: "rr1", provider_id: "pv9", name: "hemolisada", active: true } ]);
  mocked(api.receiveSample).mockResolvedValue({ sample: { ...labSample({ status: "received" }), requisition_number: "00000123" }, recollection: null });
});

describe("LabReception", () => {
  it("aceitar é o padrão: a leitura aceita", async () => {
    renderWithProviders(<LabReception />);
    await screen.findByLabelText("Etiqueta do tubo");
    read(CODE);
    await waitFor(() => expect(api.receiveSample).toHaveBeenCalledWith({ barcode: CODE, decision: "accept" }));
    expect(await screen.findByText(`${CODE} · aceita · requisição 00000123`)).not.toBeNull();
    expect(lab.refreshLab).toHaveBeenCalled();
  });

  it("rejeitar sem motivo não chama o api; com motivo, avisa a recoleta", async () => {
    mocked(api.receiveSample).mockResolvedValue({
      sample: { ...labSample({ status: "rejected" }), requisition_number: "00000123" }, recollection: labSample({ id: "sa9", barcode: "0000012399" })
    });
    renderWithProviders(<LabReception />);
    fireEvent.click(await screen.findByLabelText("Rejeitar"));
    read(CODE);
    expect(await screen.findByText(`${CODE} · escolha o motivo da rejeição antes de ler`)).not.toBeNull();
    expect(api.receiveSample).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByLabelText("Motivo da rejeição"), { target: { value: "rr1" } });
    read(CODE);
    await waitFor(() => expect(api.receiveSample).toHaveBeenCalledWith({ barcode: CODE, decision: "reject", reason_id: "rr1" }));
    expect(await screen.findByText(`${CODE} · rejeitada · recoleta 0000012399 pedida à UBS de origem`)).not.toBeNull();
  });

  it("aceitar com restrição leva a nota que vai ao laudo; sem nota não chama o api", async () => {
    renderWithProviders(<LabReception />);
    fireEvent.click(await screen.findByLabelText("Aceitar com restrição"));
    read(CODE);
    expect(await screen.findByText(`${CODE} · escreva a restrição antes de ler`)).not.toBeNull();
    expect(api.receiveSample).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Restrição (vai ao laudo)"), { target: { value: "  lipêmica " } });
    read(CODE);
    await waitFor(() => expect(api.receiveSample).toHaveBeenCalledWith({
      barcode: CODE, decision: "accept_with_restriction", restriction_note: "lipêmica"
    }));
    expect(await screen.findByText(`${CODE} · aceita com restrição · requisição 00000123`)).not.toBeNull();
  });

  it("409: amostra já recebida ou fora de trânsito tem frase própria", async () => {
    mocked(api.receiveSample).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<LabReception />);
    await screen.findByLabelText("Etiqueta do tubo");
    read(CODE);
    expect(await screen.findByText(`${CODE} · esta amostra já foi recebida, rejeitada ou ainda não foi coletada`)).not.toBeNull();
  });

  it("404 e erros do api têm mensagem própria (labError)", async () => {
    mocked(api.receiveSample).mockRejectedValueOnce(new api.ApiError(404, { error: "not_found" }, "x"));
    renderWithProviders(<LabReception />);
    await screen.findByLabelText("Etiqueta do tubo");
    read(CODE);
    expect(await screen.findByText(`${CODE} · etiqueta ou requisição não encontrada — confira o código`)).not.toBeNull();
  });

  it("falha ao reler as listas depois de receber não vira falha do recebimento", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    renderWithProviders(<LabReception />);
    await screen.findByLabelText("Etiqueta do tubo");
    mocked(lab.refreshLab).mockRejectedValueOnce(new Error("rede"));
    read(CODE);
    expect(await screen.findByText(`${CODE} · aceita · requisição 00000123`)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  it("a decisão não troca enquanto há leitura em andamento", async () => {
    let finish: (v: unknown) => void = () => undefined;
    mocked(api.receiveSample).mockReturnValueOnce(new Promise((r) => { finish = r; }));
    renderWithProviders(<LabReception />);
    await screen.findByLabelText("Etiqueta do tubo");
    read(CODE);
    await waitFor(() => expect((screen.getByLabelText("Rejeitar") as HTMLInputElement).disabled).toBe(true));
    finish({ sample: { ...labSample({ status: "received" }), requisition_number: "00000123" }, recollection: null });
    await waitFor(() => expect((screen.getByLabelText("Rejeitar") as HTMLInputElement).disabled).toBe(false));
  });

  it("a UBS não recebe", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "health_professional" ]));
    renderWithProviders(<LabReception />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
  });
});
