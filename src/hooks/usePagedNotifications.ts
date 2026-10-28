// Páginas extras de uma lista de notificações (módulo 25): a fila e os relatórios
// usam o mesmo "Carregar mais". A primeira página vem da query da tela; aqui ficam
// as seguintes, a dedupe por id (a ordem é por prazo, não por id: a linha pode
// repetir ou pular entre páginas, e a primeira vez vale) e o estado do pedido.
// Tudo vale só para a leitura que o pediu: o token é o escopo (aba, filtros) mais
// o instante da leitura, então trocar de escopo ou reler zera páginas, "ocupado" e
// erro. Resposta atrasada de outra leitura é descartada antes de qualquer setState.
import { useRef, useState } from "react";
import { listNotifications, type NotificationQuery, type SurveillanceNotification } from "../lib/api";
import { surveillanceError } from "../lib/surveillance";

export interface FirstPage { data?: { notifications: SurveillanceNotification[]; next_before: string | null }; dataUpdatedAt: number }
interface Extra { token: string; rows: SurveillanceNotification[]; next: string | null }
interface MoreState { token: string; busy: boolean; error: string | null }

export function uniqueById(rows: SurveillanceNotification[]): SurveillanceNotification[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export function usePagedNotifications(list: FirstPage, baseQuery: NotificationQuery, scope: string) {
  const [ extra, setExtra ] = useState<Extra | null>(null);
  const [ moreState, setMoreState ] = useState<MoreState | null>(null);

  const token = `${scope}|${list.dataUpdatedAt}`;
  const currentToken = useRef(token);
  currentToken.current = token;
  const liveExtra = extra && extra.token === token ? extra : null;
  const live = moreState && moreState.token === token ? moreState : null;
  const rows = uniqueById([ ...(list.data?.notifications ?? []), ...(liveExtra?.rows ?? []) ]);
  const next = liveExtra ? liveExtra.next : list.data?.next_before ?? null;

  async function loadMore() {
    if (!next || live?.busy) return;
    const asked = token;
    setMoreState({ token: asked, busy: true, error: null });
    try {
      const page = await listNotifications({ ...baseQuery, before: next });
      if (currentToken.current !== asked) return;
      setExtra((prev) => ({ token: asked, rows: [ ...(prev && prev.token === asked ? prev.rows : []), ...page.notifications ], next: page.next_before }));
      setMoreState({ token: asked, busy: false, error: null });
    } catch (err) {
      if (currentToken.current !== asked) return;
      setMoreState({ token: asked, busy: false, error: surveillanceError(err) });
    }
  }

  return { rows, next, more: { busy: live?.busy === true, error: live?.error ?? null }, loadMore };
}
