// src/modules/homeVisits/useClientUuid.ts
// O `client_uuid` do envio idempotente (módulo 24b, contrato §6): nasce com o formulário e só é trocado (`renew`) depois de uma
// resposta que diz que nada ficou pendurado (gravou, ou o api recusou). Na falha de rede ou 5xx ele fica: o reenvio leva o mesmo.
import { useCallback, useState } from "react";

// `randomUUID` só existe em contexto seguro; fora dele, um v4 montado com `getRandomValues` (que existe em qualquer contexto).
function newUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [ ...b ].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function useClientUuid(): { uuid: string; renew(): void } {
  const [ uuid, setUuid ] = useState(newUuid);
  const renew = useCallback(() => setUuid(newUuid()), []);
  return { uuid, renew };
}
