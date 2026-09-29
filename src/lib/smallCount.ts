// Exibição de contagem suprimida (módulo 11; ADR 0023, "Supressão"). A regra
// é da API; aqui só se mostra "< 5" e nunca se trata suprimido como zero.
import type { SmallCount, Suppressed } from "./types";
import { fmtNumber, fmtPercent } from "./format";

export const SUPPRESSED_LABEL = "< 5";
export const SUPPRESSED_HINT =
  "Com um bairro escolhido, números de 1 a 4 aparecem como “< 5” para não identificar ninguém.";

export function isSuppressed(v: unknown): v is Suppressed {
  return typeof v === "object" && v !== null && (v as { suppressed?: unknown }).suppressed === true;
}

export function fmtCount(v: SmallCount | null | undefined, unit?: "%"): string {
  if (isSuppressed(v)) return SUPPRESSED_LABEL;
  return unit === "%" ? fmtPercent(v) : fmtNumber(v);
}

export function numberOrNull(v: SmallCount | null | undefined): number | null {
  return typeof v === "number" ? v : null;
}

// Ponto suprimido vira lacuna no gráfico: desenhar 0 seria afirmar um número.
export function chartSeries(values: SmallCount[]): (number | null)[] {
  return values.map(numberOrNull);
}

// Barra empilhada e funil calculam proporção sobre o total; com qualquer
// categoria suprimida não há total, então quem chama mostra a lista.
export function whenAllCounted<T extends { count: SmallCount }>(rows: T[]): Array<T & { count: number }> | null {
  return rows.every((r) => typeof r.count === "number") ? (rows as Array<T & { count: number }>) : null;
}
