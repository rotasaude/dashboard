import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import type { ReportsData } from "../lib/types";

export function useReports() {
  const scope = useScope();
  return useQuery({
    queryKey: [ "reports", scope.period, scope.municipalityId ],
    queryFn: () => adminFetch<ReportsData>("/reports", scopeParams(scope)),
    staleTime: 30_000
  });
}
