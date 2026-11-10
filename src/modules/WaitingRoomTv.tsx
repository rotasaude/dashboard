// Módulo 32a (F-32.5; contrato §8, §14 Q8): a TV da sala de espera em `/#/tv`, em tela cheia e fora do shell — sem sessão, sem
// AuthProvider, sem QueryClient, sem dado pessoal. Sem token, pede o código de pareamento; com token, mostra o quadro. O token fica só
// no localStorage do aparelho (toda leitura e escrita em try/catch: aba privada ou armazenamento bloqueado guardam o token só na
// memória) e nunca é mostrado nem registrado. Revogada (401 display_revoked/invalid_token), a chave some e a TV volta ao pareamento.
import { useState } from "react";
import { TvBoard } from "./waitingRoom/TvBoard";
import { TvPairing } from "./waitingRoom/TvPairing";

export const DISPLAY_TOKEN_KEY = "waitingRoom.displayToken";

interface Props { now?: () => Date; storage?: Storage | null }

function deviceStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function readToken(s: Storage | null): string | null {
  try { return s?.getItem(DISPLAY_TOKEN_KEY) || null; } catch { return null; }
}
function writeToken(s: Storage | null, token: string): void {
  try { s?.setItem(DISPLAY_TOKEN_KEY, token); } catch { /* fica só na memória */ }
}
function clearToken(s: Storage | null): void {
  try { s?.removeItem(DISPLAY_TOKEN_KEY); } catch { /* nada a apagar */ }
}

export function WaitingRoomTv({ now, storage }: Props = {}) {
  const [ store ] = useState<Storage | null>(() => (storage === undefined ? deviceStorage() : storage));
  const [ token, setToken ] = useState<string | null>(() => readToken(store));

  if (token === null) {
    return <TvPairing onPaired={(t) => { writeToken(store, t); setToken(t); }} />;
  }
  return <TvBoard key={token} token={token} now={now} onRevoked={() => { clearToken(store); setToken(null); }} />;
}
