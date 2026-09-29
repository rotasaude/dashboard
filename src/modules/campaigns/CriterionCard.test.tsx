// src/modules/campaigns/CriterionCard.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Criterion } from "../../lib/api";
import { CriterionCard } from "./CriterionCard";
import { OPTIONS } from "../../test/campaignFixtures";

afterEach(cleanup);
const TODAY = "2026-09-29";
const P = { from: "2026-09-01", to: "2026-09-29" };

function renderCard(criterion: Criterion, options = OPTIONS) {
  const onChange = vi.fn();
  const onRemove = vi.fn();
  render(<CriterionCard criterion={criterion} options={options} today={TODAY} onChange={onChange} onRemove={onRemove} />);
  return { onChange, onRemove };
}

describe("CriterionCard", () => {
  it("protocolo: escolhe da lista de opções", () => {
    const { onChange } = renderCard({ kind: "protocol_period", protocol_name: "", ...P });
    expect(screen.getByRole("region", { name: "Protocolo e período" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("escolha o protocolo");
    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "Febre" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "protocol_period", protocol_name: "Febre", ...P });
  });

  it("protocolo: sem triagem concluída na cidade, diz isso", () => {
    renderCard({ kind: "protocol_period", protocol_name: "", ...P }, { ...OPTIONS, protocols: [] });
    expect(screen.getByText("nenhum protocolo com triagem concluída ainda")).toBeTruthy();
  });

  it("faixa: marca e desmarca", () => {
    const { onChange } = renderCard({ kind: "triage_tier", tiers: [ "amarela" ], ...P });
    fireEvent.click(screen.getByRole("checkbox", { name: "vermelha" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "triage_tier", tiers: [ "amarela", "vermelha" ], ...P });
    fireEvent.click(screen.getByRole("checkbox", { name: "amarela" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "triage_tier", tiers: [], ...P });
  });

  it("desfecho: rótulos em português e unidade opcional", () => {
    const { onChange } = renderCard({ kind: "attendance_outcome", outcomes: [ "referred" ], ...P });
    expect((screen.getByRole("checkbox", { name: "encaminhado" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Unidade do atendimento (opcional)"), { target: { value: "u1" } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "attendance_outcome", outcomes: [ "referred" ], health_unit_id: "u1", ...P });
  });

  it("desfecho: voltar para 'qualquer unidade' limpa o campo", () => {
    const { onChange } = renderCard({ kind: "attendance_outcome", outcomes: [ "referred" ], health_unit_id: "u1", ...P });
    fireEvent.change(screen.getByLabelText("Unidade do atendimento (opcional)"), { target: { value: "" } });
    expect(onChange.mock.calls[0][0].health_unit_id).toBeUndefined();
  });

  it("pedido aberto: sem período, tipo e destino opcionais", () => {
    const { onChange } = renderCard({ kind: "appointment_request_open" });
    expect(screen.queryByLabelText("De")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "retorno" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "appointment_request_open", kinds: [ "return" ] });
    fireEvent.change(screen.getByLabelText("Unidade de destino (opcional)"), { target: { value: "u2" } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "appointment_request_open", target_unit_id: "u2" });
  });

  it("período: não deixa escolher depois de hoje e explica a recusa", () => {
    const { onChange } = renderCard({ kind: "appointment_no_show", ...P });
    const until = screen.getByLabelText("Até") as HTMLInputElement;
    expect(until.max).toBe(TODAY);
    fireEvent.change(until, { target: { value: "2026-09-20" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "appointment_no_show", from: "2026-09-01", to: "2026-09-20" });
    cleanup();

    renderCard({ kind: "appointment_no_show", from: "2026-09-01", to: "2026-09-30" });
    expect(screen.getByRole("alert").textContent).toBe("o período não pode terminar no futuro");
    cleanup();

    renderCard({ kind: "appointment_no_show", from: "2026-09-10", to: "2026-09-01" });
    expect(screen.getByRole("alert").textContent).toBe("a data inicial é depois da final");
  });

  it("remover", () => {
    const { onRemove } = renderCard({ kind: "appointment_no_show", ...P });
    fireEvent.click(screen.getByRole("button", { name: "Remover Falta em agendamento" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
