// Contagem de pedidos de regulação (módulo 26a). Só a rota /count: a lista é
// nominal e grava leitura na trilha, então o contador nunca a lê. Nada fica no
// cache quando ninguém observa (gcTime 0).
import { useQuery } from "@tanstack/react-query";
import { countRegulationRequests } from "../lib/api";
import { REG_COUNT_KEY } from "../lib/regulation";

export const REGULATION_COUNT_REFRESH_MS = 60_000;

export function useRegulationCount(enabled: boolean, userId: string | null) {
  return useQuery({
    queryKey: [ REG_COUNT_KEY, userId ],
    queryFn: () => countRegulationRequests(),
    enabled,
    refetchInterval: enabled ? REGULATION_COUNT_REFRESH_MS : false,
    gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false
  });
}
