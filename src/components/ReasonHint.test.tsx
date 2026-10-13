import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReasonHint, reasonHint } from "./ReasonHint";

afterEach(cleanup);

describe("ReasonHint (FC-12)", () => {
  it("diz quanto falta e some quando basta", () => {
    expect(reasonHint("faltou")).toBe("mínimo de 10 caracteres — faltam 4");
    expect(reasonHint("documento perdido")).toBeNull();
    render(<ReasonHint id="h" text="curto" />);
    expect(screen.getByText("mínimo de 10 caracteres — faltam 5").id).toBe("h");
  });
});
