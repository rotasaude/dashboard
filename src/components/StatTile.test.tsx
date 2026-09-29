import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatTile } from "./StatTile";
import { SUPPRESSED_HINT } from "../lib/smallCount";

afterEach(cleanup);

describe("StatTile", () => {
  it("suprimido: '< 5' com a dica, sem unidade nem delta", () => {
    render(<StatTile label="Taxa" value={{ suppressed: true }} unit="%" delta="+2" tone="ok" />);
    const value = screen.getByText("< 5");
    expect(value.getAttribute("title")).toBe(SUPPRESSED_HINT);
    expect(screen.queryByText("%")).toBeNull();
    expect(screen.queryByText("+2")).toBeNull();
  });

  it("número segue como antes", () => {
    render(<StatTile label="Iniciadas" value={1234} delta="+2" />);
    expect(screen.getByText("1.234")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
  });
});
