// src/hooks/useAnalytics.ts
// Uma consulta por frente e recorte (módulo 14). O cache do TanStack já é por
// usuário (useSessionQueryClient); a chave leva só frente e recorte.
import { useQuery } from "@tanstack/react-query";
import { fetchAnalytics, type AnalyticsFront, type AnalyticsQuery } from "../lib/api";
import { analyticsKey } from "../lib/analytics";

export function useAnalytics<F extends AnalyticsFront>(front: F, query: AnalyticsQuery) {
  return useQuery({
    queryKey: analyticsKey(front, query),
    queryFn: () => fetchAnalytics(front, query),
    // D-1: o dado só muda de madrugada; 5 min evita refazer a leitura a cada aba.
    staleTime: 5 * 60_000
  });
}
