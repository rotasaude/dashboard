import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import { neighborhoodParams, useNeighborhoodFilter } from "../lib/neighborhoodFilter";
import type { ClassificationData } from "../lib/types";

export function useClassification() {
  const scope = useScope();
  const neighborhood = useNeighborhoodFilter();
  return useQuery({
    queryKey: [ "classification", scope.period, scope.municipalityId, neighborhood ],
    queryFn: () => adminFetch<ClassificationData>("/classification", { ...scopeParams(scope), ...neighborhoodParams(neighborhood) }),
    staleTime: 30_000
  });
}
