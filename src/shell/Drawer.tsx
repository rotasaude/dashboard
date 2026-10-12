// Gaveta (<1024px): diálogo modal com todos os grupos e telas. Esc, clique
// no fundo ou escolher uma tela fecham; foco preso dentro e devolvido ao
// botão Menu ao fechar.
import { useEffect, useRef } from "react";
import { IconX } from "@tabler/icons-react";
import { RouteLink } from "./RouteLink";
import type { Route } from "./router";
import type { ShellGroup } from "./types";

export function Drawer({ open, onClose, groups, route, go, returnFocusTo }: {
  open: boolean; onClose: () => void; groups: ShellGroup[]; route: Route; go: (r: Route) => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    panel?.querySelector<HTMLElement>("a,button")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>("a,button"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); returnFocusTo?.focus(); };
  }, [ open, onClose, returnFocusTo ]);

  if (!open) return null;
  const currentId = route.kind === "screen" ? route.id : null;
  return (
    <div className="shell-drawer-root">
      <div className="shell-drawer-backdrop" data-testid="drawer-backdrop" onMouseDown={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Menu" className="shell-drawer">
        <div className="shell-drawer-head">
          <strong>Menu</strong>
          <button type="button" aria-label="Fechar menu" onClick={onClose}><IconX size={20} aria-hidden="true" /></button>
        </div>
        <nav aria-label="Menu">
          <RouteLink route={{ kind: "home" }} go={go} afterGo={onClose} className="shell-drawer-link">Início</RouteLink>
          {groups.map((g) => (
            <div key={g.slug}>
              <div className="shell-drawer-group">{g.label}</div>
              {g.items.map((i) => (
                <RouteLink key={i.id} route={{ kind: "screen", id: i.id }} go={go} afterGo={onClose}
                  aria-current={i.id === currentId ? "page" : undefined} className="shell-drawer-link">
                  {i.label}
                </RouteLink>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
