import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import type { IngestionData } from "../lib/types";

export function useIngestion() {
  const scope = useScope();
  return useQuery({
    queryKey: [ "ingestion", scope.period, scope.municipalityId ],
    queryFn: () => adminFetch<IngestionData>("/ingestion", scopeParams(scope)),
    staleTime: 30_000
  });
}
