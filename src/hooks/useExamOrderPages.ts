// src/hooks/useExamOrderPages.ts
// Lista de exames com "Carregar mais" pelo cursor do api (contrato §3, §4, §6).
// Dado de saúde: nada fica no cache depois que a tela sai (gcTime: 0).
import { useInfiniteQuery } from "@tanstack/react-query";
import { mergeById } from "../lib/exams";

// `P` é a página do api (ExamOrderPage, ProviderOrderPage…): quem chama lê
// o resto da página (ex.: overdue_count) em `query.data.pages`.
export function useExamOrderPages<P extends { orders: { id: string }[]; next_before: string | null }>(
  queryKey: readonly unknown[],
  fetchPage: (before: string | null) => Promise<P>,
  enabled = true
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled, gcTime: 0, staleTime: 0, retry: false
  });
  const orders: P["orders"][number][] = mergeById<P["orders"][number]>(query.data?.pages ?? []);
  return { query, orders };
}
