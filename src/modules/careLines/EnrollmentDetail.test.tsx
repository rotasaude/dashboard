import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getCareContext: vi.fn(), listCareEnrollments: vi.fn(), countOverdueEnrollments: vi.fn(),
    countCareSuggestions: vi.fn(), getCareEnrollment: vi.fn(), recordCareContact: vi.fn()
  };
});

import { focusManager, onlineManager } from "@tanstack/react-query";
import * as api from "../../lib/api";
import { CareLinesTeam } from "../CareLinesTeam";
import { renderWithProviders } from "../../test/campaignFixtures";
import { PREGNANCY_REF, TODAY23, careContext, careUser, enrollment } from "../../test/careLineFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const WITH_CONTACTS = enrollment({
  last_contact: { channel: "home_visit", outcome: "reached", at: "2026-10-20T15:00:00-03:00" },
  contacts: [
    { id: "ct1", channel: "phone", outcome: "no_answer", recorded_at: "2026-10-10T09:00:00-03:00", recorded_by: { id: "us3", name: "Enf. Lúcia Prado" }, note: null },
    { id: "ct2", channel: "home_visit", outcome: "reached", recorded_at: "2026-10-20T15:00:00-03:00", recorded_by: { id: "us7", name: "ACS Pedro Alves" },
      note: "vai à unidade na sexta" }
  ]
});
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getCareContext, api.listCareEnrollments, api.countOverdueEnrollments,
    api.countCareSuggestions, api.getCareEnrollment, api.recordCareContact ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(careUser());
  mocked(api.getCareContext).mockResolvedValue(careContext());
  mocked(api.listCareEnrollments).mockResolvedValue({ enrollments: [ enrollment() ], next_before: null });
  mocked(api.countOverdueEnrollments).mockResolvedValue(12);
  mocked(api.countCareSuggestions).mockResolvedValue(0);
  mocked(api.getCareEnrollment).mockResolvedValue(WITH_CONTACTS);
  mocked(api.recordCareContact).mockResolvedValue(undefined);
});

async function openDetail() {
  renderWithProviders(<CareLinesTeam today={TODAY23} />);
  fireEvent.click(await screen.findByRole("button", { name: "Abrir Maria das Dores" }));
  return screen.findByRole("region", { name: "Inscrição de Maria das Dores" });
}

describe("EnrollmentDetail", () => {
  it("Abrir mostra o detalhe com trilha uma vez; contatos do mais novo ao mais antigo", async () => {
    const detail = await openDetail();
    expect(api.getCareEnrollment).toHaveBeenCalledTimes(1);
    expect(api.getCareEnrollment).toHaveBeenCalledWith("en1");
    expect(await within(detail).findByText("Hemoglobina glicada")).not.toBeNull();
    const contacts = within(within(detail).getByRole("region", { name: "Contatos" })).getAllByRole("listitem");
    expect(contacts.map((li) => li.textContent)).toEqual([
      "20/10/2026 · visita domiciliar · conversou · ACS Pedro Alves vai à unidade na sexta",
      "10/10/2026 · telefone · não atendeu · Enf. Lúcia Prado"
    ]);
  });

  it("registra contato: nota vazia não vai; relê o detalhe e a lista", async () => {
    const detail = await openDetail();
    fireEvent.click(await within(detail).findByRole("button", { name: "Registrar contato" }));
    const contactForm = within(detail).getByRole("region", { name: "Registrar contato" });
    fireEvent.change(within(contactForm).getByLabelText("Como foi o contato"), { target: { value: "phone" } });
    fireEvent.change(within(contactForm).getByLabelText("Resultado"), { target: { value: "no_answer" } });
    fireEvent.click(within(contactForm).getByRole("button", { name: "Salvar contato" }));
    await waitFor(() => expect(api.recordCareContact).toHaveBeenCalledWith("en1", { channel: "phone", outcome: "no_answer", note: "" }));
    expect((await screen.findAllByRole("status"))[0].textContent).toBe("Contato registrado.");
    await waitFor(() => expect(api.getCareEnrollment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.listCareEnrollments).toHaveBeenCalledTimes(2));
    expect(within(detail).queryByRole("region", { name: "Registrar contato" })).toBeNull();
  });

  it("sem canal não envia; nota de 501 é recusada e fica no campo", async () => {
    const detail = await openDetail();
    fireEvent.click(await within(detail).findByRole("button", { name: "Registrar contato" }));
    const contactForm = within(detail).getByRole("region", { name: "Registrar contato" });
    fireEvent.click(within(contactForm).getByRole("button", { name: "Salvar contato" }));
    expect(within(contactForm).getByRole("alert").textContent).toBe("escolha como foi o contato");
    fireEvent.change(within(contactForm).getByLabelText("Como foi o contato"), { target: { value: "phone" } });
    fireEvent.change(within(contactForm).getByLabelText("Resultado"), { target: { value: "reached" } });
    fireEvent.change(within(contactForm).getByLabelText("Nota (opcional)"), { target: { value: "x".repeat(501) } });
    fireEvent.click(within(contactForm).getByRole("button", { name: "Salvar contato" }));
    expect(within(contactForm).getByRole("alert").textContent).toBe("nota com até 500 caracteres — encurte");
    expect((within(contactForm).getByLabelText("Nota (opcional)") as HTMLTextAreaElement).value).toHaveLength(501);
    expect(api.recordCareContact).not.toHaveBeenCalled();
  });

  it("inscrição encerrada por outra pessoa (409 invalid_transition): frase, fecha e relê a lista", async () => {
    mocked(api.recordCareContact).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    const detail = await openDetail();
    fireEvent.click(await within(detail).findByRole("button", { name: "Registrar contato" }));
    const contactForm = within(detail).getByRole("region", { name: "Registrar contato" });
    fireEvent.change(within(contactForm).getByLabelText("Como foi o contato"), { target: { value: "in_person" } });
    fireEvent.change(within(contactForm).getByLabelText("Resultado"), { target: { value: "reached" } });
    fireEvent.click(within(contactForm).getByRole("button", { name: "Salvar contato" }));
    expect((await screen.findByRole("status")).textContent).toBe("isso já foi decidido ou encerrado por outra pessoa — a lista foi relida");
    expect(screen.queryByRole("region", { name: "Inscrição de Maria das Dores" })).toBeNull();
    await waitFor(() => expect(api.listCareEnrollments).toHaveBeenCalledTimes(2));
  });

  it("o detalhe não relê sozinho (trilha por registro): foco, volta da rede e tempo não disparam leitura", async () => {
    // Relógio falso ANTES do render: o setInterval de um refetchInterval nasce já no relógio falso.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const detail = await openDetail();
      await within(detail).findByText("Hemoglobina glicada");
      await act(async () => {
        focusManager.setFocused(false); focusManager.setFocused(true);
        onlineManager.setOnline(false); onlineManager.setOnline(true);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
    } finally {
      vi.useRealTimers();
      focusManager.setFocused(undefined);
      onlineManager.setOnline(true);
    }
    expect(api.getCareEnrollment).toHaveBeenCalledTimes(1);
  });

  it("fechar/trocar o detalhe durante o envio: a resposta tardia de A não fecha B nem relê A", async () => {
    const rosa = enrollment({ id: "en2", person: { patient_id: "pa9", citizen_id: "ci9", display_name: "Rosa Lima", age: 71 } });
    mocked(api.listCareEnrollments).mockResolvedValue({ enrollments: [ enrollment(), rosa ], next_before: null });
    mocked(api.getCareEnrollment).mockImplementation(async (id: string) => (id === "en2" ? rosa : WITH_CONTACTS));
    let rejectA: (e: unknown) => void = () => {};
    mocked(api.recordCareContact).mockImplementationOnce(() => new Promise((_, reject) => { rejectA = reject; }));
    const detail = await openDetail();
    fireEvent.click(await within(detail).findByRole("button", { name: "Registrar contato" }));
    const contactForm = within(detail).getByRole("region", { name: "Registrar contato" });
    fireEvent.change(within(contactForm).getByLabelText("Como foi o contato"), { target: { value: "phone" } });
    fireEvent.change(within(contactForm).getByLabelText("Resultado"), { target: { value: "reached" } });
    fireEvent.click(within(contactForm).getByRole("button", { name: "Salvar contato" }));
    await waitFor(() => expect(api.recordCareContact).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Abrir Rosa Lima" }));
    expect(await screen.findByRole("region", { name: "Inscrição de Rosa Lima" })).not.toBeNull();
    await act(async () => { rejectA(new api.ApiError(409, { error: "invalid_transition" }, "x")); await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByRole("region", { name: "Inscrição de Rosa Lima" })).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocked(api.getCareEnrollment).mock.calls.filter(([ id ]) => id === "en1")).toHaveLength(1);
    expect(api.listCareEnrollments).toHaveBeenCalledTimes(1);
  });

  it("rotula DUM na gestante e 'Data de referência' nas outras; quem registrou sem nome tem frase", async () => {
    mocked(api.getCareEnrollment).mockResolvedValue(enrollment({
      care_line: PREGNANCY_REF, anchor_date: "2026-05-01",
      contacts: [ { id: "ct9", channel: "phone", outcome: "reached", recorded_at: "2026-10-11T09:00:00-03:00", recorded_by: { id: "us9", name: null }, note: null } ]
    }));
    const detail = await openDetail();
    expect(await within(detail).findByText("DUM")).not.toBeNull();
    expect(within(detail).queryByText("Data de referência")).toBeNull();
    expect(within(within(detail).getByRole("region", { name: "Contatos" })).getAllByRole("listitem")[0].textContent)
      .toBe("11/10/2026 · telefone · conversou · profissional sem nome no cadastro");
  });

  it("inscrição encerrada fica só leitura: sem 'Registrar contato' e com o motivo", async () => {
    mocked(api.getCareEnrollment).mockResolvedValue(enrollment({ status: "ended", ended_reason: "moved", ended_at: "2026-10-18T10:00:00-03:00" }));
    const detail = await openDetail();
    expect(await within(detail).findByText("encerrada — mudou de território")).not.toBeNull();
    expect(within(detail).queryByRole("button", { name: "Registrar contato" })).toBeNull();
  });

  it("erro conhecido na gravação fica no formulário e o botão volta", async () => {
    mocked(api.recordCareContact).mockRejectedValueOnce(new api.ApiError(422, { error: "note_too_long" }, "x"));
    const detail = await openDetail();
    fireEvent.click(await within(detail).findByRole("button", { name: "Registrar contato" }));
    const contactForm = within(detail).getByRole("region", { name: "Registrar contato" });
    fireEvent.change(within(contactForm).getByLabelText("Como foi o contato"), { target: { value: "phone" } });
    fireEvent.change(within(contactForm).getByLabelText("Resultado"), { target: { value: "reached" } });
    fireEvent.click(within(contactForm).getByRole("button", { name: "Salvar contato" }));
    expect((await within(contactForm).findByRole("alert")).textContent).not.toBe("");
    expect(within(contactForm).getByRole("alert").textContent).not.toContain("note_too_long");
    await waitFor(() => expect((within(contactForm).getByRole("button", { name: "Salvar contato" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("trocar a equipe no topo fecha o detalhe aberto e o painel de inscrição", async () => {
    const detail = await openDetail();
    expect(detail).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inscrever pessoa" }));
    expect(screen.getByRole("region", { name: "Inscrever pessoa" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Equipe"), { target: { value: "tm2" } });
    expect(screen.queryByRole("region", { name: "Inscrição de Maria das Dores" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Inscrever pessoa" })).toBeNull();
  });
});
