// src/modules/consultation/ConsultationWorkspace.regulation.test.tsx
// Módulo 26a (F-26.2): a regulação no atendimento. O editor recebe `regulation` só com o portão e um CBO que pede;
// a autora lê a consulta finalizada com os pedidos (situação, "não enviado") e abre a guia por `blob:`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(), startConsultation: vi.fn(),
    getConsultation: vi.fn(), addAddendum: vi.fn(), getConsultationProblems: vi.fn(), listConsultationRegulationRequests: vi.fn(), fetchRegulationGuide: vi.fn() };
});
vi.mock("./ConsultationEditor", () => ({
  ConsultationEditor: (p: { regulation?: boolean; onFinalized(c: unknown): void }) => (
    <>
      <span>{`editor ${p.regulation ? "com" : "sem"} regulação`}</span>
      <button type="button" onClick={() => p.onFinalized({ ...finalized({ author: { id: "us1", name: "Dra. Helena Prado" } }),
        regulation_not_sent: [ { index: 0, id: "rr1", error: "cbo_not_allowed", path: "target_code" } ] })}>
        finalizar de mentira
      </button>
    </>
  )
}));

import * as api from "../../lib/api";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { consultation, finalized, options, problem, record } from "../../test/consultationFixtures";
import { regRequest } from "../../test/regulationFixtures";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

describe("ConsultationWorkspace — regulação (módulo 26a)", () => {
  beforeEach(() => {
    for (const fn of [ api.listConsultationRegulationRequests, api.fetchRegulationGuide, api.addAddendum ]) mocked(fn).mockReset();
    mocked(api.getAttendanceRecord).mockResolvedValue(record());
    mocked(api.getConsultationOptions).mockResolvedValue(options());
    mocked(api.getConsultationProblems).mockResolvedValue([ problem() ]);
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ regRequest({ status: "pending" }) ]);
  });
  const open = async (features: string[], cbo = "225142", started = consultation({ cbo_code: cbo })) => {
    mocked(api.startConsultation).mockResolvedValue(started);
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features }));
    renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={() => undefined} onFinalized={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
  };
  const author = { author: { id: "us1", name: "Dra. Helena Prado" } };

  it.each([
    [ [ "clinical_record", "care_regulation" ], "225142", "com" ], [ [ "clinical_record", "care_regulation" ], "223505", "com" ],
    [ [ "clinical_record", "care_regulation" ], "223208", "com" ], [ [ "clinical_record", "care_regulation" ], "322205", "sem" ],
    [ [ "clinical_record" ], "225142", "sem" ]
  ])("features %j, CBO %s: editor %s regulação", async (features, cbo, expected) => {
    await open(features, cbo);
    expect(await screen.findByText(`editor ${expected} regulação`)).not.toBeNull();
  });

  it("consulta finalizada da autora: pedidos com situação, aviso do adendo e a guia por blob", async () => {
    const win = { location: { href: "" }, close: vi.fn(), opener: {} };
    vi.stubGlobal("open", vi.fn(() => win));
    class FakeURL extends URL {}
    Object.assign(FakeURL, { createObjectURL: vi.fn(() => "blob:http://curitiba.localhost/g1"), revokeObjectURL: vi.fn() });
    vi.stubGlobal("URL", FakeURL);
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ regRequest({ status: "authorized" }) ]);
    mocked(api.fetchRegulationGuide).mockResolvedValue({ blob: new Blob([ "%PDF" ]), filename: "guia-regulacao-rr1.pdf" });
    await open([ "clinical_record", "care_regulation" ], "225142", finalized(author));
    expect(await screen.findByText(/vão para a regulação quando você registrar um adendo/)).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Guia em PDF" }));
    await waitFor(() => expect(win.location.href).toBe("blob:http://curitiba.localhost/g1"));
    expect(mocked(api.fetchRegulationGuide)).toHaveBeenCalledWith("rr1");
    // G8: nada de dado pessoal na URL da janela, que abre em branco e só depois recebe o blob.
    expect(vi.mocked(window.open)).toHaveBeenCalledWith("", "_blank");
  });

  it("guia: 404 vira 'guia não encontrada' na peça e a janela fecha; popup bloqueado diz o que fazer", async () => {
    const win = { location: { href: "" }, close: vi.fn(), opener: {} };
    const openSpy = vi.fn(() => win);
    vi.stubGlobal("open", openSpy);
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ regRequest({ status: "authorized" }) ]);
    mocked(api.fetchRegulationGuide).mockRejectedValue(new api.ApiError(404, { error: "not_found" }, "x"));
    await open([ "clinical_record", "care_regulation" ], "225142", finalized(author));
    fireEvent.click(await screen.findByRole("button", { name: "Guia em PDF" }));
    expect((await screen.findByRole("alert")).textContent).toBe("guia não encontrada");
    expect(win.close).toHaveBeenCalled();
    openSpy.mockReturnValue(null as never);
    fireEvent.click(screen.getByRole("button", { name: "Guia em PDF" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("o navegador bloqueou a janela nova — permita janelas deste site para ver a guia"));
  });

  it("consulta finalizada de outra pessoa ou sem regulação: nada de pedidos", async () => {
    await open([ "clinical_record", "care_regulation" ], "225142", finalized({ author: { id: "outra", name: "Dr. Outro" } }));
    await screen.findByRole("region", { name: "Consulta finalizada" });
    expect(screen.queryByRole("region", { name: "Pedidos de regulação" })).toBeNull();
  });

  it("consulta finalizada com rascunho: aparece como não enviado, editável", async () => {
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ regRequest({ status: "draft", requested_at: null, due_on: null }) ]);
    await open([ "clinical_record", "care_regulation" ], "225142", finalized(author));
    const item = await screen.findByRole("listitem", { name: "Cardiologia" });
    expect(within(item).getByText("não enviado")).not.toBeNull();
    expect(within(item).getByRole("button", { name: "Editar o pedido de Cardiologia" })).not.toBeNull();
  });

  it("o motivo vem do retorno da finalização", async () => {
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ regRequest({ status: "draft", requested_at: null, due_on: null }) ]);
    await open([ "clinical_record", "care_regulation" ]);
    fireEvent.click(await screen.findByRole("button", { name: "finalizar de mentira" }));
    const item = await screen.findByRole("listitem", { name: "Cardiologia" });
    expect(within(item).getByText(/^seu CBO não pode pedir este encaminhamento/)).not.toBeNull();
  });

  it("depois do adendo: a peça relê e os avisos passam a ser os do retorno do adendo", async () => {
    const draft = regRequest({ status: "draft", requested_at: null, due_on: null });
    mocked(api.listConsultationRegulationRequests).mockResolvedValue([ draft ]);
    mocked(api.addAddendum).mockResolvedValue({ id: "ad1", author_name: "Dra. Helena Prado", created_at: "2026-10-28T11:00:00-03:00",
      reason: "pedido de regulação", text: "Segue a regulação.", changes: null,
      regulation_not_sent: [ { index: 0, id: "rr1", error: "cid10_not_allowed_for_cbo", path: "cid10" } ] });
    await open([ "clinical_record", "care_regulation" ], "225142", finalized({ ...author }));
    const item = await screen.findByRole("listitem", { name: "Cardiologia" });
    expect(within(item).queryByText(/sua ocupação não pode usar CID-10/)).toBeNull();
    const reads = mocked(api.listConsultationRegulationRequests).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Adendo" }));
    fireEvent.change(screen.getByLabelText("Motivo do adendo"), { target: { value: "pedido de regulação" } });
    fireEvent.change(screen.getByLabelText("Texto do adendo"), { target: { value: "Segue a regulação." } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(mocked(api.listConsultationRegulationRequests).mock.calls.length).toBe(reads + 1));
    expect(await within(screen.getByRole("listitem", { name: "Cardiologia" })).findByText(/sua ocupação não pode usar CID-10/)).not.toBeNull();
  });
});
