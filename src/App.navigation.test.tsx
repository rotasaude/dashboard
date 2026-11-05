// Os atalhos entre telas continuam abrindo o mesmo destino, agora via rota.
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { act, renderHook } from "@testing-library/react";
import { renderModule, shellGroups, useCapsHandoff } from "./App";
import { NAV_GROUPS, navGroupsFor, type ModuleId } from "./shell/modules";
import { TerritoryMicroAreas } from "./modules/TerritoryMicroAreas";
import { TerritoryTeam } from "./modules/TerritoryTeam";
import { RegistryStatus } from "./modules/RegistryStatus";
import { SurveillanceQueue } from "./modules/SurveillanceQueue";
import { SurveillanceNegatives } from "./modules/SurveillanceNegatives";
import { SurveillanceReports } from "./modules/SurveillanceReports";
import { SurveillancePanel } from "./modules/SurveillancePanel";
import { SurveillanceDiseases } from "./modules/SurveillanceDiseases";
import { CapsEnrollments } from "./modules/CapsEnrollments";

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
    "open-drafts", "clinical-record", "signature", "clinical-documents-admin", "exams-admin", "territory-micro-areas" ] as const)
  ("%s.onGoToSecurity abre Segurança", (screenId) => {
    const navigate = vi.fn();
    (renderModule(screenId, navigate) as El).props.onGoToSecurity();
    expect(navigate).toHaveBeenCalledWith("security");
  });

  it("territory-micro-areas abre a tela de microáreas", () => {
    expect((renderModule("territory-micro-areas", vi.fn()) as ReactElement).type).toBe(TerritoryMicroAreas);
  });

  it("as cinco telas da vigilância abrem a tela certa; a das doenças vai à Segurança", () => {
    const navigate = vi.fn();
    expect((renderModule("surveillance-queue", navigate) as ReactElement).type).toBe(SurveillanceQueue);
    expect((renderModule("surveillance-negatives", navigate) as ReactElement).type).toBe(SurveillanceNegatives);
    expect((renderModule("surveillance-reports", navigate) as ReactElement).type).toBe(SurveillanceReports);
    expect((renderModule("surveillance-panel", navigate) as ReactElement).type).toBe(SurveillancePanel);
    const diseases = renderModule("surveillance-diseases", navigate) as El;
    expect(diseases.type).toBe(SurveillanceDiseases);
    diseases.props.onGoToSecurity();
    expect(navigate).toHaveBeenCalledWith("security");
  });

  it("territory-team abre o território da equipe", () => {
    expect((renderModule("territory-team", vi.fn()) as ReactElement).type).toBe(TerritoryTeam);
  });

  it("registry-status abre a validade dos cadastros", () => {
    expect((renderModule("registry-status", vi.fn()) as ReactElement).type).toBe(RegistryStatus);
  });

  it("caps-reception: Abrir matrícula guarda o id e o CAPS e vai a Usuários do CAPS, que os recebe", () => {
    const navigate = vi.fn();
    const caps = { enrollment: null, openEnrollment: vi.fn() };
    const h = { enrollmentId: "en9", unitId: "capsad3" };
    (renderModule("caps-reception", navigate, caps) as ReactElement<{ onOpenEnrollment(x: typeof h): void }>).props.onOpenEnrollment(h);
    expect(caps.openEnrollment).toHaveBeenCalledWith(h);
    expect(navigate).toHaveBeenCalledWith("caps-enrollments");
    type Props = { initialEnrollment?: { enrollmentId: string; unitId: string } | null };
    const el = renderModule("caps-enrollments", navigate, { enrollment: h, openEnrollment: vi.fn() }) as ReactElement<Props>;
    expect(el.type).toBe(CapsEnrollments);
    expect(el.props.initialEnrollment).toEqual(h);
    expect((renderModule("caps-enrollments", navigate) as ReactElement<Props>).props.initialEnrollment).toBeNull();
  });

  it("a matrícula vale só para a ida a Usuários do CAPS: sair da tela a apaga", () => {
    const { result, rerender, unmount } = renderHook(({ active }: { active: ModuleId }) => useCapsHandoff(active),
      { initialProps: { active: "caps-reception" as ModuleId } });
    expect(result.current.enrollment).toBeNull();
    act(() => result.current.openEnrollment({ enrollmentId: "en9", unitId: "caps2" }));
    rerender({ active: "caps-enrollments" });
    expect(result.current.enrollment).toEqual({ enrollmentId: "en9", unitId: "caps2" });
    rerender({ active: "caps-today" });
    expect(result.current.enrollment).toBeNull();
    rerender({ active: "caps-enrollments" });
    expect(result.current.enrollment).toBeNull();
    unmount();
  });
});

describe("grupos do shell", () => {
  it("a fila da vigilância leva as imediatas no rótulo e no ponto do trilho", () => {
    const item = (n: number) => shellGroups(NAV_GROUPS, 0, 0, 0, 0, n).flatMap((g) => g.items).find((i) => i.id === "surveillance-queue");
    expect(item(2)).toEqual({ id: "surveillance-queue", label: "Fila da vigilância (2 imediatas)", count: 2 });
    expect(item(0)).toEqual({ id: "surveillance-queue", label: "Fila da vigilância" });
  });

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
