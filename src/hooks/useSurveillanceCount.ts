// Contagem de notificações da vigilância (módulo 25). Só a rota /count: a
// lista é nominal e grava leitura na trilha, então o contador nunca a lê. A
// fila usa este mesmo hook (mesma chave: uma leitura por minuto, não duas).
// Nada fica no cache quando ninguém observa (gcTime 0).
import { useQuery } from "@tanstack/react-query";
import { countNotifications } from "../lib/api";
import { SURVEILLANCE_COUNT_KEY } from "../lib/surveillance";

export const SURVEILLANCE_COUNT_REFRESH_MS = 60_000;

export function useSurveillanceCount(enabled: boolean, userId: string | null) {
  return useQuery({
    queryKey: [ SURVEILLANCE_COUNT_KEY, userId ],
    queryFn: () => countNotifications(),
    enabled,
    refetchInterval: enabled ? SURVEILLANCE_COUNT_REFRESH_MS : false,
    gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false
  });
}
