// Configuração da ouvidoria (módulo 33; F-33.1): respondentes, assuntos e prazos, só do ouvidor (`lead`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { options, ombudsmanUser, settings33, subjects33 } from "../test/ombudsmanFixtures";
import * as api from "../lib/api";
import { ApiError, type SessionUser } from "../lib/api";
import { OMBUDSMAN_ERRORS, OMBUDSMAN_NO_ROLE } from "../lib/ombudsman";
import { OmbudsmanSettings } from "./OmbudsmanSettings";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getOmbudsmanSettings: vi.fn(),
  updateOmbudsmanSettings: vi.fn(), listOmbudsmanSubjects: vi.fn(), createOmbudsmanSubject: vi.fn(), updateOmbudsmanSubject: vi.fn(),
  listOmbudsmanResponders: vi.fn(), listResponderCandidates: vi.fn(), createOmbudsmanResponder: vi.fn(), updateOmbudsmanResponder: vi.fn(),
  getOmbudsmanOptions: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const RESPONDER: api.OmbudsmanResponder = {
  id: "r1", user: { id: "u7", email: "bruno@curitiba.demo", name: "Bruno Alves" },
  destination: { kind: "department", id: "dep1", name: "Assistência Farmacêutica" }, active: true
};

function mount(user: SessionUser = ombudsmanUser([ "ombudsman" ]), responders: api.OmbudsmanResponder[] = [ RESPONDER ]) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.getOmbudsmanSettings).mockResolvedValue(settings33());
  vi.mocked(api.listOmbudsmanSubjects).mockResolvedValue(subjects33());
  vi.mocked(api.listOmbudsmanResponders).mockResolvedValue(responders);
  vi.mocked(api.listResponderCandidates).mockResolvedValue([ { id: "u7", name: "Bruno Alves", email: "bruno@curitiba.demo" } ]);
  vi.mocked(api.getOmbudsmanOptions).mockResolvedValue(options());
  return renderWithProviders(<OmbudsmanSettings />);
}
const pending = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe("configuração da ouvidoria: prazos", () => {
  it("valores do api, recusa fora de 1–120 e do teto, grava o corpo inteiro", async () => {
    vi.mocked(api.updateOmbudsmanSettings).mockImplementation(async (s) => s);
    mount();
    const field = await screen.findByLabelText("Resposta ao cidadão (dias)");
    expect((field as HTMLInputElement).value).toBe("30");
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Teto diário de denúncias anônimas"), { target: { value: "1001" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
    expect(screen.getAllByRole("alert").length).toBe(2);
    expect(api.updateOmbudsmanSettings).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Teto diário de denúncias anônimas"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
    await waitFor(() => expect(api.updateOmbudsmanSettings).toHaveBeenCalledWith(settings33({ response_days: 20, anonymous_daily_cap: 80 })));
    expect(await screen.findByText("Prazos salvos.")).not.toBeNull();
  });

  it("os oito rótulos, a nota do decreto e o aviso de que vale para as abertas", async () => {
    mount();
    for (const label of [ "Resposta ao cidadão (dias)", "Prorrogação (dias)", "Manifestação urgente (dias)", "Prazo do complemento (dias)",
      "Resposta do destino (dias)", "Prorrogação do destino (dias)", "Aviso de prazo perto do fim (dias antes)", "Teto diário de denúncias anônimas" ]) {
      expect(await screen.findByLabelText(label)).not.toBeNull();
    }
    expect(screen.getByText(/Os prazos padrão vêm do modelo federal; confira o decreto municipal de ouvidoria \(gate do go-live\)\./)).not.toBeNull();
    expect(screen.getByText(/vale também para as manifestações já abertas/)).not.toBeNull();
  });

  it("não é número inteiro: recusa, não corta nem arredonda", async () => {
    mount();
    const field = await screen.findByLabelText("Prorrogação (dias)");
    for (const v of [ "1.5", "abc", "", "12x" ]) {
      fireEvent.change(field, { target: { value: v } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
      expect(screen.getAllByRole("alert").length).toBe(1);
    }
    expect(api.updateOmbudsmanSettings).not.toHaveBeenCalled();
    expect(field.getAttribute("maxlength")).toBeNull();
  });

  it("duplo clique: uma só chamada; recusa do api volta com a frase do campo", async () => {
    const gate = pending<api.OmbudsmanSettings>();
    vi.mocked(api.updateOmbudsmanSettings).mockReturnValueOnce(gate.promise);
    mount();
    await screen.findByLabelText("Resposta ao cidadão (dias)");
    const save = screen.getByRole("button", { name: "Salvar prazos" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(api.updateOmbudsmanSettings).toHaveBeenCalledTimes(1);
    gate.resolve(settings33());
    expect(await screen.findByText("Prazos salvos.")).not.toBeNull();
    vi.mocked(api.updateOmbudsmanSettings).mockRejectedValueOnce(
      new ApiError(422, { error: "invalid_request", problems: [ { error: "invalid_request", path: "warning_days" } ] }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
    expect(await screen.findByText("o prazo vai de 1 a 120 dias")).not.toBeNull();
  });
});

describe("configuração da ouvidoria: assuntos", () => {
  it("subassunto só sob assunto de primeiro nível ativo; desativados aparecem marcados", async () => {
    vi.mocked(api.createOmbudsmanSubject).mockResolvedValue({ id: "s13", name: "Acolhimento", active: true });
    mount();
    expect(await screen.findByText("Antigo")).not.toBeNull();
    expect(screen.getByText("Fila antiga")).not.toBeNull();
    expect(screen.getAllByText("desativado").length).toBe(2);
    const parent = screen.getByLabelText("Dentro de");
    expect([ ...(parent as HTMLSelectElement).options ].map((o) => o.text)).toEqual([ "— assunto de primeiro nível —", "Atendimento", "Transporte" ]);
    fireEvent.change(parent, { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Nome do assunto"), { target: { value: "Acolhimento" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar assunto" }));
    await waitFor(() => expect(api.createOmbudsmanSubject).toHaveBeenCalledWith({ name: "Acolhimento", parent_id: "s1" }));
  });

  it("assunto de primeiro nível manda parent_id nulo; nome de 1 caractere não sai; nome repetido dá a frase", async () => {
    vi.mocked(api.createOmbudsmanSubject).mockRejectedValueOnce(new ApiError(409, { error: "name_taken" }, "x"));
    mount();
    const name = await screen.findByLabelText("Nome do assunto");
    fireEvent.change(name, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar assunto" }));
    expect(api.createOmbudsmanSubject).not.toHaveBeenCalled();
    expect(screen.getByText("o nome tem de ter de 2 a 80 caracteres")).not.toBeNull();
    fireEvent.change(name, { target: { value: "Transporte" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar assunto" }));
    await waitFor(() => expect(api.createOmbudsmanSubject).toHaveBeenCalledWith({ name: "Transporte", parent_id: null }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.name_taken)).not.toBeNull();
  });

  it("too_deep volta com a frase do api", async () => {
    vi.mocked(api.createOmbudsmanSubject).mockRejectedValueOnce(
      new ApiError(422, { error: "too_deep", path: "parent_id" }, "x"));
    mount();
    fireEvent.change(await screen.findByLabelText("Nome do assunto"), { target: { value: "Filho" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar assunto" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.too_deep)).not.toBeNull();
  });

  it("renomeia e desativa/reativa sem mandar o pai; reativa o que estava desativado", async () => {
    vi.mocked(api.updateOmbudsmanSubject).mockImplementation(async (id, i) => ({ id, name: i.name, active: i.active }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Renomear Transporte" }));
    const input = screen.getByLabelText("Novo nome de Transporte");
    fireEvent.change(input, { target: { value: "T" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
    expect(api.updateOmbudsmanSubject).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Transporte sanitário" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
    await waitFor(() => expect(api.updateOmbudsmanSubject).toHaveBeenCalledWith("s6", { name: "Transporte sanitário", active: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Desativar Demora" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.updateOmbudsmanSubject).toHaveBeenCalledWith("s11", { name: "Demora", active: false }));
    fireEvent.click(screen.getByRole("button", { name: "Reativar Antigo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.updateOmbudsmanSubject).toHaveBeenCalledWith("s9", { name: "Antigo", active: true }));
  });

  it("recusa ao desativar aparece na tela", async () => {
    vi.mocked(api.updateOmbudsmanSubject).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Desativar Transporte" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.missing_role)).not.toBeNull();
  });
});

describe("configuração da ouvidoria: respondentes", () => {
  it("candidatos com nome e e-mail e destinos de options; já ligado dá a frase", async () => {
    vi.mocked(api.createOmbudsmanResponder).mockRejectedValue(new ApiError(409, { error: "already_responder" }, "x"));
    mount();
    const person = await screen.findByLabelText("Pessoa");
    await screen.findByRole("option", { name: "Bruno Alves — bruno@curitiba.demo" });
    fireEvent.change(person, { target: { value: "u7" } });
    const dest = screen.getByLabelText("Destino do respondente");
    // sem o filtro de respondente: destino sem respondente ativo continua escolhível
    expect((within(dest).getByRole("option", { name: "Regulação" }) as HTMLOptionElement).disabled).toBe(false);
    fireEvent.change(dest, { target: { value: "department:dep1" } });
    fireEvent.click(screen.getByRole("button", { name: "Ligar respondente" }));
    await waitFor(() => expect(api.createOmbudsmanResponder).toHaveBeenCalledWith({ user_id: "u7", department_id: "dep1" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.already_responder)).not.toBeNull();
  });

  it("unidade vai em health_unit_id; missing_responder_role fica no campo da pessoa", async () => {
    vi.mocked(api.createOmbudsmanResponder).mockRejectedValue(new ApiError(422, { error: "missing_responder_role", path: "user_id" }, "x"));
    mount();
    await screen.findByRole("option", { name: "Bruno Alves — bruno@curitiba.demo" });
    await screen.findByRole("option", { name: "UPA Boqueirão" });
    fireEvent.change(screen.getByLabelText("Pessoa"), { target: { value: "u7" } });
    fireEvent.change(screen.getByLabelText("Destino do respondente"), { target: { value: "health_unit:upa1" } });
    fireEvent.click(screen.getByRole("button", { name: "Ligar respondente" }));
    await waitFor(() => expect(api.createOmbudsmanResponder).toHaveBeenCalledWith({ user_id: "u7", health_unit_id: "upa1" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.missing_responder_role)).not.toBeNull();
  });

  it("sem pessoa e sem destino não sai; duplo clique manda uma vez e a lista é relida", async () => {
    const gate = pending<api.OmbudsmanResponder>();
    vi.mocked(api.createOmbudsmanResponder).mockReturnValueOnce(gate.promise);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ligar respondente" }));
    expect(api.createOmbudsmanResponder).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBe(2);
    await screen.findByRole("option", { name: "Bruno Alves — bruno@curitiba.demo" });
    await screen.findByRole("option", { name: "Regulação" });
    fireEvent.change(screen.getByLabelText("Pessoa"), { target: { value: "u7" } });
    fireEvent.change(screen.getByLabelText("Destino do respondente"), { target: { value: "department:dep2" } });
    const send = screen.getByRole("button", { name: "Ligar respondente" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(api.createOmbudsmanResponder).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(api.listOmbudsmanResponders).mock.calls.length;
    gate.resolve(RESPONDER);
    await waitFor(() => expect(vi.mocked(api.listOmbudsmanResponders).mock.calls.length).toBeGreaterThan(calls));
  });

  it("lista por destino; desativa e reativa com confirmação", async () => {
    vi.mocked(api.updateOmbudsmanResponder).mockResolvedValue({ ...RESPONDER, active: false });
    mount();
    expect(await screen.findByText("Bruno Alves")).not.toBeNull();
    expect(screen.getAllByText("Setor: Assistência Farmacêutica").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Desativar Bruno Alves — Assistência Farmacêutica" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.updateOmbudsmanResponder).toHaveBeenCalledWith("r1", { active: false }));
  });

  it("reativa um respondente desativado", async () => {
    vi.mocked(api.updateOmbudsmanResponder).mockResolvedValue(RESPONDER);
    mount(ombudsmanUser([ "ombudsman" ]), [ { ...RESPONDER, active: false } ]);
    fireEvent.click(await screen.findByRole("button", { name: "Reativar Bruno Alves — Assistência Farmacêutica" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.updateOmbudsmanResponder).toHaveBeenCalledWith("r1", { active: true }));
  });
});

describe("configuração da ouvidoria: portão", () => {
  it("o técnico não abre a configuração", async () => {
    mount(ombudsmanUser([ "ombudsman_staff" ]));
    expect(await screen.findByText(OMBUDSMAN_NO_ROLE)).not.toBeNull();
    expect(api.getOmbudsmanSettings).not.toHaveBeenCalled();
    expect(api.listOmbudsmanResponders).not.toHaveBeenCalled();
  });
});
