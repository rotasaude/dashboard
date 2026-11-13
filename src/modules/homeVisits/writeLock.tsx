// src/modules/homeVisits/writeLock.tsx
// Uma gravação por vez na tela (módulo 24b): enquanto fechar o dia, retirar ou registrar uma visita roda, os outros botões de
// gravação da mesma tela ficam bloqueados. Sem provedor (ex.: o detalhe da folha), o lock é livre e só executa.
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export interface WriteLock {
  busy: boolean;
  // Leitura síncrona (o `busy` do estado só chega no próximo render): para recusar um segundo envio no mesmo clique.
  held(): boolean;
  run<T>(fn: () => Promise<T>): Promise<T>;
}

const FREE: WriteLock = { busy: false, held: () => false, run: (fn) => fn() };
const Lock = createContext<WriteLock>(FREE);

export function WriteLockProvider({ children }: { children: ReactNode }) {
  const count = useRef(0);
  const [ busy, setBusy ] = useState(false);
  const lock = useMemo<WriteLock>(() => ({
    busy,
    held: () => count.current > 0,
    run: async (fn) => {
      count.current += 1;
      setBusy(true);
      try { return await fn(); } finally {
        count.current -= 1;
        if (count.current === 0) setBusy(false);
      }
    }
  }), [ busy ]);
  return <Lock.Provider value={lock}>{children}</Lock.Provider>;
}

export const useWriteLock = (): WriteLock => useContext(Lock);
