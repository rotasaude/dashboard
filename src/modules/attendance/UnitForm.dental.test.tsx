import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UnitForm } from "./UnitForm";
import { EMPTY_ADDRESS_FIELDS } from "../../lib/unitAddress";

afterEach(cleanup);
const CEO = "CEO (Centro de Especialidades Odontológicas)";
const form = (dentalOn?: boolean, kind = "ubs") => render(
  <UnitForm initial={{ name: "", kind, ...EMPTY_ADDRESS_FIELDS }} neighborhoods={[]} busy={false} dentalOn={dentalOn} onSave={() => undefined} onCancel={() => undefined} />);

describe("UnitForm — CEO (módulo 28)", () => {
  it("com dental_care ligado o CEO é oferecido", () => {
    form(true);
    expect(screen.queryByRole("option", { name: "UBS" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: CEO })).not.toBeNull();
  });
  it.each([ [ false ], [ undefined ] ])("desligado (%s): sem CEO", (dentalOn) => {
    form(dentalOn);
    expect(screen.queryByRole("option", { name: "UBS" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: CEO })).toBeNull();
  });
  it("unidade ceo existente com dental_care desligado ainda mostra CEO", () => {
    form(false, "ceo");
    expect(screen.queryByRole("option", { name: CEO })).not.toBeNull();
    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).value).toBe("ceo");
  });
});
