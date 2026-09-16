// Resgate do grant de entrada na cidade (Plano 6). O grant vale 60 s e é de USO
// ÚNICO: o guard precisa impedir o SEGUNDO POST, não só ignorar o resultado
// dele. `cancelled` numa closure não serve — sob StrictMode o efeito é montado,
// limpo e montado de novo, e a segunda montagem tem uma closure nova. Um ref
// sobrevive a esse ciclo, então o mesmo token nunca é redimido duas vezes.
import { useEffect, useRef, useState } from "react";
import { redeemGrant } from "./api";
import type { Entry } from "./entry";

export function useGrantEntry(entry: Entry | null, onSettled: (ok: boolean) => void): boolean {
  const redeemed = useRef<string | null>(null);
  const [ failed, setFailed ] = useState(false);

  useEffect(() => {
    if (entry?.kind !== "grant") return;
    if (redeemed.current === entry.token) return;
    redeemed.current = entry.token;

    void (async () => {
      try {
        await redeemGrant(entry.token);
        onSettled(true);
      } catch {
        setFailed(true);
        onSettled(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ entry?.kind, entry?.token ]);

  return failed;
}
