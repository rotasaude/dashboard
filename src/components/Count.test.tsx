import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Count } from "./Count";
import { SUPPRESSED_HINT } from "../lib/smallCount";

afterEach(cleanup);

describe("Count", () => {
  it("taxa suprimida: o span 'oculto' carrega a dica", () => {
    render(<Count value={{ suppressed: true }} unit="%" />);
    expect(screen.getByText("oculto").getAttribute("title")).toBe(SUPPRESSED_HINT);
    expect(SUPPRESSED_HINT).toContain("oculto");
  });
});
