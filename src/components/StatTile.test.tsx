import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatTile } from "./StatTile";
import { SUPPRESSED_HINT } from "../lib/smallCount";

afterEach(cleanup);

describe("StatTile", () => {
  it("taxa suprimida: 'oculto' com a dica, sem '< 5', unidade nem delta", () => {
    render(<StatTile label="Taxa" value={{ suppressed: true }} unit="%" delta="+2" tone="ok" />);
    const value = screen.getByText("oculto");
    expect(value.getAttribute("title")).toBe(SUPPRESSED_HINT);
    expect(screen.queryByText("< 5")).toBeNull();
    expect(screen.queryByText("%")).toBeNull();
    expect(screen.queryByText("+2")).toBeNull();
  });

  it("média em min suprimida: 'oculto'; contagem simples suprimida segue '< 5'", () => {
    const { unmount } = render(<StatTile label="Tempo" value={{ suppressed: true }} unit="min" />);
    expect(screen.getByText("oculto")).toBeTruthy();
    unmount();
    render(<StatTile label="Iniciadas" value={{ suppressed: true }} />);
    expect(screen.getByText("< 5")).toBeTruthy();
  });

  it("número segue como antes", () => {
    render(<StatTile label="Iniciadas" value={1234} delta="+2" />);
    expect(screen.getByText("1.234")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
  });
});
