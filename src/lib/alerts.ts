// deriveAlerts — alimenta o NotificationCenter (sino).
//
// O brief §5 manda que ressalvas estruturais ("fila verde ≠ entrega",
// "worker parado = risco LGPD") fiquem SEMPRE visíveis em uma seção
// "Limitações conhecidas". Os alertas ativos são derivados do estado
// atual do escopo carregado.
//
// Hoje os dados de queues/health vivem em hooks separados; esta função
// recebe-os já carregados e devolve a lista pronta para renderizar.

import type { Tone } from "../theme/tokens";

export interface Alert {
  id: string;
  severity: Exclude<Tone, "neutral">;
  title: string;
  body: string;
  to?: string; // módulo de destino quando clicar
}

interface Inputs {
  queues?: {
    queues: Array<{ name: string; urgent: boolean; oldestS: number; failed: number; depth: number }>;
    failedExecutions: Array<unknown>;
  };
  health?: {
    projections: Array<{ name: string; status: string; driftMin: number | null; thresholdMin: number }>;
  };
}

const FIXED_LIMITATIONS: Alert[] = [
  {
    id: "limit:queues-noop",
    severity: "warn",
    title: "Fila verde ≠ entrega garantida",
    body:
      "Idempotência grava processed_events antes do efeito (§1.2/§6.1). " +
      "No-op silencioso não aparece em failed_executions.",
    to: "queues"
  },
  {
    id: "limit:lgpd-worker",
    severity: "warn",
    title: "Worker parado = risco LGPD",
    body: "Sem worker, purga de inbound_messages.raw não roda. Cruzar com /health.",
    to: "health"
  }
];

export function deriveAlerts(inputs: Inputs): { active: Alert[]; limitations: Alert[] } {
  const active: Alert[] = [];

  if (inputs.queues) {
    const urgent = inputs.queues.queues.find((q) => q.urgent);
    if (urgent && urgent.oldestS > 60) {
      active.push({
        id: "queue:urgent-delayed",
        severity: "down",
        title: "Fila :urgent atrasada",
        body: `Mais antigo pendente: ${Math.round(urgent.oldestS / 60)} min.`,
        to: "queues"
      });
    }
    if (inputs.queues.failedExecutions.length > 0) {
      active.push({
        id: "queue:failed",
        severity: "down",
        title: `${inputs.queues.failedExecutions.length} execuções falhadas`,
        body: "Inspecione as falhas e a causa raiz antes de reenfileirar.",
        to: "queues"
      });
    }
  }

  if (inputs.health) {
    inputs.health.projections.forEach((p) => {
      if (p.status === "warn") {
        active.push({
          id: `health:drift:${p.name}`,
          severity: "warn",
          title: `Projeção derivando: ${p.name}`,
          body: `Drift ${p.driftMin} min (limiar ${p.thresholdMin} min).`,
          to: "health"
        });
      }
    });
  }

  return { active, limitations: FIXED_LIMITATIONS };
}

export function worstSeverity(alerts: Alert[]): Alert["severity"] | null {
  if (alerts.some((a) => a.severity === "down")) return "down";
  if (alerts.some((a) => a.severity === "warn")) return "warn";
  if (alerts.some((a) => a.severity === "info")) return "info";
  if (alerts.length > 0) return alerts[0].severity;
  return null;
}
