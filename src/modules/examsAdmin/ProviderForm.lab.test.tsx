import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProviderForm } from "./ProviderForm";
import { providerBody, providerDraft } from "../../lib/examsAdmin";
import { examError } from "../../lib/exams";
import { ApiError } from "../../lib/api";
import { examCatalogItem, examProvider } from "../../test/examFixtures";

afterEach(cleanup);

const LABEL = "Usa o laboratório municipal do Rota Saúde (resultado sai pela liberação do laudo)";

function renderForm(initial = examProvider({ kind: "municipal" }), onReview = vi.fn()) {
  render(<ProviderForm initial={initial} catalog={[ examCatalogItem() ]} labOn onReview={onReview} onCancel={vi.fn()} />);
  return onReview;
}

describe("ProviderForm — laboratório municipal", () => {
  it("com municipal_lab: checkbox vai no corpo (com endereço e telefone)", () => {
    const onReview = renderForm();
    fireEvent.click(screen.getByLabelText(LABEL));
    fireEvent.change(screen.getByLabelText("Endereço do laboratório"), { target: { value: "Rua A, 10" } });
    fireEvent.change(screen.getByLabelText("Telefone do laboratório"), { target: { value: "(41) 3333-4444" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar e salvar" }));
    const body = onReview.mock.calls[0][0];
    expect(body.uses_municipal_lab).toBe(true);
    expect(body.address).toBe("Rua A, 10");
    expect(body.phone).toBe("4133334444");
  });

  it("marcado sem endereço ou telefone: avisa antes de enviar (B31)", () => {
    const onReview = renderForm();
    fireEvent.click(screen.getByLabelText(LABEL));
    fireEvent.click(screen.getByRole("button", { name: "Revisar e salvar" }));
    expect(screen.getByRole("alert").textContent).toMatch(/endereço/);
    fireEvent.change(screen.getByLabelText("Endereço do laboratório"), { target: { value: "Rua A, 10" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar e salvar" }));
    expect(screen.getByRole("alert").textContent).toMatch(/telefone/);
    fireEvent.change(screen.getByLabelText("Telefone do laboratório"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar e salvar" }));
    expect(screen.getByRole("alert").textContent).toMatch(/telefone/);
    expect(onReview).not.toHaveBeenCalled();
  });

  it("desmarcado: endereço e telefone são opcionais e não vão no corpo se vazios", () => {
    const onReview = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e salvar" }));
    expect(onReview.mock.calls[0][0].address).toBeUndefined();
  });

  it("avisa ao marcar e ao desmarcar (B35)", () => {
    renderForm(examProvider({ kind: "municipal", uses_municipal_lab: true, address: "Rua A", phone: "4133334444" }));
    fireEvent.click(screen.getByLabelText(LABEL));
    expect(screen.getByRole("status").textContent).toMatch(/volta a receber resultados/);
    fireEvent.click(screen.getByLabelText(LABEL));
    expect(screen.getByRole("status").textContent).toMatch(/deixa de receber resultados pelo portal/);
    expect(screen.getByRole("status").textContent).toMatch(/mesmo com o interruptor/);
  });

  it("sem municipal_lab: nem checkbox nem campo no corpo", () => {
    render(<ProviderForm initial={examProvider({ uses_municipal_lab: true })} catalog={[ examCatalogItem() ]} onReview={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText(/Usa o laboratório municipal/)).toBeNull();
    expect(screen.queryByLabelText("Endereço do laboratório")).toBeNull();
    expect("uses_municipal_lab" in providerBody(providerDraft(examProvider({ uses_municipal_lab: true })))).toBe(false);
    expect(providerBody(providerDraft(examProvider({ uses_municipal_lab: true })), true).uses_municipal_lab).toBe(true);
  });

  it("mensagens para os códigos novos do api", () => {
    for (const code of [ "invalid_address", "invalid_phone", "invalid_uses_municipal_lab", "municipal_lab_disabled" ]) {
      expect(examError(new ApiError(422, { error: code }, code))).not.toMatch(/não foi possível concluir/);
    }
  });
});
