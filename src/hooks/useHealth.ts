import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import type { HealthData } from "../lib/types";

export function useHealth() {
  const scope = useScope();
  return useQuery({
    queryKey: [ "health", scope.municipalityId ],
    queryFn: () => adminFetch<HealthData>("/health", scopeParams(scope)),
    staleTime: 15_000,
    refetchInterval: 30_000
  });
}
