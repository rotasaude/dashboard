// Contagem de bloqueios ativos do CIQ (módulo 21c; Divergência C11). Só a
// rota /count: a lista de bloqueios traz dado de corrida e a de revisões,
// número de requisição — o contador nunca as lê. Uma requisição por minuto;
// nada fica no cache quando ninguém observa (gcTime 0).
import { useQuery } from "@tanstack/react-query";
import { countActiveQcBlocks } from "../lib/api";
import { QC_BLOCK_COUNT_KEY } from "../lib/qc";

export const QC_BLOCK_REFRESH_MS = 60_000;

export function useQcBlockCount(enabled: boolean, userId: string | null) {
  return useQuery({
    queryKey: [ QC_BLOCK_COUNT_KEY, userId ],
    queryFn: () => countActiveQcBlocks(),
    enabled,
    refetchInterval: enabled ? QC_BLOCK_REFRESH_MS : false,
    gcTime: 0, staleTime: 0, retry: false
  });
}
