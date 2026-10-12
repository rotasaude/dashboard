// src/modules/timeline/TimelineDetail.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getConsultationOptions: vi.fn(), getClinicalDocument: vi.fn() };
});
vi.mock("../documents/printDocument", () => ({ printDocument: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../consultation/ConsultationView", () => ({
  ConsultationLoader: (p: { id: string; endOnOutOfContext?: boolean; patientProblems: unknown[]; onAddendumAdded?(a: unknown): void }) => (
    <div>
      <span>{`consulta ${p.id} · fim em out_of_context ${p.endOnOutOfContext ? "sim" : "não"} · problemas ${p.patientProblems.length}`}</span>
      <button type="button" onClick={() => p.onAddendumAdded?.({ id: "ad9" })}>adendo (dublê)</button>
    </div>
  )
}));
vi.mock("../attendance/ScreeningDetail", () => ({
  ScreeningDetailLoader: (p: { id: string }) => <span>{`escuta ${p.id}`}</span>
}));
vi.mock("../attendance/RequestDetailPanel", () => ({
  RequestDetailPanel: (p: { requestId: string }) => <span>{`pedido ${p.requestId}`}</span>
}));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { printDocument } from "../documents/printDocument";
import { TimelineDetail } from "./TimelineDetail";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { options, problem } from "../../test/consultationFixtures";
import { prescriptionDoc } from "../../test/documentFixtures";

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
// Valor de um KeyValue: o rótulo e o valor são spans irmãos.
function kv(region: HTMLElement, label: string): string | null {
  const k = Array.from(region.querySelectorAll("span")).find((el) => el.textContent === label);
  return k?.nextElementSibling?.textContent ?? null;
}
afterEach(cleanup);

describe("TimelineDetail", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getConsultationOptions, api.getClinicalDocument, printDocument ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline" ] }));
    m(api.getConsultationOptions).mockResolvedValue(options());
    m(api.getClinicalDocument).mockResolvedValue(prescriptionDoc());
    m(printDocument).mockResolvedValue(null);
  });

  it("consulta, escuta e pedido abrem as telas existentes", async () => {
    const { rerender } = renderWithProviders(
      <TimelineDetail target={{ type: "consultation", id: "cs0" }} endOnOutOfContext onClose={vi.fn()} />);
    expect(screen.getByText("consulta cs0 · fim em out_of_context sim · problemas 0")).not.toBeNull();
    rerender(<TimelineDetail target={{ type: "screening", id: "sc1" }} onClose={vi.fn()} />);
    expect(screen.getByText("escuta sc1")).not.toBeNull();
    rerender(<TimelineDetail target={{ type: "appointment_request", id: "rq1" }} onClose={vi.fn()} />);
    expect(screen.getByText("pedido rq1")).not.toBeNull();
  });

  it("consulta: recebe os problemas do paciente e avisa o adendo a quem abriu", () => {
    const onAddendumAdded = vi.fn();
    renderWithProviders(<TimelineDetail target={{ type: "consultation", id: "cs0" }} onClose={vi.fn()}
      patientProblems={[ problem() ]} onAddendumAdded={onAddendumAdded} />);
    expect(screen.getByText("consulta cs0 · fim em out_of_context não · problemas 1")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "adendo (dublê)" }));
    expect(onAddendumAdded).toHaveBeenCalledWith({ id: "ad9" });
  });

  it("documento: tipo, situação, modo, código e Imprimir pela rotina do 19c", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TimelineDetail target={{ type: "clinical_document", id: "doc2" }} onClose={onClose} />);
    expect(await screen.findByText("P3H8T-2LQ6R")).not.toBeNull();
    expect(api.getClinicalDocument).toHaveBeenCalledWith("doc2");
    const region = screen.getByRole("region", { name: "Documento" });
    expect(kv(region, "Documento")).toBe("Receita");
    expect(kv(region, "Situação")).toBe("emitido");
    expect(kv(region, "Modo")).toBe("papel");
    expect(kv(region, "Emitido em")).toBe("09/10/2026, 09:40");
    expect(kv(region, "Profissional")).toBe("Dra. Helena Prado");
    expect(kv(region, "Código")).toBe("P3H8T-2LQ6R");
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    await waitFor(() => expect(printDocument).toHaveBeenCalledWith("doc2", expect.any(Function)));
    fireEvent.click(screen.getByRole("button", { name: "Fechar documento" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Notificação de papel: sem Imprimir e sem código", async () => {
    m(api.getClinicalDocument).mockResolvedValue(prescriptionDoc({
      id: "doc9", kind: "controlled_notification_record", short_code: null, verification_url: null
    }));
    renderWithProviders(<TimelineDetail target={{ type: "clinical_document", id: "doc9" }} onClose={vi.fn()} />);
    expect(await screen.findByText("Notificação de receita (papel)")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Imprimir" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("documento lido depois do fim da abertura: encerra a leitura", async () => {
    const onOpeningRequired = vi.fn();
    m(api.getClinicalDocument).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    renderWithProviders(<TimelineDetail target={{ type: "clinical_document", id: "doc2" }} onClose={vi.fn()}
      onOpeningRequired={onOpeningRequired} endOnOutOfContext />);
    await waitFor(() => expect(onOpeningRequired).toHaveBeenCalled());
  });

  it("documento: o fim da abertura avisa uma vez só, mesmo com o pai trocando a função", async () => {
    const spy = vi.fn();
    m(api.getClinicalDocument).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    function Host() {
      const [ n, setN ] = useState(0);
      return (
        <div>
          <span>{`renders ${n}`}</span>
          <TimelineDetail target={{ type: "clinical_document", id: "doc2" }} onClose={vi.fn()} endOnOutOfContext
            onOpeningRequired={() => { spy(); setN((x) => x + 1); }} />
        </div>
      );
    }
    renderWithProviders(<Host />);
    await screen.findByText("renders 1");
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(api.getClinicalDocument).toHaveBeenCalledTimes(1);
  });

  it("falha do Imprimir aparece como alerta", async () => {
    m(printDocument).mockResolvedValue("o navegador bloqueou a janela nova — permita janelas deste site para imprimir");
    renderWithProviders(<TimelineDetail target={{ type: "clinical_document", id: "doc2" }} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/bloqueou a janela nova/);
  });
});
