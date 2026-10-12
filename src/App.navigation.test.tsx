// Os atalhos entre telas continuam abrindo o mesmo destino, agora via rota.
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderModule, shellGroups } from "./App";
import { NAV_GROUPS, navGroupsFor } from "./shell/modules";

type El = ReactElement<Record<string, (id?: string) => void>>;

describe("atalhos entre telas", () => {
  it.each([
    [ "overview", "onNavigate", "queues" ],
    [ "overview", "onNavigate", "health" ],
    [ "overview", "onNavigate", "events" ],
    [ "protocols", "onNavigate", "security" ],
    [ "team", "onNavigate", "professionals" ],
    [ "attendance", "onNavigate", "security" ],
    [ "campaigns", "onNavigate", "security" ],
    [ "signature-pending", "onNavigate", "signature" ]
  ] as const)("%s.%s(%s) navega", (screenId, prop, target) => {
    const navigate = vi.fn();
    const el = renderModule(screenId, navigate) as El;
    el.props[prop](target);
    expect(navigate).toHaveBeenCalledWith(target);
  });

  it.each([ "integrations", "cnes", "production", "my-consultations", "professional-consultations",
    "open-drafts", "clinical-record", "signature", "clinical-documents-admin" ] as const)
  ("%s.onGoToSecurity abre Segurança", (screenId) => {
    const navigate = vi.fn();
    (renderModule(screenId, navigate) as El).props.onGoToSecurity();
    expect(navigate).toHaveBeenCalledWith("security");
  });
});

describe("grupos do shell", () => {
  it("slugs e itens vêm de NAV_GROUPS, com contagem só em Pendentes", () => {
    const gs = shellGroups(NAV_GROUPS, 3);
    expect(gs.map((g) => g.slug)).toContain("visao-geral");
    expect(gs.map((g) => g.slug)).toContain("e-sus");
    const pending = gs.flatMap((g) => g.items).find((i) => i.id === "signature-pending");
    expect(pending).toEqual({ id: "signature-pending", label: "Pendentes de assinatura", count: 3 });
  });

  it("profissional de saúde não vê Equipe nem Cidade", () => {
    const user = { operator: false, memberships: [ { role: "health_professional" } ] };
    const slugs = shellGroups(navGroupsFor(user), 0).map((g) => g.slug);
    expect(slugs).not.toContain("equipe");
    expect(slugs).not.toContain("cidade");
    expect(slugs).toContain("atendimento");
  });
});
