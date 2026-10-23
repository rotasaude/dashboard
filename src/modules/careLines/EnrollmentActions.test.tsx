import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getCareEnrollment: vi.fn(), endCareEnrollment: vi.fn(), openCareAppointment: vi.fn(),
    recordCareContact: vi.fn() };
});
// O BookPanel do módulo 17 tem os próprios testes; aqui só o que o atalho entrega a ele.
vi.mock("../attendance/BookPanel", () => ({
  BookPanel: (p: { row: { id: string }; unit: { name: string }; onDone(): void; onCancel(): void }) => (
    <div role="region" aria-label="BookPanel do módulo 17">
      <span>{`pedido ${p.row.id} · ${p.unit.name}`}</span>
      <button type="button" onClick={p.onDone}>marcar (dublê)</button>
    </div>
  )
}));

import * as api from "../../lib/api";
import { EnrollmentDetail } from "./EnrollmentDetail";
import { renderWithProviders } from "../../test/campaignFixtures";
import { UBS_VILA_VERDE, careRequestItem, careUser, enrollment } from "../../test/careLineFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const BOOK_REGION = "BookPanel do módulo 17";
const target = (over: Partial<api.CareAppointmentTarget> = {}): api.CareAppointmentTarget =>
  ({ request: careRequestItem(), unit: UBS_VILA_VERDE, can_book: true, ...over });

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getCareEnrollment, api.endCareEnrollment, api.openCareAppointment, api.recordCareContact ]) {
    mocked(fn).mockReset();
  }
  mocked(api.fetchCurrentSession).mockResolvedValue(careUser());
  mocked(api.getCareEnrollment).mockResolvedValue(enrollment({ contacts: [] }));
  mocked(api.endCareEnrollment).mockResolvedValue(undefined);
  mocked(api.openCareAppointment).mockResolvedValue(target());
});

function renderDetail(onChanged = vi.fn()) {
  renderWithProviders(<EnrollmentDetail enrollmentId="en1" onChanged={onChanged} onClose={vi.fn()} />);
  return onChanged;
}

async function clickAgendar() {
  fireEvent.click(await screen.findByRole("button", { name: "Agendar" }));
}

describe("Agendar (atalho para o módulo 17)", () => {
  it("com can_book abre o pedido da pessoa no BookPanel; marcado, o contato vem com agendou", async () => {
    renderDetail();
    await clickAgendar();
    const book = await screen.findByRole("region", { name: BOOK_REGION });
    expect(api.openCareAppointment).toHaveBeenCalledWith("en1");
    expect(within(book).getByText("pedido rq1 · UBS Vila Verde")).not.toBeNull();
    fireEvent.click(within(book).getByRole("button", { name: "marcar (dublê)" }));
    expect((await screen.findByRole("status")).textContent).toBe("Horário marcado. Registre o contato como “agendou”.");
    const contactForm = screen.getByRole("region", { name: "Registrar contato" });
    expect((within(contactForm).getByLabelText("Resultado") as HTMLSelectElement).value).toBe("scheduled");
    expect(screen.queryByRole("region", { name: BOOK_REGION })).toBeNull();
  });

  it("sem can_book não abre o BookPanel: o pedido segue para a recepção da unidade", async () => {
    mocked(api.openCareAppointment).mockResolvedValue(target({ can_book: false }));
    renderDetail();
    await clickAgendar();
    const sent = await screen.findByRole("region", { name: "Pedido de agendamento" });
    expect(within(sent).getByText("Pedido enviado à recepção da unidade")).not.toBeNull();
    expect(within(sent).getByText(/UBS Vila Verde/)).not.toBeNull();
    expect(within(sent).getByText(/Retorno/)).not.toBeNull();
    expect(screen.queryByRole("region", { name: BOOK_REGION })).toBeNull();
    // Voltar ao painel: o botão Agendar reaparece.
    fireEvent.click(within(sent).getByRole("button", { name: "Voltar" }));
    expect(screen.queryByRole("region", { name: "Pedido de agendamento" })).toBeNull();
    expect(screen.getByRole("button", { name: "Agendar" })).not.toBeNull();
  });

  it("pedido aberto de OUTRO tipo não é apresentado como pedido da linha", async () => {
    mocked(api.openCareAppointment).mockResolvedValue(target({
      request: careRequestItem({ kind: "referral", origin: "attendance", origin_unit_name: "UPA Norte", appointment_type_name: "Consulta médica" })
    }));
    renderDetail();
    await clickAgendar();
    const info = await screen.findByRole("region", { name: "Pedido de agendamento" });
    expect(within(info).getByText("já há pedido aberto (Encaminhado de UPA Norte)")).not.toBeNull();
    expect(within(info).getByText("Marque pela fila da recepção da unidade.")).not.toBeNull();
    expect(screen.queryByText("Pedido enviado à recepção da unidade")).toBeNull();
    expect(screen.queryByRole("region", { name: BOOK_REGION })).toBeNull();
  });

  it("pedido de OUTRO tipo sem can_book: a recepção da unidade marca", async () => {
    mocked(api.openCareAppointment).mockResolvedValue(target({
      can_book: false, request: careRequestItem({ kind: "referral", origin: "attendance", origin_unit_name: "UPA Norte" })
    }));
    renderDetail();
    await clickAgendar();
    const info = await screen.findByRole("region", { name: "Pedido de agendamento" });
    expect(within(info).getByText("já há pedido aberto (Encaminhado de UPA Norte)")).not.toBeNull();
    expect(within(info).getByText("A recepção da unidade marca o horário desse pedido.")).not.toBeNull();
    expect(within(info).queryByText("Marque pela fila da recepção da unidade.")).toBeNull();
    expect(screen.queryByRole("region", { name: BOOK_REGION })).toBeNull();
  });

  it.each([
    [ 409, "already_scheduled", "já há horário marcado para esta pessoa" ],
    [ 409, "citizen_not_verified", "o cadastro desta pessoa ainda não foi validado no posto — valide na recepção" ],
    [ 422, "invalid_unit", "a unidade desta equipe não está ativa para agendar — fale com a recepção" ]
  ])("erro %i %s vira frase e nenhum BookPanel", async (status, code, phrase) => {
    mocked(api.openCareAppointment).mockRejectedValueOnce(new api.ApiError(status, { error: code }, "x"));
    renderDetail();
    await clickAgendar();
    expect((await screen.findByRole("alert")).textContent).toBe(phrase);
    expect(screen.queryByRole("region", { name: BOOK_REGION })).toBeNull();
    expect(screen.getByRole("button", { name: "Agendar" })).not.toBeNull();
  });

  it("código desconhecido nunca aparece cru", async () => {
    mocked(api.openCareAppointment).mockRejectedValueOnce(new api.ApiError(422, { error: "algo_novo_do_api" }, "x"));
    renderDetail();
    await clickAgendar();
    const text = (await screen.findByRole("alert")).textContent ?? "";
    expect(text).not.toContain("algo_novo_do_api");
  });

  it("inscrição encerrada por outra pessoa (409 invalid_transition): fecha o detalhe com a frase", async () => {
    mocked(api.openCareAppointment).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    const onChanged = renderDetail();
    await clickAgendar();
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("isso já foi decidido ou encerrado por outra pessoa — a lista foi relida", true));
  });
});

describe("Encerrar inscrição", () => {
  it("motivo obrigatório; outro motivo pede nota; manda motivo e nota e fecha", async () => {
    const onChanged = renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar inscrição" }));
    const endForm = screen.getByRole("region", { name: "Encerrar a inscrição de Maria das Dores" });
    fireEvent.click(within(endForm).getByRole("button", { name: "Encerrar inscrição" }));
    expect(within(endForm).getByRole("alert").textContent).toBe("escolha o motivo do encerramento");
    fireEvent.change(within(endForm).getByLabelText("Motivo do encerramento"), { target: { value: "other" } });
    fireEvent.click(within(endForm).getByRole("button", { name: "Encerrar inscrição" }));
    expect(within(endForm).getByRole("alert").textContent).toBe("descreva o motivo em “outro motivo”");
    fireEvent.change(within(endForm).getByLabelText("Nota"), { target: { value: "acompanhamento no plano de saúde" } });
    fireEvent.click(within(endForm).getByRole("button", { name: "Encerrar inscrição" }));
    await waitFor(() => expect(api.endCareEnrollment).toHaveBeenCalledWith("en1", "other", "acompanhamento no plano de saúde"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("Inscrição de Maria das Dores encerrada.", true));
  });

  it("óbito e mudança avisam que o pedido de agendamento da linha também fecha; os outros motivos não", async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar inscrição" }));
    const endForm = screen.getByRole("region", { name: "Encerrar a inscrição de Maria das Dores" });
    const warning = "Se houver pedido de agendamento aberto por esta linha, ele também será fechado, e o horário marcado nele, cancelado.";
    expect(within(endForm).queryByText(warning)).toBeNull();
    for (const [ reason, shown ] of [ [ "death", true ], [ "moved", true ], [ "discharge", false ], [ "pregnancy_ended", false ], [ "other", false ] ] as const) {
      fireEvent.change(within(endForm).getByLabelText("Motivo do encerramento"), { target: { value: reason } });
      expect(within(endForm).queryByText(warning) !== null, reason).toBe(shown);
    }
  });

  it("inscrição já encerrada por outra pessoa: fecha o detalhe com a frase, sem reler", async () => {
    mocked(api.endCareEnrollment).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    const onChanged = renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar inscrição" }));
    const endForm = screen.getByRole("region", { name: "Encerrar a inscrição de Maria das Dores" });
    fireEvent.change(within(endForm).getByLabelText("Motivo do encerramento"), { target: { value: "discharge" } });
    fireEvent.click(within(endForm).getByRole("button", { name: "Encerrar inscrição" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("isso já foi decidido ou encerrado por outra pessoa — a lista foi relida", true));
    expect(api.getCareEnrollment).toHaveBeenCalledTimes(1);
  });

  it("erro que não é de registro velho fica no formulário, com frase", async () => {
    mocked(api.endCareEnrollment).mockRejectedValueOnce(new api.ApiError(422, { error: "too_long" }, "x"));
    const onChanged = renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar inscrição" }));
    const endForm = screen.getByRole("region", { name: "Encerrar a inscrição de Maria das Dores" });
    fireEvent.change(within(endForm).getByLabelText("Motivo do encerramento"), { target: { value: "discharge" } });
    fireEvent.click(within(endForm).getByRole("button", { name: "Encerrar inscrição" }));
    expect((await within(endForm).findByRole("alert")).textContent).toBe("texto maior que o permitido — encurte");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("Cancelar volta ao painel sem chamar o api", async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar inscrição" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("region", { name: "Encerrar a inscrição de Maria das Dores" })).toBeNull();
    expect(api.endCareEnrollment).not.toHaveBeenCalled();
  });
});

describe("inscrição encerrada", () => {
  it("só leitura — sem Agendar, Encerrar nem Registrar contato", async () => {
    mocked(api.getCareEnrollment).mockResolvedValue(enrollment({ status: "ended", ended_reason: "moved", ended_at: "2026-10-21T10:00:00-03:00", contacts: [] }));
    renderDetail();
    expect(await screen.findByText("encerrada — mudou de território")).not.toBeNull();
    for (const name of [ "Agendar", "Encerrar inscrição", "Registrar contato" ]) expect(screen.queryByRole("button", { name })).toBeNull();
  });
});
