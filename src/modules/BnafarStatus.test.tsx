// src/modules/BnafarStatus.test.tsx — "Envio à BNAFAR" (módulo 27b; contrato §3, §7; Q8, Q25, Q32, Q40, Q42, Q44; F-02, F-05–F-07,
// F-13, F-14, F-23, F-26, F-34). Faixa, lista por dia e assunto, detalhe com os registros, "Reenviar recusados" e "Corrigir" com step-up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import {
  BNAFAR_DOMAINS, bnafarUser, exitRecord, externalExitDetail, lostRecord, record, rejectedSubmission, status, submission
} from "../test/bnafarFixtures";
import * as api from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { BNAFAR_DISABLED, BNAFAR_NO_ROLE, BNAFAR_NOT_USABLE, alertLines, bnafarErrorText } from "../lib/bnafar";
import { BnafarStatus } from "./BnafarStatus";
import { RECORD_GONE } from "./bnafar/CorrectionForm";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
  getBnafarStatus: vi.fn(), listBnafarSubmissions: vi.fn(), getBnafarSubmission: vi.fn(), retryBnafarSubmission: vi.fn(),
  correctBnafarRecord: vi.fn(), getExternalExit: vi.fn(), getBnafarDomains: vi.fn() }));

const ADMIN = () => bnafarUser([ "municipal_admin" ]);
const VIEW_POSITION = "Ver registros — 25/11/2026 Posição de estoque";
const VIEW_EXIT = "Ver registros — 25/11/2026 Saídas";

beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(bnafarUser());
  vi.mocked(api.getBnafarStatus).mockResolvedValue(status());
  vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission() ], next_before: null });
  vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission());
  vi.mocked(api.getBnafarDomains).mockResolvedValue(BNAFAR_DOMAINS);
  vi.mocked(api.getExternalExit).mockResolvedValue(externalExitDetail());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Envio à BNAFAR (27b)", () => {
  it("faixa do alerta e lista por dia e assunto, só leitura para o almoxarife", async () => {
    const alert = { late: 1, rejected: 2, lost: 3, last_finished_on: "2026-11-24" };
    vi.mocked(api.getBnafarStatus).mockResolvedValue(status({ environment: "homologation", alert }));
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({
      items: [
        submission({ id: "bs2", status: "finished", counts: { accepted: 12, rejected: 2, pending: 0, lost: 0 } }),
        submission({ id: "bs3", subject: "exit", status: "lost", counts: { accepted: 3, rejected: 0, pending: 0, lost: 4 } })
      ], next_before: "c1"
    });
    renderWithProviders(<BnafarStatus />);

    const band = await screen.findByRole("alert");
    for (const line of alertLines(alert)) expect(within(band).getByText(line)).not.toBeNull();
    expect(band.textContent).not.toContain("meia-noite");
    expect(screen.getByText("Homologação")).not.toBeNull();
    expect(screen.getByText("24/11/2026")).not.toBeNull();

    expect(await screen.findByRole("button", { name: VIEW_POSITION })).not.toBeNull();
    expect(screen.getByRole("button", { name: VIEW_EXIT })).not.toBeNull();
    expect(screen.getByText("12 aceitos · 2 recusados")).not.toBeNull();
    expect(screen.getByText("3 aceitos · 4 perdidos")).not.toBeNull();
    expect(screen.getByText("perdida", { selector: "span" })).not.toBeNull();
    expect(screen.getAllByText(fmtDateTime(submission().sent_at)).length).toBe(2);
    expect(screen.queryByText(/recebida/i)).toBeNull();

    // Filtros só valem no "Filtrar".
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "exit" } });
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "lost" } });
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-11-25" } });
    expect(api.listBnafarSubmissions).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(api.listBnafarSubmissions).toHaveBeenLastCalledWith(
      { from: "2026-11-01", to: "2026-11-25", subject: "exit", status: "lost", before: null }));

    // "Carregar mais" repassa o cursor.
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission({ id: "bs5", status: "lost" }) ], next_before: "c1" });
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(api.listBnafarSubmissions).toHaveBeenLastCalledWith(expect.objectContaining({ before: "c1" })));

    // O almoxarife lê o detalhe, sem reenviar nem corrigir.
    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({ records: [ record({ id: "br5", status: "rejected", error_codes: [ "MSG09" ], retry_until: "2026-11-27T23:59:59-03:00" }), exitRecord() ] }));
    fireEvent.click(screen.getAllByRole("button", { name: VIEW_POSITION })[0]);
    expect(await screen.findByText(bnafarErrorText("MSG09"))).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Reenviar recusados" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Corrigir/ })).toBeNull();
    expect(api.getBnafarDomains).not.toHaveBeenCalled();
  });

  it("sem alerta, nenhuma faixa; nenhuma remessa concluída ainda", async () => {
    vi.mocked(api.getBnafarStatus).mockResolvedValue(status({ alert: { late: 0, rejected: 0, lost: 0, last_finished_on: null } }));
    renderWithProviders(<BnafarStatus />);
    expect(await screen.findByText("nenhuma ainda")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reenviar: step-up, um pedido, janela fechada relê e mostra perdidos", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission({ id: "bs2", counts: { accepted: 1, rejected: 2, pending: 0, lost: 0 } }) ], next_before: null });
    let resolveRetry: (v: api.BnafarRetryResult) => void = () => {};
    vi.mocked(api.retryBnafarSubmission).mockReturnValueOnce(new Promise((r) => { resolveRetry = r; }));
    renderWithProviders(<BnafarStatus />);
    fireEvent.click(await screen.findByRole("button", { name: VIEW_POSITION }));

    // Prazo do recusado: o retry_until do api, formatado; sem conta de relógio.
    expect((await screen.findAllByText(`reenviar até ${fmtDateTime("2026-11-27T23:59:59-03:00")}`)).length).toBe(2);
    expect(screen.getByText("P-0002")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reenviar recusados" }));
    const action = await screen.findByRole("region", { name: "Reenviar recusados" });
    expect(within(action).getByText("Remonta e reenvia só os registros recusados desta remessa, com os dados corrigidos.")).not.toBeNull();
    expect(document.querySelectorAll("form form").length).toBe(0);
    const confirm = within(action).getByRole("button", { name: "Confirmar reenvio" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.retryBnafarSubmission).toHaveBeenCalledTimes(1);
    expect(api.retryBnafarSubmission).toHaveBeenCalledWith("bs2");
    resolveRetry({ batch: { id: "bb1", operation: "post", status: "queued", protocol: null }, retried: 2, submission: submission({ id: "bs2" }) });
    expect(await screen.findByText("2 registros recusados reenviados à BNAFAR.")).not.toBeNull();
    await waitFor(() => expect(api.getBnafarSubmission).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getBnafarStatus).toHaveBeenCalledTimes(2));
    expect(api.listBnafarSubmissions).toHaveBeenCalledTimes(2);

    // Step-up vencido: volta ao código, sem nova chamada.
    vi.mocked(api.retryBnafarSubmission).mockRejectedValueOnce(new api.ApiError(401, { error: "mfa_required" }, "401"));
    fireEvent.click(screen.getByRole("button", { name: "Reenviar recusados" }));
    fireEvent.click(within(await screen.findByRole("region", { name: "Reenviar recusados" })).getByRole("button", { name: "Confirmar reenvio" }));
    expect(await screen.findByLabelText("Código do autenticador")).not.toBeNull();
    expect(api.retryBnafarSubmission).toHaveBeenCalledTimes(2);

    // Janela fechada: a frase, UMA releitura, e o registro aparece perdido com o motivo.
    const reads = vi.mocked(api.getBnafarSubmission).mock.calls.length;
    vi.mocked(api.stepUpMfa).mockResolvedValue(undefined);
    vi.mocked(api.retryBnafarSubmission).mockRejectedValueOnce(new api.ApiError(409, { error: "retry_window_closed" }, "409"));
    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({ status: "lost", counts: { accepted: 1, rejected: 0, pending: 0, lost: 1 },
      records: [ record({ id: "br4" }), lostRecord() ] }));
    fireEvent.change(screen.getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reenvio" }));
    expect(await screen.findByText(bnafarErrorText("retry_window_closed"))).not.toBeNull();
    expect(await screen.findByText("perdido")).not.toBeNull();
    expect(vi.mocked(api.getBnafarSubmission).mock.calls.length).toBe(reads + 1);
    expect(api.retryBnafarSubmission).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText(bnafarErrorText("MSG09")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Reenviar recusados" })).toBeNull();
  });

  it("reenviar um único recusado: frase no singular", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission({ id: "bs2", counts: { accepted: 1, rejected: 1, pending: 0, lost: 0 } }) ], next_before: null });
    vi.mocked(api.retryBnafarSubmission).mockResolvedValueOnce({ batch: { id: "bb1", operation: "post", status: "queued", protocol: null }, retried: 1, submission: submission({ id: "bs2" }) });
    renderWithProviders(<BnafarStatus />);
    fireEvent.click(await screen.findByRole("button", { name: VIEW_POSITION }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar recusados" }));
    fireEvent.click(within(await screen.findByRole("region", { name: "Reenviar recusados" })).getByRole("button", { name: "Confirmar reenvio" }));
    expect(await screen.findByText("1 registro recusado reenviado à BNAFAR.")).not.toBeNull();
  });

  it("reenviar com o bnafar inutilizável: a frase da credencial", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission({ id: "bs2", counts: { accepted: 1, rejected: 2, pending: 0, lost: 0 } }) ], next_before: null });
    vi.mocked(api.retryBnafarSubmission).mockRejectedValue(new api.ApiError(403, { error: "feature_disabled", feature: "bnafar" }, "403"));
    renderWithProviders(<BnafarStatus />);
    fireEvent.click(await screen.findByRole("button", { name: VIEW_POSITION }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar recusados" }));
    fireEvent.click(within(await screen.findByRole("region", { name: "Reenviar recusados" })).getByRole("button", { name: "Confirmar reenvio" }));
    expect(await screen.findByText(BNAFAR_NOT_USABLE)).not.toBeNull();
  });

  it("corrigir só a saída externa aceita dentro do prazo; motivo e destino conferidos antes; 409 relê", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission({ id: "bs4", subject: "exit" }) ], next_before: null });
    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({ id: "bs4", subject: "exit", counts: { accepted: 2, rejected: 0, pending: 0, lost: 0 },
      records: [
        exitRecord({ id: "br2", item_label: "Amoxicilina saída" }),
        exitRecord({ id: "br7", item_label: "Sem prazo", correct_until: null }),
        exitRecord({ id: "br8", item_label: "Sem saída", stock_external_exit_id: null, stock_external_exit_version: null }),
        exitRecord({ id: "br9", item_label: "Recusada", status: "rejected", correct_until: null, retry_until: "2026-11-27T23:59:59-03:00" })
      ] }));
    renderWithProviders(<BnafarStatus />);
    fireEvent.click(await screen.findByRole("button", { name: VIEW_EXIT }));
    // O prazo aparece como o api manda, mesmo no registro sem a saída apontada (que não oferece "Corrigir").
    expect((await screen.findAllByText(`corrigir até ${fmtDateTime("2026-12-26T23:59:59-03:00")}`)).length).toBe(2);
    expect(screen.getAllByRole("button", { name: /^Corrigir — / }).map((b) => b.getAttribute("aria-label"))).toEqual([ "Corrigir — Amoxicilina saída" ]);

    fireEvent.click(screen.getByRole("button", { name: "Corrigir — Amoxicilina saída" }));
    await waitFor(() => expect(api.getExternalExit).toHaveBeenCalledWith("ex1"));
    const type = (await screen.findByLabelText("Tipo da saída")) as HTMLSelectElement;
    await waitFor(() => expect(type.value).toBe("S-D"));
    expect((screen.getByLabelText("Código do destino") as HTMLInputElement).value).toBe("2384299");

    // Conferidos antes de enviar: o motivo (10–500) e o destino.
    fireEvent.change(screen.getByLabelText("Código do destino"), { target: { value: "12345678" } });
    fireEvent.change(screen.getByLabelText("Por que corrigir"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    expect(await screen.findByText("o CNES tem 7 dígitos")).not.toBeNull();
    expect(screen.getByText("o motivo da correção tem de 10 a 500 caracteres")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Corrigir a saída externa" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Destino"), { target: { value: "cnpj" } });
    fireEvent.change(screen.getByLabelText("Código do destino"), { target: { value: "12.abc.345/01de-35" } });
    fireEvent.change(screen.getByLabelText("Por que corrigir"), { target: { value: "destino informado errado na saída" } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    const action = await screen.findByRole("region", { name: "Corrigir a saída externa" });
    expect(document.querySelectorAll("form form").length).toBe(0);

    // 409: a frase, UMA releitura (que traz a versão nova da saída, Q44), o digitado fica e nada é reenviado sozinho.
    const reads = vi.mocked(api.getBnafarSubmission).mock.calls.length;
    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({ id: "bs4", subject: "exit",
      records: [ exitRecord({ id: "br2", item_label: "Amoxicilina saída", stock_external_exit_version: 2 }) ] }));
    vi.mocked(api.getExternalExit).mockResolvedValue(externalExitDetail({ exit_type: "S-TR", destination_code: "2384300", version: 2 }));
    vi.mocked(api.correctBnafarRecord).mockRejectedValueOnce(new api.ApiError(409, { error: "external_exit_changed" }, "409"));
    fireEvent.click(within(action).getByRole("button", { name: "Confirmar correção" }));
    await waitFor(() => expect(api.correctBnafarRecord).toHaveBeenCalledWith("br2", {
      expected_version: 1, destination_kind: "cnpj", destination_code: "12ABC34501DE35", reason: "destino informado errado na saída"
    }));
    expect(await screen.findByText(bnafarErrorText("external_exit_changed"))).not.toBeNull();
    await waitFor(() => expect(vi.mocked(api.getBnafarSubmission).mock.calls.length).toBe(reads + 1));
    // A saída também é relida: o resumo mostra o que a outra pessoa gravou; o campo que o usuário não tocou (tipo) passa ao valor
    // novo, e o que ele digitou (destino) fica.
    await waitFor(() => expect(api.getExternalExit).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("2384300")).not.toBeNull();
    expect((screen.getByLabelText("Código do destino") as HTMLInputElement).value).toBe("12.abc.345/01de-35");
    expect((screen.getByLabelText("Tipo da saída") as HTMLSelectElement).value).toBe("S-TR");
    expect(api.correctBnafarRecord).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Corrigir a saída externa" })).toBeNull();

    // A correção seguinte vai com a versão relida.
    vi.mocked(api.correctBnafarRecord).mockResolvedValueOnce([ exitRecord({ id: "br10" }) ]);
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    fireEvent.click(within(await screen.findByRole("region", { name: "Corrigir a saída externa" })).getByRole("button", { name: "Confirmar correção" }));
    expect(await screen.findByText("Correção enviada. A BNAFAR substitui os registros desta saída.")).not.toBeNull();
    expect(api.correctBnafarRecord).toHaveBeenCalledTimes(2);
    // Só o que o usuário mexeu vai: o tipo gravado pela outra pessoa (S-TR) não é desfeito.
    expect(vi.mocked(api.correctBnafarRecord).mock.calls[1][1]).toEqual({
      expected_version: 2, destination_kind: "cnpj", destination_code: "12ABC34501DE35", reason: "destino informado errado na saída"
    });
    // Ao abrir, depois do 409 e depois da correção: uma leitura de cada.
    await waitFor(() => expect(api.getBnafarStatus).toHaveBeenCalledTimes(3));
    expect(api.listBnafarSubmissions).toHaveBeenCalledTimes(3);
  });

  it("409 com o tipo editado: o tipo fica e vai; o destino não tocado passa ao relido e não vai", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission({ id: "bs4", subject: "exit" }) ], next_before: null });
    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({ id: "bs4", subject: "exit", records: [ exitRecord({ item_label: "Amoxicilina saída" }) ] }));
    renderWithProviders(<BnafarStatus />);
    fireEvent.click(await screen.findByRole("button", { name: VIEW_EXIT }));
    fireEvent.click(await screen.findByRole("button", { name: "Corrigir — Amoxicilina saída" }));
    await waitFor(() => expect((screen.getByLabelText("Tipo da saída") as HTMLSelectElement).value).toBe("S-D"));
    fireEvent.change(screen.getByLabelText("Tipo da saída"), { target: { value: "S-E" } });
    fireEvent.change(screen.getByLabelText("Por que corrigir"), { target: { value: "era empréstimo, não doação" } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));

    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({ id: "bs4", subject: "exit",
      records: [ exitRecord({ item_label: "Amoxicilina saída", stock_external_exit_version: 2 }) ] }));
    vi.mocked(api.getExternalExit).mockResolvedValue(externalExitDetail({ destination_code: "2384300", version: 2 }));
    vi.mocked(api.correctBnafarRecord).mockRejectedValueOnce(new api.ApiError(409, { error: "external_exit_changed" }, "409"));
    fireEvent.click(within(await screen.findByRole("region", { name: "Corrigir a saída externa" })).getByRole("button", { name: "Confirmar correção" }));
    expect(await screen.findByText(bnafarErrorText("external_exit_changed"))).not.toBeNull();
    await waitFor(() => expect((screen.getByLabelText("Código do destino") as HTMLInputElement).value).toBe("2384300"));
    expect((screen.getByLabelText("Tipo da saída") as HTMLSelectElement).value).toBe("S-E");

    vi.mocked(api.correctBnafarRecord).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    fireEvent.click(within(await screen.findByRole("region", { name: "Corrigir a saída externa" })).getByRole("button", { name: "Confirmar correção" }));
    expect(await screen.findByText("Correção enviada. A BNAFAR substitui os registros desta saída.")).not.toBeNull();
    expect(vi.mocked(api.correctBnafarRecord).mock.calls[1][1]).toEqual({ expected_version: 2, exit_type: "S-E", reason: "era empréstimo, não doação" });
  });

  it("releitura da saída falha depois do 409: o formulário e o digitado ficam, com o erro no lugar", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission({ id: "bs4", subject: "exit" }) ], next_before: null });
    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({ id: "bs4", subject: "exit", records: [ exitRecord({ item_label: "Amoxicilina saída" }) ] }));
    renderWithProviders(<BnafarStatus />);
    fireEvent.click(await screen.findByRole("button", { name: VIEW_EXIT }));
    fireEvent.click(await screen.findByRole("button", { name: "Corrigir — Amoxicilina saída" }));
    await waitFor(() => expect((screen.getByLabelText("Tipo da saída") as HTMLSelectElement).value).toBe("S-D"));
    fireEvent.change(screen.getByLabelText("Tipo da saída"), { target: { value: "S-E" } });
    fireEvent.change(screen.getByLabelText("Por que corrigir"), { target: { value: "era empréstimo, não doação" } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    vi.mocked(api.getExternalExit).mockRejectedValue(new api.ApiError(500, { error: "internal_error" }, "500"));
    vi.mocked(api.correctBnafarRecord).mockRejectedValueOnce(new api.ApiError(409, { error: "external_exit_changed" }, "409"));
    fireEvent.click(within(await screen.findByRole("region", { name: "Corrigir a saída externa" })).getByRole("button", { name: "Confirmar correção" }));
    expect(await screen.findByText(/^não foi possível reler a saída — /)).not.toBeNull();
    expect((screen.getByLabelText("Tipo da saída") as HTMLSelectElement).value).toBe("S-E");
    expect((screen.getByLabelText("Por que corrigir") as HTMLTextAreaElement).value).toBe("era empréstimo, não doação");
    expect(screen.getByRole("button", { name: "Corrigir" })).not.toBeNull();
  });

  it("corrigir sem mudar tipo nem destino: recusa antes de enviar", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission({ id: "bs4", subject: "exit" }) ], next_before: null });
    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({ id: "bs4", subject: "exit", records: [ exitRecord({ item_label: "Amoxicilina saída" }) ] }));
    renderWithProviders(<BnafarStatus />);
    fireEvent.click(await screen.findByRole("button", { name: VIEW_EXIT }));
    fireEvent.click(await screen.findByRole("button", { name: "Corrigir — Amoxicilina saída" }));
    await waitFor(() => expect((screen.getByLabelText("Tipo da saída") as HTMLSelectElement).value).toBe("S-D"));
    fireEvent.change(screen.getByLabelText("Por que corrigir"), { target: { value: "motivo com mais de dez letras" } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    expect(await screen.findByText("mude o tipo ou o destino da saída antes de corrigir")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Corrigir a saída externa" })).toBeNull();
    expect(api.correctBnafarRecord).not.toHaveBeenCalled();
  });

  it("corrigir registro de outro ambiente (404, Q35): a frase e uma releitura", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    vi.mocked(api.listBnafarSubmissions).mockResolvedValue({ items: [ submission({ id: "bs4", subject: "exit" }) ], next_before: null });
    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({ id: "bs4", subject: "exit", records: [ exitRecord({ item_label: "Amoxicilina saída" }) ] }));
    vi.mocked(api.correctBnafarRecord).mockRejectedValue(new api.ApiError(404, { error: "not_found" }, "404"));
    renderWithProviders(<BnafarStatus />);
    fireEvent.click(await screen.findByRole("button", { name: VIEW_EXIT }));
    fireEvent.click(await screen.findByRole("button", { name: "Corrigir — Amoxicilina saída" }));
    await waitFor(() => expect((screen.getByLabelText("Tipo da saída") as HTMLSelectElement).value).toBe("S-D"));
    fireEvent.change(screen.getByLabelText("Tipo da saída"), { target: { value: "S-TR" } });
    fireEvent.change(screen.getByLabelText("Por que corrigir"), { target: { value: "tipo informado errado na saída" } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    const reads = vi.mocked(api.getBnafarSubmission).mock.calls.length;
    fireEvent.click(within(await screen.findByRole("region", { name: "Corrigir a saída externa" })).getByRole("button", { name: "Confirmar correção" }));
    expect(await screen.findByText(RECORD_GONE)).not.toBeNull();
    await waitFor(() => expect(vi.mocked(api.getBnafarSubmission).mock.calls.length).toBe(reads + 1));
    expect(screen.queryByRole("region", { name: "Corrigir a saída externa" })).toBeNull();
    expect(api.correctBnafarRecord).toHaveBeenCalledTimes(1);
  });

  it("aceito em parte, nomes do local e do item, MSG traduzida e desconhecida crua", async () => {
    vi.mocked(api.getBnafarSubmission).mockResolvedValue(rejectedSubmission({
      records: [
        record({ id: "br11", location_name: "Farmácia UBS Leste", item_label: "Dipirona 500 mg", rejected_items: 2, error_codes: [ "MSG72", "MSG99" ] }),
        record({ id: "br12", item_label: "Captopril", status: "rejected", error_codes: [ "MSG47", "MSG09" ], retry_until: "2026-11-27T23:59:59-03:00" }),
        record({ id: "br13", item_label: "Excluído", deleted: true })
      ]
    }));
    renderWithProviders(<BnafarStatus />);
    fireEvent.click(await screen.findByRole("button", { name: VIEW_POSITION }));
    expect(await screen.findByText("aceito em parte (2 itens)")).not.toBeNull();
    expect(screen.getByText("Farmácia UBS Leste")).not.toBeNull();
    expect(screen.getByText("Dipirona 500 mg")).not.toBeNull();
    expect(screen.getByText(bnafarErrorText("MSG72"))).not.toBeNull();
    expect(screen.getByText("recusa da BNAFAR: MSG99")).not.toBeNull();
    expect(screen.getByText(bnafarErrorText("MSG47"))).not.toBeNull();
    expect(screen.getByText(bnafarErrorText("MSG09"))).not.toBeNull();
    expect(screen.getByText("excluído na BNAFAR")).not.toBeNull();

    // Filtro dos registros e "Carregar mais" do detalhe (F-34).
    vi.mocked(api.getBnafarSubmission).mockResolvedValueOnce(rejectedSubmission({ next_before: "r1" }))
      .mockResolvedValueOnce(rejectedSubmission({ records: [ record({ id: "br20", item_label: "Página dois" }) ] }));
    fireEvent.change(screen.getByLabelText("Registros da remessa"), { target: { value: "rejected" } });
    await waitFor(() => expect(api.getBnafarSubmission).toHaveBeenLastCalledWith("bs1", { status: "rejected", before: null }));
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais registros" }));
    await waitFor(() => expect(api.getBnafarSubmission).toHaveBeenLastCalledWith("bs1", { status: "rejected", before: "r1" }));
    expect(await screen.findByText("Página dois")).not.toBeNull();
  });

  it("papel sem leitura no api (403 missing_role): a frase do papel, sem tela de erro", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(bnafarUser([ "professional" ]));
    vi.mocked(api.getBnafarStatus).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "403"));
    vi.mocked(api.listBnafarSubmissions).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "403"));
    renderWithProviders(<BnafarStatus />);
    expect(await screen.findByText(BNAFAR_NO_ROLE)).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Filtrar")).toBeNull();
  });

  it("sem bnafar: frase do interruptor e nenhuma leitura", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(bnafarUser([ "municipal_admin" ], [ "pharmacy" ]));
    renderWithProviders(<BnafarStatus />);
    expect(await screen.findByText(BNAFAR_DISABLED)).not.toBeNull();
    expect(api.getBnafarStatus).not.toHaveBeenCalled();
    expect(api.listBnafarSubmissions).not.toHaveBeenCalled();
    expect(api.getBnafarSubmission).not.toHaveBeenCalled();
  });
});
