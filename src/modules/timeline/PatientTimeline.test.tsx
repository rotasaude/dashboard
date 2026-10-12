// src/modules/timeline/PatientTimeline.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getTimeline: vi.fn() };
});
vi.mock("./TimelineDetail", () => ({
  TimelineDetail: (p: { target: { type: string; id: string }; onClose(): void; onOpeningRequired?(): void }) => (
    <div>
      <span>{`detalhe ${p.target.type} ${p.target.id}`}</span>
      <button type="button" onClick={p.onClose}>fechar detalhe (dublê)</button>
      <button type="button" onClick={() => { p.onOpeningRequired?.(); p.onOpeningRequired?.(); }}>encerrar abertura (dublê)</button>
    </div>
  )
}));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { PatientTimeline } from "./PatientTimeline";
import { PARTIAL_NOTICE, TIMELINE_DISABLED, TIMELINE_EMPTY, TIMELINE_KEY } from "../../lib/timeline";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { APPOINTMENT, CONSULTATION, DOCUMENT, SCREENING, entry, page } from "../../test/timelineFixtures";

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = { kinds: [], from: "", to: "" };
afterEach(cleanup);

describe("PatientTimeline", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getTimeline ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline" ] }));
    m(api.getTimeline).mockResolvedValue(page());
  });

  it("lista na ordem do api, com tipo, onde e quem; abre o detalhe só do que tem tela", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional", "citizen_verifier" ], {
      id: "us1", features: [ "patient_timeline" ]
    }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect(await screen.findByText("Linha do tempo de Joana Lima")).not.toBeNull();
    expect(api.getTimeline).toHaveBeenCalledWith({ attendanceId: "a1" }, ALL, null);

    const text = document.body.textContent ?? "";
    const order = [ "Retorno — Consulta de enfermagem", "Receita", "Consulta agendada", "Escuta inicial", "Triagem respiratória" ]
      .map((t) => text.indexOf(t));
    expect(order.every((p) => p >= 0)).toBe(true);
    expect([ ...order ].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getAllByText("UBS Centro · Dra. Helena Prado").length).toBeGreaterThan(0);
    expect(screen.getByText("comum · digital")).not.toBeNull();
    expect(screen.getByText("finalizada")).not.toBeNull();
    expect(screen.getByText("confirmado")).not.toBeNull();
    expect(screen.queryByRole("note", { name: "histórico parcial" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Abrir consulta de 10/09/2026, 14:30" }));
    expect(screen.getByText("detalhe consultation cs0")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir agendamento de 01/10/2026, 09:00" }));
    expect(screen.getByText("detalhe appointment_request rq1")).not.toBeNull();
    expect(screen.queryByText("detalhe consultation cs0")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir triagem/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "fechar detalhe (dublê)" }));
    expect(screen.queryByText(/^detalhe /)).toBeNull();
  });

  it("carregar mais: pede com o cursor e não repete entrada", async () => {
    m(api.getTimeline)
      .mockResolvedValueOnce(page({ entries: [ APPOINTMENT, DOCUMENT ], next_before: "2026-09-10T14:40:00-03:00|clinical_document|doc2" }))
      .mockResolvedValueOnce(page({ entries: [ DOCUMENT, CONSULTATION ], next_before: null }));
    renderWithProviders(<PatientTimeline subject={{ patientId: "pa1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Consulta agendada")).not.toBeNull();
    expect(api.getTimeline).toHaveBeenLastCalledWith({ patientId: "pa1" }, ALL, "2026-09-10T14:40:00-03:00|clinical_document|doc2");
    expect(screen.getAllByText("Receita")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("filtros: tipos e período vão para a consulta e voltam à primeira página", async () => {
    m(api.getTimeline).mockResolvedValue(page({ next_before: "c1" }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    await screen.findByText("Linha do tempo de Joana Lima");
    fireEvent.click(screen.getByLabelText("Campanha"));
    fireEvent.click(screen.getByLabelText("Triagem"));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(api.getTimeline).toHaveBeenLastCalledWith({ attendanceId: "a1" }, {
      kinds: [ "attendance", "screening", "appointment", "consultation", "clinical_document", "controlled_notification" ],
      from: "2026-09-01", to: "2026-09-30"
    }, null));

    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(api.getTimeline).toHaveBeenLastCalledWith({ attendanceId: "a1" }, ALL, null));
    expect((screen.getByLabelText("Campanha") as HTMLInputElement).checked).toBe(true);
  });

  it("período invertido ou nenhum tipo: diz o motivo e não consulta", async () => {
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    await screen.findByText("Linha do tempo de Joana Lima");
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    expect(screen.getByRole("alert").textContent).toBe("o início do período é depois do fim");
    expect(api.getTimeline).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    for (const label of [ "Triagem", "Atendimento", "Escuta", "Agendamento", "Consulta", "Documento", "Notificação de receita", "Campanha" ]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    expect(screen.getByRole("alert").textContent).toBe("marque ao menos um tipo de registro");
    expect(api.getTimeline).toHaveBeenCalledTimes(1);
  });

  it("pela abertura justificada (fora de contexto) só a consulta abre detalhe (contrato §9)", async () => {
    renderWithProviders(<PatientTimeline subject={{ openingId: "op1" }} endOnOutOfContext />);
    expect(await screen.findByText("Linha do tempo de Joana Lima")).not.toBeNull();
    expect(api.getTimeline).toHaveBeenCalledWith({ openingId: "op1" }, ALL, null);
    expect(screen.getByText("Receita")).not.toBeNull();
    expect(screen.getByText("Escuta inicial")).not.toBeNull();
    expect(screen.getByText("Retorno — Consulta de enfermagem")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir documento/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir escuta/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir agendamento/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Abrir / })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Abrir consulta de 10/09/2026, 14:30" }));
    expect(screen.getByText("detalhe consultation cs0")).not.toBeNull();
  });

  it("em contexto, documento e escuta também abrem", async () => {
    renderWithProviders(<PatientTimeline subject={{ patientId: "pa1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir documento de 10/09/2026, 14:40" }));
    expect(screen.getByText("detalhe clinical_document doc2")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir escuta de 10/09/2026, 13:50" }));
    expect(screen.getByText("detalhe screening sc1")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /^Abrir / })).toHaveLength(3);
  });

  it("agendamento: sem citizen_verifier fica só o resumo; com o papel, Abrir leva ao pedido", async () => {
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect(await screen.findByText("Retorno — Consulta de enfermagem")).not.toBeNull();
    await screen.findByRole("button", { name: "Abrir consulta de 10/09/2026, 14:30" });
    expect(screen.queryByRole("button", { name: /^Abrir agendamento/ })).toBeNull();
    cleanup();
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional", "citizen_verifier" ], {
      id: "us1", features: [ "patient_timeline" ]
    }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir agendamento de 01/10/2026, 09:00" }));
    expect(screen.getByText("detalhe appointment_request rq1")).not.toBeNull();
  });

  it("histórico parcial (modo integrado): o aviso", async () => {
    m(api.getTimeline).mockResolvedValue(page({ person: { display_name: "Joana Lima", partial: true, patient_id: null } }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect((await screen.findByRole("note", { name: "histórico parcial" })).textContent).toBe(PARTIAL_NOTICE);
  });

  it("vazio: diz que não há registro, sem undefined/null", async () => {
    m(api.getTimeline).mockResolvedValue(page({ entries: [] }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect(await screen.findByText(TIMELINE_EMPTY)).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("entrada de tipo desconhecido: aparece crua e sem Abrir", async () => {
    m(api.getTimeline).mockResolvedValue(page({ entries: [
      entry({ id: "vaccination:v1", kind: "vaccination", title: "Vacina contra a gripe", summary: null, status: null, unit: null,
        professional: null, detail_ref: { type: "vaccination", id: "v1" } }),
      CONSULTATION
    ] }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect(await screen.findByText("Vacina contra a gripe")).not.toBeNull();
    expect(screen.getByText("vaccination")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir vaccination/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Abrir consulta de 10/09/2026, 14:30" })).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("403 opening_required ao carregar mais encerra a abertura", async () => {
    const onOpeningRequired = vi.fn();
    m(api.getTimeline)
      .mockResolvedValueOnce(page({ entries: [ APPOINTMENT ], next_before: "c1" }))
      .mockRejectedValueOnce(new ApiError(403, { error: "opening_required" }, "403"));
    const { client } = renderWithProviders(
      <PatientTimeline subject={{ openingId: "op1" }} endOnOutOfContext onOpeningRequired={onOpeningRequired} />);
    expect(await screen.findByText("Retorno — Consulta de enfermagem")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(onOpeningRequired).toHaveBeenCalled());
    // Nunca uma lista velha com erro parado: a tela e o cache ficam sem a pessoa.
    expect(screen.queryByText("Retorno — Consulta de enfermagem")).toBeNull();
    expect(screen.queryByText("Linha do tempo de Joana Lima")).toBeNull();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("a abertura justificada terminou — abra de novo com o motivo");
    expect(client.getQueryCache().findAll({ queryKey: [ TIMELINE_KEY ] }).filter((q) => q.state.data !== undefined)).toHaveLength(0);
    expect(api.getTimeline).toHaveBeenCalledTimes(2);
  });

  it("fim da abertura avisa uma vez só, mesmo se o pai renderiza de novo com outra função", async () => {
    const spy = vi.fn();
    m(api.getTimeline)
      .mockResolvedValueOnce(page({ entries: [ APPOINTMENT ], next_before: "c1" }))
      .mockRejectedValueOnce(new ApiError(403, { error: "opening_required" }, "403"));
    function Host() {
      const [ n, setN ] = useState(0);
      return (
        <div>
          <span>{`renders ${n}`}</span>
          <PatientTimeline subject={{ openingId: "op1" }} endOnOutOfContext
            onOpeningRequired={() => { spy(); setN((x) => x + 1); }} />
        </div>
      );
    }
    renderWithProviders(<Host />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await screen.findByText("renders 1");
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(api.getTimeline).toHaveBeenCalledTimes(2);
  });

  it("consulta aberta pela abertura que volta opening_required encerra a lista também, uma vez", async () => {
    const onOpeningRequired = vi.fn();
    const { client } = renderWithProviders(
      <PatientTimeline subject={{ openingId: "op1" }} endOnOutOfContext onOpeningRequired={onOpeningRequired} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir consulta de 10/09/2026, 14:30" }));
    fireEvent.click(screen.getByRole("button", { name: "encerrar abertura (dublê)" }));
    expect(onOpeningRequired).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Consulta agendada")).toBeNull();
    expect(screen.queryByText(/^detalhe /)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(client.getQueryCache().findAll({ queryKey: [ TIMELINE_KEY ] }).filter((q) => q.state.data !== undefined)).toHaveLength(0);
    expect(api.getTimeline).toHaveBeenCalledTimes(1);
  });

  it("Atualizar com duas páginas carregadas recomeça da primeira (uma leitura só)", async () => {
    m(api.getTimeline)
      .mockResolvedValueOnce(page({ entries: [ APPOINTMENT ], next_before: "c1" }))
      .mockResolvedValueOnce(page({ entries: [ DOCUMENT ], next_before: "c2" }))
      .mockResolvedValue(page({ entries: [ APPOINTMENT, SCREENING ], next_before: "c9" }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Receita")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(await screen.findByText("Escuta inicial")).not.toBeNull();
    expect(screen.queryByText("Receita")).toBeNull();
    expect(api.getTimeline).toHaveBeenCalledTimes(3);
    expect(m(api.getTimeline).mock.calls[2]).toEqual([ { attendanceId: "a1" }, ALL, null ]);
  });

  it("403 out_of_context em contexto (sem abertura): diz o caminho e não encerra nada", async () => {
    const onOpeningRequired = vi.fn();
    m(api.getTimeline).mockRejectedValue(new ApiError(403, { error: "out_of_context" }, "403"));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} onOpeningRequired={onOpeningRequired} />);
    expect((await screen.findByRole("alert")).textContent)
      .toBe("esta pessoa não está em atendimento com você — para ler, use a abertura justificada em Prontuário");
    expect(onOpeningRequired).not.toHaveBeenCalled();
  });

  it("403 out_of_context ao carregar mais em contexto: a lista some e fica só o alerta", async () => {
    const onOpeningRequired = vi.fn();
    m(api.getTimeline)
      .mockResolvedValueOnce(page({ entries: [ APPOINTMENT ], next_before: "c1" }))
      .mockRejectedValueOnce(new ApiError(403, { error: "out_of_context" }, "403"));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} onOpeningRequired={onOpeningRequired} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("esta pessoa não está em atendimento com você — para ler, use a abertura justificada em Prontuário");
    expect(screen.queryByText("Retorno — Consulta de enfermagem")).toBeNull();
    expect(screen.queryByText("Linha do tempo de Joana Lima")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    expect(onOpeningRequired).not.toHaveBeenCalled();
  });

  it("422 invalid_cursor: diz para atualizar; Atualizar relê", async () => {
    m(api.getTimeline)
      .mockResolvedValueOnce(page({ entries: [ APPOINTMENT ], next_before: "c1" }))
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_cursor" }, "422"))
      .mockResolvedValue(page({ entries: [ APPOINTMENT, SCREENING ] }));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a lista mudou desde a última página — use Atualizar");
    expect(screen.getByText("Retorno — Consulta de enfermagem")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(await screen.findByText("Escuta inicial")).not.toBeNull();
    expect(m(api.getTimeline).mock.calls[2]).toEqual([ { attendanceId: "a1" }, ALL, null ]);
  });

  it("interruptor desligado no api: a frase", async () => {
    m(api.getTimeline).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "patient_timeline" }, "403"));
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect((await screen.findByRole("alert")).textContent).toBe(TIMELINE_DISABLED);
  });
});
