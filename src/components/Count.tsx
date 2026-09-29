// Número de painel que pode vir suprimido (módulo 11): "< 5" com a dica.
import type { ReactNode } from "react";
import type { SmallCount } from "../lib/types";
import { SUPPRESSED_HINT, fmtCount, isSuppressed, suppressedLabel, whenAllCounted } from "../lib/smallCount";

export function Count({ value, unit }: { value: SmallCount | null | undefined; unit?: "%" | "min" }) {
  if (isSuppressed(value)) return <span title={SUPPRESSED_HINT}>{suppressedLabel(unit)}</span>;
  return <>{fmtCount(value, unit)}</>;
}

export function CountList({ items }: { items: Array<{ label: string; count: SmallCount }> }) {
  return (
    <ul aria-label="contagens" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, i) => (
        <li key={`${item.label}-${i}`} className="mono" style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
          <span style={{ color: "var(--ink2)" }}>{item.label}</span>
          <span><Count value={item.count} /></span>
        </li>
      ))}
    </ul>
  );
}

// Gráfico de proporção quando todas as categorias têm número; lista quando não.
export function SegmentsOrList<T extends { label: string; count: SmallCount }>(
  { segments, render }: { segments: T[]; render(counted: Array<T & { count: number }>): ReactNode }
) {
  const counted = whenAllCounted(segments);
  return counted ? <>{render(counted)}</> : <CountList items={segments} />;
}
