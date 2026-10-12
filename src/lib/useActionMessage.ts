// Estado da mensagem de uma ação (spec 6a §3.4): start() limpa ao começar a
// próxima ação, ok()/fail() definem o resultado.
import { useCallback, useState } from "react";

export type ActionMessageValue = { kind: "ok" | "error"; text: string } | null;

export function useActionMessage() {
  const [ message, setMessage ] = useState<ActionMessageValue>(null);
  const start = useCallback(() => setMessage(null), []);
  const ok = useCallback((text: string) => setMessage({ kind: "ok", text }), []);
  const fail = useCallback((text: string) => setMessage({ kind: "error", text }), []);
  return { message, start, ok, fail };
}
