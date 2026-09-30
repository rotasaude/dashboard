// src/modules/analytics/values.tsx
// Célula e taxa do Analytics (spec §8): "oculto" com a dica, "sem dado" para
// taxa sem denominador, percentual com uma casa.
import type { Cell, Rate } from "../../lib/api";
import { HIDDEN_HINT, NO_DATA_HINT, fmtCell, fmtRate } from "../../lib/analytics";
import { isSuppressed } from "../../lib/smallCount";

export function CellValue({ value }: { value: Cell | undefined }) {
  if (isSuppressed(value)) return <span title={HIDDEN_HINT}>{fmtCell(value)}</span>;
  return <>{fmtCell(value)}</>;
}

export function RateValue({ value }: { value: Rate | undefined }) {
  if (isSuppressed(value)) return <span title={HIDDEN_HINT}>{fmtRate(value)}</span>;
  if (value === null) return <span title={NO_DATA_HINT}>{fmtRate(value)}</span>;
  return <>{fmtRate(value)}</>;
}

export function Value({ kind, value }: { kind: "count" | "rate"; value: Cell | Rate | undefined }) {
  return kind === "rate" ? <RateValue value={value as Rate | undefined} /> : <CellValue value={value as Cell | undefined} />;
}
