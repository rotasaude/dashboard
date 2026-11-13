// src/modules/homeVisits/usePaged.tsx
// Lista paginada por cursor do módulo 24b (visitas e folhas da equipe, quem visitar, atividades coletivas). A ordem é a do api.
// `nominal`: leitura com trilha (`NOMINAL_QUERY`, nunca relida sozinha); senão `STATIC_QUERY`. Cursor antigo (`invalid_cursor`)
// recomeça da primeira página, uma vez, com a frase; se a releitura falhar, o erro aparece (sem laço).
import { useState, type ReactNode } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode } from "../../lib/api";
import { HOME_VISIT_ERRORS, NOMINAL_QUERY, STATIC_QUERY, homeVisitError } from "../../lib/homeVisits";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, stack } from "../exams/styles";

export type Page<T> = { items: T[]; next_before: string | null };

export function usePaged<T>(key: unknown[], fetchPage: (before: string | null) => Promise<Page<T>>, nominal: boolean, enabled: boolean) {
  const queryClient = useQueryClient();
  const [ note, setNote ] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: key, queryFn: ({ pageParam }) => fetchPage(pageParam), initialPageParam: null as string | null,
    getNextPageParam: (last: Page<T>) => last.next_before ?? undefined, enabled, ...(nominal ? NOMINAL_QUERY : STATIC_QUERY)
  });
  async function more() {
    setNote(null);
    const r = await q.fetchNextPage();
    if (!r.isError) return;
    if (errorCode(r.error) === "invalid_cursor") { setNote(HOME_VISIT_ERRORS.invalid_cursor); await queryClient.resetQueries({ queryKey: key }); }
    else setNote(homeVisitError(r.error));
  }
  const items = q.data ? q.data.pages.flatMap((p) => p.items) : null;
  return { items, error: q.isError && !q.data ? q.error : null, note, hasMore: !!q.hasNextPage, loadingMore: q.isFetchingNextPage, more };
}

export type Paged<T> = ReturnType<typeof usePaged<T>>;

// O corpo da lista: erro (sem dados), carregando, a frase do cursor, os itens e "Carregar mais".
export function PagedBody<T>({ list, children }: { list: Paged<T>; children(items: T[]): ReactNode }) {
  if (list.error) return <p role="alert" style={alert}>{homeVisitError(list.error)}</p>;
  if (!list.items) return <p role="status" style={muted}>Carregando…</p>;
  return (
    <div style={stack}>
      {list.note && <p role="status" style={muted}>{list.note}</p>}
      {children(list.items)}
      {list.hasMore && (
        <div><button type="button" style={secondaryButtonStyle} disabled={list.loadingMore} onClick={() => void list.more()}>{list.loadingMore ? "Carregando…" : "Carregar mais"}</button></div>
      )}
    </div>
  );
}
