import { useQuery } from "@tanstack/react-query";
import { adminFetch, ApiError } from "../lib/api";
import type { TriageTrailData } from "../lib/types";

export function useTriageTrail(triageId: string | null) {
  return useQuery({
    queryKey: [ "triage-trail", triageId ],
    queryFn: () => adminFetch<TriageTrailData>(`/triages/${triageId}/trail`),
    enabled: !!triageId,
    staleTime: 60_000,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 1;
    }
  });
}
