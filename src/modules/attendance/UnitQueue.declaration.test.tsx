// src/modules/attendance/UnitQueue.declaration.test.tsx
// Módulo 19c: declaração de comparecimento emitida pela recepção, pelo atendimento.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listUnitQueue: vi.fn(), issueAttendanceDeclaration: vi.fn(), fetchDocumentPdf: vi.fn(),
    listAttendanceDeclarations: vi.fn(), listUnitDeclarations: vi.fn(), cancelDocument: vi.fn() };
});
vi.mock("../consultation/ConsultationWorkspace", () => ({ ConsultationWorkspace: () => null }));

import * as api from "../../lib/api";
import { ApiError, type QueueRow } from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { UnitQueue } from "./UnitQueue";
import { NOW19C, declRow, declarationDoc, docUser } from "../../test/documentFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
let win: { location: { href: string }; close: ReturnType<typeof vi.fn> };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function row(over: Partial<QueueRow>): QueueRow {
  return { id: "a1", cpf_masked: "***.982.247-**", checked_in_at: "2026-10-09T09:20:00-03:00", protocol_name: null, priority: null,
    source: "triage", appointment_time: null, called_at: null, called_by_name: null, screening: null, display_name: "Joana Lima", ...over };
}
const waitingRow = row({});
const inCareRow = row({ id: "a3", display_name: "Carlos Souza", called_at: "2026-10-09T09:50:00-03:00", called_by_name: "Dra. Helena" });

function renderQueue(clinicalDocuments = true, professional = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<UnitQueue unit={unit} units={[ unit ]} canCare={false} clinicalRecord clinicalDocuments={clinicalDocuments} professional={professional} />, { wrapper });
  return client;
}
const section = async (title: string) => (await screen.findByText(title)).parentElement as HTMLElement;

describe("UnitQueue — declaração de comparecimento (19c)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW19C));
    for (const fn of [ api.fetchCurrentSession, api.listUnitQueue, api.issueAttendanceDeclaration, api.fetchDocumentPdf,
      api.listAttendanceDeclarations, api.listUnitDeclarations, api.cancelDocument ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "citizen_verifier" ], { id: "us5", email_address: "recepcao@curitiba.demo" }));
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ waitingRow ], in_care: [ inCareRow ] });
    mocked(api.issueAttendanceDeclaration).mockResolvedValue(declarationDoc({ id: "doc3", consultation_id: null, attendance_id: "a1" }));
    mocked(api.listAttendanceDeclarations).mockResolvedValue([]);
    mocked(api.listUnitDeclarations).mockResolvedValue([]);
    mocked(api.fetchDocumentPdf).mockResolvedValue({ blob: new Blob([ "%PDF" ], { type: "application/pdf" }), filename: null });
    win = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockImplementation(() => win as unknown as Window);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:doc3") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("recepção: Declaração nas duas listas; emite pelo atendimento com a chegada e a matrícula, e imprime", async () => {
    renderQueue();
    const inCare = await section("Em atendimento");
    expect(within(inCare).getByRole("button", { name: "Declaração" })).not.toBeNull();
    expect(within(inCare).queryByRole("button", { name: "Encerrar" })).toBeNull();
    const waiting = await section("Aguardando");
    fireEvent.click(within(waiting).getByRole("button", { name: "Declaração" }));
    const panel = screen.getByRole("region", { name: "Declaração de comparecimento do atendimento" });
    expect(within(panel).getByText("Joana Lima · chegou às 09:20")).not.toBeNull();
    expect((within(panel).getByLabelText("Chegada") as HTMLInputElement).value).toBe("09:20");
    fireEvent.change(within(panel).getByLabelText("Sua matrícula (sai no papel)"), { target: { value: "4521" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Emitir declaração" }));
    await waitFor(() => expect(api.issueAttendanceDeclaration).toHaveBeenCalledWith("a1",
      { arrived_at: "09:20", issuer_registration: "4521" }, "u1"));
    expect((await within(panel).findByRole("status")).textContent)
      .toBe("Documento emitido (Declaração de comparecimento) em modo papel: imprima e assine à mão.");
    expect(within(panel).getByText("D9W4N-7KC3M")).not.toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Imprimir" }));
    await waitFor(() => expect(win.location.href).toBe("blob:doc3"));
    expect(api.fetchDocumentPdf).toHaveBeenCalledWith("doc3", "u1");
  });

  it("a pessoa sai da fila enquanto a recepção preenche: o painel continua e emite", async () => {
    const client = renderQueue();
    fireEvent.click(within(await section("Aguardando")).getByRole("button", { name: "Declaração" }));
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: [ inCareRow ] });
    await client.invalidateQueries({ queryKey: [ "unitQueue", "u1" ] });
    expect(await screen.findByText("Ninguém aguardando")).not.toBeNull();
    const panel = screen.getByRole("region", { name: "Declaração de comparecimento do atendimento" });
    fireEvent.click(within(panel).getByRole("button", { name: "Emitir declaração" }));
    await waitFor(() => expect(api.issueAttendanceDeclaration).toHaveBeenCalledWith("a1", { arrived_at: "09:20" }, "u1"));
  });

  it("atendimento de mais de 30 dias: a frase diz e o formulário fica", async () => {
    mocked(api.issueAttendanceDeclaration).mockRejectedValue(new ApiError(409, { error: "attendance_not_found_or_closed_long_ago" }, "409"));
    renderQueue();
    fireEvent.click(within(await section("Aguardando")).getByRole("button", { name: "Declaração" }));
    fireEvent.click(screen.getByRole("button", { name: "Emitir declaração" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("atendimento não encontrado ou encerrado há mais de 30 dias — a declaração não sai mais por aqui");
    expect(screen.getByRole("form", { name: "Declaração de comparecimento" })).not.toBeNull();
  });

  it("sem clinical_documents: sem Declaração", async () => {
    renderQueue(false);
    const waiting = await section("Aguardando");
    expect(within(waiting).queryByRole("button", { name: "Declaração" })).toBeNull();
    expect(within(await section("Em atendimento")).queryByRole("button", { name: "Declaração" })).toBeNull();
  });

  it("profissional: não pede matrícula; sem vínculo na unidade (403 missing_role) a frase aparece", async () => {
    mocked(api.issueAttendanceDeclaration).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "403"));
    renderQueue(true, true);
    fireEvent.click(within(await section("Aguardando")).getByRole("button", { name: "Declaração" }));
    expect(screen.queryByLabelText("Sua matrícula (sai no papel)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Emitir declaração" }));
    expect((await screen.findByRole("alert")).textContent).toBe("seu papel não permite esta ação");
    expect(api.issueAttendanceDeclaration).toHaveBeenCalledWith("a1", { arrived_at: "09:20" }, "u1");
  });

  it("em voo: emitir e cancelar ficam travados e o duplo clique emite uma vez só", async () => {
    let resolve!: (d: ReturnType<typeof declarationDoc>) => void;
    mocked(api.issueAttendanceDeclaration).mockReturnValue(new Promise((r) => { resolve = r; }));
    renderQueue();
    fireEvent.click(within(await section("Aguardando")).getByRole("button", { name: "Declaração" }));
    const panel = screen.getByRole("region", { name: "Declaração de comparecimento do atendimento" });
    const emit = within(panel).getByRole("button", { name: "Emitir declaração" }) as HTMLButtonElement;
    fireEvent.click(emit);
    fireEvent.click(emit);
    await waitFor(() => expect(emit.disabled).toBe(true));
    expect((within(panel).getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.issueAttendanceDeclaration).toHaveBeenCalledTimes(1);
    resolve(declarationDoc({ id: "doc3", consultation_id: null, attendance_id: "a1" }));
    expect(await within(panel).findByRole("status")).not.toBeNull();
  });

  it("FC-13: o painel da declaração abre à vista e fecha com Escape", async () => {
    const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
    renderQueue();
    const waiting = await section("Aguardando");
    fireEvent.click(within(waiting).getByRole("button", { name: "Declaração" }));
    const panel = screen.getByRole("region", { name: "Declaração de comparecimento do atendimento" });
    expect(scroll).toHaveBeenCalled();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Declaração de comparecimento do atendimento" })).toBeNull();
  });

  describe("api#59: declarações já emitidas do atendimento", () => {
    const openPanel = async () => {
      fireEvent.click(within(await section("Aguardando")).getByRole("button", { name: "Declaração" }));
      return screen.getByRole("region", { name: "Declaração de comparecimento do atendimento" });
    };

    it("lista as do atendimento pela unidade: emitida com Reimprimir e Cancelar; cancelada sem botões", async () => {
      mocked(api.listAttendanceDeclarations).mockResolvedValue([
        declRow(), declRow({ id: "doc2", status: "cancelled", cancelled_at: "2026-10-09T09:35:00-03:00", short_code: "C4X7P-2MN8Q" })
      ]);
      renderQueue();
      const panel = await openPanel();
      const list = await within(panel).findByRole("list", { name: "Declarações deste atendimento" });
      await waitFor(() => expect(api.listAttendanceDeclarations).toHaveBeenCalledWith("a1", "u1"));
      const [ issued, cancelled ] = within(list).getAllByRole("listitem");
      expect(issued.textContent).toContain("09:40 · Marta Recepção · emitida");
      expect(within(issued).getByRole("button", { name: "Reimprimir" })).not.toBeNull();
      expect(within(issued).getByRole("button", { name: "Cancelar" })).not.toBeNull();
      expect(cancelled.textContent).toContain("cancelada");
      expect(within(cancelled).queryByRole("button")).toBeNull();
    });

    it("Reimprimir chama a impressão com o id e a unidade", async () => {
      mocked(api.listAttendanceDeclarations).mockResolvedValue([ declRow() ]);
      renderQueue();
      const panel = await openPanel();
      fireEvent.click(await within(panel).findByRole("button", { name: "Reimprimir" }));
      await waitFor(() => expect(api.fetchDocumentPdf).toHaveBeenCalledWith("doc3", "u1"));
    });

    it("Cancelar abre o motivo, cancela com a unidade e relê a lista", async () => {
      mocked(api.listAttendanceDeclarations).mockResolvedValue([ declRow() ]);
      mocked(api.cancelDocument).mockResolvedValue(declarationDoc({ status: "cancelled", cancelled_at: "2026-10-09T10:00:00-03:00" }));
      renderQueue();
      const panel = await openPanel();
      const list = await within(panel).findByRole("list", { name: "Declarações deste atendimento" });
      fireEvent.click(within(list).getByRole("button", { name: "Cancelar" }));
      fireEvent.change(await screen.findByLabelText("Motivo do cancelamento"), { target: { value: "horário de chegada errado" } });
      mocked(api.listAttendanceDeclarations).mockResolvedValue([ declRow({ status: "cancelled", cancelled_at: "2026-10-09T10:00:00-03:00" }) ]);
      fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
      await waitFor(() => expect(api.cancelDocument).toHaveBeenCalledWith("doc3", "horário de chegada errado", "u1"));
      await waitFor(() => expect(api.listAttendanceDeclarations).toHaveBeenCalledTimes(2));
      expect((await within(panel).findAllByRole("listitem"))[0].textContent).toContain("cancelada");
    });

    it("emitir uma nova relê a lista", async () => {
      renderQueue();
      const panel = await openPanel();
      await waitFor(() => expect(api.listAttendanceDeclarations).toHaveBeenCalledTimes(1));
      fireEvent.click(within(panel).getByRole("button", { name: "Emitir declaração" }));
      await within(panel).findByRole("status");
      await waitFor(() => expect(api.listAttendanceDeclarations).toHaveBeenCalledTimes(2));
    });

    it("atendimento de outra unidade: a frase manda trocar o seletor", async () => {
      mocked(api.issueAttendanceDeclaration).mockRejectedValue(new ApiError(422, { error: "attendance_outside_unit" }, "422"));
      renderQueue();
      const panel = await openPanel();
      fireEvent.click(within(panel).getByRole("button", { name: "Emitir declaração" }));
      expect((await within(panel).findByRole("alert")).textContent)
        .toBe("esta declaração é de um atendimento de outra unidade — troque a unidade no seletor");
    });
  });

  it("Declarações de hoje fica na fila quando os documentos estão ligados", async () => {
    renderQueue();
    expect(await screen.findByText("Declarações de hoje")).not.toBeNull();
  });
});
