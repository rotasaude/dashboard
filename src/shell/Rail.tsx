// Trilho de ícones (≥1024px): Início + um link por grupo visível; o grupo da
// rota atual fica com aria-current. Rótulo acessível e dica = nome do grupo.
import { IconHome } from "@tabler/icons-react";
import { RouteLink, routeForGroup } from "./RouteLink";
import type { Route } from "./router";
import type { Catalog, ShellGroup } from "./types";

export function groupOfRoute(groups: ShellGroup[], route: Route): ShellGroup | undefined {
  if (route.kind === "group") return groups.find((g) => g.slug === route.slug);
  if (route.kind === "screen") return groups.find((g) => g.items.some((i) => i.id === route.id));
  return undefined;
}

export function Rail({ groups, catalog, route, go }: {
  groups: ShellGroup[]; catalog: Catalog; route: Route; go: (r: Route) => void;
}) {
  const current = groupOfRoute(groups, route);
  return (
    <nav aria-label="Grupos" id="menu-grupos" className="shell-rail">
      <RouteLink route={{ kind: "home" }} go={go} aria-label="Início" title="Início"
        aria-current={route.kind === "home" ? "page" : undefined} className="shell-rail-link">
        <IconHome size={22} stroke={1.75} aria-hidden="true" />
      </RouteLink>
      {groups.map((g) => {
        const IconG = catalog.groups[g.label]?.icon;
        const dot = g.items.some((i) => (i.count ?? 0) > 0);
        return (
          <RouteLink key={g.slug} route={routeForGroup(g)} go={go} aria-label={g.label} title={g.label}
            aria-current={current?.slug === g.slug ? "page" : undefined} className="shell-rail-link">
            {IconG && <IconG size={22} stroke={1.75} aria-hidden="true" />}
            {dot && <span className="shell-rail-dot" aria-hidden="true" />}
          </RouteLink>
        );
      })}
    </nav>
  );
}
