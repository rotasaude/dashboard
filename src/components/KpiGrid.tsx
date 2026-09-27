// Grid de KPIs responsivo. Reusado por todas as views.
// Com `asOf`, carimba a linha com o "dados de <hora>" da resposta que trouxe
// os números (F-05.3: todo agregado mostra o carimbo; ADR 0022).

import type { ReactNode } from "react";
import { AsOfStamp } from "./AsOfStamp";

interface Props {
  children: ReactNode;
  min?: number;
  columns?: number;
  asOf?: string;
}

export function KpiGrid({ children, min = 200, columns, asOf }: Props) {
  return (
    <div role="group" aria-label="indicadores" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {asOf && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <AsOfStamp at={asOf} />
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: columns ? `repeat(${columns}, 1fr)` : `repeat(auto-fit, minmax(${min}px, 1fr))`,
          gap: columns ? 12 : 16
        }}
      >
        {children}
      </div>
    </div>
  );
}
