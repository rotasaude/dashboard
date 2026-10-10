// Módulo 19c: documentos da consulta aberta em "Minhas consultas" (reimprimir
// e cancelar). A leitura da consulta e a lista de documentos são dublês.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listMyConsultations: vi.fn(), getConsultationOptions: vi.fn() };
});
vi.mock("./consultation/ConsultationView", () => ({
  ConsultationLoader: (p: { id: string }) => <span>{`consulta ${p.id}`}</span>
}));
vi.mock("./documents/ConsultationDocuments", () => ({
  ConsultationDocuments: (p: { consultationId: string; issue?: unknown; onGoToSecurity?(): void }) => (
    <>
      <span>{`documentos ${p.consultationId} · ${p.issue ? "com emissão" : "só lista"}`}</span>
      <button type="button" onClick={p.onGoToSecurity}>ir para segurança</button>
    </>
  )
}));

import * as api from "../lib/api";
import { MyConsultations } from "./MyConsultations";
import { renderWithProviders } from "../test/campaignFixtures";
import { consultationListItem, options } from "../test/consultationFixtures";
import { docUser } from "../test/documentFixtures";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("Minhas consultas — documentos (19c)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listMyConsultations, api.getConsultationOptions ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue(docUser());
    m(api.listMyConsultations).mockResolvedValue([ consultationListItem() ]);
    m(api.getConsultationOptions).mockResolvedValue(options());
  });

  it("abrir a consulta mostra os documentos dela, só a lista", async () => {
    renderWithProviders(<MyConsultations />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir consulta de 06/10/2026, 14:30" }));
    expect(screen.getByText("consulta c1")).not.toBeNull();
    expect(screen.getByText("documentos c1 · só lista")).not.toBeNull();
  });

  it("sem clinical_documents, só a consulta", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(docUser([ "health_professional" ], { features: [ "clinical_record" ] }));
    renderWithProviders(<MyConsultations />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir consulta de 06/10/2026, 14:30" }));
    expect(screen.getByText("consulta c1")).not.toBeNull();
    expect(screen.queryByText(/^documentos /)).toBeNull();
  });

  it("operador: papel não permite e nenhum documento", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(docUser([ "health_professional" ], { operator: true }));
    renderWithProviders(<MyConsultations />);
    expect(await screen.findByText("seu papel não permite ver consultas")).not.toBeNull();
    expect(screen.queryByText(/^documentos /)).toBeNull();
  });

  it("onGoToSecurity chega aos documentos", async () => {
    const go = vi.fn();
    renderWithProviders(<MyConsultations onGoToSecurity={go} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir consulta de 06/10/2026, 14:30" }));
    fireEvent.click(screen.getByRole("button", { name: "ir para segurança" }));
    expect(go).toHaveBeenCalledTimes(1);
  });
});
