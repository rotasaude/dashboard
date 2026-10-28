import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SurveillanceGate } from "./SurveillanceGate";
import { SURVEILLANCE_DISABLED, SURVEILLANCE_NO_ROLE } from "../../lib/surveillance";

let current: unknown = null;
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: current }) }));

const user = (role: string, features: string[]) => ({ operator: false, memberships: [ { role } ], features });

function show(u: unknown, allow = (r: { surveillance: boolean }) => r.surveillance) {
  current = u;
  return render(
    <SurveillanceGate title="Fila" sub="sub" allow={allow}>{() => <p>conteúdo</p>}</SurveillanceGate>
  );
}

afterEach(cleanup);

describe("SurveillanceGate", () => {
  it("sem sessão não desenha nada", () => {
    expect(show(null).container.innerHTML).toBe("");
  });

  it("desligado: frase de desligado, sem conteúdo", () => {
    const { container, queryByText } = show(user("surveillance", []));
    expect(container.textContent).toContain(SURVEILLANCE_DISABLED);
    expect(queryByText("conteúdo")).toBeNull();
  });

  it("ligado, sem o papel: frase de sem papel", () => {
    const { container, queryByText } = show(user("analyst", [ "surveillance" ]));
    expect(container.textContent).toContain(SURVEILLANCE_NO_ROLE);
    expect(queryByText("conteúdo")).toBeNull();
  });

  it("ligado, com o papel: o conteúdo, com o título", () => {
    const { container, queryByText } = show(user("surveillance", [ "surveillance" ]));
    expect(queryByText("conteúdo")).not.toBeNull();
    expect(container.textContent).toContain("Fila");
  });
});
