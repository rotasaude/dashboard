// Fila da UPA (F-32.3; contrato §6, §14 Q6/Q18): três faixas, estouro por texto (nunca só por cor), nenhum texto clínico e
// polling sem timer sobrando. Os botões só aparecem com a ação ligada pela mesa e com o papel que o api aceita.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef, type Ref } from "react";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), getUrgencyQueue: vi.fn() }));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { NO_CLINICAL_IN_LIST } from "../../lib/urgency";
import { NOW32, UPA, colorRow, patientRef, queue, unidentifiedRef, waitingRow } from "../../test/urgencyFixtures";
import { UrgencyQueue, type UrgencyQueueHandle, type UrgencyQueueProps } from "./UrgencyQueue";

afterEach(cleanup);
// Com chaves: o retorno do beforeEach vira teardown no vitest (e a função mockada seria chamada).
beforeEach(() => { vi.mocked(api.getUrgencyQueue).mockReset(); });

type MountProps = Partial<Omit<UrgencyQueueProps, "roles">> & { roles: UrgencyQueueProps["roles"] };

function mount(props: MountProps, ref?: Ref<UrgencyQueueHandle>) {
  let current: UrgencyQueueProps = { unit: UPA, actions: {}, ...props };
  const ui = (p: UrgencyQueueProps) => <UrgencyQueue ref={ref} {...p} />;
  const r = render(ui(current));
  return {
    unmount: r.unmount,
    rerender: (next: Partial<UrgencyQueueProps>) => { current = { ...current, ...next }; r.rerender(ui(current)); }
  };
}

const ticketsOf = (region: HTMLElement) =>
  within(region).getAllByRole("row").slice(1).map((r) => within(r).getByTestId("ticket").textContent);

it("três faixas: aguardando classificação, por cor (na ordem do api) e em atendimento", async () => {
  vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({
    by_color: [ colorRow({ encounter_id: "r", color: "red", ticket: "U-039", waited_minutes: 3, overdue: true, max_wait_minutes: 0 }),
      colorRow({ encounter_id: "y", color: "yellow", ticket: "U-040", waited_minutes: 75, overdue: true }),
      colorRow({ encounter_id: "g", color: "green", ticket: "U-041", waited_minutes: 20 }) ]
  }));
  mount({ roles: { reception: false, nurse: true, doctor: true } });
  const awaiting = await screen.findByRole("region", { name: "Aguardando classificação" });
  expect(within(awaiting).getByText("U-042")).not.toBeNull();
  expect(within(awaiting).getByText("12 min desde a chegada")).not.toBeNull();
  const byColor = screen.getByRole("region", { name: "Classificados, por cor" });
  expect(ticketsOf(byColor)).toEqual([ "U-039", "U-040", "U-041" ]);
  expect(within(byColor).getByText("vermelho")).not.toBeNull();
  expect(within(byColor).getAllByText(/passou do tempo/).length).toBe(2);
  // waitLabel (FC-08): acima de 60 min em horas e minutos, como a fila do 13.
  expect(within(byColor).getByText("1 h 15 min · passou do tempo (até 60 min)")).not.toBeNull();
  expect(within(byColor).getByText("3 min · passou do tempo (imediato)")).not.toBeNull();
  expect(within(byColor).getByText("20 min")).not.toBeNull();
  const inCare = screen.getByRole("region", { name: "Em atendimento" });
  expect(ticketsOf(inCare)).toEqual([ "U-038" ]);
  // Laranja: o tom de urgente com o texto.
  expect(within(inCare).getByText("laranja")).not.toBeNull();
  expect(within(inCare).queryByText(/passou do tempo/)).toBeNull();
});

it("sem senha mostra '—'; a última chamada diz o tipo, o local e a hora", async () => {
  vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({
    awaiting_classification: [ waitingRow({ ticket: null,
      last_call: { kind: "classification", location: "Consultório 1", called_at: "2026-11-05T09:58:00-03:00" } }) ],
    by_color: [], in_care: []
  }));
  mount({ roles: { reception: true, nurse: false, doctor: false } });
  const awaiting = await screen.findByRole("region", { name: "Aguardando classificação" });
  expect(ticketsOf(awaiting)).toEqual([ "—" ]);
  expect(within(awaiting).getByText("classificação · Consultório 1 · 09:58")).not.toBeNull();
  expect(screen.getByText("ninguém classificado aguardando")).not.toBeNull();
  expect(screen.getByText("ninguém em atendimento")).not.toBeNull();
});

it("lista não mostra texto clínico nem a descrição, mesmo que o api mande", async () => {
  const leaky = { ...waitingRow({ patient: patientRef({ name: "Não identificado", unidentified: true, description: "achado na rodoviária" }) }),
    complaint: "dor no peito", cid: "I21" } as never;
  vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ awaiting_classification: [ leaky ] }));
  mount({ roles: { reception: true, nurse: false, doctor: false } });
  expect(await screen.findByText("Não identificado")).not.toBeNull();
  expect(screen.getByText("sem identificação")).not.toBeNull();
  expect(document.body.textContent).not.toMatch(/rodoviária|dor no peito|I21/);
  expect(screen.getByText(NO_CLINICAL_IN_LIST)).not.toBeNull();
  expect(screen.getByText(/^atualiza a cada 10 s · \d{2}:\d{2}$/)).not.toBeNull();
});

it("estouro também por texto, nunca só por cor", async () => {
  vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ by_color: [ colorRow({ overdue: true, waited_minutes: 61 }) ] }));
  mount({ roles: { reception: false, nurse: true, doctor: false } });
  expect(await screen.findByText("1 h 01 min · passou do tempo (até 60 min)")).not.toBeNull();
});

describe("ações por papel", () => {
  const actions = () => ({
    onClassify: vi.fn(), onCallClassification: vi.fn(), onCallCare: vi.fn(), onRecall: vi.fn(), onOpenCare: vi.fn(),
    onIdentify: vi.fn(), onLeft: vi.fn()
  });
  const calledQueue = () => queue({
    awaiting_classification: [ waitingRow({ last_call: { kind: "classification", location: "Classificação", called_at: "2026-11-05T09:58:00-03:00" } }),
      waitingRow({ encounter_id: "en5", attendance_id: "at5", ticket: "U-044", patient: unidentifiedRef() }) ]
  });

  it("enfermagem: classifica e chama para a classificação; não chama para o atendimento", async () => {
    const a = actions();
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(calledQueue());
    mount({ roles: { reception: false, nurse: true, doctor: false }, actions: a });
    const awaiting = await screen.findByRole("region", { name: "Aguardando classificação" });
    fireEvent.click(within(awaiting).getByRole("button", { name: "Classificar U-042" }));
    fireEvent.click(within(awaiting).getByRole("button", { name: "Chamar para classificação U-042" }));
    fireEvent.click(within(awaiting).getByRole("button", { name: "Chamar de novo U-042" }));
    expect(a.onClassify.mock.calls[0][0].encounter_id).toBe("en1");
    expect(a.onCallClassification.mock.calls[0][0].encounter_id).toBe("en1");
    expect(a.onRecall.mock.calls[0][0]).toMatchObject({ attendance_id: "at1" });
    const byColor = screen.getByRole("region", { name: "Classificados, por cor" });
    expect(within(byColor).getByRole("button", { name: "Reclassificar U-040" })).not.toBeNull();
    expect(within(byColor).queryByRole("button", { name: "Chamar U-040" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Atender/ })).toBeNull();
    // A8: só a recepção identifica.
    expect(screen.queryByRole("button", { name: /^Identificar/ })).toBeNull();
  });

  it("médico: chama por cor e atende; nada na faixa de quem aguarda classificação além da saída", async () => {
    const a = actions();
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(calledQueue());
    mount({ roles: { reception: false, nurse: false, doctor: true }, actions: a });
    const awaiting = await screen.findByRole("region", { name: "Aguardando classificação" });
    expect(within(awaiting).queryByRole("button", { name: /^(Chamar|Classificar)/ })).toBeNull();
    const byColor = screen.getByRole("region", { name: "Classificados, por cor" });
    fireEvent.click(within(byColor).getByRole("button", { name: "Chamar U-040" }));
    expect(a.onCallCare.mock.calls[0][0]).toMatchObject({ encounter_id: "en2", color: "yellow" });
    const inCare = screen.getByRole("region", { name: "Em atendimento" });
    fireEvent.click(within(inCare).getByRole("button", { name: "Atender U-038" }));
    expect(a.onOpenCare.mock.calls[0][0]).toMatchObject({ encounter_id: "en3", attendance_id: "at3" });
    expect(within(inCare).getByRole("button", { name: "Chamar de novo U-038" })).not.toBeNull();
  });

  it("recepção: identifica só o provisório, nunca chama de novo; a ação recebe a linha sem a descrição", async () => {
    const a = actions();
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(calledQueue());
    mount({ roles: { reception: true, nurse: false, doctor: false }, actions: a });
    const awaiting = await screen.findByRole("region", { name: "Aguardando classificação" });
    expect(within(awaiting).queryByRole("button", { name: "Identificar U-042" })).toBeNull();
    fireEvent.click(within(awaiting).getByRole("button", { name: "Identificar U-044" }));
    expect(a.onIdentify.mock.calls[0][0].patient).toEqual({ patient_id: "pa9", name: "Paciente não identificado", cns_masked: null, unidentified: true });
    expect(screen.queryByRole("button", { name: /^Chamar/ })).toBeNull();
    fireEvent.click(within(awaiting).getByRole("button", { name: "Saiu sem atendimento U-042" }));
    expect(a.onLeft.mock.calls[0][0].encounter_id).toBe("en1");
  });

  it("sem a ação ligada pela mesa, nenhum botão", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(calledQueue());
    mount({ roles: { reception: true, nurse: true, doctor: true } });
    await screen.findByRole("region", { name: "Aguardando classificação" });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

it("erro de leitura: a frase em alerta, mantendo a última fila; refresh pelo ref relê", async () => {
  vi.mocked(api.getUrgencyQueue).mockResolvedValueOnce(queue()).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const ref = createRef<UrgencyQueueHandle>();
  mount({ roles: { reception: true, nurse: false, doctor: false } }, ref);
  expect(await screen.findByText("U-042")).not.toBeNull();
  await act(async () => { ref.current?.refresh(); });
  expect(await screen.findByRole("alert")).not.toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("sem conexão com o servidor — tente de novo");
  expect(screen.getByText("U-042")).not.toBeNull();
  expect(api.getUrgencyQueue).toHaveBeenCalledTimes(2);
});

describe("polling", () => {
  // Relógio fixo (NOW32 = 10h de Brasília): a hora da última leitura sai no fuso da cidade (fmtHourMinute → cityDateFormat).
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW32); }); afterEach(() => { vi.useRealTimers(); });
  const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const forbidden = () => new ApiError(403, { error: "cbo_not_allowed" }, "x");

  it("a hora da última leitura, no fuso da cidade", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    mount({ roles: { reception: true, nurse: false, doctor: false } });
    await flush();
    expect(screen.getByText("atualiza a cada 10 s · 10:00")).not.toBeNull();
  });

  it.each([ 401, 408, 425, 429 ])("%i não para o polling: segue no intervalo e se recupera quando o api volta", async (status) => {
    vi.mocked(api.getUrgencyQueue).mockRejectedValueOnce(new ApiError(status, { error: "unauthenticated" }, "x"))
      .mockResolvedValue(queue());
    mount({ roles: { reception: true, nurse: false, doctor: false } });
    await flush();
    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    await flush(10_000);
    expect(api.getUrgencyQueue).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("U-042")).not.toBeNull();
    expect(screen.getByText("atualiza a cada 10 s · 10:00")).not.toBeNull();
  });

  it("relê a cada 10 s; trocar de unidade descarta a fila antiga e para o timer dela", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    const { rerender, unmount } = mount({ roles: { reception: true, nurse: false, doctor: false } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.getUrgencyQueue).toHaveBeenCalledTimes(2);
    rerender({ unit: { ...UPA, id: "upa2" } });
    expect(vi.mocked(api.getUrgencyQueue).mock.calls.at(-1)?.[0]).toBe("upa2");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("403 cbo_not_allowed (técnico 3222) mostra a frase, para o polling e troca o rodapé por 'parado às'", async () => {
    vi.mocked(api.getUrgencyQueue).mockImplementation(() => Promise.reject(forbidden()));
    mount({ roles: { reception: false, nurse: true, doctor: false } });
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("seu CBO não permite esta etapa na UPA");
    await flush(60_000);
    expect(api.getUrgencyQueue).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByText(/atualiza a cada/)).toBeNull();
    expect(screen.getByText("parado às 10:00")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).not.toBeNull();
  });

  it.each([ [ 404, "not_found" ], [ 422, "not_an_upa" ] ])("%i (%s) também para", async (status, error) => {
    vi.mocked(api.getUrgencyQueue).mockImplementation(() => Promise.reject(new ApiError(status, { error }, "x")));
    mount({ roles: { reception: true, nurse: false, doctor: false } });
    // A primeira resposta precisa renderizar (o act só renderiza ao sair) antes de o relógio andar.
    await flush();
    await flush(30_000);
    expect(api.getUrgencyQueue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).not.toBeNull();
  });

  it("depois de parar, refresh() pelo ref lê de novo e volta a fazer polling; 'Tentar de novo' também", async () => {
    vi.mocked(api.getUrgencyQueue).mockImplementationOnce(() => Promise.reject(forbidden()))
      .mockImplementationOnce(() => Promise.reject(forbidden())).mockResolvedValue(queue());
    const ref = createRef<UrgencyQueueHandle>();
    mount({ roles: { reception: true, nurse: false, doctor: false } }, ref);
    await flush();
    expect(screen.getByText("parado às 10:00")).not.toBeNull();
    await act(async () => { ref.current?.refresh(); });
    await flush();
    expect(api.getUrgencyQueue).toHaveBeenCalledTimes(2);
    // A segunda recusa para de novo; o botão tenta outra vez.
    expect(screen.getByRole("button", { name: "Tentar de novo" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await flush();
    expect(api.getUrgencyQueue).toHaveBeenCalledTimes(3);
    expect(screen.getByText("U-042")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("atualiza a cada 10 s · 10:00")).not.toBeNull();
    await flush(10_000);
    expect(api.getUrgencyQueue).toHaveBeenCalledTimes(4);
  });

  it("cada faixa tem o título como heading", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    mount({ roles: { reception: true, nurse: false, doctor: false } });
    await flush();
    for (const name of [ "Aguardando classificação", "Classificados, por cor", "Em atendimento" ]) {
      expect(screen.getByRole("heading", { level: 3, name })).not.toBeNull();
    }
  });

  it("sem papel nenhum, não lê", async () => {
    mount({ roles: { reception: false, nurse: false, doctor: false } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.getUrgencyQueue).not.toHaveBeenCalled();
  });
});
