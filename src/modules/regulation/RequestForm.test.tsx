// src/modules/regulation/RequestForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  searchRegulationTargets: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError, type RegulationRequestInput } from "../../lib/api";
import { RequestForm } from "./RequestForm";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CARDIO, ECO, ENDO, regUser } from "../../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const JUST = "Dor torácica aos esforços há 3 meses, teste ergométrico alterado.";

describe("RequestForm", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "health_professional" ]));
    mocked(api.searchRegulationTargets).mockReset().mockImplementation(async (_q: string, type: string) => (type === "procedure" ? [ ECO ] : [ CARDIO, ENDO ]));
  });
  const mount = (over: Partial<Parameters<typeof RequestForm>[0]> = {}) => {
    const onSubmit = vi.fn(async (_body: RegulationRequestInput) => undefined);
    renderWithProviders(<RequestForm cbo="225142" cid10Allowed submitLabel="Salvar pedido" mode="create" delayMs={0}
      onSubmit={onSubmit} onCancel={vi.fn()} {...over} />);
    return onSubmit;
  };
  const pick = async (term: string, name: string) => {
    text("Especialidade ou procedimento", term);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  };

  it("médico: alvo pela busca, CID, justificativa e cor; o corpo exato", async () => {
    const onSubmit = mount();
    await pick("cardio", "Cardiologia");
    expect(mocked(api.searchRegulationTargets)).toHaveBeenLastCalledWith("cardio", "specialty");
    expect(screen.getByLabelText("CIAP-2 (opcional)")).not.toBeNull();
    text("CID-10", "i20.9"); text("Justificativa", JUST); text("Cor de risco sugerida", "yellow");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ type: "specialty", target_code: "225120", cid10: "I209", justification: JUST,
      suggested_color: "yellow" }));
  });

  it("procedimento e regulado pelo estado", async () => {
    const onSubmit = mount();
    fireEvent.click(screen.getByLabelText("Procedimento"));
    await pick("eco", "Ecocardiografia");
    text("CID-10", "I209"); text("Justificativa", JUST); text("Cor de risco sugerida", "green");
    fireEvent.click(screen.getByLabelText("Regulado pelo estado (SISREG, CARE, CROSS)"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    await waitFor(() => expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: "procedure", target_code: "0205010032", state_regulated: true }));
  });

  it("recusa antes de enviar e o texto fica, sem cortar", async () => {
    const onSubmit = mount();
    text("Justificativa", "x".repeat(2001));
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toBe("escolha a especialidade ou o procedimento");
    await pick("cardio", "Cardiologia");
    text("CID-10", "I2"); text("Cor de risco sugerida", "red");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toBe("use um código CID-10, ex.: E11 ou E119");
    text("CID-10", "I209");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a justificativa passa de 2000 caracteres");
    expect((screen.getByLabelText("Justificativa") as HTMLTextAreaElement).value).toHaveLength(2001);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("dentista: só especialidades odontológicas, CIAP-2 e sem CID-10; enfermeiro só a lista municipal e o CIAP-2", async () => {
    mocked(api.searchRegulationTargets).mockResolvedValue([ CARDIO, ENDO ]);
    mount({ cbo: "223208", cid10Allowed: false });
    expect(screen.queryByLabelText("Procedimento")).toBeNull();
    expect(screen.queryByLabelText("CID-10")).toBeNull();
    expect(screen.getByLabelText("CIAP-2")).not.toBeNull();
    text("Especialidade ou procedimento", "endo");
    expect(await screen.findByRole("button", { name: /Endodontia/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Cardiologia/ })).toBeNull();
    cleanup();
    mocked(api.searchRegulationTargets).mockResolvedValue([ ECO, { ...ECO, code: "0205010040", name: "Ecografia de abdômen total", nurse_allowed: false } ]);
    const onSubmit = mount({ cbo: "223505", cid10Allowed: false });
    expect(screen.queryByLabelText("CID-10")).toBeNull();
    fireEvent.click(screen.getByLabelText("Procedimento"));
    text("Especialidade ou procedimento", "eco");
    expect(await screen.findByRole("button", { name: /Ecocardiografia/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /abdômen/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ecocardiografia/ }));
    text("Justificativa", JUST); text("Cor de risco sugerida", "blue");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toBe("informe o CIAP-2");
    expect(onSubmit).not.toHaveBeenCalled();
    text("CIAP-2", "k86");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    await waitFor(() => expect(onSubmit.mock.calls[0][0]).toEqual({ type: "procedure", target_code: "0205010032", ciap2: "K86",
      justification: JUST, suggested_color: "blue" }));
  });

  it("CIAP-2 com formato errado não envia", async () => {
    const onSubmit = mount({ cbo: "223505", cid10Allowed: false });
    fireEvent.click(screen.getByLabelText("Procedimento"));
    await pick("eco", "Ecocardiografia");
    text("CIAP-2", "K8"); text("Justificativa", JUST); text("Cor de risco sugerida", "blue");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toBe("use um código CIAP-2, ex.: K86");
    expect(document.activeElement).toBe(screen.getByLabelText("CIAP-2"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("recusa diagnosis_required do api fica no formulário com o texto digitado", async () => {
    const onSubmit = mount({ cbo: "223505", cid10Allowed: false });
    onSubmit.mockRejectedValueOnce(new ApiError(422, { error: "diagnosis_required", path: "ciap2" }, "x"));
    fireEvent.click(screen.getByLabelText("Procedimento"));
    await pick("eco", "Ecocardiografia");
    text("CIAP-2", "K86"); text("Justificativa", JUST); text("Cor de risco sugerida", "blue");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toBe("informe o CIAP-2 (ou o CID-10, se a sua ocupação usa)");
    expect((screen.getByLabelText("Justificativa") as HTMLTextAreaElement).value).toBe(JUST);
    expect((screen.getByLabelText("CIAP-2") as HTMLInputElement).value).toBe("K86");
  });

  it("complemento: tipo e alvo só leitura, sem 'regulado pelo estado', CID-10 e CIAP-2 pela regra do CBO", async () => {
    const onSubmit = mount({ mode: "complement", submitLabel: "Complementar",
      initial: { type: "specialty", target: { type: "specialty", code: "225120", name: "Cardiologia" }, cid10: "I209", ciap2: "", justification: JUST,
        color: "yellow", stateRegulated: true } });
    expect(screen.queryByLabelText("Procedimento")).toBeNull();
    expect(screen.queryByLabelText("Especialidade ou procedimento")).toBeNull();
    expect(screen.queryByLabelText("Regulado pelo estado (SISREG, CARE, CROSS)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Trocar" })).toBeNull();
    expect(screen.getByText(/Cardiologia/)).not.toBeNull();
    expect((screen.getByLabelText("CID-10") as HTMLInputElement).value).toBe("I209");
    expect(screen.getByLabelText("CIAP-2 (opcional)")).not.toBeNull();
    text("Justificativa", `${JUST} Complemento.`);
    fireEvent.click(screen.getByRole("button", { name: "Complementar" }));
    await waitFor(() => expect(onSubmit.mock.calls[0][0]).toEqual({ type: "specialty", target_code: "225120", cid10: "I209",
      justification: `${JUST} Complemento.`, suggested_color: "yellow" }));
  });

  it("Trocar volta à busca e onDirty avisa quando há texto ou escolha não enviada", async () => {
    const onDirty = vi.fn();
    mount({ onDirty });
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(false));
    await pick("cardio", "Cardiologia");
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByRole("button", { name: "Trocar" }));
    expect(screen.getByLabelText("Especialidade ou procedimento")).not.toBeNull();
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(false));
    text("Justificativa", "abc");
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
  });

  it("recusa do api (403 cbo_not_allowed) fica no formulário, com o que foi digitado", async () => {
    const onSubmit = mount();
    onSubmit.mockRejectedValueOnce(new ApiError(403, { error: "cbo_not_allowed" }, "x"));
    await pick("cardio", "Cardiologia");
    text("CID-10", "I209"); text("Justificativa", JUST); text("Cor de risco sugerida", "yellow");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/^seu CBO não pode pedir este encaminhamento/);
    expect((screen.getByLabelText("Justificativa") as HTMLTextAreaElement).value).toBe(JUST);
  });

  it("termo curto ou longo não chama o api", async () => {
    mount();
    text("Especialidade ou procedimento", "ca");
    expect(await screen.findByText("o termo de busca tem de 3 a 60 caracteres")).not.toBeNull();
    text("Especialidade ou procedimento", "c".repeat(61));
    expect(await screen.findByText("o termo de busca tem de 3 a 60 caracteres")).not.toBeNull();
    expect(mocked(api.searchRegulationTargets)).not.toHaveBeenCalled();
  });
});
