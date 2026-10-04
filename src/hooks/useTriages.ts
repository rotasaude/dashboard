import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import { neighborhoodParams, useNeighborhoodFilter } from "../lib/neighborhoodFilter";
import type { TriagesData } from "../lib/types";

export function useTriages() {
  const scope = useScope();
  const neighborhood = useNeighborhoodFilter();
  return useQuery({
    queryKey: [ "triages", scope.period, scope.citySlug, neighborhood ],
    queryFn: () => adminFetch<TriagesData>("/triages", { ...scopeParams(scope), ...neighborhoodParams(neighborhood) }),
    staleTime: 30_000
  });
}
