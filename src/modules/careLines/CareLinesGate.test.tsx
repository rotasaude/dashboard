import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CareLinesGate } from "./CareLinesGate";
import { CARE_DISABLED, CARE_NO_ROLE } from "../../lib/careLines";

let current: unknown = null;
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: current }) }));

const user = (role: string, features: string[]) => ({ operator: false, memberships: [ { role } ], features });
const ALL = [ "clinical_record", "care_lines" ];

function show(u: unknown, allow = (r: { admin: boolean }) => r.admin) {
  current = u;
  return render(
    <CareLinesGate title="Linhas" sub="sub" allow={allow}>{() => <p>conteúdo</p>}</CareLinesGate>
  );
}

afterEach(cleanup);

describe("CareLinesGate", () => {
  it("sem sessão não desenha nada", () => {
    const { container } = show(null);
    expect(container.innerHTML).toBe("");
  });

  it("desligado: frase de desligado, sem conteúdo (também sem clinical_record)", () => {
    for (const features of [ [], [ "clinical_record" ], [ "care_lines" ] ]) {
      const { container, queryByText } = show(user("municipal_admin", features));
      expect(container.textContent).toContain(CARE_DISABLED);
      expect(queryByText("conteúdo")).toBeNull();
      cleanup();
    }
  });

  it("ligado, sem o papel: frase de sem papel", () => {
    const { container, queryByText } = show(user("analyst", ALL));
    expect(container.textContent).toContain(CARE_NO_ROLE);
    expect(queryByText("conteúdo")).toBeNull();
  });

  it("ligado, com o papel: o conteúdo, recebendo os papéis", () => {
    current = user("municipal_admin", ALL);
    let seen: unknown;
    const { queryByText } = render(
      <CareLinesGate title="Linhas" sub="sub" allow={(r) => r.admin}>{(r) => { seen = r; return <p>conteúdo</p>; }}</CareLinesGate>
    );
    expect(queryByText("conteúdo")).not.toBeNull();
    expect(seen).toEqual({ professional: false, admin: true, analyst: false });
  });
});
