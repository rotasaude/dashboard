// Aviso do navegador ao sair com algo não salvo (spec 6c, AT-03/AT-04). Nada
// é guardado no navegador: só se avisa.
import { useEffect } from "react";

export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [ active ]);
}
