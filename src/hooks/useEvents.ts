import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { scopeParams, useScope, type Scope } from "../lib/scope";
import type { EventsData } from "../lib/types";

// Janela própria do painel (datas locais YYYY-MM-DD). null = segue o período global.
export interface EventsWindow { from: string; to: string }

export interface EventsFilter {
  name?: string;                 // nome exato ou prefixo "x.*"; "todos"/vazio = sem filtro
  window?: EventsWindow | null;
}

export function eventsParams(scope: Scope, { name, window }: EventsFilter): Record<string, string> {
  const base = window ? { period: "custom", from: window.from, to: window.to } : scopeParams(scope);
  return name && name !== "todos" ? { ...base, name } : base;
}

export function useEvents(filter: EventsFilter = {}) {
  const scope = useScope();
  const params = eventsParams(scope, filter);
  return useQuery({
    queryKey: [ "events", scope.municipalityId, params ],
    queryFn: () => adminFetch<EventsData>("/events", params),
    staleTime: 15_000
  });
}
