import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope } from "../lib/scope";
import type { EventsData } from "../lib/types";

export function useEvents(name?: string) {
  const scope = useScope();
  const filter = name && name !== "todos" ? { name } : {};
  return useQuery({
    queryKey: [ "events", scope.period, scope.municipalityId, name || "todos" ],
    queryFn: () => adminFetch<EventsData>("/events", { ...scopeParams(scope), ...filter }),
    staleTime: 15_000
  });
}
