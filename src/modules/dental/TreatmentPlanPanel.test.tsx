import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TreatmentPlanPanel } from "./TreatmentPlanPanel";
import { CEO_UNIT, FLUOR, RESIN, UBS, fields, plan, planItem, toothLoc } from "../../test/dentalFixtures";
import { MOUTH } from "../../lib/dental";

afterEach(cleanup);
const linked = fields({ procedures: [ { sigtap: RESIN.sigtap, location: toothLoc("16", "O"), quantity: 1, plan_item_id: "pi1" } ] });

describe("TreatmentPlanPanel", () => {
  it("itens com situação depois do rascunho e a sugestão de concluído", () => {
    const onMarkCompleted = vi.fn();
    render(<TreatmentPlanPanel plan={plan({ items: [ planItem(), planItem({ id: "pi2", status: "done", location: toothLoc("26") }) ] })} value={linked}
      unit={UBS} role="dentist" onChange={vi.fn()} onMarkCompleted={onMarkCompleted} />);
    expect(screen.getByRole("complementary", { name: "Plano de tratamento" })).not.toBeNull();
    expect(screen.getByText("dente 16, face oclusal/incisal")).not.toBeNull();
    expect(screen.getByText("feito nesta consulta")).not.toBeNull();
    expect(screen.getByText("feito")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Todos os itens do plano estão feitos ou cancelados. Marque o desfecho \"Tratamento concluído\".");
    fireEvent.click(screen.getByRole("button", { name: "Marcar tratamento concluído" }));
    expect(onMarkCompleted).toHaveBeenCalled();
  });

  it("com 15 marcado, só o aviso; com item planejado, nenhuma sugestão", () => {
    const { rerender } = render(<TreatmentPlanPanel plan={plan()} value={{ ...linked, dental_outcomes: [ "15" ] }} unit={UBS} role="dentist"
      onChange={vi.fn()} onMarkCompleted={vi.fn()} />);
    expect(screen.getByText("Tratamento concluído marcado — o plano fecha ao finalizar.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Marcar tratamento concluído" })).toBeNull();
    rerender(<TreatmentPlanPanel plan={plan()} value={fields()} unit={UBS} role="dentist" onChange={vi.fn()} onMarkCompleted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Marcar tratamento concluído" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("cancelar item pede motivo de 10 a 500 e entra no rascunho", () => {
    const onChange = vi.fn();
    render(<TreatmentPlanPanel plan={plan()} value={fields()} unit={UBS} role="dentist" onChange={onChange} onMarkCompleted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: `Cancelar item — ${RESIN.name}` }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(screen.getByText("o motivo precisa de 10 a 500 caracteres")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "dente indicado para extração" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(onChange).toHaveBeenCalledWith(fields({ plan_changes: { add: [], cancel: [ { item_id: "pi1", reason: "dente indicado para extração" } ] } }));
  });

  it("item cancelado no rascunho aparece como cancelado nesta consulta", () => {
    render(<TreatmentPlanPanel plan={plan()} value={fields({ plan_changes: { add: [], cancel: [ { item_id: "pi1", reason: "dente indicado para extração" } ] } })}
      unit={UBS} role="dentist" onChange={vi.fn()} onMarkCompleted={vi.fn()} />);
    expect(screen.getByText("cancelado nesta consulta")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancelar item/ })).toBeNull();
  });

  it("item cancelado no rascunho pode ter o cancelamento desfeito", () => {
    const onChange = vi.fn();
    const f = fields({ plan_changes: { add: [], cancel: [ { item_id: "pi1", reason: "dente indicado para extração" } ] } });
    render(<TreatmentPlanPanel plan={plan()} value={f} unit={UBS} role="dentist" onChange={onChange} onMarkCompleted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: `Desfazer cancelamento — ${RESIN.name}` }));
    expect(onChange).toHaveBeenCalledWith(fields({ plan_changes: { add: [], cancel: [] } }));
  });

  it("somente leitura: sem cancelar, desfazer nem marcar", () => {
    const withAdd = fields({ plan_changes: { add: [ { sigtap: FLUOR.sigtap, name: FLUOR.name, location: MOUTH } ], cancel: [] } });
    render(<TreatmentPlanPanel plan={plan()} value={withAdd} unit={UBS} role="dentist" readOnly onChange={vi.fn()} onMarkCompleted={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("auxiliar não cancela nem inclui; inclusão do rascunho desfaz", () => {
    const onChange = vi.fn();
    const withAdd = fields({ plan_changes: { add: [ { sigtap: FLUOR.sigtap, name: FLUOR.name, location: MOUTH } ], cancel: [] } });
    const { rerender } = render(<TreatmentPlanPanel plan={plan()} value={fields()} unit={UBS} role="auxiliary" onChange={onChange} onMarkCompleted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Cancelar item/ })).toBeNull();
    rerender(<TreatmentPlanPanel plan={plan()} value={withAdd} unit={UBS} role="dentist" onChange={onChange} onMarkCompleted={vi.fn()} />);
    expect(screen.getByText(`novo — ${FLUOR.name} · boca toda`)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Desfazer — ${FLUOR.name}` }));
    expect(onChange).toHaveBeenCalledWith(fields());
  });

  it("sem plano: na UBS explica onde o plano começa; no CEO, não", () => {
    const { rerender } = render(<TreatmentPlanPanel plan={null} value={fields({ dental_consultation_type: "2" })} unit={UBS} role="dentist" onChange={vi.fn()} onMarkCompleted={vi.fn()} />);
    expect(screen.getByText("Sem plano aberto nesta unidade.")).not.toBeNull();
    expect(screen.getByText("O plano começa na primeira consulta programática.")).not.toBeNull();
    rerender(<TreatmentPlanPanel plan={null} value={fields()} unit={CEO_UNIT} role="dentist" onChange={vi.fn()} onMarkCompleted={vi.fn()} />);
    expect(screen.queryByText("O plano começa na primeira consulta programática.")).toBeNull();
  });

  it("cancelar o plano pede motivo de 10 a 500, fica pendente com Desfazer e esconde o concluído", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TreatmentPlanPanel plan={plan()} value={fields()} unit={UBS} role="dentist" onChange={onChange} onMarkCompleted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar o plano" }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento do plano"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento do plano" }));
    expect(screen.getByText("o motivo precisa de 10 a 500 caracteres")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento do plano"), { target: { value: "paciente abandonou o tratamento" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento do plano" }));
    const pending = fields({ plan_changes: { add: [], cancel: [], cancel_plan: { reason: "paciente abandonou o tratamento" } } });
    expect(onChange).toHaveBeenCalledWith(pending);
    rerender(<TreatmentPlanPanel plan={plan({ items: [ planItem({ status: "done" }) ] })} value={pending} unit={UBS} role="dentist" onChange={onChange} onMarkCompleted={vi.fn()} />);
    expect(screen.getByText("plano a cancelar ao finalizar")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Marcar tratamento concluído" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar o plano" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer cancelamento do plano" }));
    expect(onChange).toHaveBeenLastCalledWith(fields({ plan_changes: { add: [], cancel: [] } }));
  });

  it("auxiliar e somente leitura não cancelam o plano", () => {
    const { rerender } = render(<TreatmentPlanPanel plan={plan()} value={fields()} unit={UBS} role="auxiliary" onChange={vi.fn()} onMarkCompleted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Cancelar o plano" })).toBeNull();
    rerender(<TreatmentPlanPanel plan={plan()} value={fields()} unit={UBS} role="dentist" readOnly onChange={vi.fn()} onMarkCompleted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Cancelar o plano" })).toBeNull();
  });
});
