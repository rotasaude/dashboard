// useAlerts — consome /queues e /health, deriva alertas ativos e devolve
// junto das limitações fixas (sempre visíveis, §5 do brief).
//
// Queues e Health são cross-tenant (infra) — não escopados por município.

import { useQueues } from "./useQueues";
import { useHealth } from "./useHealth";
import { deriveAlerts } from "../lib/alerts";

export function useAlerts() {
  const q = useQueues();
  const h = useHealth();
  return deriveAlerts({
    queues: q.data?.data,
    health: h.data?.data
  });
}
