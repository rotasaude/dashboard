import { useQuery } from "@tanstack/react-query";
import { adminFetch, ApiError } from "../lib/api";
import { useScope } from "../lib/scope";
import type { ProtocolDetailData, ProtocolsListData } from "../lib/types";

export function useProtocols() {
  const scope = useScope();
  return useQuery({
    queryKey: [ "protocols", scope.municipalityId ],
    queryFn: () => adminFetch<ProtocolsListData>("/protocols"),
    staleTime: 60_000
  });
}

export function useProtocolDetail(id: string | null) {
  return useQuery({
    queryKey: [ "protocol-detail", id ],
    queryFn: () => adminFetch<ProtocolDetailData>(`/protocols/${id}`),
    enabled: !!id,
    staleTime: 60_000,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 1;
    }
  });
}
