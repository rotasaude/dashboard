import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UnitForm } from "./UnitForm";
import { EMPTY_ADDRESS_FIELDS } from "../../lib/unitAddress";

afterEach(cleanup);
const GESTAO = "Gestão (secretaria ou central de regulação)";
const form = (tfdOn?: boolean, kind = "ubs") => render(
  <UnitForm initial={{ name: "", kind, ...EMPTY_ADDRESS_FIELDS }} neighborhoods={[]} busy={false} tfdOn={tfdOn} onSave={() => undefined} onCancel={() => undefined} />);

describe("UnitForm — unidade de gestão (módulo 30)", () => {
  it("com o transporte usável a gestão é oferecida", () => {
    form(true);
    expect(screen.queryByRole("option", { name: GESTAO })).not.toBeNull();
  });
  it.each([ [ false ], [ undefined ] ])("desligado (%s): sem gestão", (tfdOn) => {
    form(tfdOn);
    expect(screen.queryByRole("option", { name: GESTAO })).toBeNull();
  });
  it("unidade de gestão existente continua legível com o transporte desligado", () => {
    form(false, "health_management");
    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).value).toBe("health_management");
  });
});
