import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import type { ConversationsData } from "../lib/types";

export function useConversations() {
  const scope = useScope();
  return useQuery({
    queryKey: [ "conversations", scope.period, scope.municipalityId ],
    queryFn: () => adminFetch<ConversationsData>("/conversations", scopeParams(scope)),
    staleTime: 30_000
  });
}
