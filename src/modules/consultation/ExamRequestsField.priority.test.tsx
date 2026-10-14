import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ExamRequestsField } from "./ExamRequestsField";

afterEach(cleanup);
// O campo não lê a sessão: basta o QueryClient da busca de SIGTAP.
const renderField = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const VALUE = [ { sigtap_code: "0202020380", label: "Hemograma completo" } ];

describe("ExamRequestsField — prioridade (módulo 21a)", () => {
  it("com o rastreamento: escolhe urgente por exame; padrão rotina", () => {
    const onChange = vi.fn();
    renderField(<ExamRequestsField value={VALUE} onChange={onChange} cid10Allowed={false} priorityOn searchDelayMs={0} />);
    const select = screen.getByLabelText("Prioridade (0202020380)") as HTMLSelectElement;
    expect(select.value).toBe("routine");
    fireEvent.change(select, { target: { value: "urgent" } });
    expect(onChange).toHaveBeenCalledWith([ { sigtap_code: "0202020380", label: "Hemograma completo", priority: "urgent" } ]);
  });

  it("sem o rastreamento: nada muda", () => {
    renderField(<ExamRequestsField value={VALUE} onChange={vi.fn()} cid10Allowed={false} searchDelayMs={0} />);
    expect(screen.queryByLabelText("Prioridade (0202020380)")).toBeNull();
  });

  it("A33 (adendo): exame já pedido mostra a prioridade só para leitura; o novo escolhe", () => {
    const value = [ { ...VALUE[0], priority: "urgent" as const }, { sigtap_code: "0202010503", label: "HbA1c" } ];
    renderField(<ExamRequestsField value={value} onChange={vi.fn()} cid10Allowed={false} priorityOn fixedPriorityCodes={[ "0202020380" ]} searchDelayMs={0} />);
    expect(screen.queryByLabelText("Prioridade (0202020380)")).toBeNull();
    expect(screen.getByText("Prioridade: urgente")).not.toBeNull();
    expect(screen.getByLabelText("Prioridade (0202010503)")).not.toBeNull();
  });
});
