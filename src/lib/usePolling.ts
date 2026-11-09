// Polling sem vazamento (módulo 32a: fila da UPA e TV da sala de espera). Um pedido por vez: o próximo é agendado só depois da
// resposta (com sucesso ou erro) e do intervalo, num setTimeout limpo ao desmontar, ao trocar de chave e no refresh — nenhum timer
// sobrevive à tela (o vazamento de polling entre testes; precedente wpda ResultStep 82dddf1). Resposta em voo de uma chave velha ou
// de uma tela desmontada é descartada. Não serve para leitura que grava trilha (ex.: provisórios, Q29): essa é só sob demanda.
import { useCallback, useEffect, useRef, useState } from "react";

export interface Polling<T> { data: T | undefined; error: unknown; updatedAt: number | null; refresh(): void }

type Snapshot<T> = { key: string; data: T | undefined; error: unknown; updatedAt: number | null };

// `fetcher` nulo para o polling; trocar `key` zera os dados (na mesma renderização) e descarta a resposta em voo. O `fetcher` de cada
// render é guardado num ref: trocá-lo não reinicia o ciclo.
export function usePolling<T>(fetcher: (() => Promise<T>) | null, intervalMs: number, key: string): Polling<T> {
  const [ snap, setSnap ] = useState<Snapshot<T>>({ key, data: undefined, error: null, updatedAt: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seqRef = useRef(0);
  const refreshRef = useRef<() => void>(() => {});
  const enabled = fetcher !== null;

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let again = false;
    const seq = ++seqRef.current;
    const current = () => live && seq === seqRef.current;

    const tick = () => {
      const f = fetcherRef.current;
      if (!f || !current()) return;
      clearTimeout(timer);
      timer = undefined;
      inFlight = true;
      let request: Promise<T>;
      try { request = f(); } catch (e) { request = Promise.reject(e); }
      request
        .then(
          (data) => { if (current()) setSnap({ key, data, error: null, updatedAt: Date.now() }); },
          (error: unknown) => { if (current()) setSnap((s) => (s.key === key ? { ...s, error } : { key, data: undefined, error, updatedAt: null })); }
        )
        .finally(() => {
          inFlight = false;
          if (!current()) return;
          if (again) { again = false; tick(); return; }
          timer = setTimeout(tick, intervalMs);
        });
    };

    // Com o pedido em voo, não abre outro: pede de novo logo depois da resposta.
    refreshRef.current = () => {
      if (!current()) return;
      if (inFlight) { again = true; return; }
      tick();
    };
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
      refreshRef.current = () => {};
    };
  }, [ key, intervalMs, enabled ]);

  const refresh = useCallback(() => refreshRef.current(), []);
  const same = snap.key === key;
  return { data: same ? snap.data : undefined, error: same ? snap.error : null, updatedAt: same ? snap.updatedAt : null, refresh };
}
