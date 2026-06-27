import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import type { OverviewData } from "../lib/types";

export function useOverview() {
  const scope = useScope();
  return useQuery({
    queryKey: [ "overview", scope.period, scope.municipalityId ],
    queryFn: () => adminFetch<OverviewData>("/overview", scopeParams(scope)),
    staleTime: 30_000
  });
}
