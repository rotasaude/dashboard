// src/hooks/usePendingSignatures.ts
// Pendentes de assinatura do próprio profissional (módulo 19b; contrato §5).
// A página e o contador do menu leem a mesma chave: uma requisição por minuto.
import { useQuery } from "@tanstack/react-query";
import { listPendingSignatures } from "../lib/api";
import { PENDING_KEY } from "../lib/signature";

export const PENDING_REFRESH_MS = 60_000;

export function usePendingSignatures(enabled: boolean) {
  return useQuery({
    queryKey: [ PENDING_KEY ],
    queryFn: listPendingSignatures,
    enabled,
    refetchInterval: enabled ? PENDING_REFRESH_MS : false
  });
}
