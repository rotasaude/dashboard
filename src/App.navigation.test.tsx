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
    "open-drafts", "clinical-record", "signature", "clinical-documents-admin", "exams-admin" ] as const)
  ("%s.onGoToSecurity abre Segurança", (screenId) => {
    const navigate = vi.fn();
    (renderModule(screenId, navigate) as El).props.onGoToSecurity();
    expect(navigate).toHaveBeenCalledWith("security");
  });
});

describe("grupos do shell", () => {
  it("Bloqueios do CIQ levam a contagem no rótulo e no ponto do trilho", () => {
    const item = (n: number) => shellGroups(NAV_GROUPS, 0, 0, 0, n).flatMap((g) => g.items).find((i) => i.id === "lab-qc-blocks");
    expect(item(2)).toEqual({ id: "lab-qc-blocks", label: "Bloqueios e revisões do CIQ (2 ativos)", count: 2 });
    expect(item(0)).toEqual({ id: "lab-qc-blocks", label: "Bloqueios e revisões do CIQ" });
  });

  it("Resultados aguardando ciência leva a contagem no rótulo e no ponto do trilho", () => {
    const item = shellGroups(NAV_GROUPS, 0, 4).flatMap((g) => g.items).find((i) => i.id === "exam-acknowledgements");
    expect(item).toEqual({ id: "exam-acknowledgements", label: "Resultados aguardando ciência (4)", count: 4 });
  });

  it("Liberação de laudos leva a contagem no rótulo e no ponto do trilho; zero não acende nada", () => {
    const item = (n: number) => shellGroups(NAV_GROUPS, 0, 0, n).flatMap((g) => g.items).find((i) => i.id === "lab-release");
    expect(item(3)).toEqual({ id: "lab-release", label: "Liberação de laudos (3 sem aviso)", count: 3 });
    expect(item(0)).toEqual({ id: "lab-release", label: "Liberação de laudos" });
  });

  it("slugs vêm de NAV_GROUPS e Pendentes leva a contagem no rótulo (withPendingCount)", () => {
    const gs = shellGroups(NAV_GROUPS, 3);
    expect(gs.map((g) => g.slug)).toContain("visao-geral");
    expect(gs.map((g) => g.slug)).toContain("e-sus");
    const pending = gs.flatMap((g) => g.items).find((i) => i.id === "signature-pending");
    expect(pending).toEqual({ id: "signature-pending", label: "Pendentes de assinatura (3)", count: 3 });
  });

  it("200 ou mais pendentes aparece como 200+", () => {
    const pending = shellGroups(NAV_GROUPS, 200).flatMap((g) => g.items).find((i) => i.id === "signature-pending");
    expect(pending?.label).toBe("Pendentes de assinatura (200+)");
  });

  it("profissional de saúde não vê Equipe nem Cidade", () => {
    const user = { operator: false, memberships: [ { role: "health_professional" } ] };
    const slugs = shellGroups(navGroupsFor(user), 0).map((g) => g.slug);
    expect(slugs).not.toContain("equipe");
    expect(slugs).not.toContain("cidade");
    expect(slugs).toContain("atendimento");
  });
});
