// Grid de KPIs responsivo. Reusado por todas as views.

import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  min?: number;
}

export function KpiGrid({ children, min = 200 }: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
        gap: 16
      }}
    >
      {children}
    </div>
  );
}
