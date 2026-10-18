// src/modules/labAdmin/VersionForm.instrument.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), createLabExamVersion: vi.fn() };
});

import * as api from "../../lib/api";
import { VersionForm } from "./VersionForm";
import { renderWithProviders } from "../../test/campaignFixtures";
import { labExam, labVersion } from "../../test/labFixtures";
import { instrument, qcUser } from "../../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(qcUser([ "municipal_admin" ]));
  mocked(api.createLabExamVersion).mockReset().mockResolvedValue(labVersion({ id: "ev2", version: 2 }));
});

describe("VersionForm com aparelho (contrato §2)", () => {
  it("com aparelhos: escolhe e o corpo leva lab_instrument_id", async () => {
    renderWithProviders(<VersionForm exam={labExam()} instruments={[ instrument(), instrument({ id: "in2", name: "Yumizen H550", active: false }) ]} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Nova versão de Glicose (atual v1)" });
    const select = within(form).getByLabelText("Aparelho") as HTMLSelectElement;
    expect([ ...select.options ].map((o) => o.textContent)).toEqual([ "nenhum", "BS-200" ]);
    fireEvent.change(select, { target: { value: "in1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar versão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar versão 2" }));
    await waitFor(() => expect(api.createLabExamVersion).toHaveBeenCalled());
    expect(mocked(api.createLabExamVersion).mock.calls[0][1].lab_instrument_id).toBe("in1");
  });

  it("sem a prop: nenhum campo novo e o corpo do 21b", async () => {
    renderWithProviders(<VersionForm exam={labExam()} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Nova versão de Glicose (atual v1)" });
    expect(within(form).queryByLabelText("Aparelho")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar versão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar versão 2" }));
    await waitFor(() => expect(api.createLabExamVersion).toHaveBeenCalled());
    expect(mocked(api.createLabExamVersion).mock.calls[0][1]).not.toHaveProperty("lab_instrument_id");
  });

  it("a versão atual com aparelho vem escolhida", async () => {
    const exam = labExam({ current_version: labVersion({ lab_instrument_id: "in1" }) });
    renderWithProviders(<VersionForm exam={exam} instruments={[ instrument() ]} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Nova versão de Glicose (atual v1)" });
    expect((within(form).getByLabelText("Aparelho") as HTMLSelectElement).value).toBe("in1");
  });

  it("aparelho inativo da versão atual: campo vazio, com aviso, e o corpo leva null", async () => {
    const exam = labExam({ current_version: labVersion({ lab_instrument_id: "in2" }) });
    renderWithProviders(<VersionForm exam={exam} instruments={[ instrument(), instrument({ id: "in2", name: "Yumizen H550", active: false }) ]} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Nova versão de Glicose (atual v1)" });
    expect((within(form).getByLabelText("Aparelho") as HTMLSelectElement).value).toBe("");
    expect(within(form).getByText(/está inativo/)).not.toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar versão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar versão 2" }));
    await waitFor(() => expect(api.createLabExamVersion).toHaveBeenCalled());
    expect(mocked(api.createLabExamVersion).mock.calls[0][1].lab_instrument_id).toBeNull();
  });
});
