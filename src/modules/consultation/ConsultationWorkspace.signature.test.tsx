// src/modules/consultation/ConsultationWorkspace.signature.test.tsx
// Módulo 19b (Ruling R8): logo depois de finalizar (ou de um adendo) o bloco
// vem "manual sem pedido"; a tela relê a consulta a cada 3 s, até 3 vezes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { Consultation, SignatureBlock } from "../../lib/api";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(),
    startConsultation: vi.fn(), getConsultation: vi.fn() };
});
const MANUAL: SignatureBlock = { mode: "manual" };
vi.mock("./ConsultationEditor", () => ({
  ConsultationEditor: (p: { consultation: Consultation; onFinalized(c: Consultation): void }) => (
    <button type="button" onClick={() => p.onFinalized({ ...p.consultation, status: "finalized", signature: { mode: "manual" } })}>
      finalizar (dublê)
    </button>
  )
}));
const mode = (b?: SignatureBlock) => (b ? `${b.mode}${b.request_id ? `/${b.request_id}` : ""}` : "sem bloco");
vi.mock("./ConsultationView", () => ({
  ConsultationView: (p: { consultation: Consultation; onAddendumAdded(a: unknown): void }) => (
    <div>
      <span>{`assinatura: ${mode(p.consultation.signature)}`}</span>
      <span>{`adendos: ${p.consultation.addenda.map((a) => `${a.id}=${mode(a.signature)}`).join(",")}`}</span>
      <button type="button" onClick={() => p.onAddendumAdded({ id: "ad9", author_name: "Dra. Helena Prado",
        created_at: "2026-10-07T11:00:00-03:00", reason: "correção do plano", text: "Retorno.", changes: null,
        signature: { mode: "manual" } })}>adendo (dublê)</button>
    </div>
  ),
  ConsultationLoader: () => null
}));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ConsultationWorkspace, SIGNATURE_REREAD_MS } from "./ConsultationWorkspace";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { consultation, finalized, options, record } from "../../test/consultationFixtures";
import { signatureBlock, signer } from "../../test/signatureFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
// Um passo de releitura por vez: o efeito que agenda a próxima só roda ao fim do act.
async function steps(n: number) { for (let i = 0; i < n; i++) await tick(SIGNATURE_REREAD_MS); }

afterEach(() => { cleanup(); vi.useRealTimers(); });

async function finalize() {
  const view = renderWithProviders(
    <ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={vi.fn()} onFinalized={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
  const button = await screen.findByRole("button", { name: "finalizar (dublê)" });
  // O relógio falso entra só agora: o carregamento usou o real.
  vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
  fireEvent.click(button);
  expect(screen.getByText("assinatura: manual")).not.toBeNull();
  return view;
}

describe("ConsultationWorkspace — releitura da assinatura (19b)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getAttendanceRecord, api.getConsultationOptions, api.startConsultation,
      api.getConsultation ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(signer());
    mocked(api.getAttendanceRecord).mockResolvedValue(record());
    mocked(api.getConsultationOptions).mockResolvedValue(options());
    mocked(api.startConsultation).mockResolvedValue(consultation());
  });

  it("3 s depois de finalizar relê e mostra o bloco que o job gravou", async () => {
    expect(SIGNATURE_REREAD_MS).toBe(3000);
    mocked(api.getConsultation).mockResolvedValue(finalized({ signature: signatureBlock() }));
    await finalize();
    await tick(SIGNATURE_REREAD_MS - 1);
    expect(api.getConsultation).not.toHaveBeenCalled();
    await tick(1);
    expect(api.getConsultation).toHaveBeenCalledWith("cs1");
    expect(screen.getByText("assinatura: digital/sr1")).not.toBeNull();
    await steps(3);
    expect(api.getConsultation).toHaveBeenCalledTimes(1);
  });

  it("pendente sem motivo (job assinando) continua relendo; pendente com motivo para", async () => {
    mocked(api.getConsultation)
      .mockResolvedValueOnce(finalized({ signature: { mode: "pending", request_id: "sr1" } }))
      .mockResolvedValue(finalized({ signature: { mode: "pending", request_id: "sr1", reason_code: "no_session" } }));
    await finalize();
    await tick(SIGNATURE_REREAD_MS);
    expect(screen.getByText("assinatura: pending/sr1")).not.toBeNull();
    await tick(SIGNATURE_REREAD_MS);
    expect(api.getConsultation).toHaveBeenCalledTimes(2);
    await steps(3);
    expect(api.getConsultation).toHaveBeenCalledTimes(2);
  });

  it("para depois de 3 tentativas, mesmo sem assentar", async () => {
    mocked(api.getConsultation).mockResolvedValue(finalized({ signature: MANUAL }));
    await finalize();
    await steps(6);
    expect(api.getConsultation).toHaveBeenCalledTimes(3);
  });

  it("erro na releitura é silencioso: fica o que estava e conta como tentativa", async () => {
    mocked(api.getConsultation).mockRejectedValue(new ApiError(403, { error: "out_of_context" }, "403"));
    await finalize();
    await steps(6);
    expect(api.getConsultation).toHaveBeenCalledTimes(3);
    expect(screen.getByText("assinatura: manual")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("quem não pode assinar não relê", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(
      sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record" ] }));
    await finalize();
    await steps(4);
    expect(api.getConsultation).not.toHaveBeenCalled();
  });

  it("bloco que já tem pedido (devolvido ao papel) não relê", async () => {
    renderWithProviders(
      <ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={vi.fn()} onFinalized={vi.fn()} />);
    mocked(api.startConsultation).mockResolvedValue(
      finalized({ signature: { mode: "manual", request_id: "sr1", reason_code: "user_request" } }));
    vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
    await tick(50);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar consulta" }));
    await tick(0);
    expect(screen.getByText("assinatura: manual/sr1")).not.toBeNull();
    await steps(4);
    expect(api.getConsultation).not.toHaveBeenCalled();
  });

  it("depois de um adendo (o 201 vem manual) relê de novo, mantendo o adendo", async () => {
    mocked(api.getConsultation)
      .mockResolvedValueOnce(finalized({ signature: signatureBlock() }))
      .mockResolvedValue(finalized({ signature: signatureBlock(), addenda: [ { id: "ad9", author_name: "Dra. Helena Prado",
        created_at: "2026-10-07T11:00:00-03:00", reason: "correção do plano", text: "Retorno.", changes: null,
        signature: signatureBlock({ request_id: "sr9", signature_id: "sg9" }) } ] }));
    await finalize();
    await tick(SIGNATURE_REREAD_MS);
    expect(api.getConsultation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "adendo (dublê)" }));
    expect(screen.getByText("adendos: ad9=manual")).not.toBeNull();
    await tick(SIGNATURE_REREAD_MS);
    expect(api.getConsultation).toHaveBeenCalledTimes(2);
    expect(screen.getByText("adendos: ad9=digital/sr9")).not.toBeNull();
  });

  it("a releitura que chega sem o adendo recém-criado não o apaga", async () => {
    mocked(api.getConsultation)
      .mockResolvedValueOnce(finalized({ signature: signatureBlock() }))
      .mockResolvedValue(finalized({ signature: signatureBlock() }));
    await finalize();
    await tick(SIGNATURE_REREAD_MS);
    fireEvent.click(screen.getByRole("button", { name: "adendo (dublê)" }));
    await tick(SIGNATURE_REREAD_MS);
    expect(screen.getByText("adendos: ad9=manual")).not.toBeNull();
  });

  it("desmontar cancela a releitura", async () => {
    mocked(api.getConsultation).mockResolvedValue(finalized({ signature: signatureBlock() }));
    const view = await finalize();
    view.unmount();
    await tick(SIGNATURE_REREAD_MS * 2);
    expect(api.getConsultation).not.toHaveBeenCalled();
  });
});
