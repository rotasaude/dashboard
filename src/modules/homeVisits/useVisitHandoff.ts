// src/modules/homeVisits/useVisitHandoff.ts
// "Quem visitar" → "Folha do dia": o alvo da visita vai só em memória (nome incluso), nunca na URL nem no storage, e é
// apagado quando a tela ativa deixa de ser a folha do dia.
import { useEffect, useMemo, useState } from "react";
import type { ModuleId } from "../../shell/modules";

export type VisitStart = {
  teamId: string; microAreaId: string; householdId: string | null; familyId: string | null;
  patientId: string | null; displayName: string | null;
};
export type VisitHandoff = { start: VisitStart | null; startVisit(s: VisitStart): void };
export const NO_VISIT_HANDOFF: VisitHandoff = { start: null, startVisit: () => {} };

export function useVisitHandoff(active: ModuleId): VisitHandoff {
  const [ start, setStart ] = useState<VisitStart | null>(null);
  useEffect(() => { if (active !== "home-visit-day") setStart(null); }, [ active ]);
  return useMemo(() => ({ start, startVisit: setStart }), [ start ]);
}
