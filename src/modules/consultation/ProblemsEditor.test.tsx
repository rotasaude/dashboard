// src/modules/consultation/ProblemsEditor.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, searchTerminology: vi.fn() };
});

import * as api from "../../lib/api";
import type { EvaluatedProblem, PatientProblem } from "../../lib/api";
import { ProblemsEditor } from "./ProblemsEditor";
import { TODAY19, problem } from "../../test/consultationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const T90 = problem();
const K86 = problem({ id: "pp2", code: "K86", label: "Hipertensão sem complicações", onset_on: null, onset_precision: null });

const E11 = problem({ id: "pp3", terminology: "cid10", code: "E11", label: "Diabetes mellitus não insulino-dependente" });

function Harness({ cid10Allowed = true, patientProblems = [ T90, K86 ] }: { cid10Allowed?: boolean; patientProblems?: PatientProblem[] }) {
  const [ items, setItems ] = useState<EvaluatedProblem[]>([]);
  return (
    <>
      <ProblemsEditor patientProblems={patientProblems} items={items} onChange={setItems} cid10Allowed={cid10Allowed}
        today={TODAY19} searchDelayMs={0} />
      <pre data-testid="items">{JSON.stringify(items)}</pre>
    </>
  );
}
function renderIt(cid10Allowed?: boolean, patientProblems?: PatientProblem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<Harness cid10Allowed={cid10Allowed} patientProblems={patientProblems} />, { wrapper });
}
const items = (): EvaluatedProblem[] => JSON.parse(screen.getByTestId("items").textContent ?? "[]");

describe("ProblemsEditor", () => {
  beforeEach(() => mocked(api.searchTerminology).mockReset());

  it("lista os ativos com o início e marca avaliar, resolver e desfazer", () => {
    renderIt();
    const list = screen.getByRole("list", { name: "problemas ativos do paciente" });
    expect(within(list).getByText(/Diabetes não insulino-dependente · desde 03\/2019/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Avaliar T90" }));
    expect(items()).toEqual([ { problem_id: "pp1", terminology: "ciap2", code: "T90", label: T90.label, action: "evaluate" } ]);
    expect(within(list).getByText("avaliado")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resolver T90" }));
    expect(items().map((i) => i.action)).toEqual([ "resolve" ]);
    fireEvent.click(screen.getByRole("button", { name: "Desfazer T90" }));
    expect(items()).toEqual([]);
  });

  it("corrigir início com precisão de ano; futuro é recusado sob o campo", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Corrigir início K86" }));
    const group = screen.getByRole("group", { name: "Início de K86" });
    fireEvent.change(within(group).getByLabelText("Precisão"), { target: { value: "year" } });
    fireEvent.change(within(group).getByLabelText("Início"), { target: { value: "2027" } });
    fireEvent.click(within(group).getByRole("button", { name: "Aplicar início" }));
    expect(within(group).getByRole("alert").textContent).toBe("o início não pode ser no futuro");
    fireEvent.change(within(group).getByLabelText("Início"), { target: { value: "2018" } });
    fireEvent.click(within(group).getByRole("button", { name: "Aplicar início" }));
    expect(items()).toEqual([ { problem_id: "pp2", terminology: "ciap2", code: "K86", label: K86.label, action: "correct_onset",
      onset_on: "2018-01-01", onset_precision: "year" } ]);
    expect(screen.queryByRole("group", { name: "Início de K86" })).toBeNull();
  });

  it("incluir T90 que já está na lista marca avaliado e avisa", async () => {
    mocked(api.searchTerminology).mockResolvedValue([ { code: "T90", label: "Diabetes não insulino-dependente" } ]);
    renderIt();
    fireEvent.change(screen.getByLabelText("Incluir problema (CIAP-2)"), { target: { value: "diabetes" } });
    fireEvent.click(await screen.findByRole("button", { name: "T90 — Diabetes não insulino-dependente" }));
    expect(items().map((i) => [ i.problem_id, i.action ])).toEqual([ [ "pp1", "evaluate" ] ]);
    expect(screen.getByRole("status").textContent).toBe("T90 já está na lista do paciente — marcado como avaliado");
  });

  it("incluir em CID-10 busca na terminologia escolhida e pede o início do novo", async () => {
    mocked(api.searchTerminology).mockResolvedValue([ { code: "E11", label: "Diabetes mellitus não insulino-dependente" } ]);
    renderIt();
    fireEvent.change(screen.getByLabelText("Terminologia"), { target: { value: "cid10" } });
    fireEvent.change(screen.getByLabelText("Incluir problema (CID-10)"), { target: { value: "diabetes" } });
    fireEvent.click(await screen.findByRole("button", { name: "E11 — Diabetes mellitus não insulino-dependente" }));
    expect(api.searchTerminology).toHaveBeenCalledWith("diabetes", "cid10");
    const added = screen.getByRole("list", { name: "problemas incluídos nesta consulta" });
    expect(within(added).getByText(/CID-10 · início não informado/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Informar início E11" }));
    const group = screen.getByRole("group", { name: "Início de E11" });
    fireEvent.change(within(group).getByLabelText("Início"), { target: { value: "2024-05" } });
    fireEvent.click(within(group).getByRole("button", { name: "Aplicar início" }));
    expect(items()).toEqual([ { problem_id: null, terminology: "cid10", code: "E11", label: "Diabetes mellitus não insulino-dependente",
      action: "add", onset_on: "2024-05-01", onset_precision: "month" } ]);
    fireEvent.click(screen.getByRole("button", { name: "Remover E11" }));
    expect(items()).toEqual([]);
  });

  it("sem CID-10 para o CBO, a terminologia só oferece CIAP-2", () => {
    renderIt(false);
    const select = screen.getByLabelText("Terminologia") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([ "ciap2" ]);
  });

  it("sem CID-10 para o CBO, problema CID-10 existente ainda pode ser avaliado e resolvido", () => {
    renderIt(false, [ E11 ]);
    const select = screen.getByLabelText("Terminologia") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([ "ciap2" ]);
    fireEvent.click(screen.getByRole("button", { name: "Avaliar E11" }));
    expect(items().map((i) => [ i.code, i.action ])).toEqual([ [ "E11", "evaluate" ] ]);
    fireEvent.click(screen.getByRole("button", { name: "Resolver E11" }));
    expect(items().map((i) => [ i.code, i.action ])).toEqual([ [ "E11", "resolve" ] ]);
  });
});
