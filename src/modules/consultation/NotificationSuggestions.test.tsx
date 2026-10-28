// src/modules/consultation/NotificationSuggestions.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, getNotificationSuggestions: vi.fn(), createConsultationNotification: vi.fn(), listSurveillanceDiseases: vi.fn() };
});
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { NotificationSuggestions, SUGGESTION_PENDING_NOTE } from "./NotificationSuggestions";
import { DENGUE, MEASLES, TODAY25, disease, notification } from "../../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const mount = (finalizing = false, key = "cid10:A90") => render(
  <QueryClientProvider client={client()}>
    <NotificationSuggestions consultationId="cs1" problemsKey={key} today={TODAY25} finalizing={finalizing} />
  </QueryClientProvider>);

describe("NotificationSuggestions", () => {
  beforeEach(() => {
    for (const fn of [ api.getNotificationSuggestions, api.createConsultationNotification, api.listSurveillanceDiseases ]) mocked(fn).mockReset();
    mocked(api.getNotificationSuggestions).mockResolvedValue([ { disease: DENGUE, matched_code: "A90" } ]);
    mocked(api.listSurveillanceDiseases).mockResolvedValue([ DENGUE, MEASLES ]);
    mocked(api.createConsultationNotification).mockResolvedValue(notification());
  });

  it("sugestão do CID: notifica com a data dos sintomas; o corpo leva só ids, código e data", async () => {
    mount();
    expect(await screen.findByText("CID de notificação obrigatória (A90): notificar suspeita de Dengue")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Primeiros sintomas (opcional)"), { target: { value: "2026-10-24" } });
    fireEvent.click(screen.getByRole("button", { name: "Notificar suspeita de Dengue" }));
    expect((await screen.findByRole("status")).textContent).toBe("Suspeita de Dengue notificada à vigilância.");
    expect(mocked(api.createConsultationNotification).mock.calls[0][0]).toEqual({ consultation_id: "cs1", disease_code: "dengue", symptoms_on: "2026-10-24" });
    await waitFor(() => expect(mocked(api.getNotificationSuggestions)).toHaveBeenCalledTimes(2));
  });

  it("sem data dos sintomas, o corpo não leva symptoms_on", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Notificar suspeita de Dengue" }));
    await screen.findByRole("status");
    expect(mocked(api.createConsultationNotification).mock.calls[0][0]).toEqual({ consultation_id: "cs1", disease_code: "dengue" });
  });

  it("data dos sintomas no futuro é recusada antes de enviar", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Primeiros sintomas (opcional)"), { target: { value: "2026-10-28" } });
    fireEvent.click(screen.getByRole("button", { name: "Notificar suspeita de Dengue" }));
    expect((await screen.findByRole("alert")).textContent).toBe("data dos primeiros sintomas depois de hoje");
    expect(mocked(api.createConsultationNotification)).not.toHaveBeenCalled();
  });

  it("doença de prazo imediato mostra o prazo na sugestão; semanal não", async () => {
    mocked(api.getNotificationSuggestions).mockResolvedValue([ { disease: MEASLES, matched_code: "B059" } ]);
    mount();
    expect(await screen.findByText("CID de notificação obrigatória (B059): notificar suspeita de Sarampo")).not.toBeNull();
    expect(screen.getByText("imediata (24 h)")).not.toBeNull();
    cleanup();
    mocked(api.getNotificationSuggestions).mockResolvedValue([ { disease: DENGUE, matched_code: "A90" } ]);
    mount();
    await screen.findByText("CID de notificação obrigatória (A90): notificar suspeita de Dengue");
    expect(screen.queryByText("semanal (7 dias)")).toBeNull();
  });

  it("409 already_notified: frase e a sugestão some", async () => {
    mocked(api.createConsultationNotification).mockRejectedValue(new ApiError(409, { error: "already_notified" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Notificar suspeita de Dengue" }));
    expect((await screen.findByRole("alert")).textContent).toBe("já existe notificação desta doença em aberto (ou recente) para o paciente");
    expect(screen.queryByRole("button", { name: "Notificar suspeita de Dengue" })).toBeNull();
  });

  it.each([
    [ "cbo_not_allowed", 403, {}, "só médico ou enfermeiro notifica pela consulta" ],
    [ "not_author", 403, {}, "só quem atendeu a consulta pode notificar por ela" ],
    [ "invalid_disease", 422, {}, "doença fora da lista vigente — recarregue a lista" ],
    [ "feature_disabled", 403, { feature: "clinical_record" }, "Prontuário da atenção primária está desligado nesta cidade" ],
    [ "feature_disabled", 403, { feature: "surveillance" }, "a vigilância epidemiológica está desligada nesta cidade" ]
  ])("recusa %s fica na peça, em frase", async (error, status, extra, phrase) => {
    mocked(api.createConsultationNotification).mockRejectedValue(new ApiError(status, { error, ...extra }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Notificar suspeita de Dengue" }));
    expect((await screen.findByRole("alert")).textContent).toBe(phrase);
    expect(screen.getByRole("button", { name: "Notificar suspeita de Dengue" })).not.toBeNull();
  });

  it("falha de rede ao notificar: frase genérica na peça, sem repetir o corpo", async () => {
    mocked(api.createConsultationNotification).mockRejectedValue(new Error("boom"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Notificar suspeita de Dengue" }));
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert.length).toBeGreaterThan(0);
    expect(alert).not.toContain("boom");
  });

  it("leitura das sugestões que falha: o aviso fica na peça e a escolha manual continua", async () => {
    mocked(api.getNotificationSuggestions).mockRejectedValue(new ApiError(500, {}, "x"));
    mount();
    expect((await screen.findByRole("alert")).textContent?.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Notificar outra suspeita" })).not.toBeNull();
  });

  it("Notificar outra suspeita: escolhe a doença da lista da cidade", async () => {
    mocked(api.getNotificationSuggestions).mockResolvedValue([]);
    mount(false, "");
    fireEvent.click(await screen.findByRole("button", { name: "Notificar outra suspeita" }));
    await screen.findByRole("option", { name: "Sarampo" });
    fireEvent.change(screen.getByLabelText("Doença ou agravo"), { target: { value: "sarampo" } });
    fireEvent.click(screen.getByRole("button", { name: "Notificar suspeita" }));
    await waitFor(() => expect(mocked(api.createConsultationNotification).mock.calls[0][0]).toEqual({ consultation_id: "cs1", disease_code: "sarampo" }));
  });

  it("Notificar outra suspeita leva a mesma data dos sintomas", async () => {
    mocked(api.getNotificationSuggestions).mockResolvedValue([]);
    mount(false, "");
    fireEvent.click(await screen.findByRole("button", { name: "Notificar outra suspeita" }));
    await screen.findByRole("option", { name: "Sarampo" });
    fireEvent.change(screen.getByLabelText("Primeiros sintomas (opcional)"), { target: { value: "2026-10-25" } });
    fireEvent.change(screen.getByLabelText("Doença ou agravo"), { target: { value: "sarampo" } });
    fireEvent.click(screen.getByRole("button", { name: "Notificar suspeita" }));
    await waitFor(() => expect(mocked(api.createConsultationNotification).mock.calls[0][0])
      .toEqual({ consultation_id: "cs1", disease_code: "sarampo", symptoms_on: "2026-10-25" }));
  });

  it("o seletor mostra a nota da doença sem CID (só notificação manual) e não deixa notificar sem escolher", async () => {
    const manualOnly = disease({ code: "raiva", name: "Raiva humana", cid10: [], notes: "Sem CID próprio: notifique manualmente." });
    mocked(api.getNotificationSuggestions).mockResolvedValue([]);
    mocked(api.listSurveillanceDiseases).mockResolvedValue([ DENGUE, manualOnly ]);
    mount(false, "");
    fireEvent.click(await screen.findByRole("button", { name: "Notificar outra suspeita" }));
    await screen.findByRole("option", { name: "Raiva humana" });
    expect((screen.getByRole("button", { name: "Notificar suspeita" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Sem CID próprio: notifique manualmente.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Doença ou agravo"), { target: { value: "raiva" } });
    expect(screen.getByText("Sem CID próprio: notifique manualmente.")).not.toBeNull();
    expect(mocked(api.createConsultationNotification)).not.toHaveBeenCalled();
  });

  it("lista de doenças que falha: o aviso fica na peça", async () => {
    mocked(api.getNotificationSuggestions).mockResolvedValue([]);
    mocked(api.listSurveillanceDiseases).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    mount(false, "");
    fireEvent.click(await screen.findByRole("button", { name: "Notificar outra suspeita" }));
    expect((await screen.findByRole("alert")).textContent).toBe("seu papel não permite usar a vigilância epidemiológica");
  });

  it("finalizando com sugestão pendente: o aviso diz que a vigilância verá como possível", async () => {
    mount(true);
    expect(await screen.findByText(SUGGESTION_PENDING_NOTE)).not.toBeNull();
  });

  it("sem finalizar, ou sem sugestão pendente, não há aviso de finalização", async () => {
    mount(false);
    await screen.findByRole("button", { name: "Notificar suspeita de Dengue" });
    expect(screen.queryByText(SUGGESTION_PENDING_NOTE)).toBeNull();
    cleanup();
    mocked(api.getNotificationSuggestions).mockResolvedValue([]);
    mount(true, "");
    await screen.findByRole("button", { name: "Notificar outra suspeita" });
    expect(screen.queryByText(SUGGESTION_PENDING_NOTE)).toBeNull();
  });

  it("depois de notificada, o aviso de finalização some quando a leitura não traz mais a sugestão", async () => {
    mocked(api.getNotificationSuggestions).mockResolvedValueOnce([ { disease: DENGUE, matched_code: "A90" } ]).mockResolvedValue([]);
    mount(true);
    await screen.findByText(SUGGESTION_PENDING_NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Notificar suspeita de Dengue" }));
    await screen.findByRole("status");
    await waitFor(() => expect(screen.queryByText(SUGGESTION_PENDING_NOTE)).toBeNull());
  });

  it("o aviso pode ir para um destino fora da peça (a caixa de finalizar do editor)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { container } = render(
      <QueryClientProvider client={client()}>
        <NotificationSuggestions consultationId="cs1" problemsKey="cid10:A90" today={TODAY25} finalizing noteTarget={host} />
      </QueryClientProvider>);
    await waitFor(() => expect(host.textContent).toBe(SUGGESTION_PENDING_NOTE));
    expect(container.textContent).not.toContain(SUGGESTION_PENDING_NOTE);
    host.remove();
  });

  it("a chave dos problemas troca: relê as sugestões", async () => {
    const shared = client();
    const { rerender } = render(
      <QueryClientProvider client={shared}>
        <NotificationSuggestions consultationId="cs1" problemsKey="cid10:A90" today={TODAY25} finalizing={false} />
      </QueryClientProvider>);
    await screen.findByRole("button", { name: "Notificar suspeita de Dengue" });
    rerender(
      <QueryClientProvider client={shared}>
        <NotificationSuggestions consultationId="cs1" problemsKey="cid10:A90,cid10:B059" today={TODAY25} finalizing={false} />
      </QueryClientProvider>);
    await waitFor(() => expect(mocked(api.getNotificationSuggestions)).toHaveBeenCalledTimes(2));
  });
});
