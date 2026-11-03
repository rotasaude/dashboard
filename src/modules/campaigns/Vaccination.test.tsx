// src/modules/campaigns/Vaccination.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AudienceBuilder } from "./AudienceBuilder";
import { emptyAudienceDraft } from "../../lib/campaigns";

afterEach(cleanup);
const OPTIONS = { protocols: [], tiers: [], outcomes: [], neighborhoods: [], units: [], immunobiologicals: [ { code: "42", name: "Penta" }, { code: "15", name: "BCG" } ] };

describe("público com vacina em atraso", () => {
  it("oferece o critério, as vacinas em ordem e a nota", () => {
    const onChange = vi.fn();
    render(<AudienceBuilder draft={emptyAudienceDraft()} options={OPTIONS} today="2026-11-02" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar critério clínico" }));
    fireEvent.click(screen.getByRole("button", { name: "Vacina em atraso" }));
    const next = onChange.mock.calls[0][0];
    cleanup();
    render(<AudienceBuilder draft={next} options={OPTIONS} today="2026-11-02" onChange={vi.fn()} />);
    expect(screen.getAllByRole("checkbox").map((c) => (c.parentElement?.textContent ?? "").trim())).toEqual([ "BCG", "Penta" ]);
    expect(screen.getByText(/Só entram cadernetas conferidas/)).not.toBeNull();
    expect(screen.getByText("marque ao menos uma vacina")).not.toBeNull();
    expect(screen.getByLabelText("Idade mínima (meses)")).not.toBeNull();
    expect(screen.getByLabelText("Idade máxima (meses)")).not.toBeNull();
  });
  it("sem o catálogo nas opções, não oferece", () => {
    render(<AudienceBuilder draft={emptyAudienceDraft()} options={{ ...OPTIONS, immunobiologicals: undefined }} today="2026-11-02" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar critério clínico" }));
    expect(screen.queryByRole("button", { name: "Vacina em atraso" })).toBeNull();
  });
});
