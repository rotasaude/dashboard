// src/hooks/useExamPending.ts
// Resultados aguardando a ciência de quem pediu e os negados (módulo 21a;
// contrato §3, Divergência D7). O aviso do Início, o contador do menu e a
// tela leem a mesma chave: uma requisição por minuto. Dado de saúde: nada
// fica no cache depois que ninguém observa (gcTime 0) e a chave só leva o id
// do usuário.
import { useQuery } from "@tanstack/react-query";
import { listPendingAcknowledgements } from "../lib/api";
import { EXAM_PENDING_KEY } from "../lib/exams";

export const EXAM_PENDING_REFRESH_MS = 60_000;

export function useExamPending(enabled: boolean, userId: string | null) {
  return useQuery({
    queryKey: [ EXAM_PENDING_KEY, userId ],
    queryFn: listPendingAcknowledgements,
    enabled,
    refetchInterval: enabled ? EXAM_PENDING_REFRESH_MS : false,
    gcTime: 0, staleTime: 0, retry: false
  });
}
