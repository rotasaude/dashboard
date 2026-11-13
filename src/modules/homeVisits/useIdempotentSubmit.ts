// src/modules/homeVisits/useIdempotentSubmit.ts
// Envio idempotente da visita (Task 7) e da atividade coletiva (Task 11), sobre o `useFormProblems`:
// - o corpo é montado uma vez por envio novo, com o `client_uuid` do formulário; o duplo clique manda uma vez;
// - 201/200 → `renew()` e `ok`; 4xx → `renew()` e as recusas nos campos (o api não gravou nada);
// - 429 `too_many_requests` → frase, campos livres, MESMO uuid (nada foi gravado, Q67);
// - rede ou 5xx → não se sabe se gravou: guarda o uuid e o corpo, `locked` trava os campos e o reenvio ("Tentar de novo")
//   manda exatamente o mesmo corpo; quem usa oferece também "Descartar";
// - uma gravação por vez na tela (`useWriteLock`).
import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api";
import { NETWORK_RETRY, homeVisitRefusals, isNetworkOrServer, type HomeVisitRefusal } from "../../lib/homeVisits";
import type { Problem } from "../../lib/pharmacy";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { useClientUuid } from "./useClientUuid";
import { useWriteLock } from "./writeLock";

export type IdempotentSend<B, T> = {
  check?(): Problem[];
  body(): B;
  call(input: B & { client_uuid: string }): Promise<T>;
  ok(result: T): void;
  // Recusa do api → problemas na tela (padrão: path e frase de cada recusa). `err` é o erro cru (ex.: candidatos do 409).
  refused?(refusals: HomeVisitRefusal[], err: unknown): Problem[];
};

const NO_EVENT = { preventDefault: () => {} } as FormEvent;

// `networkText`: a frase do envio pendurado (a da visita, por padrão; a atividade passa a dela).
export function useIdempotentSubmit(opts: { networkText?: string } = {}) {
  const f = useFormProblems({ refusals: (err) => homeVisitRefusals(err).map((r) => ({ ...r, participantIndex: null })), isStale: () => false });
  const id = useClientUuid();
  const lock = useWriteLock();
  const [ locked, setLocked ] = useState(false);
  // O envio pendurado (rede/5xx): o corpo exato e quem trata a resposta.
  const pending = useRef<{ input: unknown; send: IdempotentSend<unknown, unknown> } | null>(null);
  const lastErr = useRef<unknown>(null);
  const network = useRef(false);

  function attempt<B, T>(ev: FormEvent, send: IdempotentSend<B, T>, check: boolean) {
    network.current = false;
    return f.submit<T>(ev, {
      check: check ? send.check : undefined,
      call: async () => {
        const input = (pending.current?.input as B & { client_uuid: string } | undefined) ?? { ...send.body(), client_uuid: id.uuid };
        pending.current = { input, send: send as IdempotentSend<unknown, unknown> };
        try {
          return await lock.run(() => send.call(input));
        } catch (err) {
          lastErr.current = err;
          if (isNetworkOrServer(err)) { network.current = true; setLocked(true); throw err; }
          pending.current = null;
          setLocked(false);
          if (!(err instanceof ApiError && err.status === 429)) id.renew();
          throw err;
        }
      },
      ok: (result) => { pending.current = null; setLocked(false); id.renew(); send.ok(result); },
      refused: (refusals) => {
        if (network.current) return [ { path: "", text: opts.networkText ?? NETWORK_RETRY } ];
        return send.refused ? send.refused(refusals, lastErr.current) : refusals.map((r) => ({ path: r.path, text: r.text }));
      }
    });
  }

  // Envio novo (descarta nada: com `locked`, só "Tentar de novo" ou "Descartar"); outra gravação da tela em curso → nada.
  function send<B, T>(ev: FormEvent, s: IdempotentSend<B, T>) {
    if (locked || lock.held()) { ev.preventDefault(); return Promise.resolve(); }
    pending.current = null;
    return attempt(ev, s, true);
  }
  // O mesmo corpo, o mesmo uuid.
  function retry() {
    const p = pending.current;
    if (!p || lock.held()) return Promise.resolve();
    return attempt(NO_EVENT, p.send, false);
  }

  return { ...f, uuid: id.uuid, locked, busy: f.busy || lock.busy, send, retry };
}
