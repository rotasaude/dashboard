// Contagem de valores críticos liberados sem registro de aviso (módulo 21b;
// Divergência D11). Só a rota /count: a lista grava leitura clínica na
// trilha, então o contador nunca a lê. Uma requisição por minuto; nada fica
// no cache quando ninguém observa (gcTime 0).
import { useQuery } from "@tanstack/react-query";
import { countUnnotifiedCriticals } from "../lib/api";
import { LAB_CRITICAL_COUNT_KEY } from "../lib/lab";

export const LAB_CRITICAL_REFRESH_MS = 60_000;

export function useLabCriticalCount(enabled: boolean, userId: string | null) {
  return useQuery({
    queryKey: [ LAB_CRITICAL_COUNT_KEY, userId ],
    queryFn: () => countUnnotifiedCriticals(),
    enabled,
    refetchInterval: enabled ? LAB_CRITICAL_REFRESH_MS : false,
    gcTime: 0, staleTime: 0, retry: false
  });
}
