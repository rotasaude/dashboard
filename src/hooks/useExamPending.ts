// src/hooks/useExamPending.ts
// Contagem de resultados aguardando a ciência de quem pediu e de negados
// (módulo 21a; A46). Só a rota /count: listar o pedido grava uma leitura
// clínica por ordem na auditoria, então o contador nunca lê a lista. O aviso
// do Início e o contador do menu leem a mesma chave: uma requisição por minuto. Dado de saúde: nada
// fica no cache depois que ninguém observa (gcTime 0) e a chave só leva o id
// do usuário.
import { useQuery } from "@tanstack/react-query";
import { countPendingAcknowledgements } from "../lib/api";
import { EXAM_PENDING_KEY } from "../lib/exams";

export const EXAM_PENDING_REFRESH_MS = 60_000;

export function useExamPending(enabled: boolean, userId: string | null) {
  return useQuery({
    queryKey: [ EXAM_PENDING_KEY, userId, "count" ],
    queryFn: () => countPendingAcknowledgements(),
    enabled,
    refetchInterval: enabled ? EXAM_PENDING_REFRESH_MS : false,
    gcTime: 0, staleTime: 0, retry: false
  });
}
