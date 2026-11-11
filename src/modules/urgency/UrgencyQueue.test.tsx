// Fila da UPA (F-32.3; contrato §6, §14 Q6/Q18): três faixas, estouro por texto (nunca só por cor), nenhum texto clínico e
// polling sem timer sobrando. Os botões só aparecem com a ação ligada pela mesa e com o papel que o api aceita.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef, type Ref } from "react";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()), getUrgencyQueue: vi.fn(), getUrgencyObservation: vi.fn(),
  listCallLocations: vi.fn(), callForClassification: vi.fn(), callAttendance: vi.fn(), callNext: vi.fn(), recallAttendance: vi.fn()
}));
// O painel do atendimento médico tem o próprio teste (UrgencyCare.test.tsx); aqui só a chamada.
vi.mock("./UrgencyCare", () => ({ UrgencyCare: (p: { row: { ticket: string | null } }) => <span>{`atendimento ${p.row.ticket} (dublê)`}</span> }));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { NO_CLINICAL_IN_LIST, writeCallLocation } from "../../lib/urgency";
import {
  DOCTOR_LINK, NOW32, NURSE_LINK, UPA, callLocation, colorRow, encounter, inCareRow, patientRef, queue, unidentifiedRef, urgencyUser,
  waitingRow
} from "../../test/urgencyFixtures";
import { TECH_LINK, observationMap } from "../../test/urgencyObservationFixtures";
import { UrgencyDesk } from "./UrgencyDesk";
import { UrgencyQueue, type UrgencyQueueHandle, type UrgencyQueueProps } from "./UrgencyQueue";

afterEach(cleanup);
// Com chaves: o retorno do beforeEach vira teardown no vitest (e a função mockada seria chamada).
beforeEach(() => {
  vi.mocked(api.getUrgencyQueue).mockReset();
  vi.mocked(api.getUrgencyObservation).mockReset().mockResolvedValue({ beds: [], waiting_bed: [] });
});

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

// A chamada pela mesa da UPA (F-32.5; contrato §6, §14 Q7): o seletor do local no topo da fila; a enfermagem 2235 chama para a
// classificação, o médico 225 chama para o atendimento (por linha e "Chamar próximo", que no api segue a cor); "Chamar de novo"
// repete o tipo da última chamada. Depois de cada chamada a fila relê.
describe("chamada", () => {
  const LOCS = { items: [ callLocation(), callLocation({ id: "loc2", name: "Sala de medicação", active: false }) ], location_required: true };
  beforeEach(() => {
    for (const fn of [ api.listCallLocations, api.callForClassification, api.callAttendance, api.callNext, api.recallAttendance ]) {
      vi.mocked(fn as ReturnType<typeof vi.fn>).mockReset();
    }
    sessionStorage.clear();
    vi.mocked(api.listCallLocations).mockResolvedValue(LOCS);
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
  });

  function mountDesk(links = [ NURSE_LINK ], features?: string[]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      <UrgencyDesk unit={UPA} user={urgencyUser([ "health_professional" ], features)} links={links} />
    </QueryClientProvider>);
  }
  async function chooseLocation() {
    await screen.findByRole("option", { name: "Consultório 1" });
    fireEvent.change(screen.getByLabelText("Local da chamada"), { target: { value: "loc1" } });
  }
  const queueReads = () => vi.mocked(api.getUrgencyQueue).mock.calls.length;

  it("enfermagem: 'Chamar para classificação' leva o local; aviso e a fila relê; sem 'Chamar próximo'", async () => {
    vi.mocked(api.callForClassification).mockResolvedValue({ encounter: encounter(),
      call: { id: "c1", kind: "classification", ticket: "U-042", location: "Consultório 1", called_at: "2026-11-05T10:00:00-03:00" } });
    mountDesk();
    await chooseLocation();
    expect(screen.queryByRole("option", { name: "Sala de medicação" })).toBeNull();
    const before = queueReads();
    fireEvent.click(screen.getByRole("button", { name: "Chamar para classificação U-042" }));
    await waitFor(() => expect(vi.mocked(api.callForClassification).mock.calls[0]).toEqual([ "en1", "loc1" ]));
    expect(await screen.findByText("U-042 chamada para a classificação em Consultório 1")).not.toBeNull();
    await waitFor(() => expect(queueReads()).toBeGreaterThan(before));
    expect(screen.queryByRole("button", { name: "Chamar próximo" })).toBeNull();
    // Não chama para o atendimento.
    expect(screen.queryByRole("button", { name: "Chamar U-040" })).toBeNull();
  });

  it("médico: 'Chamar' por cor e 'Chamar próximo' levam o local; nenhuma chamada em quem aguarda classificação", async () => {
    // A resposta do api (attendance_json) não traz a senha.
    vi.mocked(api.callAttendance).mockResolvedValue({ attendance: { id: "at2" } as api.Attendance });
    vi.mocked(api.callNext).mockResolvedValue({ attendance: { id: "at2" } as api.Attendance });
    mountDesk([ DOCTOR_LINK ]);
    await chooseLocation();
    const awaiting = screen.getByRole("region", { name: "Aguardando classificação" });
    expect(within(awaiting).queryByRole("button", { name: /^Chamar/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chamar U-040" }));
    await waitFor(() => expect(vi.mocked(api.callAttendance).mock.calls[0]).toEqual([ "at2", "upa1", "loc1" ]));
    expect(await screen.findByText("U-040 chamada para o atendimento em Consultório 1")).not.toBeNull();
    const before = queueReads();
    fireEvent.click(screen.getByRole("button", { name: "Chamar próximo" }));
    await waitFor(() => expect(vi.mocked(api.callNext).mock.calls[0]).toEqual([ "upa1", "loc1" ]));
    await waitFor(() => expect(queueReads()).toBeGreaterThan(before));
  });

  it("422 not_classified mostra a frase", async () => {
    vi.mocked(api.callAttendance).mockRejectedValue(new ApiError(422, { error: "not_classified" }, "x"));
    mountDesk([ DOCTOR_LINK ]);
    await chooseLocation();
    fireEvent.click(screen.getByRole("button", { name: "Chamar U-040" }));
    expect(await screen.findByText("classifique a pessoa antes de chamar para o atendimento")).not.toBeNull();
  });

  it("already_called e queue_empty releem a fila, sem alerta; queue_empty diz 'ninguém aguardando'", async () => {
    vi.mocked(api.callAttendance).mockRejectedValue(new ApiError(409, { error: "already_called" }, "x"));
    vi.mocked(api.callNext).mockRejectedValue(new ApiError(404, { error: "queue_empty" }, "x"));
    mountDesk([ DOCTOR_LINK ]);
    await chooseLocation();
    let before = queueReads();
    fireEvent.click(screen.getByRole("button", { name: "Chamar U-040" }));
    await waitFor(() => expect(queueReads()).toBeGreaterThan(before));
    before = queueReads();
    fireEvent.click(screen.getByRole("button", { name: "Chamar próximo" }));
    await waitFor(() => expect(queueReads()).toBeGreaterThan(before));
    expect(await screen.findByText("ninguém aguardando")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("'Chamar de novo U-038' em atendimento leva o local; o aviso usa o local da resposta", async () => {
    vi.mocked(api.recallAttendance).mockResolvedValue({ call_id: "c9",
      call: { id: "c9", kind: "care", ticket: "U-038", location: "Consultório 1", called_at: "2026-11-05T10:00:00-03:00" } });
    mountDesk([ DOCTOR_LINK ]);
    await chooseLocation();
    const before = queueReads();
    fireEvent.click(screen.getByRole("button", { name: "Chamar de novo U-038" }));
    await waitFor(() => expect(vi.mocked(api.recallAttendance).mock.calls[0]).toEqual([ "at3", "loc1" ]));
    expect(await screen.findByText("U-038 chamada de novo em Consultório 1")).not.toBeNull();
    await waitFor(() => expect(queueReads()).toBeGreaterThan(before));
  });

  it("local obrigatório sem escolha: não chama, a frase e o foco no seletor; o local lembrado já vem escolhido", async () => {
    mountDesk();
    await screen.findByRole("option", { name: "Consultório 1" });
    fireEvent.click(screen.getByRole("button", { name: "Chamar para classificação U-042" }));
    expect(screen.getByText("escolha o local da chamada — a unidade tem TV na sala de espera")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Local da chamada"));
    expect(api.callForClassification).not.toHaveBeenCalled();
    cleanup();
    writeCallLocation("u-1", "upa1", "loc1");
    vi.mocked(api.callForClassification).mockResolvedValue({ encounter: encounter(), call: null });
    mountDesk();
    await screen.findByRole("option", { name: "Consultório 1" });
    expect((screen.getByLabelText("Local da chamada") as HTMLSelectElement).value).toBe("loc1");
    fireEvent.click(screen.getByRole("button", { name: "Chamar para classificação U-042" }));
    await waitFor(() => expect(vi.mocked(api.callForClassification).mock.calls[0]).toEqual([ "en1", "loc1" ]));
  });

  it("sem waiting_room_display: nenhum seletor nem 'Chamar de novo'; a chamada sai sem local", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ in_care: [ inCareRow() ],
      awaiting_classification: [ waitingRow({ last_call: { kind: "classification", location: null, called_at: "2026-11-05T09:58:00-03:00" } }) ] }));
    vi.mocked(api.callForClassification).mockResolvedValue({ encounter: encounter(), call: null });
    mountDesk([ NURSE_LINK ], [ "urgency_care", "clinical_record" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Chamar para classificação U-042" }));
    await waitFor(() => expect(vi.mocked(api.callForClassification).mock.calls[0]).toEqual([ "en1", null ]));
    expect(await screen.findByText("U-042 chamada para a classificação")).not.toBeNull();
    expect(screen.queryByLabelText("Local da chamada")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Chamar de novo/ })).toBeNull();
    expect(api.listCallLocations).not.toHaveBeenCalled();
  });

  it("a recepção não vê seletor nem chamada", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      <UrgencyDesk unit={UPA} user={urgencyUser([ "citizen_verifier" ])} links={[]} />
    </QueryClientProvider>);
    await screen.findByRole("region", { name: "Aguardando classificação" });
    expect(screen.queryByLabelText("Local da chamada")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Chamar/ })).toBeNull();
    expect(api.listCallLocations).not.toHaveBeenCalled();
  });
});

describe("coluna Observação (32b)", () => {
  const inCareRegion = async () => screen.findByRole("region", { name: "Em atendimento" });

  it("mostra leito, horas e alerta por texto; sem observação, '—'; campo extra não aparece", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ in_care: [
      inCareRow({ observation: { bed_label: "Obs 1", hours: 21, alert: "near_limit", medication: "morfina" } as never }),
      inCareRow({ encounter_id: "en8", attendance_id: "at8", ticket: "U-070", observation: null })
    ] }));
    mount({ roles: { reception: false, nurse: true, doctor: false } });
    const region = await inCareRegion();
    expect(within(region).getByRole("columnheader", { name: "Observação" })).not.toBeNull();
    expect(within(region).getByText("Obs 1 · 21 h em observação · perto de 24 h em observação")).not.toBeNull();
    expect(within(region).getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/morfina/)).toBeNull();
  });

  it("sem alerta, só leito e horas", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ in_care: [ inCareRow({ observation: { bed_label: "Obs 2", hours: 3, alert: null } }) ] }));
    mount({ roles: { reception: true, nurse: false, doctor: false } });
    expect(within(await inCareRegion()).getByText("Obs 2 · 3 h em observação")).not.toBeNull();
  });

  it("o técnico lê a fila", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    mount({ roles: { reception: false, nurse: false, doctor: false, technician: true } });
    await screen.findByRole("region", { name: "Em atendimento" });
    expect(vi.mocked(api.getUrgencyQueue)).toHaveBeenCalledTimes(1);
  });
});

describe("mesa: o mapa e o técnico (32b)", () => {
  function mountDesk(links: api.ProfessionalLink[]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      <UrgencyDesk unit={UPA} user={urgencyUser([ "health_professional" ])} links={links} />
    </QueryClientProvider>);
  }

  it("o técnico 3222 vê o mapa e a fila, sem 'seu papel não atua nesta UPA' e sem ação de escrita", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    mountDesk([ TECH_LINK ]);
    expect(await screen.findByRole("region", { name: "Observação" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Obs 1" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "Fila da urgência" })).not.toBeNull();
    expect(screen.queryByText("seu papel não atua nesta UPA")).toBeNull();
    expect(screen.queryByRole("button", { name: /Colocar em observação|Trocar de leito|Encerrar observação|Classificar|Chamar/ })).toBeNull();
  });

  it("fila recusada com 403 cbo_not_allowed mostra a frase e o mapa continua", async () => {
    vi.mocked(api.getUrgencyQueue).mockRejectedValue(new ApiError(403, { error: "cbo_not_allowed" }, "x"));
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    mountDesk([ TECH_LINK ]);
    expect(await screen.findByText("seu CBO não permite esta etapa na UPA")).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Obs 1" })).not.toBeNull();
  });

  it("enfermagem: o mapa fica entre a fila e a lista, com o botão de entrada", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue());
    vi.mocked(api.getUrgencyObservation).mockResolvedValue(observationMap());
    mountDesk([ NURSE_LINK ]);
    await screen.findByRole("region", { name: "Obs 1" });
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions.indexOf("Fila da urgência")).toBeLessThan(regions.indexOf("Observação"));
    expect(screen.getByRole("button", { name: "Colocar em observação no Obs 2" })).not.toBeNull();
  });
});
