import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnitForm, type UnitFormValue } from "./UnitForm";
import { EMPTY_ADDRESS_FIELDS } from "../../lib/unitAddress";
import { PHONE_TEXT, PSY_ERRORS } from "../../lib/psychosocial";

afterEach(cleanup);

const EMPTY: UnitFormValue = { name: "CAPS AD Boqueirão", kind: "ubs", ...EMPTY_ADDRESS_FIELDS };
const form = (initial: UnitFormValue, props: Partial<Parameters<typeof UnitForm>[0]> = {}) => {
  const onSave = vi.fn();
  const ui = (p: Partial<Parameters<typeof UnitForm>[0]>) => (
    <UnitForm initial={initial} neighborhoods={[]} busy={false} onSave={onSave} onCancel={() => {}} {...props} {...p} />);
  const view = render(ui({}));
  return { onSave, rerender: (p: Partial<Parameters<typeof UnitForm>[0]>) => view.rerender(ui(p)) };
};
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

describe("UnitForm — CAPS (módulo 31)", () => {
  it("CAPS só com o interruptor; pede a modalidade; recusa classificação de 2 dígitos e aceita 3", () => {
    const { onSave, rerender } = form(EMPTY);
    expect(screen.queryByRole("option", { name: "CAPS" })).toBeNull();
    rerender({ capsOn: true });
    pick("Tipo", "caps");
    expect(screen.getByLabelText("Modalidade do CAPS")).not.toBeNull();
    save();
    expect(screen.getByText("escolha a modalidade do CAPS")).not.toBeNull();
    pick("Modalidade do CAPS", "caps_ad_iii");
    pick("Classificação do serviço 115", "02");
    save();
    expect(screen.getByText(PSY_ERRORS.invalid_service_classification)).not.toBeNull();
    expect(screen.queryByText("escolha a modalidade do CAPS")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    pick("Classificação do serviço 115", "002");
    save();
    expect(onSave.mock.calls[0][0]).toMatchObject({ kind: "caps", capsModality: "caps_ad_iii", serviceClassification: "002" });
  });
  it("a classificação é opcional; as sete modalidades são oferecidas", () => {
    const { onSave } = form({ ...EMPTY, kind: "caps" }, { capsOn: true });
    const modalities = [ ...(screen.getByLabelText("Modalidade do CAPS") as HTMLSelectElement).options ].map((o) => o.value).filter(Boolean);
    expect(modalities).toEqual([ "caps_i", "caps_ii", "caps_iii", "caps_i_child", "caps_ad", "caps_ad_iii", "caps_ad_iv" ]);
    pick("Modalidade do CAPS", "caps_ii");
    save();
    expect(onSave.mock.calls[0][0]).toMatchObject({ kind: "caps", capsModality: "caps_ii" });
    expect(onSave.mock.calls[0][0].serviceClassification ?? "").toBe("");
  });
  it("unidade CAPS já gravada aparece com o tipo e a modalidade mesmo sem o interruptor", () => {
    form({ ...EMPTY, kind: "caps", capsModality: "caps_ii", serviceClassification: "002" });
    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).value).toBe("caps");
    expect((screen.getByLabelText("Modalidade do CAPS") as HTMLSelectElement).value).toBe("caps_ii");
    expect((screen.getByLabelText("Classificação do serviço 115") as HTMLInputElement).value).toBe("002");
  });
  it("trocar o tipo para fora do CAPS esconde os campos e não leva a modalidade", () => {
    const { onSave } = form({ ...EMPTY, kind: "caps", capsModality: "caps_ii", serviceClassification: "002" });
    pick("Tipo", "ubs");
    expect(screen.queryByLabelText("Modalidade do CAPS")).toBeNull();
    save();
    const sent = onSave.mock.calls[0][0] as UnitFormValue;
    expect(sent.kind).toBe("ubs");
    expect(sent.capsModality).toBeUndefined();
    expect(sent.serviceClassification).toBeUndefined();
  });
});

describe("UnitForm — telefone (P27, toda unidade)", () => {
  it("campo opcional em qualquer tipo; 9 dígitos é recusado; 10 e 11 passam; vazio vale", () => {
    const { onSave } = form(EMPTY);
    pick("Telefone", "(41) 3333-444");
    save();
    expect(screen.getByText(PHONE_TEXT)).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    pick("Telefone", "4133334444");
    save();
    expect(onSave.mock.calls[0][0]).toMatchObject({ phone: "4133334444" });
    pick("Telefone", "");
    save();
    expect(onSave).toHaveBeenCalledTimes(2);
  });
  it("só dígitos: a máscara é descartada, mas o excesso é recusado, não cortado", () => {
    const { onSave } = form(EMPTY);
    pick("Telefone", "+55 (41) 99999-1234");
    expect((screen.getByLabelText("Telefone") as HTMLInputElement).value).toBe("5541999991234");
    save();
    expect(screen.getByText(PHONE_TEXT)).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("mostra todas as recusas de uma vez: telefone, modalidade e classificação", () => {
    form(EMPTY, { capsOn: true });
    pick("Tipo", "caps");
    pick("Telefone", "123");
    pick("Classificação do serviço 115", "1");
    save();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([ PHONE_TEXT, "escolha a modalidade do CAPS", PSY_ERRORS.invalid_service_classification ]);
  });
});
