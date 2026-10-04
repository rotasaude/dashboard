import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import { neighborhoodParams, useNeighborhoodFilter } from "../lib/neighborhoodFilter";
import type { ReportsData } from "../lib/types";

export function useReports() {
  const scope = useScope();
  const neighborhood = useNeighborhoodFilter();
  return useQuery({
    queryKey: [ "reports", scope.period, scope.citySlug, neighborhood ],
    queryFn: () => adminFetch<ReportsData>("/reports", { ...scopeParams(scope), ...neighborhoodParams(neighborhood) }),
    staleTime: 30_000
  });
}
