import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  getMyProfessional: vi.fn(), getConsultationOptions: vi.fn(), listReturnedRequests: vi.fn(), complementRegulationRequest: vi.fn(),
  searchRegulationTargets: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { RegulationReturned } from "./RegulationReturned";
import { STALE_TEXT } from "../lib/regulation";
import { renderWithProviders } from "../test/campaignFixtures";
import { regRequest, regUser } from "../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const link = (id: string, unit: string, name: string, ended: string | null = null, cbo = "225142") => ({ id, health_unit_id: unit, unit_name: name,
  cbo_code: cbo, cbo_title: "Médico clínico", started_at: "2026-01-01", started_by: "adm", ended_at: ended, ended_by: null });
const RETURNED = regRequest({ status: "returned", version: 4, events: [
  { status: "pending", at: "2026-10-08T10:00:00-03:00", by: { name: "Dra. Helena Prado" }, reason: null },
  { status: "returned", at: "2026-10-20T15:00:00-03:00", by: { name: "Regulador" }, reason: "Falta o resultado do teste ergométrico" } ] });
const profile = (links: ReturnType<typeof link>[]) => ({ professional: { id: "p1" }, shifts: [], links });

describe("RegulationReturned", () => {
  beforeEach(() => {
    for (const fn of [ api.listReturnedRequests, api.complementRegulationRequest, api.getMyProfessional, api.getConsultationOptions ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "health_professional" ]));
    mocked(api.getMyProfessional).mockResolvedValue(profile([ link("l1", "u1", "UBS Centro"), link("l2", "u3", "UBS Vila"),
      link("l3", "u9", "UBS Antiga", "2026-05-01") ]));
    mocked(api.getConsultationOptions).mockResolvedValue({ care_types: [], conducts: [], cid10_allowed_for_cbo: true });
    mocked(api.listReturnedRequests).mockResolvedValue([ RETURNED ]);
    mocked(api.complementRegulationRequest).mockResolvedValue(regRequest({ status: "pending", version: 5 }));
  });

  it("escolhe a unidade entre os vínculos ativos e mostra o motivo da devolução", async () => {
    renderWithProviders(<RegulationReturned />);
    const select = await screen.findByLabelText("Unidade");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([ "UBS Centro", "UBS Vila" ]);
    await waitFor(() => expect(mocked(api.listReturnedRequests)).toHaveBeenCalledWith("u1"));
    const row = await screen.findByRole("listitem", { name: "Cardiologia de Joana Lima" });
    expect(within(row).getByText("Falta o resultado do teste ergométrico")).not.toBeNull();
    fireEvent.change(select, { target: { value: "u3" } });
    await waitFor(() => expect(mocked(api.listReturnedRequests)).toHaveBeenLastCalledWith("u3"));
  });

  it("devolvido sem cor confirmada mostra a cor sugerida, marcada como sugerida", async () => {
    mocked(api.listReturnedRequests).mockResolvedValue([ { ...RETURNED, color: null, suggested_color: "red" } ]);
    renderWithProviders(<RegulationReturned />);
    const row = await screen.findByRole("listitem", { name: "Cardiologia de Joana Lima" });
    expect(within(row).getByText("vermelho")).not.toBeNull();
    expect(within(row).getByText("sugerida")).not.toBeNull();
  });

  it("um vínculo só: sem seletor, a unidade aparece como texto", async () => {
    mocked(api.getMyProfessional).mockResolvedValue(profile([ link("l1", "u1", "UBS Centro") ]));
    renderWithProviders(<RegulationReturned />);
    await screen.findByRole("listitem", { name: "Cardiologia de Joana Lima" });
    expect(screen.queryByLabelText("Unidade")).toBeNull();
    expect(screen.getByText("UBS Centro")).not.toBeNull();
    expect(mocked(api.listReturnedRequests)).toHaveBeenCalledWith("u1");
  });

  it("sem vínculo ativo: frase, sem leitura nominal", async () => {
    mocked(api.getMyProfessional).mockResolvedValue(profile([ link("l3", "u9", "UBS Antiga", "2026-05-01") ]));
    renderWithProviders(<RegulationReturned />);
    expect(await screen.findByText("você não tem vínculo ativo em nenhuma unidade")).not.toBeNull();
    expect(mocked(api.listReturnedRequests)).not.toHaveBeenCalled();
  });

  it("complementar: justificativa nova, cor e versão; volta à fila com a data original", async () => {
    renderWithProviders(<RegulationReturned />);
    fireEvent.click(await screen.findByRole("button", { name: "Complementar" }));
    const field = screen.getByLabelText("Justificativa") as HTMLTextAreaElement;
    expect(field.value).toBe(RETURNED.justification);
    const next = `${RETURNED.justification} Teste ergométrico de 15/10: infradesnivelamento de ST.`;
    fireEvent.change(field, { target: { value: next } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar complemento" }));
    await waitFor(() => expect(mocked(api.complementRegulationRequest)).toHaveBeenCalledWith("rr1",
      { justification: next, cid10: "I209", suggested_color: "yellow", version: 4 }));
    expect(await screen.findByText("Pedido complementado: voltou para a fila da regulação, com a data do pedido original.")).not.toBeNull();
    expect(mocked(api.listReturnedRequests)).toHaveBeenCalledTimes(2);
  });

  it("enfermeira complementa com CIAP-2 sem mexer no CID-10", async () => {
    mocked(api.getMyProfessional).mockResolvedValue(profile([ link("l1", "u1", "UBS Centro", null, "223505") ]));
    mocked(api.getConsultationOptions).mockResolvedValue({ care_types: [], conducts: [], cid10_allowed_for_cbo: false });
    renderWithProviders(<RegulationReturned />);
    fireEvent.click(await screen.findByRole("button", { name: "Complementar" }));
    expect(screen.queryByLabelText("CID-10")).toBeNull();
    fireEvent.change(screen.getByLabelText("CIAP-2"), { target: { value: "k86" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar complemento" }));
    await waitFor(() => expect(mocked(api.complementRegulationRequest)).toHaveBeenCalledWith("rr1",
      { justification: RETURNED.justification, ciap2: "K86", suggested_color: "yellow", version: 4 }));
    expect(mocked(api.complementRegulationRequest).mock.calls[0][1]).not.toHaveProperty("cid10");
  });

  it("enfermeira complementa sem tocar em nada: o CID-10 da médica já basta", async () => {
    mocked(api.getMyProfessional).mockResolvedValue(profile([ link("l1", "u1", "UBS Centro", null, "223505") ]));
    mocked(api.getConsultationOptions).mockResolvedValue({ care_types: [], conducts: [], cid10_allowed_for_cbo: false });
    renderWithProviders(<RegulationReturned />);
    fireEvent.click(await screen.findByRole("button", { name: "Complementar" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar complemento" }));
    await waitFor(() => expect(mocked(api.complementRegulationRequest)).toHaveBeenCalledWith("rr1",
      { justification: RETURNED.justification, suggested_color: "yellow", version: 4 }));
  });

  it("409 stale_version: frase, o texto fica; 'Recarregar' mantém o rascunho e reenvia com a versão nova", async () => {
    mocked(api.complementRegulationRequest).mockRejectedValueOnce(new ApiError(409, { error: "stale_version" }, "x"));
    renderWithProviders(<RegulationReturned />);
    fireEvent.click(await screen.findByRole("button", { name: "Complementar" }));
    const next = "Texto novo do complemento, com o exame.";
    fireEvent.change(screen.getByLabelText("Justificativa"), { target: { value: next } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar complemento" }));
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    expect((screen.getByLabelText("Justificativa") as HTMLTextAreaElement).value).toBe(next);
    expect(mocked(api.listReturnedRequests)).toHaveBeenCalledTimes(1);
    mocked(api.listReturnedRequests).mockResolvedValue([ { ...RETURNED, version: 5 } ]);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(mocked(api.listReturnedRequests)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Recarregar" })).toBeNull());
    expect((screen.getByLabelText("Justificativa") as HTMLTextAreaElement).value).toBe(next);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enviar complemento" }));
    await waitFor(() => expect(mocked(api.complementRegulationRequest)).toHaveBeenLastCalledWith("rr1",
      { justification: next, cid10: "I209", suggested_color: "yellow", version: 5 }));
  });

  it("409 invalid_transition: frase do api e 'Recarregar'; pedido que sumiu da lista fecha o formulário", async () => {
    mocked(api.complementRegulationRequest).mockRejectedValue(new ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<RegulationReturned />);
    fireEvent.click(await screen.findByRole("button", { name: "Complementar" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar complemento" }));
    expect((await screen.findByRole("alert")).textContent).toBe("este pedido mudou de situação — recarregue");
    mocked(api.listReturnedRequests).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(await screen.findByText("nenhum pedido devolvido para esta unidade")).not.toBeNull();
    expect(screen.queryByLabelText("Justificativa")).toBeNull();
  });

  it("Recarregar com o pedido já fora de 'returned': fecha o formulário", async () => {
    mocked(api.complementRegulationRequest).mockRejectedValue(new ApiError(409, { error: "stale_version" }, "x"));
    renderWithProviders(<RegulationReturned />);
    fireEvent.click(await screen.findByRole("button", { name: "Complementar" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar complemento" }));
    await screen.findByRole("alert");
    mocked(api.listReturnedRequests).mockResolvedValue([ { ...RETURNED, status: "pending" } ]);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(screen.queryByLabelText("Justificativa")).toBeNull());
  });

  it("depois de complementar, o pedido some até a releitura terminar", async () => {
    renderWithProviders(<RegulationReturned />);
    fireEvent.click(await screen.findByRole("button", { name: "Complementar" }));
    let release: (rows: unknown[]) => void = () => undefined;
    mocked(api.listReturnedRequests).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar complemento" }));
    expect(await screen.findByText(/^Pedido complementado/)).not.toBeNull();
    expect(screen.queryByRole("listitem", { name: "Cardiologia de Joana Lima" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complementar" })).toBeNull();
    release([]);
    expect(await screen.findByText("nenhum pedido devolvido para esta unidade")).not.toBeNull();
  });

  it("'Complementar' fica desabilitado até as regras de diagnóstico chegarem", async () => {
    let release: (v: unknown) => void = () => undefined;
    mocked(api.getConsultationOptions).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    renderWithProviders(<RegulationReturned />);
    const button = await screen.findByRole("button", { name: "Complementar" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    release({ care_types: [], conducts: [], cid10_allowed_for_cbo: true });
    await waitFor(() => expect((screen.getByRole("button", { name: "Complementar" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("falha nas regras de diagnóstico: alerta e 'Complementar' continua desabilitado", async () => {
    mocked(api.getConsultationOptions).mockRejectedValue(new ApiError(500, { error: "boom" }, "x"));
    renderWithProviders(<RegulationReturned />);
    expect((await screen.findByRole("alert")).textContent).toBe("não foi possível ler as regras de diagnóstico — recarregue a página");
    expect(((await screen.findByRole("button", { name: "Complementar" })) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sem devolvidos: estado vazio", async () => {
    mocked(api.listReturnedRequests).mockResolvedValue([]);
    renderWithProviders(<RegulationReturned />);
    expect(await screen.findByText("nenhum pedido devolvido para esta unidade")).not.toBeNull();
  });

  it("falha na leitura: frase em alerta", async () => {
    mocked(api.listReturnedRequests).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    renderWithProviders(<RegulationReturned />);
    expect((await screen.findByRole("alert")).textContent).toBe("seu papel não permite usar a regulação municipal");
  });

  it("sem o papel de profissional: nada é lido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "care_regulator" ]));
    renderWithProviders(<RegulationReturned />);
    expect(await screen.findByText("seu papel não permite usar a regulação municipal")).not.toBeNull();
    expect(mocked(api.getMyProfessional)).not.toHaveBeenCalled();
    expect(mocked(api.listReturnedRequests)).not.toHaveBeenCalled();
  });
});
