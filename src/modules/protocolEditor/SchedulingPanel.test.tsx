// src/modules/protocolEditor/SchedulingPanel.test.tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { SchedulingPanel } from "./SchedulingPanel";
import { TYPES } from "../../test/schedulingFixtures";
import { SUGGESTION_DEF } from "../../test/conditionFixtures";
import type { AppointmentType } from "../../lib/api";

afterEach(cleanup);

function Harness({ initial, types }: { initial: unknown; types: AppointmentType[] | null }) {
  const [ def, setDef ] = useState<unknown>(initial);
  return (
    <>
      <SchedulingPanel definition={def} types={types} onChange={setDef} />
      <pre data-testid="json">{JSON.stringify(def)}</pre>
    </>
  );
}
const json = () => JSON.parse(screen.getByTestId("json").textContent ?? "null");
const rule = (n: number) => screen.getByRole("group", { name: `regra ${n}` });

describe("SchedulingPanel", () => {
  it("+ regra monta tipo, prioridade, prazo e condição no JSON", () => {
    render(<Harness initial={SUGGESTION_DEF} types={TYPES} />);
    fireEvent.click(screen.getByRole("button", { name: "+ regra de agendamento" }));
    fireEvent.change(within(rule(1)).getByLabelText("Tipo de atendimento"), { target: { value: "consulta_medica" } });
    fireEvent.change(within(rule(1)).getByLabelText("Prioridade"), { target: { value: "priority" } });
    fireEvent.change(within(rule(1)).getByLabelText("Prazo (dias)"), { target: { value: "30" } });
    const when = within(rule(1)).getByRole("group", { name: "Quando gerar o pedido" });
    fireEvent.click(within(when).getByRole("button", { name: "+ condição" }));
    fireEvent.change(within(when).getByLabelText("valor"), { target: { value: "60" } });
    expect(json().scheduling).toEqual([
      { when: { gte: [ "profile.age", 60 ] }, appointment_type: "consulta_medica", priority: "priority", due_in_days: 30 }
    ]);
  });

  it("prazo inválido mostra o motivo e não chega ao JSON", () => {
    render(<Harness initial={{ ...SUGGESTION_DEF, scheduling: [ { when: { gte: [ "profile.age", 60 ] },
      appointment_type: "consulta_medica", priority: "routine", due_in_days: 30 } ] }} types={TYPES} />);
    fireEvent.change(within(rule(1)).getByLabelText("Prazo (dias)"), { target: { value: "400" } });
    expect(within(rule(1)).getByText("use de 1 a 365 dias")).not.toBeNull();
    expect(json().scheduling[0].due_in_days).toBe(30);
  });

  it("subir troca a ordem; remover a última tira o bloco do JSON", () => {
    const a = { when: { gte: [ "profile.age", 60 ] }, appointment_type: "consulta_medica", priority: "routine", due_in_days: 30 };
    const b = { ...a, appointment_type: "retorno" };
    render(<Harness initial={{ ...SUGGESTION_DEF, scheduling: [ a, b ] }} types={TYPES} />);
    fireEvent.click(within(rule(2)).getByRole("button", { name: "subir" }));
    expect(json().scheduling.map((r: { appointment_type: string }) => r.appointment_type)).toEqual([ "retorno", "consulta_medica" ]);
    fireEvent.click(within(rule(2)).getByRole("button", { name: "remover regra" }));
    fireEvent.click(within(rule(1)).getByRole("button", { name: "remover regra" }));
    expect("scheduling" in json()).toBe(false);
  });

  it("regra com tipo inativo ou desconhecido continua no select", () => {
    const base = { when: { gte: [ "profile.age", 60 ] }, priority: "routine", due_in_days: 30 };
    render(<Harness initial={{ ...SUGGESTION_DEF, scheduling: [
      { ...base, appointment_type: "puericultura" }, { ...base, appointment_type: "sumiu" } ] }} types={TYPES} />);
    const first = within(rule(1)).getByLabelText("Tipo de atendimento") as HTMLSelectElement;
    expect(first.value).toBe("puericultura");
    expect(within(first).getByRole("option", { name: "Puericultura (inativo)" })).not.toBeNull();
    const second = within(rule(2)).getByLabelText("Tipo de atendimento") as HTMLSelectElement;
    expect(second.value).toBe("sumiu");
    expect(within(second).getByRole("option", { name: "sumiu (não existe na cidade)" })).not.toBeNull();
    expect(within(rule(2)).getByText("tipo não existe nesta cidade: o gate avisa, sem bloquear")).not.toBeNull();
    expect(json().scheduling[1].appointment_type).toBe("sumiu");
  });

  it("sem lista de tipos, o tipo é texto livre com o padrão da chave", () => {
    render(<Harness initial={SUGGESTION_DEF} types={null} />);
    fireEvent.click(screen.getByRole("button", { name: "+ regra de agendamento" }));
    const field = within(rule(1)).getByLabelText("Tipo de atendimento (chave)") as HTMLInputElement;
    expect(field.tagName).toBe("INPUT");
    fireEvent.change(field, { target: { value: "Consulta" } });
    expect(within(rule(1)).getByText("tipo inválido: minúsculas, números e _")).not.toBeNull();
    fireEvent.change(field, { target: { value: "consulta_medica" } });
    expect(json().scheduling[0].appointment_type).toBe("consulta_medica");
    expect(screen.getByText("Sem acesso à lista de tipos da cidade: digite a chave (o gate avisa se ela não existir).")).not.toBeNull();
  });

  it("no limite de 10 regras o botão trava", () => {
    const r = { when: { gte: [ "profile.age", 60 ] }, appointment_type: "retorno", priority: "routine", due_in_days: 30 };
    render(<Harness initial={{ ...SUGGESTION_DEF, scheduling: Array.from({ length: 10 }, () => r) }} types={TYPES} />);
    expect((screen.getByRole("button", { name: "+ regra de agendamento" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("scheduling fora do formato: motivo, sem controles", () => {
    render(<Harness initial={{ ...SUGGESTION_DEF, scheduling: { a: 1 } }} types={TYPES} />);
    expect(screen.getByRole("alert").textContent).toBe("“scheduling” não é uma lista: corrija no JSON");
    expect(screen.queryByRole("button", { name: "+ regra de agendamento" })).toBeNull();
    expect(json().scheduling).toEqual({ a: 1 });
  });

  it("condição fora do subconjunto: regra avançada, intacta ao editar o resto", () => {
    const advanced = { custom_op: [ "profile.age", 60 ] };
    render(<Harness initial={{ ...SUGGESTION_DEF, scheduling: [ { when: advanced,
      appointment_type: "consulta_medica", priority: "routine", due_in_days: 30 } ] }} types={TYPES} />);
    expect(within(rule(1)).getByText("Regra avançada: o construtor não edita esta regra. Altere no JSON.")).not.toBeNull();
    fireEvent.change(within(rule(1)).getByLabelText("Prioridade"), { target: { value: "priority" } });
    expect(json().scheduling[0]).toEqual({ when: advanced, appointment_type: "consulta_medica", priority: "priority", due_in_days: 30 });
  });
});
