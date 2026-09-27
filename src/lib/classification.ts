// Tolerância do consumidor (ADR 0015): enquanto houver api servindo o contrato
// antigo da Classificação (priorityTrue/priorityTrend, pivô low/medium/high,
// priority booleana), o painel o converte para o novo em vez de quebrar.
import type { ClassificationData } from "./types";

type Legacy = Partial<Omit<ClassificationData, "byProtocol" | "sampleTriages">> & {
  priorityTrue?: number;
  priorityTrend?: number[];
  byProtocol?: Array<{ protocol: string; counts?: Record<string, number>; [tier: string]: unknown }>;
  sampleTriages?: Array<Omit<ClassificationData["sampleTriages"][number], "priority" | "urgent"> & {
    priority: number | boolean | null;
    urgent?: boolean;
  }>;
};

const LEGACY_TIERS = [ "low", "medium", "high" ];

export function normalizeClassification(raw: Legacy): ClassificationData {
  const tiers = raw.tiers ?? [];
  const tierKeys = raw.tierKeys ?? tiers.map((t) => t.key ?? t.label);
  return {
    tiers,
    tierKeys,
    urgent: raw.urgent ?? raw.priorityTrue ?? 0,
    urgentMaxPriority: raw.urgentMaxPriority ?? 1,
    urgentTrend: raw.urgentTrend ?? raw.priorityTrend ?? [],
    byProtocol: (raw.byProtocol ?? []).map((row) => ({
      protocol: row.protocol,
      counts: row.counts ?? Object.fromEntries(LEGACY_TIERS.map((t) => [ t, Number(row[t] ?? 0) ]))
    })),
    byMode: raw.byMode ?? [],
    sampleTriages: (raw.sampleTriages ?? []).map((s) => ({
      ...s,
      priority: typeof s.priority === "number" ? s.priority : null,
      urgent: s.urgent ?? s.priority === true
    }))
  };
}
