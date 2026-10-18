import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listLabInstruments: vi.fn(), listLabExams: vi.fn(), listQcLots: vi.fn(),
    listQcMaterials: vi.fn(), listQcRuns: vi.fn(), openQcRun: vi.fn(), recordQcValue: vi.fn() };
});

import * as api from "../lib/api";
import { LabQcRuns } from "./LabQcRuns";
import { DOT_IN_NUMBER } from "../lib/lab";
import { renderWithProviders } from "../test/campaignFixtures";
import { CHOL_EXAM, GLU_EXAM, NOW21C, instrument, qcBlock, qcContext, qcLot, qcMaterial, qcRun, qcUser, qcValue } from "../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listLabInstruments, api.listLabExams, api.listQcLots, api.listQcMaterials,
  api.listQcRuns, api.openQcRun, api.recordQcValue ];
const MATERIAL = qcMaterial({ analytes: [ { lab_exam_id: "le1", analyte_key: "glicose" }, { lab_exam_id: "le2", analyte_key: "ct" }, { lab_exam_id: "le2", analyte_key: "hdl" } ] });
const ok = (key: string) => ({ value: qcValue({ id: `v-${key}`, analyte_key: key }), run: qcRun(), block: null });
const GLU = "Glicose (Glicose)";
const CT = "Colesterol total (Colesterol total e frações)";
const HDL = "HDL (Colesterol total e frações)";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21C));
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ]));
  mocked(api.getLabContext).mockResolvedValue(qcContext());
  mocked(api.listLabInstruments).mockResolvedValue([ instrument() ]);
  mocked(api.listLabExams).mockResolvedValue([ GLU_EXAM, CHOL_EXAM ]);
  mocked(api.listQcLots).mockResolvedValue([ qcLot() ]);
  mocked(api.listQcMaterials).mockResolvedValue([ MATERIAL ]);
  mocked(api.listQcRuns).mockResolvedValue([ qcRun() ]);
  mocked(api.openQcRun).mockResolvedValue(qcRun({ id: "qr9", status: "open", evaluated_at: null, values: [] }));
  mocked(api.recordQcValue).mockImplementation(async (input: { analyte_key: string }) => ok(input.analyte_key));
});

async function openForm() {
  renderWithProviders(<LabQcRuns />);
  const form = await screen.findByRole("region", { name: "Digitar valores de controle" });
  await within(form).findByRole("option", { name: "L2026A · Controle bioquímico" });
  fireEvent.change(within(form).getByLabelText("Lote"), { target: { value: "ql1" } });
  fireEvent.change(within(form).getByLabelText("Nível"), { target: { value: "normal" } });
  return form;
}
// O ActionButton fica ocupado durante o clique (ignora cliques repetidos): espera soltar antes e depois.
async function save(form: HTMLElement) {
  const free = () => expect(within(form).getByRole("button", { name: /Gravar valores/ }).getAttribute("aria-busy")).toBeNull();
  await waitFor(free);
  fireEvent.click(within(form).getByRole("button", { name: /Gravar valores/ }));
  await waitFor(free);
}

describe("LabQcRuns", () => {
  it("corridas de hoje do aparelho: situação, z, regras e lote do reagente", async () => {
    renderWithProviders(<LabQcRuns />);
    expect(await screen.findByText("aprovada")).not.toBeNull();
    expect(api.listQcRuns).toHaveBeenCalledWith("in1", "2026-10-18");
    expect(screen.getByText("+0,4")).not.toBeNull();
    expect(screen.getByText("99")).not.toBeNull();
    expect(screen.getByText("lote R-778")).not.toBeNull();
  });

  it("série de valores: ponto bloqueia tudo; 422 no meio marca o campo e mantém os não enviados", async () => {
    mocked(api.recordQcValue)
      .mockImplementationOnce(async () => ok("glicose"))
      .mockRejectedValueOnce(new api.ApiError(422, { error: "no_target" }, "x"));
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "99,0" } });
    fireEvent.change(within(form).getByLabelText(CT), { target: { value: "182.5" } });
    fireEvent.change(within(form).getByLabelText(HDL), { target: { value: "-0,3" } });
    await save(form);
    expect(within(form).getByText(DOT_IN_NUMBER)).not.toBeNull();
    expect(api.recordQcValue).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText(CT), { target: { value: "182,5" } });
    await save(form);
    await waitFor(() => expect(api.recordQcValue).toHaveBeenCalledTimes(2));
    expect(mocked(api.recordQcValue).mock.calls[0][0]).toEqual({ run_id: null, instrument_id: "in1", lot_id: "ql1", level: "normal", analyte_key: "glicose", value: "99.0" });
    expect(mocked(api.recordQcValue).mock.calls[1][0].value).toBe("182.5");
    expect(await within(form).findByText("este nível e analito ainda não têm referência neste aparelho — cadastre a da bula em Controles e referências")).not.toBeNull();
    expect((within(form).getByLabelText(GLU) as HTMLInputElement).value).toBe("");
    expect((within(form).getByLabelText(CT) as HTMLInputElement).value).toBe("182,5");
    expect((within(form).getByLabelText(HDL) as HTMLInputElement).value).toBe("-0,3");
  });

  it("decimal fora do formato do api (mais de 4 casas, mais de 9 inteiros) não é enviado", async () => {
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "1,23456" } });
    await save(form);
    expect(within(form).getByText(/no máximo 9 dígitos antes da vírgula e 4 depois/)).not.toBeNull();
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "1234567890,5" } });
    await save(form);
    expect(within(form).getByText(/no máximo 9 dígitos/)).not.toBeNull();
    expect(api.recordQcValue).not.toHaveBeenCalled();
  });

  it("corrida reprovada abre bloqueio: avisa, relê as corridas e o próximo valor abre corrida nova", async () => {
    mocked(api.recordQcValue).mockResolvedValueOnce({
      value: qcValue({ z_score: 2.4, outcome: "reject", rules_fired: [ "2_2s" ] }), run: qcRun({ id: "qr2", status: "rejected" }), block: qcBlock()
    });
    const form = await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Abrir corrida nova" }));
    await waitFor(() => expect(api.openQcRun).toHaveBeenCalledWith("in1"));
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "104,0" } });
    await save(form);
    expect((await screen.findByRole("alert", { name: "corrida reprovada" })).textContent)
      .toBe("Corrida reprovada (2-2s): bloqueio aberto para Glicose (Glicose) no BS-200. A liberação desse analito fica presa até a ação corretiva e uma corrida aprovada com todos os níveis.");
    expect(mocked(api.recordQcValue).mock.calls[0][0].run_id).toBe("qr9");
    expect(await screen.findByText("O próximo valor abre uma corrida nova.")).not.toBeNull();
    await waitFor(() => expect(api.listQcRuns).toHaveBeenCalledTimes(3));
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "98,0" } });
    await save(form);
    await waitFor(() => expect(api.recordQcValue).toHaveBeenCalledTimes(2));
    expect(mocked(api.recordQcValue).mock.calls[1][0].run_id).toBeNull();
  });

  it("reprovação no meio da série para o envio e mantém os campos não enviados", async () => {
    mocked(api.recordQcValue).mockResolvedValueOnce({
      value: qcValue({ outcome: "reject", rules_fired: [ "1_3s" ] }), run: qcRun({ status: "rejected" }), block: qcBlock()
    });
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "110" } });
    fireEvent.change(within(form).getByLabelText(CT), { target: { value: "180" } });
    await save(form);
    await screen.findByRole("alert", { name: "corrida reprovada" });
    expect(api.recordQcValue).toHaveBeenCalledTimes(1);
    expect(within(form).getByText("corrida reprovada; os valores seguintes não foram enviados")).not.toBeNull();
    expect((within(form).getByLabelText(CT) as HTMLInputElement).value).toBe("180");
    await save(form);
    await waitFor(() => expect(api.recordQcValue).toHaveBeenCalledTimes(2));
    expect(mocked(api.recordQcValue).mock.calls[1][0].run_id).toBeNull();
  });

  it("aviso de ação corretiva pendente vem do notice, não de um código de erro", async () => {
    mocked(api.recordQcValue).mockResolvedValueOnce({ ...ok("glicose"), block: qcBlock(), notice: "corrective_action_required" });
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "98" } });
    await save(form);
    expect((await screen.findByRole("status", { name: "ação corretiva pendente" })).textContent).toContain("o bloqueio continua aberto");
    expect(screen.queryByRole("alert", { name: "corrida reprovada" })).toBeNull();
  });

  it("valor aprovado com bloqueio ativo devolvido: não diz reprovada", async () => {
    mocked(api.recordQcValue).mockResolvedValueOnce({ ...ok("glicose"), block: qcBlock({ corrective_action: "calibrado" }) });
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "98" } });
    await save(form);
    expect(await screen.findByText("Valores gravados · corrida aprovada.")).not.toBeNull();
    expect(screen.queryByRole("alert", { name: "corrida reprovada" })).toBeNull();
    expect(screen.getByRole("status", { name: "bloqueio ainda aberto" })).not.toBeNull();
  });

  it("valor que fecha o bloqueio: bloqueio encerrado", async () => {
    mocked(api.recordQcValue).mockResolvedValueOnce({ ...ok("glicose"), block: qcBlock({ closed_at: "2026-10-18T10:00:00-03:00", closed_by_run_id: "qr1" }) });
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "98" } });
    await save(form);
    expect(await screen.findByRole("status", { name: "bloqueio encerrado" })).not.toBeNull();
    expect(screen.queryByRole("alert", { name: "corrida reprovada" })).toBeNull();
  });

  it("série: a reprovação é do analito certo, não do primeiro com bloqueio", async () => {
    mocked(api.recordQcValue)
      .mockResolvedValueOnce({ ...ok("glicose"), block: qcBlock({ analyte_key: "glicose" }) })
      .mockResolvedValueOnce({ value: qcValue({ analyte_key: "ct", outcome: "reject", rules_fired: [ "1_3s" ] }), run: qcRun({ status: "rejected" }), block: qcBlock({ id: "qb2", analyte_key: "ct" }) });
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "98" } });
    fireEvent.change(within(form).getByLabelText(CT), { target: { value: "300" } });
    await save(form);
    expect((await screen.findByRole("alert", { name: "corrida reprovada" })).textContent).toContain("bloqueio aberto para Colesterol total (Colesterol total e frações)");
  });

  it("409 invalid_transition zera a corrida: a frase explica e o valor seguinte vai sem run_id", async () => {
    mocked(api.recordQcValue).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    const form = await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Abrir corrida nova" }));
    await waitFor(() => expect(api.openQcRun).toHaveBeenCalled());
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "98" } });
    await save(form);
    expect(await within(form).findByText("esta corrida já foi reprovada — o próximo valor abre uma corrida nova")).not.toBeNull();
    await waitFor(() => expect(api.listQcRuns).toHaveBeenCalledTimes(3));
    await save(form);
    await waitFor(() => expect(api.recordQcValue).toHaveBeenCalledTimes(2));
    expect(mocked(api.recordQcValue).mock.calls[1][0].run_id).toBeNull();
  });

  it("404 not_found tem frase própria; lote vencido não é oferecido", async () => {
    mocked(api.listQcLots).mockResolvedValue([ qcLot(), qcLot({ id: "ql2", lot_number: "L-VENC", expired: true }) ]);
    mocked(api.recordQcValue).mockRejectedValueOnce(new api.ApiError(404, { error: "not_found" }, "x"));
    const form = await openForm();
    expect(within(form).queryByRole("option", { name: "L-VENC · Controle bioquímico" })).toBeNull();
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "98" } });
    await save(form);
    expect(await within(form).findByText("não encontrado neste laboratório — a tela foi atualizada")).not.toBeNull();
    await waitFor(() => expect(api.listQcRuns).toHaveBeenCalledTimes(2));
  });

  it("abrir corrida nova: os valores seguintes vão nela", async () => {
    const form = await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Abrir corrida nova" }));
    await waitFor(() => expect(api.openQcRun).toHaveBeenCalledWith("in1"));
    fireEvent.change(within(form).getByLabelText(GLU), { target: { value: "98,0" } });
    await save(form);
    await waitFor(() => expect(mocked(api.recordQcValue).mock.calls[0][0].run_id).toBe("qr9"));
  });

  it("outro dia: só leitura", async () => {
    renderWithProviders(<LabQcRuns />);
    await screen.findByText("aprovada");
    fireEvent.change(screen.getByLabelText("Dia"), { target: { value: "2026-10-17" } });
    await waitFor(() => expect(api.listQcRuns).toHaveBeenCalledWith("in1", "2026-10-17"));
    expect(screen.queryByRole("region", { name: "Digitar valores de controle" })).toBeNull();
  });
});
