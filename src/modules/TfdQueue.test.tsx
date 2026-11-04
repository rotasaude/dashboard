import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { DEST_CURITIBA, NOW30, TODAY30, tfdCase, tfdLeg, tfdRow, trUser } from "../test/transportFixtures";
import { TfdQueue } from "./TfdQueue";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listTfdCases: vi.fn(), readTfdCase: vi.fn(),
  decideTfdCase: vi.fn(), setTfdAppointment: vi.fn(), setTfdInpatient: vi.fn(), cancelTfdCase: vi.fn(), getTfdOptions: vi.fn(), stepUpMfa: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(user = trUser([ "tfd_committee" ])) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.listTfdCases).mockResolvedValue({ items: [ tfdRow() ], next_before: null });
  vi.mocked(api.getTfdOptions).mockResolvedValue({ destinations: [ DEST_CURITIBA ], providers: [ { id: "cp1", name: "Hospital de Olhos", ibge_code: "4106902" } ], min_distance_km: 50 });
  return renderWithProviders(<TfdQueue today={TODAY30} now={NOW30} />);
}

async function openCase() {
  fireEvent.click(await screen.findByRole("button", { name: "Ler o laudo de Maria da Silva" }));
  await screen.findByText("H25.1");
}

const mfaRequired = () => new ApiError(401, { error: "mfa_required" }, "401");
const closedWindow = () => ({ ...trUser([ "tfd_committee" ]), mfa_verified_at: null });

describe("comissão de TFD", () => {
  it("a fila não traz dado clínico; o laudo só abre no clique, uma vez", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase());
    mount();
    expect(await screen.findByText("Maria da Silva")).not.toBeNull();
    expect(api.listTfdCases).toHaveBeenCalledWith({ status: "submitted", before: null });
    expect(screen.queryByText("H25.1")).toBeNull();
    expect(api.readTfdCase).not.toHaveBeenCalled();
    expect(screen.getByText("Abrir o laudo fica registrado na trilha de acesso.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ler o laudo de Maria da Silva" }));
    expect(await screen.findByText("H25.1")).not.toBeNull();
    expect(screen.getByText("Sem oftalmologia cirúrgica no município.")).not.toBeNull();
    expect(api.readTfdCase).toHaveBeenCalledTimes(1);
  });

  it("abrir põe o foco no título; fechar tira o laudo da tela", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase());
    mount();
    await openCase();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Laudo de Maria da Silva" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar laudo" }));
    expect(screen.queryByText("H25.1")).toBeNull();
    expect(screen.queryByText("Sem oftalmologia cirúrgica no município.")).toBeNull();
  });

  it("autorizar sem atendimento não envia; step-up repete uma vez (Review Focus 4)", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase());
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ler o laudo de Maria da Silva" }));
    fireEvent.click(await screen.findByRole("button", { name: "Autorizar" }));
    expect(screen.getByText("marque o atendimento no destino antes de autorizar")).not.toBeNull();
    expect(api.decideTfdCase).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Motivo")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Marcar atendimento" }));
  });

  it("atendimento no passado conta como ausente: autorizar não envia", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase({ appointment_at: "2026-11-02T08:00:00-03:00" }));
    mount();
    await openCase();
    fireEvent.click(screen.getByRole("button", { name: "Autorizar" }));
    expect(screen.getByText("marque o atendimento no destino antes de autorizar")).not.toBeNull();
    expect(api.decideTfdCase).not.toHaveBeenCalled();
  });

  it("com atendimento: autoriza com motivo; mfa_required pede o código e repete uma vez", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase({ appointment_at: "2026-11-20T08:00:00-03:00" }));
    vi.mocked(api.decideTfdCase)
      .mockRejectedValueOnce(mfaRequired())
      .mockResolvedValueOnce(tfdCase({ status: "authorized", appointment_at: "2026-11-20T08:00:00-03:00" }));
    vi.mocked(api.stepUpMfa).mockResolvedValue(undefined as never);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ler o laudo de Maria da Silva" }));
    fireEvent.click(await screen.findByRole("button", { name: "Autorizar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "laudo completo e destino confirmado" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    fireEvent.change(await screen.findByLabelText(/código/i), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.decideTfdCase).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.decideTfdCase).mock.calls[1]).toEqual([ "c1", { decision: "authorize", reason: "laudo completo e destino confirmado" } ]);
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
    expect(await screen.findByText("autorizado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Autorizar" })).toBeNull();
  });

  it("motivo curto não envia; recusas do api aparecem todas de uma vez", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase({ appointment_at: "2026-11-20T08:00:00-03:00" }));
    vi.mocked(api.decideTfdCase).mockRejectedValueOnce(new ApiError(422, { error: "billing_unit_missing", problems: [
      { path: "tfd_billing_health_unit_id", error: "billing_unit_missing" }, { path: "report.cid10", error: "cid_required" } ] }, "422"));
    mount();
    await openCase();
    fireEvent.click(screen.getByRole("button", { name: "Recusar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("o motivo tem de 10 a 500 caracteres")).not.toBeNull();
    expect(api.decideTfdCase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Autorizar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "laudo completo e destino confirmado" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/falta a unidade de faturamento nos ajustes do transporte/)).not.toBeNull();
    expect(screen.getByText(/informe o CID-10/)).not.toBeNull();
  });

  it("marcar atendimento: no passado recusa; no futuro envia hora da cidade e prestador, com step-up", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase());
    vi.mocked(api.setTfdAppointment).mockResolvedValue(tfdCase({ appointment_at: "2026-11-20T08:00:00-03:00" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ler o laudo de Maria da Silva" }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar atendimento" }));
    fireEvent.change(await screen.findByLabelText("Data e hora do atendimento"), { target: { value: "2026-11-02T08:00" } });
    fireEvent.submit(screen.getByRole("form", { name: "Atendimento no destino" }));
    expect(screen.getByText("o atendimento não pode estar no passado")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Data e hora do atendimento"), { target: { value: "2026-11-20T08:00" } });
    fireEvent.change(screen.getByLabelText("Prestador"), { target: { value: "cp1" } });
    fireEvent.submit(screen.getByRole("form", { name: "Atendimento no destino" }));
    expect(api.setTfdAppointment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.setTfdAppointment).toHaveBeenCalledWith("c1", { appointment_at: "2026-11-20T08:00:00-03:00", provider_id: "cp1" }));
    expect(await screen.findByText("Atendimento no destino marcado.")).not.toBeNull();
  });

  it("marcar atendimento sem escolher prestador mantém o do laudo; janela fechada pede o código", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase());
    vi.mocked(api.setTfdAppointment).mockResolvedValue(tfdCase({ appointment_at: "2026-11-20T08:00:00-03:00" }));
    vi.mocked(api.stepUpMfa).mockResolvedValue(undefined as never);
    mount(closedWindow());
    await openCase();
    fireEvent.click(screen.getByRole("button", { name: "Marcar atendimento" }));
    fireEvent.change(await screen.findByLabelText("Data e hora do atendimento"), { target: { value: "2026-11-20T08:00" } });
    fireEvent.submit(screen.getByRole("form", { name: "Atendimento no destino" }));
    fireEvent.change(await screen.findByLabelText(/código/i), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.setTfdAppointment).toHaveBeenCalledWith("c1", { appointment_at: "2026-11-20T08:00:00-03:00" }));
    expect(api.stepUpMfa).toHaveBeenCalledWith("654321");
  });

  it("internação só em viagem marcada ou em viagem; datas conferidas; envia com step-up", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValueOnce(tfdCase());
    mount();
    await openCase();
    expect(screen.queryByRole("button", { name: "Registrar internação" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar laudo" }));

    const scheduled = tfdCase({ status: "scheduled", appointment_at: "2026-11-20T08:00:00-03:00", legs: [ tfdLeg({ date: "2026-11-01" }) ] });
    vi.mocked(api.readTfdCase).mockResolvedValueOnce(scheduled);
    vi.mocked(api.setTfdInpatient).mockResolvedValue({ ...scheduled, inpatient: [ { from: "2026-11-02", to: null } ] });
    await openCase();
    fireEvent.click(screen.getByRole("button", { name: "Registrar internação" }));
    expect(screen.getByText("Sem diária enquanto o paciente está internado no destino.")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Internado desde"), { target: { value: "2026-11-04" } });
    fireEvent.submit(screen.getByRole("form", { name: "Internação no destino" }));
    expect(screen.getByText("o início da internação não pode ser futuro")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Internado desde"), { target: { value: "2026-10-30" } });
    fireEvent.submit(screen.getByRole("form", { name: "Internação no destino" }));
    expect(screen.getByText("o início da internação não pode ser antes de 31/10/2026")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Internado desde"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("Alta em"), { target: { value: "2026-11-01" } });
    fireEvent.submit(screen.getByRole("form", { name: "Internação no destino" }));
    expect(screen.getByText("o fim não pode ser antes do início")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Alta em"), { target: { value: "" } });
    fireEvent.submit(screen.getByRole("form", { name: "Internação no destino" }));
    expect(api.setTfdInpatient).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.setTfdInpatient).toHaveBeenCalledWith("c1", { from: "2026-11-02" }));
    expect(await screen.findByText(/02\/11\/2026 — em aberto/)).not.toBeNull();
  });

  it("internação aberta: o formulário fecha a mesma estada; inpatient_open traduzido", async () => {
    const open = tfdCase({ status: "travelling", inpatient: [ { from: "2026-11-02", to: null } ] });
    vi.mocked(api.readTfdCase).mockResolvedValue(open);
    vi.mocked(api.setTfdInpatient).mockRejectedValueOnce(new ApiError(422, { error: "inpatient_open", path: "from" }, "422"));
    mount();
    await openCase();
    fireEvent.click(screen.getByRole("button", { name: "Registrar internação" }));
    expect((screen.getByLabelText("Internado desde") as HTMLInputElement).value).toBe("2026-11-02");
    fireEvent.change(screen.getByLabelText("Alta em"), { target: { value: "2026-11-03" } });
    fireEvent.submit(screen.getByRole("form", { name: "Internação no destino" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("já há uma internação aberta — feche-a primeiro")).not.toBeNull();
    expect(api.setTfdInpatient).toHaveBeenCalledWith("c1", { from: "2026-11-02", to: "2026-11-03" });
  });

  it("cancelar o processo: motivo e step-up; a situação muda na tela e a fila é relida", async () => {
    vi.mocked(api.readTfdCase).mockResolvedValue(tfdCase({ status: "authorized" }));
    vi.mocked(api.cancelTfdCase).mockResolvedValue(tfdCase({ status: "cancelled" }));
    mount();
    await openCase();
    expect(screen.queryByRole("button", { name: "Autorizar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar processo" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "paciente mudou de cidade" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.cancelTfdCase).toHaveBeenCalledWith("c1", "paciente mudou de cidade"));
    expect(await screen.findByText("cancelado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar processo" })).toBeNull();
    await waitFor(() => expect(api.listTfdCases).toHaveBeenCalledTimes(2));
  });

  it("processo encerrado não oferece ação; leitura recusada mostra a frase", async () => {
    vi.mocked(api.readTfdCase).mockRejectedValueOnce(new ApiError(404, { error: "not_found" }, "404"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ler o laudo de Maria da Silva" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    vi.mocked(api.readTfdCase).mockResolvedValueOnce(tfdCase({ status: "denied" }));
    await openCase();
    for (const name of [ "Autorizar", "Marcar atendimento", "Registrar internação", "Cancelar processo" ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("sem o papel: portão; filtro por situação vai na URL", async () => {
    mount(trUser([ "transport_dispatcher" ]));
    expect(await screen.findByText("seu papel não permite usar o TFD")).not.toBeNull();
    expect(api.listTfdCases).not.toHaveBeenCalled();
    cleanup();
    mount();
    fireEvent.change(await screen.findByLabelText("Situação"), { target: { value: "returned" } });
    await waitFor(() => expect(api.listTfdCases).toHaveBeenLastCalledWith({ status: "returned", before: null }));
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "" } });
    await waitFor(() => expect(api.listTfdCases).toHaveBeenLastCalledWith({ status: null, before: null }));
  });

  it("paginação: Próximos pede os itens depois do cursor; voltar ao início", async () => {
    mount();
    vi.mocked(api.listTfdCases).mockResolvedValueOnce({ items: [ tfdRow() ], next_before: "cur1" });
    expect(await screen.findByRole("button", { name: "Próximos" })).not.toBeNull();
    vi.mocked(api.listTfdCases).mockResolvedValueOnce({ items: [ tfdRow({ id: "c2", patient: { display_name: "José Souza" } }) ], next_before: null });
    fireEvent.click(screen.getByRole("button", { name: "Próximos" }));
    expect(await screen.findByText("José Souza")).not.toBeNull();
    expect(api.listTfdCases).toHaveBeenLastCalledWith({ status: "submitted", before: "cur1" });
    expect(screen.queryByRole("button", { name: "Próximos" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao início" }));
    await waitFor(() => expect(screen.queryByText("José Souza")).toBeNull());
  });
});
