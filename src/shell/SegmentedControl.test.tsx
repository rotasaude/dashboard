// O período selecionado precisa se distinguir dos outros em todo tema
// (no alto contraste, --panel e --sunken são ambos pretos).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";

afterEach(cleanup);

describe("SegmentedControl", () => {
  it("o selecionado usa o par accent/on-accent", () => {
    render(<SegmentedControl options={[ { key: "a", label: "Hoje" }, { key: "b", label: "7 dias" } ]} value="b" onChange={vi.fn()} />);
    const on = screen.getByRole("tab", { name: "7 dias" });
    const off = screen.getByRole("tab", { name: "Hoje" });
    expect(on.style.background).toBe("var(--accent)");
    expect(on.style.color).toBe("var(--on-accent)");
    expect(off.style.background).toBe("transparent");
  });
});
