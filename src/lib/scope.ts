// Escopo do painel: período + município (fixo). Propagado aos hooks via
// React Query key. Sem ScopePicker — município vem de lib/tenant.
import { createContext, useContext } from "react";

export type PeriodKey = "today" | "7d" | "30d";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "7d",    label: "7 dias" },
  { key: "30d",   label: "30 dias" }
];

export interface Scope {
  period: PeriodKey;
  municipalityId: string;
  setPeriod: (p: PeriodKey) => void;
}

export const ScopeContext = createContext<Scope | null>(null);

export function useScope(): Scope {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope precisa estar dentro de <ScopeContext.Provider>");
  return ctx;
}

export function scopeParams(scope: Scope): Record<string, string> {
  return { period: scope.period, municipality_id: scope.municipalityId };
}
