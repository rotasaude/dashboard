// Trilha das telas internas: Início › Grupo › Tela. O último item abre as
// outras telas do mesmo grupo. Grupo de uma tela (ou tela fora do menu):
// Início › Tela.
import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { RouteLink } from "./RouteLink";
import type { Route } from "./router";
import type { ShellGroup } from "./types";

export function Breadcrumb({ groups, route, go, titleFor }: {
  groups: ShellGroup[]; route: Route; go: (r: Route) => void; titleFor: (id: string) => string;
}) {
  const [ open, setOpen ] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [ open ]);

  if (route.kind !== "screen") return null;
  const group = groups.find((g) => g.items.some((i) => i.id === route.id));
  const title = titleFor(route.id);
  const multi = group && group.items.length > 1;

  return (
    <nav aria-label="Trilha" className="shell-crumbs">
      <RouteLink route={{ kind: "home" }} go={go}>Início</RouteLink>
      <span aria-hidden="true">›</span>
      {multi && (
        <>
          <RouteLink route={{ kind: "group", slug: group.slug }} go={go}>{group.label}</RouteLink>
          <span aria-hidden="true">›</span>
          <div ref={ref} className="shell-crumb-switch">
            <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {title} <IconChevronDown size={14} aria-hidden="true" />
            </button>
            {open && (
              <div role="menu" className="shell-menu">
                {group.items.map((i) => (
                  <button key={i.id} type="button" role="menuitem" aria-current={i.id === route.id ? "page" : undefined}
                    onClick={() => { setOpen(false); go({ kind: "screen", id: i.id }); }}>
                    {i.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {!multi && <span aria-current="page">{title}</span>}
    </nav>
  );
}
