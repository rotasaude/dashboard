// Início (cards dos grupos) e tela do grupo (sub-cards): ícone + título +
// descrição, mesmo visual nos dois níveis (spec do subprojeto 2, §4.2).
import type { Icon } from "@tabler/icons-react";
import { RouteLink, routeForGroup } from "./RouteLink";
import type { Route } from "./router";
import type { Catalog, ShellGroup } from "./types";

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function Card({ route, go, icon: IconC, title, description, count }: {
  route: Route; go: (r: Route) => void; icon?: Icon; title: string; description?: string; count?: number;
}) {
  return (
    <RouteLink route={route} go={go} className="shell-card">
      <span className="shell-card-icon" aria-hidden="true">{IconC && <IconC size={24} stroke={1.75} />}</span>
      <span className="shell-card-title">
        {title}
        {count ? <span className="shell-card-count"> {count > 200 ? "200+" : count}</span> : null}
      </span>
      {description && <span className="shell-card-desc">{description}</span>}
    </RouteLink>
  );
}

export function HomeCards({ groups, catalog, go, now = new Date() }: {
  groups: ShellGroup[]; catalog: Catalog; go: (r: Route) => void; now?: Date;
}) {
  return (
    <section>
      <h1 className="shell-page-title">{greeting(now)}</h1>
      <p className="shell-page-sub">Escolha uma área para começar.</p>
      <div className="shell-cards">
        {groups.map((g) => (
          <Card key={g.slug} route={routeForGroup(g)} go={go} icon={catalog.groups[g.label]?.icon}
            title={g.label} description={catalog.groups[g.label]?.description} />
        ))}
      </div>
    </section>
  );
}

export function GroupCards({ group, catalog, go }: { group: ShellGroup; catalog: Catalog; go: (r: Route) => void }) {
  const meta = catalog.groups[group.label];
  const IconG = meta?.icon;
  return (
    <section>
      <div className="shell-page-head">
        <span className="shell-card-icon" aria-hidden="true">{IconG && <IconG size={24} stroke={1.75} />}</span>
        <div>
          <h1 className="shell-page-title">{group.label}</h1>
          {meta?.description && <p className="shell-page-sub">{meta.description}</p>}
        </div>
      </div>
      <div className="shell-cards">
        {group.items.map((i) => (
          <Card key={i.id} route={{ kind: "screen", id: i.id }} go={go} icon={catalog.screens[i.id]?.icon}
            title={i.label} description={catalog.screens[i.id]?.description} count={i.count} />
        ))}
      </div>
    </section>
  );
}
