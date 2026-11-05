// Leitos (F-31.5; P41): mapa sem dado clínico, entrada com a crítica local, `bed_taken` relê o mapa, limite de noites (a equipe
// não passa; a coordenação passa com reavaliação, uma vez), saída com data e motivo (mês fechado, limite na saída, já encerrada) e
// o detalhe da permanência só no clique. As frases vêm da lib.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAPS_AD_III, CAPS_II, NOW31, TODAY31, bedBoard, enrollmentRow, nightStay, psyUser } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import {
  BED_FREE, NIGHT_STAY_CLOSED, NIGHT_STAY_NOTE, NIGHT_STAY_STARTED, PSY_ERRORS, REASON_TEXT, REASSESSMENT_NOT_NEEDED, STAY_END_BEFORE_START,
  STAY_END_IN_FUTURE, STAY_EXPECTED_END_TEXT, STAY_START_TEXT, TRAIL_NOTE, bedStayText, nightLimitText, psyCodeText
} from "../lib/psychosocial";
import { CapsBeds } from "./CapsBeds";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn(), getPsyBedBoard: vi.fn(),
  listPsyEnrollments: vi.fn(), startPsyNightStay: vi.fn(), closePsyNightStay: vi.fn(), getPsyNightStay: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const JOSE = { patient_id: "pt2", name: "José Pereira", cns_masked: null };
const LIMIT = { error: "night_limit_reached", used: 14, limit: 14, window_days: 30, rule: "total" };
const LIMIT_TEXT = nightLimitText({ used: 14, limit: 14, window_days: 30, rule: "total" });
const REASON = "risco de recaída na semana de festas";
const EXIT_REASON = "alta do acolhimento noturno com plano de cuidado";
const LEAD = { user_id: "u-1", name: "Ana Coordenadora", cbo_code: "251510" };

beforeEach(() => {
  // O api não manda dado clínico no mapa; se mandar por engano, a tela não mostra.
  const b = bedBoard();
  vi.mocked(api.getPsyBedBoard).mockResolvedValue({
    ...b, items: b.items.map((i) => (i.stay ? { ...i, stay: { ...i.stay, cid_main: "F102", substances: [ "01" ], notes: "segredo" } as never } : i))
  });
  vi.mocked(api.listPsyEnrollments).mockResolvedValue([ enrollmentRow(), enrollmentRow({ id: "en2", patient: JOSE }) ]);
  vi.mocked(api.startPsyNightStay).mockResolvedValue(nightStay({ id: "ns2", bed: bedBoard().items[0].bed, enrollment_id: "en1" }));
  vi.mocked(api.closePsyNightStay).mockResolvedValue(nightStay({ ended_at: "2026-11-04T09:00:00-03:00", end_reason: EXIT_REASON }));
  vi.mocked(api.getPsyNightStay).mockResolvedValue(nightStay());
});

function mount(user = psyUser(), units: api.PsyUnit[] = [ CAPS_AD_III ]) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.listPsyUnits).mockResolvedValue(units);
  return renderWithProviders(<CapsBeds today={TODAY31} now={NOW31} />);
}

async function enterStay(label: string, enrollmentId: string, end = "2026-11-05T08:00") {
  fireEvent.click(await screen.findByRole("button", { name: `Registrar entrada no ${label}` }));
  await screen.findByRole("option", { name: /Maria da Silva/ });
  fireEvent.change(screen.getByLabelText("Usuário"), { target: { value: enrollmentId } });
  fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "2026-11-04T09:00" } });
  fireEvent.change(screen.getByLabelText("Saída prevista"), { target: { value: end } });
}

describe("Leitos do CAPS", () => {
  it("mapa: leito livre e ocupado com noites usadas, sem dado clínico; só CAPS com leitos", async () => {
    mount(psyUser(), [ CAPS_II, CAPS_AD_III ]);
    expect(await screen.findByText("Leito 1")).not.toBeNull();
    expect(screen.getByText(BED_FREE)).not.toBeNull();
    expect(screen.getByText(bedStayText("José Pereira", 9, 14, 30, "caps_ad_iii"))).not.toBeNull();
    expect(screen.getByText("José Pereira · 9 de 14 noites em 30 dias")).not.toBeNull();
    expect(screen.queryByText(/F10/)).toBeNull();
    expect(screen.queryByText("segredo")).toBeNull();
    // O portão oferece só o CAPS com acolhimento noturno; o mapa é do dia da cidade.
    expect(vi.mocked(api.getPsyBedBoard).mock.calls[0]).toEqual([ CAPS_AD_III.id, TODAY31 ]);
    expect(screen.queryByRole("option", { name: /CAPS II Centro/ })).toBeNull();
    expect(api.getPsyNightStay).not.toHaveBeenCalled();
  });

  it("trocar a data relê o mapa daquele dia", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Data do mapa"), { target: { value: "2026-11-01" } });
    await waitFor(() => expect(api.getPsyBedBoard).toHaveBeenLastCalledWith(CAPS_AD_III.id, "2026-11-01"));
  });

  it("entrada: corpo com a hora da cidade, sem reavaliação; relê o mapa; quem já está no leito não aparece na lista", async () => {
    mount();
    await enterStay("Leito 1", "en1");
    expect(screen.getByText(NIGHT_STAY_NOTE)).not.toBeNull();
    expect(screen.queryByRole("option", { name: /José Pereira/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText(NIGHT_STAY_STARTED)).not.toBeNull();
    expect(vi.mocked(api.startPsyNightStay).mock.calls[0][0]).toEqual({
      bed_id: "b1", enrollment_id: "en1", started_at: "2026-11-04T09:00:00-03:00", expected_end_at: "2026-11-05T08:00:00-03:00"
    });
    await waitFor(() => expect(api.getPsyBedBoard).toHaveBeenCalledTimes(2));
  });

  it("entrada: a crítica local recusa tudo de uma vez antes de enviar", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar entrada no Leito 1" }));
    await screen.findByLabelText("Usuário");
    fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "2026-11-05T09:00" } });
    fireEvent.change(screen.getByLabelText("Saída prevista"), { target: { value: "2026-12-10T08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(screen.getByText("escolha o usuário")).not.toBeNull();
    expect(screen.getByText(STAY_START_TEXT)).not.toBeNull();
    expect(screen.getByText(STAY_EXPECTED_END_TEXT)).not.toBeNull();
    // Matrícula que começa depois da entrada: recusa na hora, com a frase do api.
    vi.mocked(api.listPsyEnrollments).mockResolvedValue([ enrollmentRow({ started_on: "2026-11-04" }) ]);
    cleanup();
    mount();
    await enterStay("Leito 1", "en1");
    fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "2026-11-03T21:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(screen.getByText(psyCodeText("enrollment_required", "enrollment_id"))).not.toBeNull();
    expect(api.startPsyNightStay).not.toHaveBeenCalled();
  });

  it("leito tomado relê o mapa; limite: equipe não passa", async () => {
    mount();
    await enterStay("Leito 1", "en1");
    vi.mocked(api.startPsyNightStay).mockRejectedValueOnce(new ApiError(409, { error: "bed_taken" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText(PSY_ERRORS.bed_taken)).not.toBeNull();
    await waitFor(() => expect(api.getPsyBedBoard).toHaveBeenCalledTimes(2));
    vi.mocked(api.startPsyNightStay).mockRejectedValueOnce(new ApiError(422, LIMIT, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText(LIMIT_TEXT)).not.toBeNull();
    expect(screen.queryByLabelText("Motivo da reavaliação")).toBeNull();
    expect(screen.queryByRole("button", { name: "Passar do limite com reavaliação" })).toBeNull();
  });

  it("entrada: mês fechado e matrícula fora do prazo vêm do api com a frase do campo", async () => {
    mount();
    await enterStay("Leito 1", "en1");
    vi.mocked(api.startPsyNightStay).mockRejectedValueOnce(new ApiError(422, { error: "month_closed", path: "started_at" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText(psyCodeText("month_closed", "started_at"))).not.toBeNull();
    vi.mocked(api.startPsyNightStay).mockRejectedValueOnce(new ApiError(409, { error: "already_staying" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText(PSY_ERRORS.already_staying)).not.toBeNull();
  });

  it("coordenação: reavaliação com motivo de 10 a 500, enviada uma vez", async () => {
    vi.mocked(api.startPsyNightStay).mockResolvedValue(nightStay({ id: "ns2", enrollment_id: "en1", reassessment: { reason: REASON, by: LEAD } }));
    mount(psyUser([ "psychosocial_lead" ]));
    await enterStay("Leito 1", "en1");
    vi.mocked(api.startPsyNightStay).mockRejectedValueOnce(new ApiError(422, LIMIT, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText(LIMIT_TEXT)).not.toBeNull();
    fireEvent.change(await screen.findByLabelText("Motivo da reavaliação"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Passar do limite com reavaliação" }));
    expect(screen.getByText(REASON_TEXT)).not.toBeNull();
    expect(api.startPsyNightStay).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Motivo da reavaliação"), { target: { value: REASON } });
    const pass = screen.getByRole("button", { name: "Passar do limite com reavaliação" });
    fireEvent.click(pass); fireEvent.click(pass);
    await waitFor(() => expect(api.startPsyNightStay).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.startPsyNightStay).mock.calls[1][0].reassessment).toEqual({ reason: REASON });
    expect(await screen.findByText(NIGHT_STAY_STARTED)).not.toBeNull();
    expect(api.startPsyNightStay).toHaveBeenCalledTimes(2);
  });

  it("coordenação: reavaliação desnecessária volta nula e a tela avisa", async () => {
    vi.mocked(api.startPsyNightStay).mockRejectedValueOnce(new ApiError(422, LIMIT, "x"));
    mount(psyUser([ "psychosocial_lead" ]));
    await enterStay("Leito 1", "en1");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    fireEvent.change(await screen.findByLabelText("Motivo da reavaliação"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Passar do limite com reavaliação" }));
    expect(await screen.findByText(`${NIGHT_STAY_STARTED} ${REASSESSMENT_NOT_NEEDED}`)).not.toBeNull();
  });

  it("saída: data e motivo; saída antes da entrada é recusada antes", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar saída de José Pereira" }));
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-11-01T08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(screen.getByText(STAY_END_BEFORE_START)).not.toBeNull();
    expect(screen.getByText(REASON_TEXT)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-11-04T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(screen.getByText(STAY_END_IN_FUTURE)).not.toBeNull();
    expect(api.closePsyNightStay).not.toHaveBeenCalled();
  });

  it("saída: envia data e motivo uma vez, relê o mapa e não lê o detalhe", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar saída de José Pereira" }));
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-11-04T09:00" } });
    fireEvent.change(screen.getByLabelText("Motivo da saída"), { target: { value: EXIT_REASON } });
    const confirm = screen.getByRole("button", { name: "Confirmar saída" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(await screen.findByText(NIGHT_STAY_CLOSED)).not.toBeNull();
    expect(api.closePsyNightStay).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.closePsyNightStay).mock.calls[0]).toEqual([ "ns1", { ended_at: "2026-11-04T09:00:00-03:00", reason: EXIT_REASON } ]);
    await waitFor(() => expect(api.getPsyBedBoard).toHaveBeenCalledTimes(2));
    expect(api.getPsyNightStay).not.toHaveBeenCalled();
  });

  it("saída: mês fechado no campo; ação recusada no topo; já encerrada relê o mapa", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar saída de José Pereira" }));
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-11-04T09:00" } });
    fireEvent.change(screen.getByLabelText("Motivo da saída"), { target: { value: EXIT_REASON } });
    vi.mocked(api.closePsyNightStay).mockRejectedValueOnce(new ApiError(422, { error: "month_closed", path: "ended_at" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(await screen.findByText(psyCodeText("month_closed", "ended_at"))).not.toBeNull();
    vi.mocked(api.closePsyNightStay).mockRejectedValueOnce(new ApiError(422, {
      error: "action_rejected", problems: [ { error: "cbo_incompatible", path: "sigtap_code" } ]
    }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(await screen.findByText(PSY_ERRORS.cbo_incompatible)).not.toBeNull();
    vi.mocked(api.closePsyNightStay).mockRejectedValueOnce(new ApiError(409, { error: "already_closed" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(await screen.findByText(PSY_ERRORS.already_closed)).not.toBeNull();
    expect(screen.queryByLabelText("Motivo da saída")).toBeNull();
    await waitFor(() => expect(api.getPsyBedBoard).toHaveBeenCalledTimes(2));
  });

  it("saída com limite: a equipe vê a frase; a coordenação reavalia com motivo", async () => {
    vi.mocked(api.closePsyNightStay).mockRejectedValue(new ApiError(422, LIMIT, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar saída de José Pereira" }));
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-11-04T09:00" } });
    fireEvent.change(screen.getByLabelText("Motivo da saída"), { target: { value: EXIT_REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(await screen.findByText(LIMIT_TEXT)).not.toBeNull();
    expect(screen.queryByLabelText("Motivo da reavaliação")).toBeNull();
    cleanup();
    vi.mocked(api.closePsyNightStay).mockReset();
    vi.mocked(api.closePsyNightStay).mockRejectedValueOnce(new ApiError(422, LIMIT, "x")).mockResolvedValueOnce(nightStay({ ended_at: "2026-11-04T09:00:00-03:00", reassessment: { reason: REASON, by: LEAD } }));
    mount(psyUser([ "psychosocial_lead" ]));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar saída de José Pereira" }));
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-11-04T09:00" } });
    fireEvent.change(screen.getByLabelText("Motivo da saída"), { target: { value: EXIT_REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    fireEvent.change(await screen.findByLabelText("Motivo da reavaliação"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída com reavaliação" }));
    expect(await screen.findByText(NIGHT_STAY_CLOSED)).not.toBeNull();
    expect(vi.mocked(api.closePsyNightStay).mock.calls[1]).toEqual([ "ns1", {
      ended_at: "2026-11-04T09:00:00-03:00", reason: EXIT_REASON, reassessment: { reason: REASON }
    } ]);
  });

  it("detalhe da permanência só no clique, com o id do CAPS na chave", async () => {
    vi.mocked(api.getPsyNightStay).mockResolvedValue(nightStay({ reassessment: { reason: REASON, by: LEAD } }));
    const { client } = mount();
    expect(await screen.findByText("Leito 2")).not.toBeNull();
    expect(api.getPsyNightStay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver permanência de José Pereira" }));
    expect(await screen.findByText(TRAIL_NOTE)).not.toBeNull();
    expect(await screen.findByText(REASON)).not.toBeNull();
    expect(screen.getByText("Ana Coordenadora")).not.toBeNull();
    expect(screen.getByText("2 noites")).not.toBeNull();
    expect(vi.mocked(api.getPsyNightStay).mock.calls[0]).toEqual([ "ns1" ]);
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys.some((k) => k[0] === "psyDetail" && k.includes(CAPS_AD_III.id) && k.includes("ns1"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Fechar detalhe" }));
    expect(screen.queryByText(REASON)).toBeNull();
  });
});
