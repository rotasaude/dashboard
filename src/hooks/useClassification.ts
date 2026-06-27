import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import type { ClassificationData } from "../lib/types";

export function useClassification() {
  const scope = useScope();
  return useQuery({
    queryKey: [ "classification", scope.period, scope.municipalityId ],
    queryFn: () => adminFetch<ClassificationData>("/classification", scopeParams(scope)),
    staleTime: 30_000
  });
}
