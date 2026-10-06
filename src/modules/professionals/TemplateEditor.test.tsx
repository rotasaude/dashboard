import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, createScheduleTemplate: vi.fn(), updateScheduleTemplate: vi.fn(), previewScheduleTemplate: vi.fn(), listCbo: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { TemplateEditor } from "./TemplateEditor";
import { MORNING, NOW, TYPES } from "../../test/schedulingFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderIt(template = MORNING as typeof MORNING | null) {
  const onSaved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<TemplateEditor template={template} types={TYPES} onSaved={onSaved} onCancel={vi.fn()} />, { wrapper });
  return { onSaved };
}
const block = (n: number) => screen.getByRole("group", { name: `faixa ${n}` });
const save = () => screen.getByRole("button", { name: "Salvar modelo" }) as HTMLButtonElement;

describe("TemplateEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW));
    mocked(api.listCbo).mockResolvedValue([ { code: "225125", title: "Médico clínico", council: "CRM" } ]);
  });

  it("abre o modelo com as três faixas e salva sem mudar nada", async () => {
    mocked(api.updateScheduleTemplate).mockResolvedValue(MORNING);
    const { onSaved } = renderIt();
    expect((within(block(2)).getByLabelText("Tipo de atendimento") as HTMLSelectElement).value).toBe("consulta_medica");
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(api.updateScheduleTemplate).toHaveBeenCalledWith("t1",
      { name: "Manhã", fit_in_limit: 2, blocks: MORNING.blocks }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("faixas sobrepostas: as duas mostram o motivo e o botão trava; corrigir destrava", () => {
    renderIt();
    fireEvent.change(within(block(1)).getByLabelText("Fim"), { target: { value: "09:30" } });
    expect(within(block(1)).getByText("faixas sobrepostas — ajuste os horários")).not.toBeNull();
    expect(within(block(2)).getByText("faixas sobrepostas — ajuste os horários")).not.toBeNull();
    expect(save().disabled).toBe(true);
    fireEvent.change(within(block(1)).getByLabelText("Fim"), { target: { value: "09:00" } });
    expect(save().disabled).toBe(false);
  });

  it("faixa agendável sem tipo trava; trocar para demanda do dia tira o tipo e a vaga", () => {
    renderIt();
    fireEvent.change(within(block(2)).getByLabelText("Tipo de atendimento"), { target: { value: "" } });
    expect(within(block(2)).getByText("faixa agendável precisa de um tipo de atendimento")).not.toBeNull();
    expect(save().disabled).toBe(true);
    fireEvent.change(within(block(2)).getByLabelText("Tipo de faixa"), { target: { value: "walk_in" } });
    expect(within(block(2)).queryByLabelText("Tipo de atendimento")).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it("faixa com tipo inativo continua no select marcada e pede troca", () => {
    renderIt({ ...MORNING, blocks: [ { starts: "09:00", ends: "11:00", kind: "bookable", appointment_type_key: "puericultura" } ] });
    const select = within(block(1)).getByLabelText("Tipo de atendimento") as HTMLSelectElement;
    expect(select.value).toBe("puericultura");
    expect(within(select).getByRole("option", { name: "Puericultura (inativo)" })).not.toBeNull();
    expect(within(block(1)).getByText("faixa com tipo de atendimento desativado — escolha um tipo ativo")).not.toBeNull();
    expect(save().disabled).toBe(true);
    fireEvent.change(select, { target: { value: "consulta_enfermagem" } });
    expect(save().disabled).toBe(false);
  });

  it("faixa que cruza a meia-noite trava", () => {
    renderIt();
    fireEvent.change(within(block(3)).getByLabelText("Fim"), { target: { value: "10:00" } });
    expect(within(block(3)).getByText("a faixa não cruza a meia-noite — use fim depois do início (sem 24:00)")).not.toBeNull();
    expect(save().disabled).toBe(true);
  });

  it("nome da faixa que veio da API não volta no salvar", async () => {
    mocked(api.updateScheduleTemplate).mockResolvedValue(MORNING);
    renderIt({ ...MORNING, blocks: [ { ...MORNING.blocks[1], appointment_type_name: "Consulta médica" } ] });
    fireEvent.click(save());
    await waitFor(() => expect(api.updateScheduleTemplate).toHaveBeenCalledWith("t1",
      { name: "Manhã", fit_in_limit: 2, blocks: [ MORNING.blocks[1] ] }));
    const sent = mocked(api.updateScheduleTemplate).mock.calls[0][1] as { blocks: object[] };
    expect("appointment_type_name" in sent.blocks[0]).toBe(false);
  });

  it("+ faixa começa onde a última termina; remover tira a faixa", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "+ faixa" }));
    expect((within(block(4)).getByLabelText("Início") as HTMLInputElement).value).toBe("12:00");
    expect((within(block(4)).getByLabelText("Fim") as HTMLInputElement).value).toBe("13:00");
    fireEvent.click(within(block(4)).getByRole("button", { name: "remover faixa" }));
    expect(screen.queryByRole("group", { name: "faixa 4" })).toBeNull();
  });

  it("modelo novo: cria com nome, limite e faixas; 422 invalid_blocks mostra o detalhe", async () => {
    mocked(api.createScheduleTemplate).mockRejectedValue(new ApiError(422, { error: "invalid_blocks", detail: "unknown_type" }, "x"));
    renderIt(null);
    expect(save().disabled).toBe(true); // sem nome e com faixa agendável sem tipo
    fireEvent.change(screen.getByLabelText("Nome do modelo"), { target: { value: "Tarde" } });
    fireEvent.change(within(block(1)).getByLabelText("Tipo de atendimento"), { target: { value: "consulta_enfermagem" } });
    fireEvent.change(screen.getByLabelText("Encaixes por turno"), { target: { value: "3" } });
    fireEvent.click(save());
    await waitFor(() => expect(api.createScheduleTemplate).toHaveBeenCalledWith({ name: "Tarde", fit_in_limit: 3,
      blocks: [ { starts: "08:00", ends: "12:00", kind: "bookable", appointment_type_key: "consulta_enfermagem" } ] }));
    expect(await screen.findByText("faixa com tipo de atendimento que não existe na cidade")).not.toBeNull();
  });

  it("limite de encaixes fora de 0–20 trava", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Encaixes por turno"), { target: { value: "21" } });
    expect(screen.getByText("limite de encaixes entre 0 e 20")).not.toBeNull();
    expect(save().disabled).toBe(true);
  });

  it("pré-visualização: manda o turno de exemplo no fuso da cidade e lista as vagas; mudar o modelo esconde o resultado", async () => {
    mocked(api.previewScheduleTemplate).mockResolvedValue({
      slots: [
        { starts_at: "2026-10-06T09:00:00-03:00", ends_at: "2026-10-06T09:20:00-03:00", appointment_type_key: "consulta_medica" },
        { starts_at: "2026-10-06T09:20:00-03:00", ends_at: "2026-10-06T09:40:00-03:00", appointment_type_key: "consulta_medica" }
      ],
      blocks: MORNING.blocks
    });
    renderIt();
    const box = screen.getByRole("group", { name: "Pré-visualização" });
    await within(box).findByRole("option", { name: "225125 · Médico clínico" });
    fireEvent.change(within(box).getByLabelText("Data do exemplo"), { target: { value: "2026-10-06" } });
    fireEvent.change(within(box).getByLabelText("Início do turno"), { target: { value: "07:00" } });
    fireEvent.change(within(box).getByLabelText("Fim do turno"), { target: { value: "12:00" } });
    fireEvent.change(within(box).getByLabelText("Ocupação do exemplo (CBO)"), { target: { value: "225125" } });
    fireEvent.click(within(box).getByRole("button", { name: "Pré-visualizar" }));
    await waitFor(() => expect(api.previewScheduleTemplate).toHaveBeenCalledWith({
      blocks: MORNING.blocks, fit_in_limit: 2,
      sample: { starts_at: "2026-10-06T07:00:00-03:00", ends_at: "2026-10-06T12:00:00-03:00", cbo_code: "225125" }
    }));
    expect(await within(box).findByText("09:00–09:20 · Consulta médica")).not.toBeNull();
    expect(within(box).getByText("2 vagas")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Encaixes por turno"), { target: { value: "3" } });
    expect(within(box).queryByText("09:00–09:20 · Consulta médica")).toBeNull();
  });

  it("pré-visualização sem vaga diz por quê olhar", async () => {
    mocked(api.previewScheduleTemplate).mockResolvedValue({ slots: [], blocks: MORNING.blocks });
    renderIt();
    const box = screen.getByRole("group", { name: "Pré-visualização" });
    await within(box).findByRole("option", { name: "225125 · Médico clínico" });
    fireEvent.change(within(box).getByLabelText("Data do exemplo"), { target: { value: "2026-10-06" } });
    fireEvent.change(within(box).getByLabelText("Ocupação do exemplo (CBO)"), { target: { value: "225125" } });
    fireEvent.click(within(box).getByRole("button", { name: "Pré-visualizar" }));
    expect(await within(box).findByText("nenhuma vaga — confira o tipo das faixas e se o CBO do exemplo é atendido por ele"))
      .not.toBeNull();
  });
  it("+ faixa trava ao chegar a 24 faixas (teto do api)", () => {
    const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
    const blocks = Array.from({ length: 23 }, (_, h) => ({ starts: hh(h), ends: hh(h + 1), kind: "walk_in" as const }));
    renderIt({ ...MORNING, blocks });
    const add = () => screen.getByRole("button", { name: "+ faixa" }) as HTMLButtonElement;
    expect(add().disabled).toBe(false);
    fireEvent.click(add());
    expect((within(block(24)).getByLabelText("Início") as HTMLInputElement).value).toBe("23:00");
    expect((within(block(24)).getByLabelText("Fim") as HTMLInputElement).value).toBe("23:59");
    expect(add().disabled).toBe(true);
    fireEvent.click(add());
    expect(screen.queryByRole("group", { name: "faixa 25" })).toBeNull();
  });

  it("+ faixa depois de uma faixa que termina às 23:59 mostra o problema e trava o salvar", () => {
    renderIt({ ...MORNING, blocks: [ { starts: "08:00", ends: "23:59", kind: "walk_in" } ] });
    expect(save().disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "+ faixa" }));
    expect(within(block(2)).getByText("a faixa não cruza a meia-noite — use fim depois do início (sem 24:00)")).not.toBeNull();
    expect(save().disabled).toBe(true);
  });

  it("faixa que deixa de ser agendável perde tipo e duração da vaga no salvar", async () => {
    mocked(api.updateScheduleTemplate).mockResolvedValue(MORNING);
    renderIt({ ...MORNING, blocks: [
      { starts: "09:00", ends: "11:00", kind: "bookable", appointment_type_key: "consulta_medica", slot_minutes: 30 }
    ] });
    fireEvent.change(within(block(1)).getByLabelText("Tipo de faixa"), { target: { value: "blocked" } });
    expect(within(block(1)).queryByText(/faixa inválida/)).toBeNull();
    expect(save().disabled).toBe(false);
    fireEvent.change(within(block(1)).getByLabelText("Tipo de faixa"), { target: { value: "bookable" } });
    expect((within(block(1)).getByLabelText("Tipo de atendimento") as HTMLSelectElement).value).toBe("");
    expect((within(block(1)).getByLabelText("Vaga (min)") as HTMLInputElement).value).toBe("");
    fireEvent.change(within(block(1)).getByLabelText("Tipo de faixa"), { target: { value: "blocked" } });
    fireEvent.click(save());
    await waitFor(() => expect(api.updateScheduleTemplate).toHaveBeenCalled());
    const sent = mocked(api.updateScheduleTemplate).mock.calls[0][1] as { blocks: object[] };
    expect(sent.blocks).toStrictEqual([ { starts: "09:00", ends: "11:00", kind: "blocked" } ]);
  });
});
