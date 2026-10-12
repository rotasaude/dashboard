// Shell dos painéis (spec do subprojeto 2, §4): barra eMAG, barra de topo,
// faixa de contexto, trilho (≥1024) ou gaveta (<1024), trilha e conteúdo.
// Troca de rota: <title> e foco no h1 do conteúdo (ou no main).
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./shell.css";
import { EmagBar } from "./EmagBar";
import { TopBar } from "./TopBar";
import { Rail } from "./Rail";
import { Drawer } from "./Drawer";
import { Breadcrumb } from "./Breadcrumb";
import { toHash, type Route } from "./router";
import type { Catalog, ShellGroup } from "./types";

export function Shell({ product, groups, catalog, route, go, titleFor, context, notifications, account, children }: {
  product: string; groups: ShellGroup[]; catalog: Catalog; route: Route; go: (r: Route) => void;
  titleFor: (id: string) => string; context: ReactNode; notifications: ReactNode; account: ReactNode; children: ReactNode;
}) {
  const [ menuOpen, setMenuOpen ] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  const key = toHash(route);

  const pageTitle =
    route.kind === "home" ? "Início" :
    route.kind === "a11y" ? "Acessibilidade" :
    route.kind === "group" ? (groups.find((g) => g.slug === route.slug)?.label ?? "Início") :
    titleFor(route.id);

  useEffect(() => {
    document.title = `${pageTitle} · Rota Saúde`;
    if (first.current) { first.current = false; return; }
    const main = mainRef.current;
    if (!main) return;
    const target = main.querySelector<HTMLElement>("h1") ?? main;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  }, [ key, pageTitle ]);

  return (
    <div className="shell-root">
      <header className="shell-header">
        <EmagBar />
        <TopBar product={product} groups={groups} catalog={catalog} go={go} notifications={notifications}
          account={account} onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} menuButtonRef={menuButtonRef} />
        {context}
      </header>
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} groups={groups} route={route} go={go}
        returnFocusTo={menuButtonRef.current} />
      <div className="shell-body">
        <Rail groups={groups} catalog={catalog} route={route} go={go} />
        <main id="conteudo" ref={mainRef} className="shell-main">
          <Breadcrumb groups={groups} route={route} go={go} titleFor={titleFor} />
          {children}
        </main>
      </div>
    </div>
  );
}
