// src/modules/ExamRegulation.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listRegulationQueue: vi.fn(), listEnabledProviders: vi.fn(), authorizeExam: vi.fn(), denyExam: vi.fn() };
});

vi.mock("../lib/exams", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/exams")>();
  return { ...real, refreshExams: vi.fn(real.refreshExams) };
});

import * as api from "../lib/api";
import * as exams from "../lib/exams";
import { ApiError } from "../lib/api";
import { ExamRegulation } from "./ExamRegulation";
import { renderWithProviders } from "../test/campaignFixtures";
import { examOrder, examUser } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const refreshSpy = mocked(exams.refreshExams);
const WAITING = examOrder({ status: "awaiting_authorization", priority: "urgent", provider: null, cid10_justification: "E11" });
afterEach(cleanup);

async function decide() {
  fireEvent.click(await screen.findByRole("button", { name: "Decidir Hemograma completo de Joana Lima" }));
  return screen.getByRole("region", { name: "Decidir: Hemograma completo de Joana Lima" });
}

describe("ExamRegulation", () => {
  beforeEach(async () => {
    for (const fn of [ api.fetchCurrentSession, api.listRegulationQueue, api.listEnabledProviders, api.authorizeExam, api.denyExam ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "exam_regulator" ], { id: "rg1" }));
    mocked(api.listRegulationQueue).mockResolvedValue({ orders: [ WAITING ], next_before: null });
    mocked(api.listEnabledProviders).mockResolvedValue([ { id: "pv1", name: "Laboratório Simulado" } ]);
    mocked(api.authorizeExam).mockResolvedValue(undefined);
    mocked(api.denyExam).mockResolvedValue(undefined);
    const real = await vi.importActual<typeof import("../lib/exams")>("../lib/exams");
    refreshSpy.mockReset().mockImplementation(real.refreshExams);
  });

  it("fila com prioridade e justificativa; autorizar exige e manda o prestador", async () => {
    renderWithProviders(<ExamRegulation />);
    const queue = await screen.findByRole("region", { name: "Fila de regulação" });
    expect(await within(queue).findByText("urgente")).not.toBeNull();
    const panel = await decide();
    expect(within(panel).getByText("E11")).not.toBeNull();
    expect(api.listEnabledProviders).toHaveBeenCalledWith("0202020380");
    fireEvent.click(within(panel).getByRole("button", { name: "Autorizar" }));
    expect((await within(panel).findByRole("alert")).textContent).toBe("escolha o prestador");
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(api.authorizeExam).toHaveBeenCalledWith("eo1", "pv1"));
    expect((await screen.findByText("Exame autorizado para Laboratório Simulado.")).getAttribute("role")).toBe("status");
    await waitFor(() => expect(api.listRegulationQueue).toHaveBeenCalledTimes(2));
  });

  it("negar exige o motivo", async () => {
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    fireEvent.click(within(panel).getByRole("button", { name: "Negar" }));
    const form = within(panel).getByRole("form", { name: "Motivo da negativa" });
    fireEvent.click(within(form).getByRole("button", { name: "Negar exame" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("escreva o motivo (ao menos 5 caracteres)");
    fireEvent.change(within(form).getByLabelText("Motivo da negativa"), { target: { value: "Fora do protocolo municipal" } });
    fireEvent.click(within(form).getByRole("button", { name: "Negar exame" }));
    await waitFor(() => expect(api.denyExam).toHaveBeenCalledWith("eo1", "Fora do protocolo municipal"));
    expect(await screen.findByText("Exame negado. Quem pediu vê o aviso no início do painel.")).not.toBeNull();
  });

  it("outro regulador decidiu antes: fecha a decisão, avisa e relê a fila", async () => {
    mocked(api.authorizeExam).mockRejectedValue(new ApiError(409, { error: "invalid_transition", status: "awaiting_schedule" }, "x"));
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Autorizar" }));
    expect((await screen.findByText("a situação do exame mudou — atualize para ver a atual")).getAttribute("role")).toBe("alert");
    expect(screen.queryByRole("region", { name: "Decidir: Hemograma completo de Joana Lima" })).toBeNull();
    await waitFor(() => expect(api.listRegulationQueue).toHaveBeenCalledTimes(2));
  });

  it("nenhum prestador faz o exame: diz onde cadastrar", async () => {
    mocked(api.listEnabledProviders).mockResolvedValue([]);
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    expect((await within(panel).findByRole("alert")).textContent).toBe("nenhum prestador ativo faz este exame — cadastre em Catálogo e prestadores");
  });

  it("profissional não regula", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "health_professional" ]));
    renderWithProviders(<ExamRegulation />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.listRegulationQueue).not.toHaveBeenCalled();
  });
  it("409: o botão Decidir some enquanto a releitura está pendente e depois a fila vazia aparece", async () => {
    mocked(api.authorizeExam).mockRejectedValue(new ApiError(409, { error: "invalid_transition", status: "awaiting_schedule" }, "x"));
    let release: (v: { orders: never[]; next_before: null }) => void = () => {};
    mocked(api.listRegulationQueue).mockResolvedValueOnce({ orders: [ WAITING ], next_before: null })
      .mockReturnValueOnce(new Promise((r) => { release = r; }));
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Autorizar" }));
    await screen.findByText("a situação do exame mudou — atualize para ver a atual");
    await waitFor(() => expect(api.listRegulationQueue).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Decidir Hemograma completo de Joana Lima" })).toBeNull();
    release({ orders: [], next_before: null });
    expect(await screen.findByText("nenhum exame aguardando autorização")).not.toBeNull();
  });

  it("409 ao negar: fecha, avisa e esconde a linha", async () => {
    mocked(api.denyExam).mockRejectedValue(new ApiError(409, { error: "invalid_transition" }, "x"));
    mocked(api.listRegulationQueue).mockResolvedValueOnce({ orders: [ WAITING ], next_before: null }).mockResolvedValue({ orders: [], next_before: null });
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    fireEvent.click(within(panel).getByRole("button", { name: "Negar" }));
    const form = within(panel).getByRole("form", { name: "Motivo da negativa" });
    fireEvent.change(within(form).getByLabelText("Motivo da negativa"), { target: { value: "Fora do protocolo municipal" } });
    fireEvent.click(within(form).getByRole("button", { name: "Negar exame" }));
    expect((await screen.findByText("a situação do exame mudou — atualize para ver a atual")).getAttribute("role")).toBe("alert");
    expect(screen.queryByRole("region", { name: "Decidir: Hemograma completo de Joana Lima" })).toBeNull();
    await waitFor(() => expect(api.listRegulationQueue).toHaveBeenCalledTimes(2));
  });

  it("404 ao autorizar: trata como situação mudada", async () => {
    mocked(api.authorizeExam).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Autorizar" }));
    expect((await screen.findByText("exame não encontrado — atualize a lista")).getAttribute("role")).toBe("alert");
    expect(screen.queryByRole("region", { name: "Decidir: Hemograma completo de Joana Lima" })).toBeNull();
    await waitFor(() => expect(api.listRegulationQueue).toHaveBeenCalledTimes(2));
  });

  it("422 prestador não faz o exame: frase, painel aberto, lista de prestadores relida", async () => {
    mocked(api.authorizeExam).mockRejectedValue(new ApiError(422, { error: "provider_not_enabled_for_exam" }, "x"));
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Autorizar" }));
    expect((await within(panel).findByText("este prestador não faz este exame — escolha outro ou habilite-o no cadastro")).getAttribute("role")).toBe("alert");
    expect(screen.queryByRole("region", { name: "Decidir: Hemograma completo de Joana Lima" })).not.toBeNull();
    await waitFor(() => expect(api.listEnabledProviders).toHaveBeenCalledTimes(2));
  });

  it("administrador municipal acessa a fila", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "municipal_admin" ]));
    renderWithProviders(<ExamRegulation />);
    expect(await screen.findByRole("button", { name: "Decidir Hemograma completo de Joana Lima" })).not.toBeNull();
  });

  it("sem CID-10 mostra traço", async () => {
    mocked(api.listRegulationQueue).mockResolvedValue({ orders: [ { ...WAITING, cid10_justification: null } ], next_before: null });
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    expect(within(panel).getByText("—")).not.toBeNull();
  });

  it("Carregar mais com id repetido entre páginas mostra o exame uma vez", async () => {
    mocked(api.listRegulationQueue).mockResolvedValueOnce({ orders: [ WAITING ], next_before: "c1" })
      .mockResolvedValueOnce({ orders: [ WAITING ], next_before: null });
    renderWithProviders(<ExamRegulation />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(api.listRegulationQueue).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("button", { name: "Decidir Hemograma completo de Joana Lima" })).toHaveLength(1);
  });
  it("a releitura devolve o mesmo exame ainda aguardando: a linha volta", async () => {
    mocked(api.authorizeExam).mockRejectedValue(new ApiError(409, { error: "invalid_transition" }, "x"));
    let release: (v: { orders: typeof WAITING[]; next_before: null }) => void = () => {};
    mocked(api.listRegulationQueue).mockResolvedValueOnce({ orders: [ WAITING ], next_before: null })
      .mockReturnValueOnce(new Promise((r) => { release = r; }));
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(api.listRegulationQueue).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Decidir Hemograma completo de Joana Lima" })).toBeNull();
    release({ orders: [ WAITING ], next_before: null });
    expect(await screen.findByRole("button", { name: "Decidir Hemograma completo de Joana Lima" })).not.toBeNull();
  });

  it("404 ao negar: fecha, explica e relê", async () => {
    mocked(api.denyExam).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    renderWithProviders(<ExamRegulation />);
    const panel = await decide();
    fireEvent.click(within(panel).getByRole("button", { name: "Negar" }));
    const form = within(panel).getByRole("form", { name: "Motivo da negativa" });
    fireEvent.change(within(form).getByLabelText("Motivo da negativa"), { target: { value: "Fora do protocolo municipal" } });
    fireEvent.click(within(form).getByRole("button", { name: "Negar exame" }));
    expect((await screen.findByText("exame não encontrado — atualize a lista")).getAttribute("role")).toBe("alert");
    expect(screen.queryByRole("region", { name: "Decidir: Hemograma completo de Joana Lima" })).toBeNull();
    await waitFor(() => expect(api.listRegulationQueue).toHaveBeenCalledTimes(2));
  });
  it("duas decisões sobrepostas: a releitura da primeira só devolve a primeira linha", async () => {
    const OTHER = { ...WAITING, id: "eo2", label: "Glicemia de jejum" };
    mocked(api.listRegulationQueue).mockResolvedValue({ orders: [ WAITING, OTHER ], next_before: null });
    const settles: (() => void)[] = [];
    refreshSpy.mockImplementation(() => new Promise<void>((r) => { settles.push(r); }));
    renderWithProviders(<ExamRegulation />);
    let panel = await decide();
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(settles.length).toBe(1));
    fireEvent.click(await screen.findByRole("button", { name: "Decidir Glicemia de jejum de Joana Lima" }));
    panel = screen.getByRole("region", { name: "Decidir: Glicemia de jejum de Joana Lima" });
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(settles.length).toBe(2));
    settles[0]();
    expect(await screen.findByRole("button", { name: "Decidir Hemograma completo de Joana Lima" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Decidir Glicemia de jejum de Joana Lima" })).toBeNull();
    settles[1]();
    expect(await screen.findByRole("button", { name: "Decidir Glicemia de jejum de Joana Lima" })).not.toBeNull();
  });
});
