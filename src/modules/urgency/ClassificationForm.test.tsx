// Classificação de risco na UPA (F-32.3; contrato §5, §14 Q1–Q3, Q18, Q19, Q22): sinais vitais do 18 sem a dor, a dor à parte e
// obrigatória, a cor sugerida com o critério (só depois da dor), a justificativa quando a cor é outra ou não há sugestão, e a
// reclassificação com o histórico. A queixa e os sinais só vão no corpo do pedido.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  getUrgencyEncounter: vi.fn(), suggestUrgencyColor: vi.fn(), classifyUrgency: vi.fn(), getUrgencyQueue: vi.fn()
}));

import * as api from "../../lib/api";
import { ApiError, type UrgencySuggestion } from "../../lib/api";
import {
  NURSE_LINK, UPA, classification, encounter, queue, suggestion, unidentifiedRef, urgencyUser
} from "../../test/urgencyFixtures";
import { ClassificationForm } from "./ClassificationForm";
import { DISCARD_QUESTION, NOTICE_MS, UrgencyDesk } from "./UrgencyDesk";

const CRITERION = "Temperatura de 39 °C ou mais";
const JUSTIFICATION_TEXT = "explique a cor escolhida (pelo menos 10 caracteres)";

afterEach(() => { cleanup(); vi.useRealTimers(); });
// Com chaves: o retorno do beforeEach vira teardown no vitest.
beforeEach(() => {
  vi.mocked(api.getUrgencyEncounter).mockReset();
  vi.mocked(api.suggestUrgencyColor).mockReset();
  vi.mocked(api.classifyUrgency).mockReset();
  vi.mocked(api.getUrgencyQueue).mockReset();
});

const onDone = vi.fn();
const onCancel = vi.fn();

function mount(props: { suggestDelayMs?: number } = {}) {
  onDone.mockReset(); onCancel.mockReset();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <ClassificationForm encounterId="en1" onDone={onDone} onCancel={onCancel} {...props} />
  </QueryClientProvider>);
  return client;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("Classificação de risco (F-32.3)", () => {
  it("sugestão com critério; cor igual não pede justificativa; envia queixa, sinais sem a dor e a dor à parte", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion());
    vi.mocked(api.classifyUrgency).mockResolvedValue({
      encounter: encounter({ state: "classified", color: "yellow", classifications: [ classification() ] }),
      suggested: suggestion().suggested
    });
    mount({ suggestDelayMs: 0 });
    fireEvent.change(await screen.findByLabelText("Queixa principal"), { target: { value: "febre e dor de cabeça" } });
    fireEvent.change(screen.getByLabelText("Temperatura (°C)"), { target: { value: "39,4" } });
    // O 18 mostra "Dor (0 a 10)" entre os sinais; aqui ela é um campo só (Q3), não dois.
    expect(screen.getAllByLabelText("Dor (0 a 10)").length).toBe(1);
    fireEvent.change(screen.getByLabelText("Dor (0 a 10)"), { target: { value: "5" } });
    expect(await screen.findByText(`Sugerida: amarelo — ${CRITERION}`)).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "amarelo · até 60 min" }));
    expect(screen.queryByLabelText("Justificativa")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Classificar" }));
    await waitFor(() => expect(api.classifyUrgency).toHaveBeenCalledTimes(1));
    const [ id, body ] = vi.mocked(api.classifyUrgency).mock.calls[0];
    expect(id).toBe("en1");
    expect(body).toEqual({ complaint: "febre e dor de cabeça", vital_signs: { temperature_c: 39.4 }, pain_scale: 5, color: "yellow" });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0][0]).toMatchObject({ id: "en1", state: "classified" });
  });

  it("a prévia só depois da dor (Q22): sem a queixa e sem pain_score no corpo; o detalhe é lido pelo id", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion());
    mount({ suggestDelayMs: 0 });
    fireEvent.change(await screen.findByLabelText("Queixa principal"), { target: { value: "febre alta" } });
    fireEvent.change(screen.getByLabelText("Temperatura (°C)"), { target: { value: "39,4" } });
    expect(screen.getByText("Informe a dor para ver a cor sugerida.")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.suggestUrgencyColor).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Dor (0 a 10)"), { target: { value: "3" } });
    await screen.findByText(`Sugerida: amarelo — ${CRITERION}`);
    expect(api.suggestUrgencyColor).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.suggestUrgencyColor).mock.calls[0][0]).toEqual({ encounter_id: "en1", vital_signs: { temperature_c: 39.4 }, pain_scale: 3 });
    expect(vi.mocked(api.getUrgencyEncounter).mock.calls[0][0]).toBe("en1");
  });

  it("espera a pessoa parar de digitar e ignora a resposta velha", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    const first = deferred<UrgencySuggestion>();
    const second = deferred<UrgencySuggestion>();
    vi.mocked(api.suggestUrgencyColor).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mount({ suggestDelayMs: 30 });
    const pain = await screen.findByLabelText("Dor (0 a 10)");
    // Três teclas seguidas: um pedido só, com o valor final.
    fireEvent.change(pain, { target: { value: "1" } });
    fireEvent.change(pain, { target: { value: "" } });
    fireEvent.change(pain, { target: { value: "4" } });
    await waitFor(() => expect(api.suggestUrgencyColor).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.suggestUrgencyColor).mock.calls[0][0].pain_scale).toBe(4);
    fireEvent.change(pain, { target: { value: "8" } });
    await waitFor(() => expect(api.suggestUrgencyColor).toHaveBeenCalledTimes(2));
    second.resolve(suggestion({ suggested: { color: "orange", criterion: "Dor intensa (8 a 10)", rule_id: "dor-intensa" } }));
    expect(await screen.findByText("Sugerida: laranja — Dor intensa (8 a 10)")).not.toBeNull();
    first.resolve(suggestion({ suggested: { color: "green", criterion: "Dor leve (2 a 4)", rule_id: "dor-leve" } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Sugerida: verde — Dor leve (2 a 4)")).toBeNull();
    expect(screen.getByText("Sugerida: laranja — Dor intensa (8 a 10)")).not.toBeNull();
  });

  it("limpar a dor esconde a sugestão velha na hora; o envio nunca sai de uma sugestão velha", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    const later = deferred<UrgencySuggestion>();
    vi.mocked(api.suggestUrgencyColor).mockResolvedValueOnce(suggestion()).mockReturnValueOnce(later.promise);
    mount({ suggestDelayMs: 0 });
    fireEvent.change(await screen.findByLabelText("Queixa principal"), { target: { value: "febre" } });
    const pain = screen.getByLabelText("Dor (0 a 10)");
    fireEvent.change(pain, { target: { value: "5" } });
    await screen.findByText(`Sugerida: amarelo — ${CRITERION}`);
    fireEvent.change(pain, { target: { value: "" } });
    // Na mesma renderização, sem esperar a espera curta.
    expect(screen.queryByText(`Sugerida: amarelo — ${CRITERION}`)).toBeNull();
    expect(screen.getByText("Informe a dor para ver a cor sugerida.")).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "amarelo · até 60 min" }));
    fireEvent.change(pain, { target: { value: "9" } });
    expect(screen.queryByText(`Sugerida: amarelo — ${CRITERION}`)).toBeNull();
    // A sugestão da dor 5 não vale para a dor 9: o envio espera a nova.
    const go = screen.getByRole("button", { name: "Classificar" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(go);
    expect(api.classifyUrgency).not.toHaveBeenCalled();
    later.resolve(suggestion({ suggested: { color: "orange", criterion: "Dor intensa (8 a 10)", rule_id: "dor-intensa" } }));
    expect(await screen.findByText("Sugerida: laranja — Dor intensa (8 a 10)")).not.toBeNull();
    // Amarelo agora é outra cor que a sugerida: pede justificativa.
    expect(screen.getByLabelText("Justificativa")).not.toBeNull();
  });

  it("depois de justification_required, uma sugestão nova para outra dor volta à regra local", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion());
    vi.mocked(api.classifyUrgency).mockRejectedValue(new ApiError(422, { error: "justification_required", path: "justification" }, "x"));
    mount({ suggestDelayMs: 0 });
    fireEvent.change(await screen.findByLabelText("Queixa principal"), { target: { value: "febre" } });
    fireEvent.change(screen.getByLabelText("Dor (0 a 10)"), { target: { value: "5" } });
    await screen.findByText(`Sugerida: amarelo — ${CRITERION}`);
    fireEvent.click(screen.getByRole("radio", { name: "amarelo · até 60 min" }));
    expect(screen.queryByLabelText("Justificativa")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Classificar" }));
    expect(await screen.findByLabelText("Justificativa")).not.toBeNull();
    // A releitura da mesma dor mantém o pedido do api.
    await waitFor(() => expect(api.suggestUrgencyColor).toHaveBeenCalledTimes(2));
    await screen.findByText(`Sugerida: amarelo — ${CRITERION}`);
    expect(screen.getByLabelText("Justificativa")).not.toBeNull();
    // Outra dor, sugestão nova (amarela de novo): o pedido era para a anterior.
    fireEvent.change(screen.getByLabelText("Dor (0 a 10)"), { target: { value: "6" } });
    await waitFor(() => expect(api.suggestUrgencyColor).toHaveBeenCalledTimes(3));
    await screen.findByText(`Sugerida: amarelo — ${CRITERION}`);
    await waitFor(() => expect(screen.queryByLabelText("Justificativa")).toBeNull());
  });

  it("sem protocolo ativo: aviso e justificativa obrigatória", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion({ suggested: null }));
    mount({ suggestDelayMs: 0 });
    fireEvent.change(await screen.findByLabelText("Queixa principal"), { target: { value: "corte no braço" } });
    fireEvent.change(screen.getByLabelText("Dor (0 a 10)"), { target: { value: "2" } });
    expect(await screen.findByText("Sem cor sugerida: a cidade não tem protocolo ativo ou nenhuma regra casou. Explique a cor escolhida.")).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "verde · até 120 min" }));
    expect(screen.getByLabelText("Justificativa")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Classificar" }));
    expect(screen.getByText(JUSTIFICATION_TEXT)).not.toBeNull();
    expect(api.classifyUrgency).not.toHaveBeenCalled();
  });

  it("cor trocada pede justificativa; justification_required do api mostra o campo e mantém tudo; duplo clique envia uma vez", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion());
    vi.mocked(api.classifyUrgency).mockRejectedValue(new ApiError(422, { error: "justification_required", path: "justification" }, "x"));
    mount({ suggestDelayMs: 0 });
    fireEvent.change(await screen.findByLabelText("Queixa principal"), { target: { value: "febre" } });
    fireEvent.change(screen.getByLabelText("Dor (0 a 10)"), { target: { value: "5" } });
    await screen.findByText(`Sugerida: amarelo — ${CRITERION}`);
    // Laranja: o tom de urgente com o texto (o tema não tem laranja).
    fireEvent.click(screen.getByRole("radio", { name: "laranja · até 10 min" }));
    fireEvent.change(screen.getByLabelText("Justificativa"), { target: { value: "criança de 2 meses, febre alta" } });
    const go = screen.getByRole("button", { name: "Classificar" });
    fireEvent.click(go); fireEvent.click(go);
    expect(await screen.findByText(JUSTIFICATION_TEXT)).not.toBeNull();
    expect(api.classifyUrgency).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.classifyUrgency).mock.calls[0][1]).toEqual({
      complaint: "febre", vital_signs: {}, pain_scale: 5, color: "orange", justification: "criança de 2 meses, febre alta"
    });
    expect((screen.getByLabelText("Queixa principal") as HTMLTextAreaElement).value).toBe("febre");
    expect((screen.getByLabelText("Justificativa") as HTMLTextAreaElement).value).toBe("criança de 2 meses, febre alta");
    expect(screen.getAllByText(JUSTIFICATION_TEXT).length).toBe(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("recusa do api: cada problema no seu campo (pain_scale_required, sinal), o encerrado no topo", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion());
    vi.mocked(api.classifyUrgency)
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", problems: [
        { path: "pain_scale", error: "pain_scale_required" }, { path: "vital_signs.spo2", error: "invalid_request" } ] }, "x"))
      .mockRejectedValueOnce(new ApiError(409, { error: "encounter_closed" }, "x"));
    mount({ suggestDelayMs: 0 });
    fireEvent.change(await screen.findByLabelText("Queixa principal"), { target: { value: "febre" } });
    fireEvent.change(screen.getByLabelText("Dor (0 a 10)"), { target: { value: "5" } });
    await screen.findByText(`Sugerida: amarelo — ${CRITERION}`);
    fireEvent.click(screen.getByRole("radio", { name: "amarelo · até 60 min" }));
    fireEvent.click(screen.getByRole("button", { name: "Classificar" }));
    expect(await screen.findByText("informe a dor (0 a 10)")).not.toBeNull();
    expect(screen.getByText("Saturação (SpO2): valor fora do plausível — confira")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Classificar" }));
    expect(await screen.findByText("este atendimento já foi encerrado")).not.toBeNull();
    expect(screen.queryByText("informe a dor (0 a 10)")).toBeNull();
  });

  it("reclassificação: mostra a cor vigente e o histórico; o botão diz 'Reclassificar'", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter({ state: "classified", color: "yellow", max_wait_minutes: 60,
      first_classified_at: "2026-11-05T09:20:00-03:00", classifications: [
        classification({ id: "c2", position: 2, color: "yellow", classified_at: "2026-11-05T09:50:00-03:00", suggested_color: "green",
          suggested: { color: "green", criterion: "Dor leve (2 a 4)" }, criterion: null, justification: "piora da dor" }),
        classification({ id: "c1", position: 1, color: "green", classified_at: "2026-11-05T09:20:00-03:00", suggested_color: "green",
          suggested: { color: "green", criterion: "Dor leve (2 a 4)" }, criterion: "Dor leve (2 a 4)" }) ] }));
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion());
    mount({ suggestDelayMs: 0 });
    expect(await screen.findByText("Cor vigente: amarelo (09:50, Ana Souza)")).not.toBeNull();
    // Na ordem, a vigente por último (pela posição, não pela ordem em que o api mandou).
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([ expect.stringContaining("09:20 · verde"), expect.stringContaining("09:50 · amarelo") ]);
    expect(items[0]).toContain("Dor leve (2 a 4)");
    expect(items[1]).toContain("piora da dor");
    expect(screen.getByRole("button", { name: "Reclassificar" })).not.toBeNull();
  });

  it("estouro vem do api (Q18) e a descrição do não identificado aparece no resumo", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter({
      state: "classified", color: "orange", max_wait_minutes: 10, overdue: true,
      patient: unidentifiedRef({ description: "homem, cerca de 40 anos, achado na rodoviária" }),
      classifications: [ classification({ color: "orange" }) ]
    }));
    mount({ suggestDelayMs: 0 });
    expect(await screen.findByText("passou do tempo máximo (até 10 min)")).not.toBeNull();
    expect(screen.getByText("homem, cerca de 40 anos, achado na rodoviária")).not.toBeNull();
    expect(screen.getByText("sem identificação")).not.toBeNull();
  });

  it("sinal fora do plausível: a frase do 18 no campo, sem enviar", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    mount({ suggestDelayMs: 0 });
    fireEvent.change(await screen.findByLabelText("Saturação (SpO2) (%)"), { target: { value: "140" } });
    fireEvent.click(screen.getByRole("button", { name: "Classificar" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    // A frase do sinal aparece uma vez só (o campo do 18), não repetida no resumo dos problemas.
    expect(screen.getAllByText("use de 50 a 100 %").length).toBe(1);
    expect(api.classifyUrgency).not.toHaveBeenCalled();
    expect(api.suggestUrgencyColor).not.toHaveBeenCalled();
  });

  it("'Cancelar' chama onCancel", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    mount({ suggestDelayMs: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("Mesa da UPA: classificação", () => {
  function mountDesk() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      <UrgencyDesk unit={UPA} user={urgencyUser([ "health_professional" ])} links={[ NURSE_LINK ]} />
    </QueryClientProvider>);
    return client;
  }

  it("a enfermagem abre o painel com o foco no título; classificar fecha, relê a fila e limpa o detalhe", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion());
    vi.mocked(api.classifyUrgency).mockResolvedValue({
      encounter: encounter({ state: "classified", color: "yellow", classifications: [ classification() ] }), suggested: suggestion().suggested
    });
    const client = mountDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Classificar U-042" }));
    const panel = await screen.findByRole("region", { name: "Classificação de risco — U-042" });
    expect(document.activeElement?.textContent).toBe("Classificação de risco — U-042");
    // A linha classificada ganha "Reclassificar".
    expect(screen.getByRole("button", { name: "Reclassificar U-040" })).not.toBeNull();
    fireEvent.change(await within(panel).findByLabelText("Queixa principal"), { target: { value: "febre" } });
    fireEvent.change(within(panel).getByLabelText("Dor (0 a 10)"), { target: { value: "5" } });
    await within(panel).findByText(/^Sugerida: amarelo/, {}, { timeout: 2000 });
    fireEvent.click(within(panel).getByRole("radio", { name: "amarelo · até 60 min" }));
    const before = vi.mocked(api.getUrgencyQueue).mock.calls.length;
    fireEvent.click(within(panel).getByRole("button", { name: "Classificar" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Classificação de risco — U-042" })).toBeNull());
    await waitFor(() => expect(vi.mocked(api.getUrgencyQueue).mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByText("U-042 classificado: amarelo.")).not.toBeNull();
    expect(client.getQueryCache().findAll({ queryKey: [ "urgencyDetail" ] }).length).toBe(0);
  });

  it("Escape fecha o painel e limpa o detalhe do cache", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    const client = mountDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Classificar U-042" }));
    const panel = await screen.findByRole("region", { name: "Classificação de risco — U-042" });
    await within(panel).findByLabelText("Queixa principal");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Classificação de risco — U-042" })).toBeNull();
    expect(client.getQueryCache().findAll({ queryKey: [ "urgencyDetail" ] }).length).toBe(0);
  });

  async function openDirty() {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion());
    const client = mountDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Classificar U-042" }));
    const panel = await screen.findByRole("region", { name: "Classificação de risco — U-042" });
    fireEvent.change(await within(panel).findByLabelText("Queixa principal"), { target: { value: "febre" } });
    return { client, panel };
  }

  it("com algo digitado, Escape pergunta antes; continuar mantém tudo; descartar fecha e limpa o detalhe", async () => {
    const { client, panel } = await openDirty();
    fireEvent.keyDown(panel, { key: "Escape" });
    const dialog = screen.getByRole("alertdialog", { name: "Descartar a classificação?" });
    expect(within(dialog).getByText(DISCARD_QUESTION)).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Continuar classificando");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continuar classificando" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((within(panel).getByLabelText("Queixa principal") as HTMLTextAreaElement).value).toBe("febre");
    fireEvent.keyDown(panel, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.queryByRole("region", { name: "Classificação de risco — U-042" })).toBeNull();
    expect(client.getQueryCache().findAll({ queryKey: [ "urgencyDetail" ] }).length).toBe(0);
  });

  it("com algo digitado, 'Cancelar' também pergunta antes", async () => {
    const { panel } = await openDirty();
    fireEvent.click(within(panel).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("alertdialog", { name: "Descartar a classificação?" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "Classificação de risco — U-042" })).not.toBeNull();
  });

  it("Escape dentro de um campo não fecha o painel", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    mountDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Classificar U-042" }));
    const panel = await screen.findByRole("region", { name: "Classificação de risco — U-042" });
    fireEvent.keyDown(await within(panel).findByLabelText("Queixa principal"), { key: "Escape" });
    expect(screen.getByRole("region", { name: "Classificação de risco — U-042" })).not.toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("com algo digitado, outra linha pergunta antes de trocar o painel", async () => {
    await openDirty();
    fireEvent.click(screen.getByRole("button", { name: "Reclassificar U-040" }));
    expect(screen.getByRole("alertdialog", { name: "Descartar a classificação?" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "Classificação de risco — U-042" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(await screen.findByRole("region", { name: "Classificação de risco — U-040" })).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Classificação de risco — U-042" })).toBeNull();
  });

  it("sem nada digitado, outra linha troca o painel na hora", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    mountDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Classificar U-042" }));
    await screen.findByLabelText("Queixa principal");
    fireEvent.click(screen.getByRole("button", { name: "Reclassificar U-040" }));
    expect(await screen.findByRole("region", { name: "Classificação de risco — U-040" })).not.toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("o aviso de classificado some sozinho", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter());
    vi.mocked(api.suggestUrgencyColor).mockResolvedValue(suggestion());
    vi.mocked(api.classifyUrgency).mockResolvedValue({
      encounter: encounter({ state: "classified", color: "yellow", classifications: [ classification() ] }), suggested: suggestion().suggested
    });
    mountDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Classificar U-042" }));
    const panel = await screen.findByRole("region", { name: "Classificação de risco — U-042" });
    fireEvent.change(await within(panel).findByLabelText("Queixa principal"), { target: { value: "febre" } });
    fireEvent.change(within(panel).getByLabelText("Dor (0 a 10)"), { target: { value: "5" } });
    await within(panel).findByText(/^Sugerida: amarelo/, {}, { timeout: 2000 });
    fireEvent.click(within(panel).getByRole("radio", { name: "amarelo · até 60 min" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Classificar" }));
    expect(await screen.findByText("U-042 classificado: amarelo.")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(NOTICE_MS); });
    expect(screen.queryByText("U-042 classificado: amarelo.")).toBeNull();
  });

  it("o médico não vê 'Classificar'", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      <UrgencyDesk unit={UPA} user={urgencyUser([ "health_professional" ])}
        links={[ { ...NURSE_LINK, id: "l2", cbo_code: "225125", cbo_title: "Médico clínico" } ]} />
    </QueryClientProvider>);
    await screen.findByRole("region", { name: "Aguardando classificação" });
    expect(screen.queryByRole("button", { name: "Classificar U-042" })).toBeNull();
  });
});
