// Roteador por hash do shell (spec do subprojeto 2, §3). #/ Início,
// #/grupo/<slug>, #/<id da tela>, #/acessibilidade. O Voltar sobe um nível
// porque cada `go` empilha um hash; rota inválida ou não permitida vira o
// Início com replaceState (não entra no histórico). Atalho interno (`go`)
// não passa pelo filtro: abre o que abre hoje.
import { useCallback, useEffect, useRef, useState } from "react";

export type Route<Id extends string = string> =
  | { kind: "home" }
  | { kind: "group"; slug: string }
  | { kind: "screen"; id: Id }
  | { kind: "a11y" };

export function slugOf(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, "-");
}

export function parseHash<Id extends string>(
  hash: string, ids: ReadonlySet<string>, slugs: ReadonlySet<string>
): Route<Id> | null {
  const path = hash.replace(/^#/, "");
  if (path === "" || path === "/") return { kind: "home" };
  if (path === "/acessibilidade") return { kind: "a11y" };
  const group = /^\/grupo\/([a-z0-9-]+)$/.exec(path);
  if (group) return slugs.has(group[1]) ? { kind: "group", slug: group[1] } : null;
  const screen = /^\/([a-z0-9_-]+)$/.exec(path);
  if (screen && ids.has(screen[1])) return { kind: "screen", id: screen[1] as Id };
  return null;
}

export function toHash(route: Route): string {
  switch (route.kind) {
    case "home":   return "#/";
    case "a11y":   return "#/acessibilidade";
    case "group":  return `#/grupo/${route.slug}`;
    case "screen": return `#/${route.id}`;
  }
}

function writeHash(route: Route, mode: "push" | "replace"): void {
  const url = new URL(window.location.href);
  url.hash = toHash(route);
  if (mode === "push") window.history.pushState(window.history.state, "", url.toString());
  else window.history.replaceState(window.history.state, "", url.toString());
}

export function useHashRoute<Id extends string>(opts: {
  ids: ReadonlySet<string>;
  slugs: ReadonlySet<string>;
  initial?: Route<Id>;
  isAllowed: (r: Route<Id>) => boolean;
}): { route: Route<Id>; go: (r: Route<Id>) => void } {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const resolve = useCallback((): Route<Id> => {
    const { ids, slugs, isAllowed } = optsRef.current;
    const parsed = parseHash<Id>(window.location.hash, ids, slugs);
    if (parsed && isAllowed(parsed)) return parsed;
    const home: Route<Id> = { kind: "home" };
    writeHash(home, "replace");
    return home;
  }, []);

  const [ route, setRoute ] = useState<Route<Id>>(() => {
    const empty = window.location.hash === "" || window.location.hash === "#";
    if (empty && opts.initial) {
      writeHash(opts.initial, "replace");
      return opts.initial;
    }
    return resolve();
  });

  useEffect(() => {
    const onNav = () => setRoute(resolve());
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
    };
  }, [ resolve ]);

  const go = useCallback((r: Route<Id>) => {
    // Clicar no lugar atual não empilha uma entrada repetida (A-07).
    if (toHash(r) === window.location.hash) { setRoute(r); return; }
    writeHash(r, "push");
    setRoute(r);
  }, []);

  return { route, go };
}
