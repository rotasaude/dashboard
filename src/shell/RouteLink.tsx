// Link de rota: <a href="#/…"> de verdade (nova aba, copiar link), mas o
// clique primário sem modificador navega pelo `go` (empilha histórico).
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { toHash, type Route } from "./router";
import type { ShellGroup } from "./types";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  route: Route; go: (r: Route) => void; children: ReactNode; afterGo?: () => void;
};

export function RouteLink({ route, go, children, onClick, afterGo, ...rest }: Props) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(route);
    afterGo?.();
  }
  return <a href={toHash(route)} onClick={handle} {...rest}>{children}</a>;
}

export function routeForGroup(g: ShellGroup): Route {
  return g.items.length === 1 ? { kind: "screen", id: g.items[0].id } : { kind: "group", slug: g.slug };
}
