import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TerritoryGate } from "./TerritoryGate";
import { TERRITORY_DISABLED, TERRITORY_NO_ROLE } from "../../lib/territoryRegistry";

let current: unknown = null;
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: current }) }));

const user = (role: string, features: string[]) => ({ operator: false, memberships: [ { role } ], features });
const ALL = [ "clinical_record", "territory_registry" ];

function show(u: unknown) {
  current = u;
  return render(
    <TerritoryGate title="Território" sub="sub" allow={(r) => r.admin}>{() => <p>conteúdo</p>}</TerritoryGate>
  );
}

afterEach(cleanup);

describe("TerritoryGate", () => {
  it("sem sessão não desenha nada", () => {
    expect(show(null).container.innerHTML).toBe("");
  });

  it("desligado (também sem clinical_record): frase de desligado, sem conteúdo", () => {
    for (const features of [ [], [ "clinical_record" ], [ "territory_registry" ] ]) {
      const { container, queryByText } = show(user("municipal_admin", features));
      expect(container.textContent).toContain(TERRITORY_DISABLED);
      expect(queryByText("conteúdo")).toBeNull();
      cleanup();
    }
  });

  it("operador nunca", () => {
    const { container } = show({ operator: true, memberships: [], features: ALL });
    expect(container.textContent).toContain(TERRITORY_DISABLED);
  });

  it("ligado, sem o papel: frase de sem papel", () => {
    const { container, queryByText } = show(user("analyst", ALL));
    expect(container.textContent).toContain(TERRITORY_NO_ROLE);
    expect(queryByText("conteúdo")).toBeNull();
  });

  it("ligado, com o papel: o conteúdo, recebendo os papéis", () => {
    current = user("municipal_admin", ALL);
    let seen: unknown;
    const { queryByText } = render(
      <TerritoryGate title="Território" sub="sub" allow={(r) => r.admin}>{(r) => { seen = r; return <p>conteúdo</p>; }}</TerritoryGate>
    );
    expect(queryByText("conteúdo")).not.toBeNull();
    expect(seen).toEqual({ professional: false, admin: true });
  });
});
