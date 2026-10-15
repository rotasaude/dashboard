// src/modules/LabShipments.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listActiveUnits: vi.fn(), createShipment: vi.fn(), sendShipment: vi.fn(),
    listShipments: vi.fn(), receiveShipment: vi.fn(), listUnitPending: vi.fn(), fetchLabLabels: vi.fn() };
});

import * as api from "../lib/api";
import { LabShipments } from "./LabShipments";
import { renderWithProviders } from "../test/campaignFixtures";
import { UBS21B, labContext, labSample, labShipment, labUser } from "../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const read = (label: string, code: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  localStorage.clear();
  for (const fn of [ api.fetchCurrentSession, api.getLabContext, api.listActiveUnits, api.createShipment, api.sendShipment, api.listShipments,
    api.receiveShipment, api.listUnitPending, api.fetchLabLabels ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "health_professional" ]));
  mocked(api.getLabContext).mockResolvedValue(labContext());
  mocked(api.listActiveUnits).mockResolvedValue([ UBS21B ]);
  mocked(api.listShipments).mockResolvedValue([]);
  mocked(api.listUnitPending).mockResolvedValue({ recollections: [], not_received: [] });
  mocked(api.createShipment).mockResolvedValue(labShipment({ status: "open", sent_at: null }));
  mocked(api.sendShipment).mockResolvedValue(labShipment());
});

async function openUbs() {
  renderWithProviders(<LabShipments />);
  fireEvent.click(await screen.findByRole("button", { name: "UBS Centro" }));
  await screen.findByLabelText("Etiqueta do tubo para a remessa");
}

describe("LabShipments — UBS", () => {
  it("monta pela leitura (sem repetir), exige a temperatura e envia", async () => {
    await openUbs();
    read("Etiqueta do tubo para a remessa", "0000012301");
    read("Etiqueta do tubo para a remessa", "0000012302");
    read("Etiqueta do tubo para a remessa", "0000012303");
    expect(await screen.findByText("0000012303 · incluída")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tirar 0000012303" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar remessa (2)" }));
    expect(screen.getByRole("alert").textContent).toBe("informe a temperatura da caixa em °C");
    expect(api.createShipment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Temperatura da caixa (°C)"), { target: { value: "4,5" } });
    // o botão ainda termina de voltar do clique anterior (estado "ocupado")
    fireEvent.click(await screen.findByRole("button", { name: "Enviar remessa (2)" }));
    await waitFor(() => expect(api.createShipment).toHaveBeenCalledWith({
      origin_unit_id: "u1", provider_id: "pv9", barcodes: [ "0000012301", "0000012302" ], temperature_celsius: 4.5
    }));
    await waitFor(() => expect(api.sendShipment).toHaveBeenCalledWith("sh1"));
    expect(await screen.findByText("Remessa enviada com 2 amostras.")).not.toBeNull();
    // refreshLab depois da gravação: as listas da UBS são relidas
    await waitFor(() => expect(mocked(api.listUnitPending).mock.calls.length).toBeGreaterThan(1));
  });

  it("a mesma etiqueta lida de novo não entra duas vezes", async () => {
    await openUbs();
    read("Etiqueta do tubo para a remessa", "0000012301");
    await screen.findByText("0000012301 · incluída");
    // depois da janela de leitura dupla: o ScanField entrega, o montador recusa
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    read("Etiqueta do tubo para a remessa", "0000012301");
    expect(await screen.findByText("0000012301 · já está nesta remessa")).not.toBeNull();
  });

  it("422 com o código: diz qual amostra; envio que falha deixa a remessa montada para reenviar", async () => {
    mocked(api.createShipment).mockRejectedValueOnce(new api.ApiError(422, { error: "sample_not_collected", barcode: "0000012301" }, "x"));
    await openUbs();
    read("Etiqueta do tubo para a remessa", "0000012301");
    fireEvent.change(await screen.findByLabelText("Temperatura da caixa (°C)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar remessa (1)" }));
    expect((await screen.findByRole("alert")).textContent).toBe("0000012301: a amostra ainda não foi coletada");
    mocked(api.sendShipment).mockRejectedValueOnce(new Error("rede"));
    mocked(api.listShipments).mockResolvedValue([ labShipment({ status: "open", sent_at: null }) ]);
    fireEvent.click(await screen.findByRole("button", { name: "Enviar remessa (1)" }));
    expect(await screen.findByText(/remessa montada, mas não enviada/)).not.toBeNull();
    const open = await screen.findByRole("region", { name: "Remessas montadas" });
    fireEvent.click(within(open).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(api.sendShipment).toHaveBeenCalledTimes(2));
  });

  it("recoletas e amostras que não chegaram, com a etiqueta da recoleta", async () => {
    const pending = (over: object) => ({ ...labSample(over), requisition: { id: "rq1", number: "00000123", patient_display_name: "Joana Lima" } });
    mocked(api.listUnitPending).mockResolvedValue({
      recollections: [ pending({ id: "sa9", barcode: "0000012399", recollection_of_id: "sa2" }) ],
      not_received: [ pending({ id: "sa3", barcode: "0000012304", status: "not_received" }) ]
    });
    mocked(api.fetchLabLabels).mockResolvedValue({ blob: new Blob([ "%PDF" ]), filename: null });
    vi.spyOn(window, "open").mockReturnValue({ location: { href: "" }, close: vi.fn(), opener: null } as unknown as Window);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:x") });
    await openUbs();
    const rec = await screen.findByRole("region", { name: "Recoletas pedidas pelo laboratório" });
    expect(within(rec).getByText("Joana Lima")).not.toBeNull();
    fireEvent.click(within(rec).getByRole("button", { name: "Etiqueta" }));
    await waitFor(() => expect(api.fetchLabLabels).toHaveBeenCalledWith("rq1", [ "sa9" ]));
    const lost = screen.getByRole("region", { name: "Amostras que não chegaram ao laboratório" });
    expect(within(lost).getByText("0000012304")).not.toBeNull();
  });
});

describe("LabShipments — laboratório", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    mocked(api.listShipments).mockResolvedValue([ labShipment() ]);
    mocked(api.receiveShipment).mockResolvedValue(labShipment({ status: "received" }));
  });

  it("confere pela leitura; o que não foi lido vira 'não chegou' depois da confirmação", async () => {
    renderWithProviders(<LabShipments />);
    fireEvent.click(await screen.findByRole("button", { name: "Conferir" }));
    const check = await screen.findByRole("region", { name: "Conferência da remessa de UBS Centro" });
    read("Etiqueta do tubo recebido", "0000012301");
    read("Etiqueta do tubo recebido", "7777777777");
    expect(await within(check).findByText("7777777777 · não é desta remessa")).not.toBeNull();
    expect(within(check).getByText("1 de 2 lidas")).not.toBeNull();
    fireEvent.click(within(check).getByRole("button", { name: "Concluir conferência" }));
    expect(within(check).getByText("1 amostra não lida ficará como \"não chegou\" e a UBS será avisada. Concluir?")).not.toBeNull();
    fireEvent.click(within(check).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.receiveShipment).toHaveBeenCalledWith("sh1", [ "0000012301" ]));
    expect(await screen.findByText("Remessa conferida. Siga para o recebimento de cada amostra.")).not.toBeNull();
  });

  it("Concluir fica desabilitado enquanto há leitura na fila e a contagem sai depois dela", async () => {
    renderWithProviders(<LabShipments />);
    fireEvent.click(await screen.findByRole("button", { name: "Conferir" }));
    const check = await screen.findByRole("region", { name: "Conferência da remessa de UBS Centro" });
    read("Etiqueta do tubo recebido", "0000012301");
    // a leitura ainda está na fila: concluir agora contaria a amostra como "não chegou"
    expect(within(check).getByRole("button", { name: "Concluir conferência" }).getAttribute("aria-disabled")).toBe("true");
    await within(check).findByText("1 de 2 lidas");
    await waitFor(() => expect(within(check).getByRole("button", { name: "Concluir conferência" }).getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(within(check).getByRole("button", { name: "Concluir conferência" }));
    expect(within(check).getByText(/1 amostra não lida ficará/)).not.toBeNull();
  });

  it("falha ao reler as listas depois de conferir não vira erro de conferência", async () => {
    renderWithProviders(<LabShipments />);
    fireEvent.click(await screen.findByRole("button", { name: "Conferir" }));
    read("Etiqueta do tubo recebido", "0000012301");
    read("Etiqueta do tubo recebido", "0000012302");
    await screen.findByText("2 de 2 lidas");
    mocked(api.listShipments).mockRejectedValue(new Error("rede"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Concluir conferência" }).getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Concluir conferência" }));
    expect(await screen.findByText("Remessa conferida. Siga para o recebimento de cada amostra.")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("409: outra pessoa já conferiu — explica e relê a lista", async () => {
    mocked(api.receiveShipment).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<LabShipments />);
    fireEvent.click(await screen.findByRole("button", { name: "Conferir" }));
    read("Etiqueta do tubo recebido", "0000012301");
    read("Etiqueta do tubo recebido", "0000012302");
    // as leituras entram numa fila: só com as duas conferidas o botão deixa de pedir confirmação
    await screen.findByText("2 de 2 lidas");
    fireEvent.click(screen.getByRole("button", { name: "Concluir conferência" }));
    await waitFor(() => expect(api.receiveShipment).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toBe("a situação mudou — a tela foi atualizada");
    await waitFor(() => expect(api.listShipments).toHaveBeenCalledTimes(2));
  });
});
