import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import { neighborhoodParams, useNeighborhoodFilter } from "../lib/neighborhoodFilter";
import type { OverviewData } from "../lib/types";

export function useOverview() {
  const scope = useScope();
  const neighborhood = useNeighborhoodFilter();
  return useQuery({
    queryKey: [ "overview", scope.period, scope.citySlug, neighborhood ],
    queryFn: () => adminFetch<OverviewData>("/overview", { ...scopeParams(scope), ...neighborhoodParams(neighborhood) }),
    staleTime: 30_000
  });
}
