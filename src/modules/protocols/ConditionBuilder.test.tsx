// src/modules/protocols/ConditionBuilder.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { ConditionBuilder } from "./ConditionBuilder";
import { fieldsFor, type ConditionField } from "../../lib/condition";
import { NEIGHBORHOODS } from "../../test/conditionFixtures";

afterEach(cleanup);

const ELIG = fieldsFor("eligibility");
const REST = fieldsFor("restriction", { neighborhoods: NEIGHBORHOODS });

function Harness({ initial, fields = ELIG, onTree }: { initial: unknown; fields?: ConditionField[]; onTree: (t: unknown) => void }) {
  const [ value, setValue ] = useState<unknown>(initial);
  return (
    <>
      <ConditionBuilder label="Elegibilidade" fields={fields} value={value} emptyText="para todos"
        onChange={(tree) => { setValue(tree); onTree(tree); }} />
      <button type="button" onClick={() => setValue({ gte: [ "profile.age", 18 ] })}>trocar por fora</button>
    </>
  );
}

const lastTree = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0];
const row = (n: number) => screen.getByRole("group", { name: `condição ${n}` });

describe("ConditionBuilder", () => {
  it("vazio diz 'para todos'; idade a partir de 60 vira a árvore e a frase", () => {
    const onTree = vi.fn();
    render(<Harness initial={undefined} onTree={onTree} />);
    expect(screen.getByText("para todos")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ condição" }));
    fireEvent.change(within(row(1)).getByLabelText("valor"), { target: { value: "60" } });
    expect(lastTree(onTree)).toEqual({ gte: [ "profile.age", 60 ] });
    expect(screen.getByText("idade a partir de 60 anos")).not.toBeNull();
  });

  it("linha incompleta continua na tela e não emite nada", () => {
    const onTree = vi.fn();
    render(<Harness initial={undefined} onTree={onTree} />);
    fireEvent.click(screen.getByRole("button", { name: "+ condição" }));
    expect(lastTree(onTree)).toBeNull();
    expect(row(1)).not.toBeNull();
    expect(within(row(1)).getByText("informe o valor")).not.toBeNull();
    fireEvent.change(within(row(1)).getByLabelText("operador"), { target: { value: "between" } });
    fireEvent.change(within(row(1)).getByLabelText("de"), { target: { value: "60" } });
    fireEvent.change(within(row(1)).getByLabelText("até"), { target: { value: "18" } });
    expect(lastTree(onTree)).toBeNull();
    expect(within(row(1)).getByText("o início precisa ser menor que o fim")).not.toBeNull();
  });

  it("entre emite o all de gte e lte", () => {
    const onTree = vi.fn();
    render(<Harness initial={undefined} onTree={onTree} />);
    fireEvent.click(screen.getByRole("button", { name: "+ condição" }));
    fireEvent.change(within(row(1)).getByLabelText("operador"), { target: { value: "between" } });
    fireEvent.change(within(row(1)).getByLabelText("de"), { target: { value: "18" } });
    fireEvent.change(within(row(1)).getByLabelText("até"), { target: { value: "59" } });
    expect(lastTree(onTree)).toEqual({ all: [ { gte: [ "profile.age", 18 ] }, { lte: [ "profile.age", 59 ] } ] });
  });

  it("sexo é um de: marcar as duas opções", () => {
    const onTree = vi.fn();
    render(<Harness initial={undefined} onTree={onTree} />);
    fireEvent.click(screen.getByRole("button", { name: "+ condição" }));
    fireEvent.change(within(row(1)).getByLabelText("campo"), { target: { value: "profile.sex" } });
    fireEvent.click(within(row(1)).getByLabelText("feminino"));
    fireEvent.click(within(row(1)).getByLabelText("masculino"));
    expect(lastTree(onTree)).toEqual({ in: [ "profile.sex", [ "female", "male" ] ] });
    expect(screen.getByText("sexo feminino ou masculino")).not.toBeNull();
  });

  it("NÃO na linha e na raiz", () => {
    const onTree = vi.fn();
    render(<Harness initial={{ gte: [ "profile.age", 60 ] }} onTree={onTree} />);
    fireEvent.click(within(row(1)).getByLabelText("NÃO"));
    expect(lastTree(onTree)).toEqual({ not: { gte: [ "profile.age", 60 ] } });
    fireEvent.click(screen.getByLabelText("NÃO (negar tudo)"));
    expect(lastTree(onTree)).toEqual({ not: { all: [ { not: { gte: [ "profile.age", 60 ] } } ] } });
  });

  it("grupo OU dentro do E", () => {
    const onTree = vi.fn();
    render(<Harness initial={{ in: [ "profile.sex", [ "female" ] ] }} onTree={onTree} />);
    fireEvent.click(screen.getByRole("button", { name: "+ grupo" }));
    const group = screen.getByRole("group", { name: "grupo 2" });
    fireEvent.change(within(group).getByLabelText("valor"), { target: { value: "60" } });
    fireEvent.click(within(group).getByRole("button", { name: "+ condição" }));
    const second = within(group).getByRole("group", { name: "condição 2" });
    fireEvent.change(within(second).getByLabelText("operador"), { target: { value: "lte" } });
    fireEvent.change(within(second).getByLabelText("valor"), { target: { value: "2" } });
    expect(lastTree(onTree)).toEqual({ all: [
      { in: [ "profile.sex", [ "female" ] ] },
      { any: [ { gte: [ "profile.age", 60 ] }, { lte: [ "profile.age", 2 ] } ] }
    ] });
    expect(screen.getByText("sexo feminino e (idade a partir de 60 anos ou idade até 2 anos)")).not.toBeNull();
  });

  it("mudança vinda de fora reaparece nos controles", () => {
    render(<Harness initial={{ gte: [ "profile.age", 60 ] }} onTree={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "trocar por fora" }));
    expect((within(row(1)).getByLabelText("valor") as HTMLInputElement).value).toBe("18");
  });

  it("remover a única linha emite null e volta a 'para todos'", () => {
    const onTree = vi.fn();
    render(<Harness initial={{ gte: [ "profile.age", 60 ] }} onTree={onTree} />);
    fireEvent.click(within(row(1)).getByRole("button", { name: "remover" }));
    expect(lastTree(onTree)).toBeNull();
    expect(screen.getByText("para todos")).not.toBeNull();
  });

  it("regra avançada: só a frase, sem controles, e nada é emitido", () => {
    const onTree = vi.fn();
    render(<Harness initial={{ gt: [ "profile.age", 59 ] }} onTree={onTree} />);
    expect(screen.getByText("Regra avançada: o construtor não edita esta regra. Altere no JSON.")).not.toBeNull();
    expect(screen.getByText("idade acima de 59 anos")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "+ condição" })).toBeNull();
    expect(onTree).not.toHaveBeenCalled();
  });

  it("bairro inativo marcado aparece e sai ao desmarcar", () => {
    const onTree = vi.fn();
    render(<Harness fields={REST} initial={{ in: [ "citizen.neighborhood_id", [ "n3", "n1" ] ] }} onTree={onTree} />);
    const inactive = within(row(1)).getByLabelText("Centro (bairro inativo)") as HTMLInputElement;
    expect(inactive.checked).toBe(true);
    expect(screen.getByText("bairro Centro (bairro inativo) ou Xaxim")).not.toBeNull();
    fireEvent.click(inactive);
    expect(lastTree(onTree)).toEqual({ in: [ "citizen.neighborhood_id", [ "n1" ] ] });
    expect(within(row(1)).queryByLabelText("Centro (bairro inativo)")).toBeNull();
  });
});
