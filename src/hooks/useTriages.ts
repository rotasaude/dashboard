import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import type { TriagesData } from "../lib/types";

export function useTriages() {
  const scope = useScope();
  return useQuery({
    queryKey: [ "triages", scope.period, scope.municipalityId ],
    queryFn: () => adminFetch<TriagesData>("/triages", scopeParams(scope)),
    staleTime: 30_000
  });
}
