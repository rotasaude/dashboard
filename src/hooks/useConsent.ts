import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import type { ConsentData } from "../lib/types";

export function useConsent() {
  const scope = useScope();
  return useQuery({
    queryKey: [ "consent", scope.period, scope.municipalityId ],
    queryFn: () => adminFetch<ConsentData>("/consent", scopeParams(scope)),
    staleTime: 30_000
  });
}
