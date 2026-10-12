// TopBar.tsx — barra de topo só de navegação: Menu (<1024px), marca, busca,
// sino e conta.
import type { ReactNode, RefObject } from "react";
import { IconMenu2 } from "@tabler/icons-react";
import { Brand } from "./Brand";
import { ScreenSearch } from "./ScreenSearch";
import type { Route } from "./router";
import type { Catalog, ShellGroup } from "./types";

export function TopBar({ product, groups, catalog, go, notifications, account, onMenu, menuOpen, menuButtonRef }: {
  product: string; groups: ShellGroup[]; catalog: Catalog; go: (r: Route) => void;
  notifications: ReactNode; account: ReactNode; onMenu: () => void; menuOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement>;
}) {
  return (
    <div className="shell-topbar">
      <button ref={menuButtonRef} id="menu-botao" type="button" className="shell-menu-btn"
        aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onMenu}>
        <IconMenu2 size={20} aria-hidden="true" /> Menu
      </button>
      <Brand product={product} />
      <div style={{ flex: "0 1 320px", minWidth: 160 }}>
        <ScreenSearch groups={groups} catalog={catalog} go={go} />
      </div>
      <div className="shell-topbar-end">
        {notifications}
        {account}
      </div>
    </div>
  );
}
