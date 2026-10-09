// src/modules/consultation/StructuredFields.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, searchSigtap: vi.fn() };
});

import * as api from "../../lib/api";
import type { ExamRequest } from "../../lib/api";
import { ConductsField } from "./ConductsField";
import { ExamRequestsField } from "./ExamRequestsField";
import { options } from "../../test/consultationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function Conducts() {
  const [ value, setValue ] = useState<string[]>([]);
  return (<><ConductsField options={options().conducts} value={value} onChange={setValue} /><pre data-testid="v">{JSON.stringify(value)}</pre></>);
}
function Exams({ cid10Allowed, initial = [] }: { cid10Allowed: boolean; initial?: ExamRequest[] }) {
  const [ value, setValue ] = useState<ExamRequest[]>(initial);
  return (<><ExamRequestsField value={value} onChange={setValue} cid10Allowed={cid10Allowed} searchDelayMs={0} /><pre data-testid="v">{JSON.stringify(value)}</pre></>);
}
function withQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const value = () => JSON.parse(screen.getByTestId("v").textContent ?? "null");

describe("condutas e exames", () => {
  it("condutas pelas opções do api", () => {
    render(<Conducts />);
    fireEvent.click(screen.getByLabelText("Alta do episódio"));
    fireEvent.click(screen.getByLabelText("Retorno para consulta agendada"));
    expect(value()).toEqual([ "12", "9" ]);
    fireEvent.click(screen.getByLabelText("Alta do episódio"));
    expect(value()).toEqual([ "9" ]);
  });

  it("exame pela busca SIGTAP, sem repetir, com a justificativa CID-10 conferida", async () => {
    mocked(api.searchSigtap).mockResolvedValue([ { code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA" } ]);
    withQuery(<Exams cid10Allowed />);
    fireEvent.change(screen.getByLabelText("Solicitar exame (SIGTAP)"), { target: { value: "hemoglobina" } });
    fireEvent.click(await screen.findByRole("button", { name: "0202010503 — DOSAGEM DE HEMOGLOBINA GLICOSILADA" }));
    fireEvent.change(screen.getByLabelText("Solicitar exame (SIGTAP)"), { target: { value: "hemoglobina" } });
    fireEvent.click(await screen.findByRole("button", { name: "0202010503 — DOSAGEM DE HEMOGLOBINA GLICOSILADA" }));
    expect(value()).toEqual([ { sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA" } ]);
    const just = screen.getByLabelText("CID-10 de justificativa (0202010503)");
    fireEvent.change(just, { target: { value: "E1" } });
    expect(screen.getByRole("alert").textContent).toBe("use um código CID-10, ex.: E11 ou E119");
    fireEvent.change(just, { target: { value: "e11.9" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remover exame 0202010503" }));
    expect(value()).toEqual([]);
  });

  it("sem CID-10 para o CBO, não há justificativa", async () => {
    mocked(api.searchSigtap).mockResolvedValue([ { code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA" } ]);
    withQuery(<Exams cid10Allowed={false} />);
    fireEvent.change(screen.getByLabelText("Solicitar exame (SIGTAP)"), { target: { value: "hemoglobina" } });
    fireEvent.click(await screen.findByRole("button", { name: "0202010503 — DOSAGEM DE HEMOGLOBINA GLICOSILADA" }));
    expect(screen.queryByLabelText("CID-10 de justificativa (0202010503)")).toBeNull();
  });

  it("sem CID-10 para o CBO, a justificativa existente fica intacta no valor", async () => {
    mocked(api.searchSigtap).mockResolvedValue([ { code: "0202010999", label: "COLESTEROL TOTAL" } ]);
    withQuery(<Exams cid10Allowed={false} initial={[ { sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA", cid10_justification: "E11" } ]} />);
    expect(screen.queryByLabelText("CID-10 de justificativa (0202010503)")).toBeNull();
    fireEvent.change(screen.getByLabelText("Solicitar exame (SIGTAP)"), { target: { value: "colesterol" } });
    fireEvent.click(await screen.findByRole("button", { name: "0202010999 — COLESTEROL TOTAL" }));
    expect(value()[0]).toEqual({ sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA", cid10_justification: "E11" });
    fireEvent.click(screen.getByRole("button", { name: "Remover exame 0202010999" }));
    expect(value()).toEqual([ { sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA", cid10_justification: "E11" } ]);
  });
});
