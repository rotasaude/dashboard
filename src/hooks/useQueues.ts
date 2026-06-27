import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import type { QueuesData } from "../lib/types";

// Queues é cross-tenant por natureza (infra). Não muda com escopo.
export function useQueues() {
  return useQuery({
    queryKey: [ "queues" ],
    queryFn: () => adminFetch<QueuesData>("/queues"),
    staleTime: 15_000,
    refetchInterval: 30_000
  });
}
